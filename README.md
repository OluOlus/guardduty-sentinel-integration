# GuardDuty → Sentinel Integration

Production-ready ingestion and KQL parsing layer for AWS GuardDuty findings in Microsoft Sentinel. Supports the native AWS S3 connector and a direct EventBridge/Lambda path through Azure Monitor's DCR Logs Ingestion API.

## What This Solves

**The Problem**: Microsoft Sentinel can ingest GuardDuty data via the AWS S3 connector, but teams struggle with:
- Connector shows "Connected" but no data flows (usually KMS permissions)
- Raw GuardDuty data is hard to query and correlate
- No ASIM normalization for cross-source hunting
- Lack of operational validation and troubleshooting tools
- No real-time push option for time-sensitive findings

**The Solution**: A complete ingestion and parsing package — config-driven KQL functions that make GuardDuty data immediately queryable and ASIM-aligned, plus an optional Lambda handler for real-time EventBridge→Sentinel streaming.

## Quick Start

### Prerequisites

- Microsoft Sentinel workspace
- AWS GuardDuty enabled and exporting to S3
- Microsoft Sentinel AWS S3 connector installed

### 1. Set Up AWS S3 Connector

1. **Install AWS Solution** from Sentinel Content Hub
2. **Configure AWS S3 connector** for GuardDuty data type
3. **Use automatic setup script** (recommended) to create AWS resources

See [Connector Setup Guide](docs/connector-setup.md) for detailed steps.

### 2. Deploy KQL Functions

```bash
# Clone repository
git clone https://github.com/OluOlus/guardduty-sentinel-integration
cd guardduty-sentinel-integration

# Option A: One-command deploy script
./deploy.sh -g your-resource-group -w your-sentinel-workspace

# Option B: Azure CLI directly
az deployment group create \
  --resource-group your-resource-group \
  --template-file deployment/azuredeploy.json \
  --parameters workspaceName=your-sentinel-workspace
```

### 3. Validate Installation

```kql
// Run smoke tests to verify everything works
// Copy queries from validation/smoke_tests.kql
AWSGuardDuty_Main(1d) | take 10
```

## Architecture

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                    INGESTION PATHS                       │
                    ├─────────────────────────────────────────────────────────┤
                    │                                                         │
 AWS GuardDuty ─┬──▶ S3 Export → SQS → Sentinel AWS S3 Connector (polling)   │
                │   │                                                         │
                └──▶ EventBridge → Lambda → DCR Logs Ingestion (real-time)   │
                    │                                                         │
                    └──────────────────────────┬──────────────────────────────┘
                                               │
                                               ▼
                                      AWSGuardDuty Table
                                               │
                                               ▼
                              KQL Parsing Functions → ASIM Normalization
```

**Path 1 — S3 Connector (default):** Native Microsoft connector polls an SQS queue for S3 object notifications. No custom compute required. ~15-30 min latency.

**Path 2 — Lambda Direct Push (optional):** EventBridge triggers Lambda, which maps the finding to Microsoft's built-in `AWSGuardDuty` table contract and sends it through the DCR Logs Ingestion API. Sub-minute latency.

**Key Benefits:**
- Two ingestion paths: S3 connector (managed) or Lambda (real-time)
- Uses existing, supported Microsoft connector for the primary path
- One documented native table contract for both routes
- ASIM-aligned for cross-source hunting
- Built-in troubleshooting for common issues (KMS permissions)
- Raises delivery failures so Lambda retries and on-failure destinations work

## KQL Functions

### Core Functions

| Function | Purpose | Key Fields |
|----------|---------|---------|
| `AWSGuardDuty_Config()` | Centralised configuration | Table names, lookback, feature flags |
| `AWSGuardDuty_Main(lookback)` | Base parser — all findings | FindingId, Severity, AwsAccountId, gd |
| `AWSGuardDuty_Network(lookback)` | Network findings | RemoteIp, Protocol, VpcId, ThreatCategory |
| `AWSGuardDuty_IAM(lookback)` | IAM/API call findings | ApiName, UserName, AccessKeyId, RiskScore |
| `AWSGuardDuty_S3(lookback)` | S3 bucket findings | BucketName, EffectivePermission, EncryptionType |
| `AWSGuardDuty_EKS(lookback)` | EKS/Kubernetes findings | K8sNamespace, K8sUserName, K8sThreatCategory |
| `AWSGuardDuty_Malware(lookback)` | Malware scan findings | ScanId, ThreatName, ScanResult |
| `AWSGuardDuty_RDS(lookback)` | RDS database findings | DbInstanceId, DbUser, AuthMethod |
| `AWSGuardDuty_ASIMNetworkSession(lookback)` | ASIM network session normalization | SrcIpAddr, DstIpAddr, ThreatRiskLevel |
| `AWSGuardDuty_Schema(lookback)` | Data quality validation | OverallQualityScore, QualityCategory |

### Usage Examples

```kql
// High-severity findings from last 24 hours
AWSGuardDuty_Main(1d)
| where SeverityLevel == "High"
| project EventTime, FindingType, Title, AwsAccountId, AwsRegion

