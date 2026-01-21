# GuardDuty to Sentinel Integration - Deployment Guide

## Overview

This guide provides comprehensive instructions for deploying the GuardDuty to Sentinel integration system across different environments and deployment methods.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Manual Deployment](#manual-deployment)
3. [Terraform Deployment](#terraform-deployment)
4. [Container Deployment](#container-deployment)
5. [AWS Lambda Deployment](#aws-lambda-deployment)
6. [Azure Functions Deployment](#azure-functions-deployment)
7. [Configuration Management](#configuration-management)
8. [Security Considerations](#security-considerations)
9. [Validation and Testing](#validation-and-testing)

## Prerequisites

### Azure Requirements

- **Azure Subscription** with appropriate permissions
- **Log Analytics Workspace** for storing GuardDuty findings
- **Service Principal** with the following roles:
  - `Monitoring Metrics Publisher` on the Log Analytics Workspace
  - `Log Analytics Contributor` (for DCR management)
- **Data Collection Rule (DCR)** configured for GuardDuty findings

### AWS Requirements

- **AWS Account** with GuardDuty enabled
- **S3 Bucket** for GuardDuty findings export
- **KMS Key** for S3 encryption (optional but recommended)
- **IAM Roles/Policies** for accessing S3 and KMS
- **GuardDuty Publishing Destination** configured

### General Requirements

- **Node.js 18+** (for local development and testing)
- **Docker** (for container deployments)
- **Terraform 1.0+** (for infrastructure-as-code deployments)
- **Azure CLI** and **AWS CLI** (for manual setup)

## Manual Deployment

### Step 1: Azure Infrastructure Setup

#### 1.1 Create Log Analytics Workspace

```bash
# Create resource group
az group create --name guardduty-integration-rg --location eastus

# Create Log Analytics workspace
az monitor log-analytics workspace create \
  --resource-group guardduty-integration-rg \
  --workspace-name guardduty-workspace \
  --location eastus
```

#### 1.2 Create Service Principal

```bash
# Create service principal
az ad sp create-for-rbac --name guardduty-integration-sp \
  --role "Monitoring Metrics Publisher" \
  --scopes "/subscriptions/{subscription-id}/resourceGroups/guardduty-integration-rg"

# Note the output: appId, password, tenant
```

#### 1.3 Create Data Collection Rule

```bash
# Create DCR using Azure CLI or ARM template
az monitor data-collection rule create \
  --resource-group guardduty-integration-rg \
  --name guardduty-dcr \
  --location eastus \
  --rule-file dcr-config.json
```

**DCR Configuration (dcr-config.json):**

```json
{
  "location": "eastus",
  "kind": "Direct",
  "properties": {
    "streamDeclarations": {
      "Custom-GuardDutyFindings": {
        "columns": [
          {"name": "TimeGenerated", "type": "datetime"},
          {"name": "FindingId", "type": "string"},
          {"name": "AccountId", "type": "string"},
          {"name": "Region", "type": "string"},
          {"name": "Severity", "type": "real"},
          {"name": "Type", "type": "string"},
          {"name": "RawJson", "type": "string"}
        ]
      }
    },
    "destinations": {
      "logAnalytics": [{
        "workspaceResourceId": "/subscriptions/{subscription-id}/resourceGroups/guardduty-integration-rg/providers/microsoft.operationalinsights/workspaces/guardduty-workspace",
        "name": "LogAnalyticsDest"
      }]
    },
    "dataFlows": [{
      "streams": ["Custom-GuardDutyFindings"],
      "destinations": ["LogAnalyticsDest"],
      "transformKql": "source | extend TimeGenerated = now()",
      "outputStream": "Custom-RawGuardDuty_CL"
    }]
  }
}
```

### Step 2: AWS Infrastructure Setup

#### 2.1 Create S3 Bucket

```bash
# Create S3 bucket
aws s3 mb s3://your-guardduty-bucket --region us-east-1

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket your-guardduty-bucket \
  --versioning-configuration Status=Enabled
```

#### 2.2 Create KMS Key

```bash
# Create KMS key
aws kms create-key \
  --description "GuardDuty S3 encryption key" \
  --key-usage ENCRYPT_DECRYPT \
  --key-spec SYMMETRIC_DEFAULT

# Create alias
aws kms create-alias \
  --alias-name alias/guardduty-s3-key \
  --target-key-id {key-id}
```

#### 2.3 Configure GuardDuty Publishing Destination

```bash
# Create publishing destination
aws guardduty create-publishing-destination \
  --detector-id {detector-id} \
  --destination-type S3 \
  --destination-properties DestinationArn=arn:aws:s3:::your-guardduty-bucket,KmsKeyArn=arn:aws:kms:us-east-1:{account-id}:key/{key-id}
```

### Step 3: Deploy Application

#### 3.1 Install Dependencies

```bash
npm install
npm run build
```

#### 3.2 Configure Environment

Create `.env` file:

```bash
# Azure Configuration
AZURE_TENANT_ID=your-tenant-id
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret
AZURE_WORKSPACE_ID=your-workspace-id
AZURE_SUBSCRIPTION_ID=your-subscription-id
AZURE_RESOURCE_GROUP_NAME=guardduty-integration-rg
AZURE_DCR_IMMUTABLE_ID=dcr-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AZURE_DCR_STREAM_NAME=Custom-GuardDutyFindings

# AWS Configuration
AWS_REGION=us-east-1
AWS_S3_BUCKET_NAME=your-guardduty-bucket
AWS_S3_BUCKET_PREFIX=AWSLogs/123456789012/GuardDuty/
AWS_KMS_KEY_ARN=arn:aws:kms:us-east-1:123456789012:key/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Processing Configuration
BATCH_SIZE=100
MAX_RETRIES=3
ENABLE_NORMALIZATION=false
ENABLE_DEDUPLICATION=true
```

#### 3.3 Start Application

```bash
# For container deployment
npm run start:container

# For development
npm run dev
```

## Terraform Deployment

### Step 1: Configure Terraform

Create `terraform.tfvars`:

```hcl
# Azure Configuration
azure_subscription_id = "your-subscription-id"
azure_tenant_id = "your-tenant-id"
azure_location = "East US"
resource_group_name = "guardduty-integration-rg"

# AWS Configuration
aws_region = "us-east-1"
aws_account_id = "123456789012"
guardduty_bucket_name = "your-guardduty-bucket"

# Application Configuration
worker_type = "container"  # or "lambda" or "azure-function"
batch_size = 100
enable_normalization = false
```

### Step 2: Deploy Infrastructure

```bash
# Initialize Terraform
cd infra/examples/complete-deployment
terraform init

# Plan deployment
terraform plan -var-file="terraform.tfvars"

# Apply deployment
terraform apply -var-file="terraform.tfvars"
```

### Step 3: Deploy Application

```bash
# Build and deploy application (varies by worker type)
terraform apply -target=module.application -var-file="terraform.tfvars"
```

## Container Deployment

### Step 1: Build Container Image

```bash
# Build Docker image
docker build -f src/workers/container/Dockerfile -t guardduty-sentinel-integration .

# Tag for registry
docker tag guardduty-sentinel-integration your-registry/guardduty-sentinel-integration:latest
```

### Step 2: Deploy with Docker Compose

```bash
# Copy environment template
cp src/workers/container/.env.example .env

# Edit .env with your configuration
nano .env

# Start services
docker-compose -f src/workers/container/docker-compose.yml up -d

# View logs
docker-compose -f src/workers/container/docker-compose.yml logs -f
```

### Step 3: Deploy to Kubernetes

```bash
# Update secrets in k8s-deployment.yaml
kubectl apply -f src/workers/container/k8s-deployment.yaml

# Check deployment status
kubectl get pods -n guardduty-integration
kubectl logs -f deployment/guardduty-integration -n guardduty-integration
```

## AWS Lambda Deployment

### Step 1: Package Lambda Function

```bash
# Build and package
npm run build
cd dist/workers/lambda
zip -r guardduty-lambda.zip .
```

### Step 2: Deploy Lambda Function

```bash
# Create Lambda function
aws lambda create-function \
  --function-name guardduty-sentinel-integration \
  --runtime nodejs18.x \
  --role arn:aws:iam::123456789012:role/lambda-execution-role \
  --handler index.handler \
  --zip-file fileb://guardduty-lambda.zip \
  --timeout 300 \
  --memory-size 512

# Configure environment variables
aws lambda update-function-configuration \
  --function-name guardduty-sentinel-integration \
  --environment Variables='{
    "AZURE_TENANT_ID":"your-tenant-id",
    "AZURE_CLIENT_ID":"your-client-id",
    "AZURE_CLIENT_SECRET":"your-client-secret",
    "AWS_S3_BUCKET_NAME":"your-guardduty-bucket"
  }'
```

### Step 3: Configure S3 Event Trigger

```bash
# Add S3 event notification
aws s3api put-bucket-notification-configuration \
  --bucket your-guardduty-bucket \
  --notification-configuration file://s3-notification.json
```

## Azure Functions Deployment

### Step 1: Create Function App

```bash
# Create Function App
az functionapp create \
  --resource-group guardduty-integration-rg \
  --consumption-plan-location eastus \
  --runtime node \
  --runtime-version 18 \
  --functions-version 4 \
  --name guardduty-function-app \
  --storage-account guarddutysa
```

### Step 2: Deploy Function Code

```bash
# Build and deploy
npm run build
cd src/workers/azure-function
func azure functionapp publish guardduty-function-app
```

### Step 3: Configure Application Settings

```bash
# Set application settings
az functionapp config appsettings set \
  --name guardduty-function-app \
  --resource-group guardduty-integration-rg \
  --settings \
    AZURE_TENANT_ID=your-tenant-id \
    AZURE_CLIENT_ID=your-client-id \
    AZURE_CLIENT_SECRET=your-client-secret \
    AWS_S3_BUCKET_NAME=your-guardduty-bucket
```

## Configuration Management

### Environment Variables

All deployment methods support configuration via environment variables:

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `AZURE_TENANT_ID` | Yes | Azure tenant ID | - |
| `AZURE_CLIENT_ID` | Yes | Azure client ID | - |
| `AZURE_CLIENT_SECRET` | Yes | Azure client secret | - |
| `AWS_REGION` | Yes | AWS region | - |
| `AWS_S3_BUCKET_NAME` | Yes | S3 bucket name | - |
| `BATCH_SIZE` | No | Processing batch size | 100 |
| `MAX_RETRIES` | No | Maximum retry attempts | 3 |
| `ENABLE_NORMALIZATION` | No | Enable data normalization | false |
| `ENABLE_DEDUPLICATION` | No | Enable deduplication | true |

### Configuration Files

For complex configurations, use JSON or YAML files:

```json
{
  "batchSize": 100,
  "maxRetries": 3,
  "enableNormalization": false,
  "dcr": {
    "immutableId": "dcr-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "streamName": "Custom-GuardDutyFindings"
  },
  "aws": {
    "region": "us-east-1",
    "s3BucketName": "your-guardduty-bucket"
  },
  "azure": {
    "tenantId": "your-tenant-id",
    "clientId": "your-client-id",
    "workspaceId": "your-workspace-id"
  }
}
```

## Security Considerations

### Secrets Management

- **Never commit secrets** to version control
- Use **Azure Key Vault** or **AWS Secrets Manager** for production
- Implement **secret rotation** policies
- Use **managed identities** when possible

### Network Security

- Deploy in **private subnets** when using containers
- Configure **security groups** and **NSGs** appropriately
- Use **VPC endpoints** for AWS services
- Enable **Azure Private Link** for Azure services

### Access Control

- Follow **principle of least privilege**
- Use **IAM roles** instead of access keys when possible
- Implement **resource-based policies**
- Enable **audit logging** for all resources

### Data Protection

- Enable **encryption in transit** and **at rest**
- Use **customer-managed keys** for sensitive data
- Implement **data retention** policies
- Configure **backup and recovery** procedures

## Validation and Testing

### Health Checks

All deployment methods provide health check endpoints:

```bash
# Container deployment
curl http://localhost:3000/health

# Lambda deployment (via API Gateway)
curl https://api-gateway-url/health

# Azure Functions deployment
curl https://function-app.azurewebsites.net/api/health
```

### Integration Testing

```bash
# Test S3 to Azure flow
npm run test:integration

# Test with sample data
npm run test:sample-data

# Validate KQL queries
npm run test:kql
```

### Performance Testing

```bash
# Load testing
npm run test:load

# Stress testing
npm run test:stress

# Memory profiling
npm run profile:memory
```

### Monitoring Validation

- Check **Azure Monitor Logs** for ingested data
- Verify **metrics collection** in monitoring systems
- Test **alert rules** and **incident generation**
- Validate **log aggregation** and **correlation**

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   - Verify service principal permissions
   - Check credential expiration
   - Validate tenant/subscription IDs

2. **Network Connectivity**
   - Test DNS resolution
   - Check firewall rules
   - Verify endpoint accessibility

3. **Data Ingestion Issues**
   - Validate DCR configuration
   - Check data format compliance
   - Monitor ingestion quotas

4. **Performance Problems**
   - Adjust batch sizes
   - Scale worker instances
   - Optimize retry policies

### Diagnostic Commands

```bash
# Check application logs
docker logs guardduty-sentinel-integration

# Validate configuration
npm run validate:config

# Test connectivity
npm run test:connectivity

# Check resource usage
docker stats guardduty-sentinel-integration
```

## Next Steps

After successful deployment:

1. **Configure Sentinel Analytics Rules** (see [Operations Guide](operations-guide.md))
2. **Set up Monitoring and Alerting** (see [Monitoring Guide](monitoring-guide.md))
3. **Implement Backup and Recovery** procedures
4. **Plan for Scaling** and capacity management
5. **Schedule Regular Maintenance** and updates

For detailed operational procedures, see the [Operations Guide](operations-guide.md).