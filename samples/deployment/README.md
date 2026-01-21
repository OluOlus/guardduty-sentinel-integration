# Manual Deployment Guide

This directory contains guides and configuration samples for manually setting up the GuardDuty to Sentinel integration without Terraform.

## Overview

The manual deployment process involves setting up resources in both AWS and Azure, then configuring the ingestion worker to connect them. This approach gives you full control over resource configuration and is ideal when:

- You cannot use Terraform in your environment
- You need custom resource configurations not covered by the Terraform modules
- You want to integrate with existing infrastructure
- You prefer using native cloud tools (AWS CLI, Azure CLI, Azure Portal)

## Prerequisites

Before starting the manual deployment, ensure you have:

### AWS Prerequisites
- AWS CLI installed and configured with appropriate permissions
- Access to create and configure:
  - S3 buckets with KMS encryption
  - GuardDuty publishing destinations
  - IAM roles and policies
  - KMS keys (optional, can use AWS managed keys)

### Azure Prerequisites
- Azure CLI installed and configured
- PowerShell 7+ (for Azure PowerShell scripts)
- Access to create and configure:
  - Log Analytics workspaces
  - Data Collection Rules (DCR)
  - Data Collection Endpoints (DCE) - optional for new DCRs
  - Service principals with appropriate permissions
  - Resource groups

### Required Permissions

#### AWS Permissions
Your AWS user/role needs permissions for:
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:CreateBucket",
                "s3:PutBucketPolicy",
                "s3:PutBucketEncryption",
                "s3:PutBucketNotification",
                "guardduty:CreatePublishingDestination",
                "guardduty:UpdatePublishingDestination",
                "kms:CreateKey",
                "kms:PutKeyPolicy",
                "kms:CreateAlias",
                "iam:CreateRole",
                "iam:PutRolePolicy",
                "iam:AttachRolePolicy"
            ],
            "Resource": "*"
        }
    ]
}
```

#### Azure Permissions
Your Azure user needs:
- **Contributor** role on the target resource group
- **Log Analytics Contributor** role on the workspace
- **Monitoring Metrics Publisher** role for the service principal
- Permission to create service principals (or have one created by an admin)

## Deployment Steps

Follow these guides in order:

1. **[AWS Setup](aws-setup.md)** - Configure S3, GuardDuty, and IAM resources
2. **[Azure Setup](azure-setup.md)** - Configure Log Analytics, DCR, and authentication
3. **[Worker Configuration](worker-configuration.md)** - Configure and deploy the ingestion worker
4. **[Validation](validation.md)** - Verify the integration is working correctly

## Quick Start

For a rapid deployment with default settings:

1. Run the AWS setup script:
   ```bash
   cd samples/deployment/scripts
   ./setup-aws-resources.sh
   ```

2. Run the Azure setup script:
   ```powershell
   cd samples/deployment/scripts
   ./Setup-AzureResources.ps1
   ```

3. Configure the worker using the generated configuration files
4. Run the validation script to verify everything is working

## Configuration Files

After completing the setup, you'll have configuration files ready for the ingestion worker:

- `generated-config.json` - Complete configuration with your resource details
- `environment-variables.env` - Environment variables for containerized deployments
- `azure-function-settings.json` - Settings for Azure Function deployment
- `lambda-environment.json` - Environment variables for AWS Lambda deployment

## Troubleshooting

Common issues and solutions:

### AWS Issues
- **S3 Access Denied**: Check bucket policy and IAM permissions
- **KMS Decryption Errors**: Verify KMS key policy includes GuardDuty service principal
- **GuardDuty Export Not Working**: Check publishing destination configuration

### Azure Issues
- **DCR Authentication Failed**: Verify service principal has "Monitoring Metrics Publisher" role
- **Data Not Appearing in Workspace**: Check DCR configuration and stream name
- **Schema Validation Errors**: Verify DCR stream definition matches data structure

### Integration Issues
- **Worker Cannot Connect to S3**: Check AWS credentials and network connectivity
- **Worker Cannot Send to Azure**: Check Azure credentials and endpoint URLs
- **Data Transformation Errors**: Check normalization configuration and sample data

See individual setup guides for detailed troubleshooting steps.

## Support

For additional help:
1. Check the troubleshooting sections in each setup guide
2. Review the validation script output for specific error messages
3. Enable detailed logging in the worker configuration for debugging
4. Refer to the main project README for general troubleshooting tips