// Network threat analysis
AWSGuardDuty_Network(7d)
| where isnotempty(RemoteIp)
| summarize Findings = count() by RemoteCountry, FindingType
| order by Findings desc

// S3 public exposure findings
AWSGuardDuty_S3(7d)
| where IsPubliclyExposed == true or S3RiskCategory == "Encryption Disabled"
| project EventTime, BucketName, S3RiskCategory, EffectivePermission, EncryptionType, AwsAccountId

// EKS privilege escalation and suspicious workloads
AWSGuardDuty_EKS(7d)
| where K8sThreatCategory in ("Privilege Escalation", "Credential Access")
| project EventTime, ClusterName, K8sNamespace, K8sObjectName, K8sIsPrivileged, K8sRiskScore

// ASIM-compliant network sessions for cross-source hunting
AWSGuardDuty_ASIMNetworkSession(1d)
| where NetworkDirection == "Inbound"
| project TimeGenerated, SrcIpAddr, DstIpAddr, DstPortNumber, ThreatCategory
```

## Configuration

All parsers compile against Microsoft's documented built-in `AWSGuardDuty`
table. The configuration function controls lookback and feature flags:

```kql
AWSGuardDuty_Config()
| where Setting == "DefaultLookback"  // Default: "7d"
```

`EventData` and `Message` are not columns in that native table. A custom source
table needs a separate adapter function; silently guessing a raw column is not
supported.

## Common Issues & Solutions

### Issue 1: Connector "Connected" But No Data
**Cause**: KMS permissions (90% of cases)
**Solution**: See [KMS Permissions Guide](docs/kms-permissions.md)

### Issue 2: Parsing Functions Return Empty
**Cause**: The source does not match the native Microsoft table contract
**Solution**: Run `AWSGuardDuty | getschema` and compare it with
`contracts/azure/awsguardduty-table.schema.json`.

### Issue 3: Only Low Severity Findings
**Cause**: Data lag - high severity findings export slower
**Solution**: Wait 30-60 minutes, check AWS GuardDuty console

See [Troubleshooting Guide](docs/troubleshooting.md) for complete solutions.

## Validation & Testing

### Smoke Tests
```kql
// Run queries from validation/smoke_tests.kql against your Sentinel workspace
// Tests data availability, structure, and parsing quality
AWSGuardDuty_Main(1d) | take 10
```

### Expected Results
- GuardDuty data is available and queryable
- Data structure is valid  
- Multiple finding types detected
- Network, IAM, S3, and EKS findings parse correctly

Synthetic, non-secret contract fixtures are versioned under
`tests/fixtures/guardduty/`. Use `validation/` for post-deployment checks.

## Documentation

| Guide | Purpose |
|-------|---------|
| [Connector Setup](docs/connector-setup.md) | Step-by-step AWS S3 connector configuration |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and diagnostic queries |
| [KMS Permissions](docs/kms-permissions.md) | Fixing the #1 cause of ingestion failures |
| [Test Strategy](docs/test-strategy.md) | Contract, container, mutation, resilience, and live-cloud gates |
| [Proposed Upstream Issue](docs/proposed-upstream-issue.md) | Ready-to-paste maintainer discussion with the test-system diagram |

## What's Included

```
guardduty-sentinel-integration/
├── kql/                          # KQL parsing functions
│   ├── AWSGuardDuty_Config.kql
│   ├── AWSGuardDuty_Main.kql          # native AWSGuardDuty table adapter
│   ├── AWSGuardDuty_Network.kql
│   ├── AWSGuardDuty_IAM.kql
│   ├── AWSGuardDuty_S3.kql            # S3 bucket findings
│   ├── AWSGuardDuty_EKS.kql           # EKS/Kubernetes findings
│   ├── AWSGuardDuty_Malware.kql
│   ├── AWSGuardDuty_RDS.kql
│   ├── AWSGuardDuty_ASIMNetworkSession.kql
│   └── AWSGuardDuty_Schema.kql        # data quality validation
├── deployment/                   # ARM/Bicep templates
│   ├── azuredeploy.json
│   └── deploy.bicep
├── scripts/                      # Deployment and ingestion scripts
│   ├── lambda_ingestion_handler.py    # EventBridge → Sentinel direct push (Lambda)
│   ├── run_live_conformance.py
│   ├── sync_arm_template.py
│   └── gates.sh
├── contracts/                    # Versioned AWS, EventBridge, and Azure schemas
├── tests/                        # Unit, property, contract, and container tests
│   └── validate-deployment.ps1
├── validation/                   # Diagnostic queries
│   ├── smoke_tests.kql
│   └── troubleshooting.kql
├── docs/                         # Comprehensive guides
│   ├── connector-setup.md
│   ├── troubleshooting.md
│   └── kms-permissions.md
└── deploy.sh                     # One-command deployment script
```

## Lambda Direct-Push Handler (Optional)

For real-time ingestion without the S3/SQS polling delay, deploy the Lambda function at `scripts/lambda_ingestion_handler.py`. This function:

- Receives GuardDuty findings from EventBridge
- Auto-detects and unwraps EventBridge envelope format
- Maps nested JSON to Microsoft's exact built-in table schema
- Posts with Entra OAuth to the DCR Logs Ingestion API
- Retries transient failures and raises exhausted failures to Lambda

### Environment Variables

| Variable | Description |
|----------|-------------|
| `AZURE_TENANT_ID` | Entra tenant containing the ingestion application |
| `AZURE_CLIENT_ID` | Entra application/client ID |
| `AZURE_CLIENT_SECRET` | Entra client secret (prefer a secret manager at deployment) |
| `AZURE_LOGS_INGESTION_ENDPOINT` | DCR/DCE ingestion endpoint |
| `AZURE_DCR_IMMUTABLE_ID` | DCR immutable ID |
| `AZURE_DCR_STREAM_NAME` | DCR stream (default: `Microsoft-AWSGuardDuty`) |
| `MAX_RETRIES` | Total request attempts (default: `3`) |
| `LOG_LEVEL` | Logging verbosity (default: `INFO`) |

The legacy shared-key API remains available only with
`INGESTION_MODE=legacy` during migration. Microsoft ends support for that API
on September 14, 2026.

### EventBridge Rule

```json
{
  "source": ["aws.guardduty"],
  "detail-type": ["GuardDuty Finding"]
}
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Test with sample data
4. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/OluOlus/guardduty-sentinel-integration./issues)
- **Connector Issues**: Check Microsoft Sentinel documentation
- **AWS GuardDuty**: Consult AWS documentation

## Version

Current version: **1.5.0**

Version 1.5 establishes executable AWS/EventBridge/Azure contracts, DCR
ingestion, official AWS severity boundaries, correct asynchronous Lambda
failure semantics, generated IaC parity, Testcontainers for LocalStack and
Kusto, a 70% mutation-score ratchet, and protected live-cloud conformance.
