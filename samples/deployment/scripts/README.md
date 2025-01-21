# Deployment Scripts

This directory contains automation scripts for setting up the GuardDuty to Sentinel integration manually (without Terraform).

## Scripts Overview

### 1. `setup-aws-resources.sh`
**Purpose**: Automates AWS resource creation for GuardDuty export setup.

**What it creates**:
- S3 bucket with KMS encryption for GuardDuty exports
- GuardDuty publishing destination configuration
- IAM roles and policies for the ingestion worker
- Optional custom KMS key for additional security
- Test GuardDuty finding for validation

**Usage**:
```bash
./setup-aws-resources.sh
```

**Prerequisites**:
- AWS CLI installed and configured
- Appropriate AWS permissions (see main README)
- `jq` installed for JSON processing

**Output**:
- `../config/generated-aws-config.json` - AWS resource configuration

### 2. `Setup-AzureResources.ps1`
**Purpose**: Automates Azure resource creation for data ingestion and analysis.

**What it creates**:
- Log Analytics workspace for data storage
- Data Collection Rule (DCR) for data ingestion
- Service principal with appropriate permissions
- Optional Azure Sentinel workspace
- KQL parser function template

**Usage**:
```powershell
# Interactive mode
./Setup-AzureResources.ps1

# Non-interactive mode
./Setup-AzureResources.ps1 -SubscriptionId "your-sub-id" -ResourceGroupName "my-rg" -SkipConfirmation
```

**Parameters**:
- `-SubscriptionId`: Azure subscription ID
- `-ResourceGroupName`: Resource group name (default: "guardduty-sentinel-rg")
- `-Location`: Azure region (default: "eastus")
- `-WorkspaceName`: Log Analytics workspace name
- `-DcrName`: Data Collection Rule name
- `-ServicePrincipalName`: Service principal name
- `-EnableSentinel`: Enable Azure Sentinel
- `-SkipConfirmation`: Skip interactive prompts

**Prerequisites**:
- Azure CLI installed and authenticated
- PowerShell 7+ (recommended)
- Appropriate Azure permissions (see main README)

**Output**:
- `../config/generated-azure-config.json` - Azure resource configuration
- `../config/generated-azure-env.env` - Environment variables
- `../config/guardduty-parser-function.kql` - KQL parser function

### 3. `merge-configurations.sh`
**Purpose**: Combines AWS and Azure configurations into complete worker configuration files.

**What it does**:
- Merges AWS and Azure resource configurations
- Prompts for processing preferences (batch size, retries, etc.)
- Generates deployment-specific configuration files
- Validates the final configuration

**Usage**:
```bash
./merge-configurations.sh
```

**Prerequisites**:
- Both AWS and Azure setup scripts completed
- `jq` installed for JSON processing

**Output**:
- `../config/complete-worker-config.json` - Complete JSON configuration
- `../config/complete-worker-config.env` - Environment variables
- `../config/azure-function-settings.json` - Azure Function app settings
- `../config/lambda-environment.json` - AWS Lambda environment variables
- `../config/docker-compose.yml` - Docker Compose configuration

### 4. `validate-integration.sh`
**Purpose**: Validates the end-to-end integration is working correctly.

**What it tests**:
- AWS and Azure authentication
- Resource accessibility (S3, GuardDuty, Log Analytics, DCR)
- Data flow (GuardDuty exports, S3 files, worker processing)
- Performance metrics
- Generates test data and queries

**Usage**:
```bash
./validate-integration.sh
```

**Prerequisites**:
- All setup scripts completed
- AWS CLI and Azure CLI authenticated
- `jq` and `curl` installed

**Output**:
- Test results summary
- Azure KQL test queries in `../config/test-queries/`
- Performance metrics
- Manual verification steps

## Quick Start Workflow

Follow these scripts in order for a complete setup:

1. **AWS Setup**:
   ```bash
   ./setup-aws-resources.sh
   ```

2. **Azure Setup**:
   ```powershell
   ./Setup-AzureResources.ps1
   ```

3. **Merge Configurations**:
   ```bash
   ./merge-configurations.sh
   ```

4. **Validate Setup**:
   ```bash
   ./validate-integration.sh
   ```

## Configuration Files Generated

After running all scripts, you'll have these configuration files:

```
config/
├── generated-aws-config.json          # AWS resources
├── generated-azure-config.json        # Azure resources
├── generated-azure-env.env           # Azure environment variables
├── complete-worker-config.json       # Complete worker configuration
├── complete-worker-config.env        # Complete environment variables
├── azure-function-settings.json      # Azure Function app settings
├── lambda-environment.json           # Lambda environment variables
├── docker-compose.yml               # Docker Compose configuration
├── guardduty-parser-function.kql    # KQL parser function
└── test-queries/                     # Azure test queries
    ├── check-recent-data.kql
    ├── test-normalization.kql
    └── check-test-finding.kql
```

## Deployment Options

After configuration, choose your deployment method:

### Azure Function
```bash
# Use the generated Azure Function settings
az functionapp config appsettings set \
  --name your-function-app \
  --resource-group your-rg \
  --settings @config/azure-function-settings.json
```

### AWS Lambda
```bash
# Use the generated Lambda environment
aws lambda update-function-configuration \
  --function-name your-function \
  --environment file://config/lambda-environment.json
```

### Docker Container
```bash
# Use the generated Docker Compose file
cd config
docker-compose up --build
```

## Troubleshooting

### Common Issues

**Script Permission Denied**
```bash
chmod +x *.sh
```

**AWS CLI Not Configured**
```bash
aws configure
# or
aws configure sso
```

**Azure CLI Not Authenticated**
```bash
az login
```

**Missing Dependencies**
```bash
# Install jq (macOS)
brew install jq

# Install jq (Ubuntu/Debian)
sudo apt-get install jq

# Install PowerShell 7+ (if needed)
# See: https://docs.microsoft.com/en-us/powershell/scripting/install/installing-powershell
```

**Configuration Validation Errors**
- Check that all required fields are present
- Verify URLs use HTTPS protocol
- Ensure numeric values are within valid ranges
- Review the validation error messages for specific issues

### Script-Specific Issues

**setup-aws-resources.sh**
- Ensure AWS credentials have sufficient permissions
- Check that the chosen S3 bucket name is globally unique
- Verify GuardDuty is available in your chosen region

**Setup-AzureResources.ps1**
- Ensure you have permission to create service principals
- Check that the chosen resource names are available
- Verify the Azure location supports Log Analytics and DCR

**merge-configurations.sh**
- Ensure both AWS and Azure setup scripts completed successfully
- Check that the generated configuration files exist
- Verify jq is installed and working

**validate-integration.sh**
- Allow time for GuardDuty findings to be exported (5-10 minutes)
- Check that both AWS and Azure CLIs are authenticated
- Review the manual verification steps if automated tests fail

## Support

For additional help:
1. Check the main deployment guides in the parent directory
2. Review the troubleshooting sections in each setup guide
3. Enable detailed logging in the scripts by adding `set -x` at the top
4. Check the generated configuration files for correctness