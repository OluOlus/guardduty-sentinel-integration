# GuardDuty → Sentinel Integration

Production-ready ingestion and KQL parsing layer for AWS GuardDuty findings in Microsoft Sentinel. Supports two ingestion paths: the native AWS S3 connector (polling) and a direct Lambda push via the Log Analytics Data Collector API.

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
                └──▶ EventBridge → Lambda → Log Analytics API (real-time)     │
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

**Path 2 — Lambda Direct Push (optional):** EventBridge rule triggers a Lambda that transforms and POSTs findings directly to the Log Analytics Data Collector API. Sub-minute latency.

**Key Benefits:**
- Two ingestion paths: S3 connector (managed) or Lambda (real-time)
- Uses existing, supported Microsoft connector for the primary path
- Config-driven parsing (change table names once)
- ASIM-aligned for cross-source hunting
- Built-in troubleshooting for common issues (KMS permissions)
- Handles both direct JSON and EventBridge envelope formats automatically

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

All functions read from a single config function. Change settings once:

```kql
AWSGuardDuty_Config()
| where Setting == "TableName"  // Default: "AWSGuardDuty"
| where Setting == "RawColumn"  // Default: "EventData" 
| where Setting == "DefaultLookback"  // Default: "7d"
```

To customize, redeploy with different parameters:
```bash
az deployment group create \
  --template-file deployment/azuredeploy.json \
  --parameters workspaceName=MyWorkspace guardDutyTableName=CustomTable
```

## Common Issues & Solutions

### Issue 1: Connector "Connected" But No Data
**Cause**: KMS permissions (90% of cases)
**Solution**: See [KMS Permissions Guide](docs/kms-permissions.md)

### Issue 2: Parsing Functions Return Empty
**Cause**: Wrong column name or data format
**Solution**: Check `AWSGuardDuty | getschema` and update config

### Issue 3: Only Low Severity Findings
**Cause**: Data lag - high severity findings export slower
**Solution**: Wait 30-60 minutes, check AWS GuardDuty console

See [Troubleshooting Guide](docs/troubleshooting.md) for complete solutions.

## � Validation & Testing

### Smoke Tests
```kql
// Copy and run queries from validation/smoke_tests.kql
// Tests data availability, structure, parsing quality
```

### Sample Queries
```kql
// Copy queries from sample-data/test_queries.kql
// Examples for hunting, analysis, and operational monitoring
```

### Expected Results
- GuardDuty data is available
- Data structure is valid  
- Multiple finding types detected
- Network and IAM findings parse correctly

## Documentation

| Guide | Purpose |
|-------|---------|
| [Connector Setup](docs/connector-setup.md) | Step-by-step AWS S3 connector configuration |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and diagnostic queries |
| [KMS Permissions](docs/kms-permissions.md) | Fixing the #1 cause of ingestion failures |

## What's Included

```
guardduty-sentinel-integration/
├── kql/                          # KQL parsing functions
│   ├── AWSGuardDuty_Config.kql
│   ├── AWSGuardDuty_Main.kql          # handles both direct & EventBridge envelope formats
│   ├── AWSGuardDuty_Network.kql
│   ├── AWSGuardDuty_IAM.kql
│   ├── AWSGuardDuty_S3.kql            # S3 bucket findings
│   ├── AWSGuardDuty_EKS.kql           # EKS/Kubernetes findings
│   ├── AWSGuardDuty_ASIMNetworkSession.kql
│   └── AWSGuardDuty_Schema.kql        # data quality validation
├── deployment/                   # ARM/Bicep templates
│   ├── azuredeploy.json
│   └── deploy.bicep
├── scripts/                      # Deployment and ingestion scripts
│   ├── lambda_ingestion_handler.py    # EventBridge → Sentinel direct push (Lambda)
│   └── validate-deployment.ps1
├── validation/                   # Diagnostic queries
│   ├── smoke_tests.kql
│   └── troubleshooting.kql
├── sample-data/                  # Test data and queries
│   ├── guardduty_findings.jsonl
│   └── test_queries.kql
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
- Transforms nested JSON into a flat, Sentinel-friendly schema
- Posts to the Log Analytics Data Collector API with HMAC-SHA256 auth
- Returns structured error responses for each failure mode

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SENTINEL_WORKSPACE_ID` | Log Analytics workspace ID |
| `SENTINEL_SHARED_KEY` | Log Analytics primary/secondary key |
| `LOG_TYPE` | Target table name (default: `AWSGuardDuty`) |
| `LOG_LEVEL` | Logging verbosity (default: `INFO`) |

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

Current version: **1.3.0**

**What's New in 1.3.0:**
- Added `scripts/lambda_ingestion_handler.py` — direct EventBridge→Sentinel push via Log Analytics Data Collector API
- Two ingestion paths: S3 connector (managed, polling) and Lambda (real-time, sub-minute)
- Lambda handler includes HMAC-SHA256 auth, structured error handling, and automatic envelope detection
- Updated architecture diagram to reflect both ingestion paths
- CI workflow fix: ASIM parser upstream reference validation now accepts transitive dependencies
- Deployed and validated end-to-end with live GuardDuty findings (406 findings, 202 unique types)

**What's New in 1.2.0:**
- Added `AWSGuardDuty_S3` parser — extracts bucket encryption, public access posture, and ACL details
- Added `AWSGuardDuty_EKS` parser — covers EKS audit log and Runtime Monitoring findings
- Fixed `AWSGuardDuty_Main` to auto-detect and unwrap EventBridge envelope format
- Fixed `AWSGuardDuty_ASIMNetworkSession` — removed references to columns that do not exist in upstream schema
- Updated `AWSGuardDuty_Config` with `HandleEventBridgeEnvelope` flag and `Critical` severity tier
- ARM template now deploys all 8 parsers
- CI workflow now validates S3/EKS parsers, sample data coverage, and ARM function list
- Sample data expanded to 7 findings covering Network, IAM, S3, EKS, and both input formats