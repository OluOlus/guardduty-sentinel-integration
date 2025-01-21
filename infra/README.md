# Infrastructure as Code

This directory contains Terraform modules for deploying the GuardDuty to Sentinel integration infrastructure.

## Structure

- `aws/` - AWS infrastructure modules (S3, GuardDuty, IAM, KMS)
- `azure/` - Azure infrastructure modules (Log Analytics, DCR, Service Principal)
- `sentinel/` - Microsoft Sentinel analytics modules (Rules, Workbooks, Automation)
- `examples/` - Example Terraform configurations and complete deployments

## Modules Overview

### AWS Module (`aws/`)
Creates AWS infrastructure for GuardDuty findings export:
- S3 bucket with KMS encryption
- GuardDuty publishing destination
- IAM roles for cross-service access
- CloudWatch log groups for monitoring

### Azure Module (`azure/`)
Creates Azure infrastructure for data ingestion:
- Log Analytics workspace
- Data Collection Endpoint and Rule (DCE/DCR)
- Service principal with appropriate permissions
- KQL functions for data normalization

### Sentinel Module (`sentinel/`)
Creates Microsoft Sentinel analytics and automation:
- Scheduled analytics rules for threat detection
- Interactive workbooks for visualization
- Automation rules for incident management
- Action groups for notifications

## Usage

The Terraform modules in this directory are optional deployment accelerators. The core system can be deployed manually using the configuration samples in the `samples/` directory.

### Option 1: Complete Deployment
Use the complete example for end-to-end deployment:

```bash
cd examples/complete-deployment
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values
terraform init
terraform apply
```

### Option 2: Modular Deployment
Deploy individual modules as needed:

```hcl
# Deploy AWS infrastructure only
module "guardduty_aws" {
  source = "./aws"
  # ... configuration
}

# Deploy Azure infrastructure only
module "guardduty_azure" {
  source = "./azure"
  # ... configuration
}

# Deploy Sentinel analytics only
module "guardduty_sentinel" {
  source = "./sentinel"
  # ... configuration
}
```

## Prerequisites

- Terraform >= 1.0
- AWS CLI configured with appropriate permissions
- Azure CLI configured with appropriate permissions
- Microsoft Sentinel license (for Sentinel module)

## Quick Start

1. **Choose Deployment Method**:
   - Complete deployment: `cd examples/complete-deployment`
   - Individual modules: Create your own configuration

2. **Configure Variables**:
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars with your specific values
   ```

3. **Deploy Infrastructure**:
   ```bash
   terraform init
   terraform plan
   terraform apply
   ```

4. **Configure Ingestion Workers**:
   Use the output values to configure your ingestion workers

## Manual Deployment Alternative

For manual deployment without Terraform, see the `samples/` directory for:
- AWS setup scripts and configuration templates
- Azure setup scripts and PowerShell modules
- Sentinel analytics rule templates
- Configuration validation scripts