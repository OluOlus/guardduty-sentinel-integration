# GuardDuty Sentinel Integration

A production-ready KQL parsing and normalization layer for AWS GuardDuty findings in Microsoft Sentinel. This solution works with the existing Microsoft Sentinel AWS S3 connector - no custom ingestion infrastructure required.

## What This Solves

**The Problem**: Microsoft Sentinel can ingest GuardDuty data via the AWS S3 connector, but teams struggle with:
- Connector shows "Connected" but no data flows (usually KMS permissions)
- Raw GuardDuty data is hard to query and correlate
- No ASIM normalization for cross-source hunting
- Lack of operational validation and troubleshooting tools

**The Solution**: A complete KQL parsing package that makes GuardDuty data immediately queryable and ASIM-aligned once ingested.

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
git clone https://github.com/your-org/guardduty-sentinel-integration
cd guardduty-sentinel-integration

# Deploy using Azure CLI
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
AWS GuardDuty → S3 Export → Microsoft Sentinel AWS S3 Connector → AWSGuardDuty Table
                                                                         ↓
                                    KQL Parsing Functions → ASIM Normalization
```

**Key Benefits:**
- Uses existing, supported Microsoft connector
- No custom infrastructure to maintain
- Config-driven parsing (change table names once)
- ASIM-aligned for cross-source hunting
- Built-in troubleshooting for common issues (KMS permissions)

## KQL Functions

### Core Functions

| Function | Purpose | Example |
|----------|---------|---------|
| `AWSGuardDuty_Config()` | Centralized configuration | Table names, default lookback |
| `AWSGuardDuty_Main(lookback)` | Primary parser | All findings with core fields |
| `AWSGuardDuty_Network(lookback)` | Network-focused findings | Remote IPs, ports, protocols |
| `AWSGuardDuty_IAM(lookback)` | Identity findings | API calls, users, access keys |
| `AWSGuardDuty_ASIMNetworkSession(lookback)` | ASIM normalization | Cross-source network hunting |

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
│   ├── AWSGuardDuty_Main.kql
│   ├── AWSGuardDuty_Network.kql
│   ├── AWSGuardDuty_IAM.kql
│   └── AWSGuardDuty_ASIMNetworkSession.kql
├── deployment/                   # ARM/Bicep templates
│   ├── azuredeploy.json
│   └── deploy.bicep
├── validation/                   # Diagnostic queries
│   ├── smoke_tests.kql
│   └── troubleshooting.kql
├── sample-data/                  # Test data and queries
│   ├── guardduty_findings.jsonl
│   └── test_queries.kql
└── docs/                        # Comprehensive guides
    ├── connector-setup.md
    ├── troubleshooting.md
    └── kms-permissions.md
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Test with sample data
4. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/your-org/guardduty-sentinel-integration/issues)
- **Connector Issues**: Check Microsoft Sentinel documentation
- **AWS GuardDuty**: Consult AWS documentation

## Version

Current version: 1.0.0 (Production Ready)

**What's New in 1.0.0:**
- Complete redesign to use existing AWS S3 connector
- Config-driven KQL parsing functions
- ASIM network session normalization
- Comprehensive troubleshooting guides
- One-click ARM template deployment
- Production-tested with real GuardDuty data