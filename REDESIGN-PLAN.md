# Redesign Plan: GuardDuty Sentinel Integration

## Problem Analysis

The current codebase implements a **custom ingestion connector** with:
- Complex ingestion workers (Azure Function, Container, Lambda)
- Custom S3 processing and Azure Monitor ingestion
- Data transformation pipelines
- Batch processing systems

But the requirements clearly state:
> "i dont want to create a connector from scratch.. using the existing guardduty S3 connector"

## New Architecture (Requirements-Aligned)

### What We Keep
- Basic TypeScript project structure
- Testing framework
- Documentation approach

### What We Remove/Replace
- ❌ All ingestion workers (`src/workers/`)
- ❌ Custom S3 processing (`src/services/s3-service.ts`)
- ❌ Custom Azure Monitor client (`src/services/azure-monitor-client.ts`)
- ❌ Batch processing system (`src/services/batch-processor.ts`)
- ❌ Complex data transformation (`src/services/data-transformer.ts`)
- ❌ Infrastructure for custom ingestion

### What We Build Instead
- ✅ KQL parsing functions (config-driven)
- ✅ ASIM-aligned normalization functions
- ✅ ARM/Bicep deployment templates for KQL functions
- ✅ Connector validation and troubleshooting tools
- ✅ Sample data and test queries
- ✅ Documentation for using existing AWS S3 connector

## New Project Structure

```
guardduty-sentinel-integration/
├── kql/                          # KQL Functions
│   ├── AWSGuardDuty_Config.kql
│   ├── AWSGuardDuty_Main.kql
│   ├── AWSGuardDuty_Network.kql
│   ├── AWSGuardDuty_IAM.kql
│   └── AWSGuardDuty_ASIMNetworkSession.kql
├── deployment/                   # ARM/Bicep Templates
│   ├── azuredeploy.json
│   ├── azuredeploy.parameters.json
│   └── deploy.bicep
├── sample-data/                  # Test Data
│   ├── guardduty_findings.jsonl
│   └── test_queries.kql
├── validation/                   # Connector Validation
│   ├── smoke_tests.kql
│   ├── troubleshooting.kql
│   └── kms_validation.kql
├── docs/                        # Documentation
│   ├── connector-setup.md
│   ├── troubleshooting.md
│   └── kms-permissions.md
└── tests/                       # Unit Tests for KQL
    ├── config.test.ts
    ├── parsers.test.ts
    └── asim.test.ts
```

## Implementation Steps

1. ✅ **Clean up existing code** - Remove custom ingestion components
2. ✅ **Create KQL functions** - Config-driven parsing layer
3. ✅ **Build deployment templates** - ARM/Bicep for function deployment
4. ✅ **Add validation tools** - Smoke tests and troubleshooting queries
5. ✅ **Create sample data** - Test findings and expected outputs
6. ✅ **Update documentation** - Focus on existing connector usage
7. ✅ **CI/CD validation** - GitHub Actions for KQL function validation
8. ✅ **Deployment script** - Easy one-command deployment

## Value Proposition

Instead of building complex infrastructure, we provide:
- **Immediate value**: Works with existing Sentinel AWS S3 connector
- **Easy deployment**: One ARM template deploys all KQL functions
- **Troubleshooting**: Known issues (KMS permissions) with solutions
- **ASIM alignment**: Normalized queries that work across data sources
- **Maintainable**: Config-driven, no custom backend to maintain
- **Production ready**: CI/CD validation, comprehensive documentation
- **User friendly**: One-command deployment script with validation