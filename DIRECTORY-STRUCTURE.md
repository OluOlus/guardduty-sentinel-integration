# Directory Structure

This document describes the clean, production-ready directory structure for the GuardDuty Sentinel Integration KQL parsing solution.

## 📁 Root Directory

```
guardduty-sentinel-integration/
├── .github/workflows/           # CI/CD automation
│   └── validate-kql.yml        # KQL function validation pipeline
├── deployment/                  # Deployment templates
│   ├── azuredeploy.json        # ARM template for Azure deployment
│   ├── azuredeploy.parameters.json # Template parameters
│   └── deploy.bicep            # Bicep template (modern IaC)
├── docs/                       # Documentation
│   ├── connector-setup.md      # Step-by-step connector setup
│   ├── kms-permissions.md      # KMS troubleshooting guide
│   └── troubleshooting.md      # General troubleshooting
├── kql/                        # KQL parsing functions
│   ├── AWSGuardDuty_Config.kql # Configuration function
│   ├── AWSGuardDuty_Main.kql   # Primary parser
│   ├── AWSGuardDuty_Network.kql # Network-focused parser
│   ├── AWSGuardDuty_IAM.kql    # IAM-focused parser
│   └── AWSGuardDuty_ASIMNetworkSession.kql # ASIM normalization
├── sample-data/                # Test data and examples
│   ├── guardduty_findings.jsonl # Sample GuardDuty data
│   └── test_queries.kql        # Example queries (15+ samples)
├── validation/                 # Diagnostic and validation tools
│   ├── smoke_tests.kql         # Connector health validation
│   └── troubleshooting.kql     # Diagnostic queries
├── .gitignore                  # Git ignore rules
├── CHANGELOG.md                # Version history
├── CONTRIBUTING.md             # Contribution guidelines
├── deploy.sh                   # One-command deployment script
├── LICENSE                     # MIT license
├── PRODUCTION-READY-SUMMARY.md # Production readiness summary
├── README.md                   # Main documentation
├── REDESIGN-PLAN.md           # Architecture redesign documentation
└── requirements.md             # Requirements specification
```

## 🎯 Key Components

### Core KQL Functions (`kql/`)
- **AWSGuardDuty_Config.kql**: Centralized configuration for all parsers
- **AWSGuardDuty_Main.kql**: Primary parser with core GuardDuty fields
- **AWSGuardDuty_Network.kql**: Network threat analysis functions
- **AWSGuardDuty_IAM.kql**: Identity and access management findings
- **AWSGuardDuty_ASIMNetworkSession.kql**: ASIM-compliant normalization

### Deployment Infrastructure (`deployment/`)
- **azuredeploy.json**: ARM template for one-click deployment
- **deploy.bicep**: Modern Bicep template alternative
- **azuredeploy.parameters.json**: Customizable deployment parameters

### Documentation (`docs/`)
- **connector-setup.md**: Complete setup guide for AWS S3 connector
- **troubleshooting.md**: Common issues and diagnostic procedures
- **kms-permissions.md**: KMS permission troubleshooting (90% of issues)

### Validation Tools (`validation/`)
- **smoke_tests.kql**: Health checks for connector and parsing functions
- **troubleshooting.kql**: Diagnostic queries for common problems

### Sample Data (`sample-data/`)
- **guardduty_findings.jsonl**: Sample GuardDuty findings for testing
- **test_queries.kql**: 15+ example queries for immediate use

## 🚀 Deployment

### Quick Start
```bash
# Deploy KQL functions
./deploy.sh -g your-resource-group -w your-sentinel-workspace

# Validate deployment
# Copy queries from validation/smoke_tests.kql
```

### Manual Deployment
```bash
# Using Azure CLI
az deployment group create \
  --resource-group your-rg \
  --template-file deployment/azuredeploy.json \
  --parameters @deployment/azuredeploy.parameters.json
```

## 📊 What Was Removed

The following components were removed during the redesign to focus on the KQL parsing solution:

### Removed Directories
- `node_modules/` - Node.js dependencies (no longer needed)
- `dist/` - TypeScript build output (no longer needed)
- `src/` - Custom TypeScript ingestion code (replaced by KQL)
- `tests/` - TypeScript unit tests (replaced by KQL validation)
- `infra/` - Complex infrastructure code (replaced by simple ARM template)
- `samples/` - Old sample configurations (consolidated into sample-data/)

### Removed Files
- `package.json`, `package-lock.json` - Node.js configuration
- `tsconfig.json` - TypeScript configuration
- `jest.config.js` - Jest testing configuration
- `.eslintrc.js`, `.prettierrc` - Code formatting configuration
- `design.md`, `tasks.md` - Old design documents
- Various fix scripts and temporary files

## 🎯 Benefits of Clean Architecture

### Simplicity
- **No custom code to maintain** - Only KQL functions
- **No dependencies** - Works with existing Sentinel infrastructure
- **No build process** - Direct deployment of KQL functions

### Maintainability
- **Config-driven** - Change settings once, all functions adapt
- **Self-documenting** - Clear file structure and naming
- **Version controlled** - All components in git

### Production Ready
- **CI/CD validation** - Automated testing of KQL functions
- **Comprehensive documentation** - Setup and troubleshooting guides
- **One-command deployment** - Simple deployment script
- **Professional structure** - Enterprise-ready organization

## 📈 File Count Comparison

| Component | Before | After | Change |
|-----------|--------|-------|--------|
| **Total Files** | 500+ | 25 | -95% |
| **TypeScript Files** | 50+ | 0 | -100% |
| **KQL Functions** | 0 | 5 | +5 |
| **Documentation** | 8 | 3 | Focused |
| **Dependencies** | 200+ | 0 | -100% |

The clean architecture reduces complexity by 95% while providing the same functionality through a more maintainable KQL-based approach.

## 🔄 Migration Impact

### For Users
- **Simpler deployment** - One command instead of complex setup
- **Faster onboarding** - Minutes instead of hours
- **Better reliability** - Uses proven Microsoft infrastructure
- **Easier troubleshooting** - Built-in diagnostic tools

### For Maintainers
- **Zero infrastructure maintenance** - No custom services
- **Simplified CI/CD** - Only KQL validation needed
- **Reduced support burden** - Common issues documented and solved
- **Clear upgrade path** - Simple ARM template updates

This clean, focused architecture delivers the same value with significantly less complexity and maintenance overhead.