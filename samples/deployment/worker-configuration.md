# Worker Configuration Guide

This guide shows how to configure and deploy the GuardDuty to Sentinel ingestion worker after setting up AWS and Azure resources.

## Overview

The ingestion worker is the component that:
1. Reads GuardDuty findings from S3
2. Processes and optionally transforms the data
3. Sends findings to Azure Monitor via DCR
4. Handles retries, deduplication, and error logging

## Configuration Sources

The worker loads configuration from multiple sources with this precedence:
1. **Environment Variables** (highest precedence)
2. **Configuration File** (JSON or YAML)
3. **Default Values** (lowest precedence)

## Step 1: Combine AWS and Azure Configurations

Merge the configurations generated from the AWS and Azure setup guides:

```bash
# Navigate to the config directory
cd samples/config

# Combine generated configurations
cat > complete-config.json << 'EOF'
{
  "batchSize": 100,
  "maxRetries": 3,
  "retryBackoffMs": 1000,
  "enableNormalization": true,
  "deadLetterQueue": "guardduty-failed-findings",
  "azureEndpoint": "AZURE_ENDPOINT_FROM_AZURE_SETUP",
  "dcr": {
    "immutableId": "DCR_IMMUTABLE_ID_FROM_AZURE_SETUP",
    "streamName": "Custom-GuardDutyFindings"
  },
  "aws": {
    "region": "AWS_REGION_FROM_AWS_SETUP",
    "s3BucketName": "S3_BUCKET_FROM_AWS_SETUP",
    "s3BucketPrefix": "AWSLogs/ACCOUNT_ID/GuardDuty/",
    "kmsKeyArn": "KMS_KEY_ARN_FROM_AWS_SETUP"
  },
  "azure": {
    "tenantId": "TENANT_ID_FROM_AZURE_SETUP",
    "clientId": "CLIENT_ID_FROM_AZURE_SETUP",
    "clientSecret": "CLIENT_SECRET_FROM_AZURE_SETUP",
    "workspaceId": "WORKSPACE_ID_FROM_AZURE_SETUP",
    "subscriptionId": "SUBSCRIPTION_ID_FROM_AZURE_SETUP",
    "resourceGroupName": "RESOURCE_GROUP_FROM_AZURE_SETUP"
  },
  "deduplication": {
    "enabled": true,
    "strategy": "findingId",
    "cacheSize": 10000
  },
  "monitoring": {
    "enableMetrics": true,
    "enableDetailedLogging": true,
    "healthCheckPort": 8080,
    "metricsBackend": {
      "type": "console",
      "config": {}
    }
  }
}
EOF

# Replace placeholders with actual values from your setup
# You can use the generated-aws-config.json and generated-azure-config.json files
```

## Step 2: Create Environment Variables Configuration

For containerized deployments, create an environment variables file:

```bash
# Create environment variables file
cat > complete-config.env << 'EOF'
# Core Processing Settings
BATCH_SIZE=100
MAX_RETRIES=3
RETRY_BACKOFF_MS=1000
ENABLE_NORMALIZATION=true
DEAD_LETTER_QUEUE=guardduty-failed-findings

# Azure Configuration
AZURE_ENDPOINT=YOUR_DCR_ENDPOINT
DCR_IMMUTABLE_ID=YOUR_DCR_IMMUTABLE_ID
DCR_STREAM_NAME=Custom-GuardDutyFindings

# AWS Configuration
AWS_REGION=YOUR_AWS_REGION
AWS_S3_BUCKET_NAME=YOUR_S3_BUCKET_NAME
AWS_S3_BUCKET_PREFIX=AWSLogs/YOUR_ACCOUNT_ID/GuardDuty/
AWS_KMS_KEY_ARN=YOUR_KMS_KEY_ARN

# Azure Authentication
AZURE_TENANT_ID=YOUR_TENANT_ID
AZURE_CLIENT_ID=YOUR_CLIENT_ID
AZURE_CLIENT_SECRET=YOUR_CLIENT_SECRET
AZURE_WORKSPACE_ID=YOUR_WORKSPACE_ID
AZURE_SUBSCRIPTION_ID=YOUR_SUBSCRIPTION_ID
AZURE_RESOURCE_GROUP_NAME=YOUR_RESOURCE_GROUP

# Deduplication Settings
DEDUPLICATION_ENABLED=true
DEDUPLICATION_STRATEGY=findingId
DEDUPLICATION_CACHE_SIZE=10000

# Monitoring Settings
MONITORING_ENABLE_METRICS=true
MONITORING_ENABLE_DETAILED_LOGGING=true
MONITORING_HEALTH_CHECK_PORT=8080
EOF

echo "Replace placeholder values with your actual configuration"
```

## Step 3: Validate Configuration

Use the configuration validation script to check your settings:

```bash
# Create validation script
cat > validate-config.js << 'EOF'
const { ConfigurationManager } = require('../../src/services/configuration-manager');

async function validateConfiguration() {
    try {
        const configManager = new ConfigurationManager();
        const result = await configManager.loadConfiguration('complete-config.json');
        
        console.log('✅ Configuration validation successful!');
        console.log('Configuration sources:', result.sources);
        
        if (result.warnings.length > 0) {
            console.log('\n⚠️  Warnings:');
            result.warnings.forEach(warning => console.log(`  - ${warning}`));
        }
        
        // Test key configuration values
        const config = result.config;
        console.log('\n📋 Configuration Summary:');
        console.log(`  Batch Size: ${config.batchSize}`);
        console.log(`  Max Retries: ${config.maxRetries}`);
        console.log(`  Normalization: ${config.enableNormalization ? 'Enabled' : 'Disabled'}`);
        console.log(`  AWS Region: ${config.aws.region}`);
        console.log(`  S3 Bucket: ${config.aws.s3BucketName}`);
        console.log(`  Azure Workspace: ${config.azure.workspaceId}`);
        console.log(`  DCR Stream: ${config.dcr.streamName}`);
        console.log(`  Deduplication: ${config.deduplication.enabled ? config.deduplication.strategy : 'Disabled'}`);
        
    } catch (error) {
        console.error('❌ Configuration validation failed:');
        console.error(error.message);
        process.exit(1);
    }
}

validateConfiguration();
EOF

# Run validation (requires the project to be built)
echo "Run 'node validate-config.js' after building the project to validate your configuration"
```

## Step 4: Choose Deployment Method

### Option A: Azure Function Deployment

Create Azure Function configuration:

```bash
# Create Azure Function settings
cat > azure-function-settings.json << 'EOF'
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "DefaultEndpointsProtocol=https;AccountName=YOUR_STORAGE_ACCOUNT;AccountKey=YOUR_KEY;EndpointSuffix=core.windows.net",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "FUNCTIONS_EXTENSION_VERSION": "~4",
    "BATCH_SIZE": "100",
    "MAX_RETRIES": "3",
    "RETRY_BACKOFF_MS": "1000",
    "ENABLE_NORMALIZATION": "true",
    "AZURE_ENDPOINT": "YOUR_DCR_ENDPOINT",
    "DCR_IMMUTABLE_ID": "YOUR_DCR_IMMUTABLE_ID",
    "DCR_STREAM_NAME": "Custom-GuardDutyFindings",
    "AWS_REGION": "YOUR_AWS_REGION",
    "AWS_S3_BUCKET_NAME": "YOUR_S3_BUCKET_NAME",
    "AWS_S3_BUCKET_PREFIX": "AWSLogs/YOUR_ACCOUNT_ID/GuardDuty/",
    "AZURE_TENANT_ID": "YOUR_TENANT_ID",
    "AZURE_CLIENT_ID": "YOUR_CLIENT_ID",
    "AZURE_CLIENT_SECRET": "YOUR_CLIENT_SECRET",
    "AZURE_WORKSPACE_ID": "YOUR_WORKSPACE_ID",
    "AZURE_SUBSCRIPTION_ID": "YOUR_SUBSCRIPTION_ID",
    "AZURE_RESOURCE_GROUP_NAME": "YOUR_RESOURCE_GROUP",
    "DEDUPLICATION_ENABLED": "true",
    "DEDUPLICATION_STRATEGY": "findingId",
    "MONITORING_ENABLE_METRICS": "true"
  }
}
EOF

echo "Azure Function settings created. Deploy using Azure CLI or Portal."
```

### Option B: Container Deployment

Create Docker configuration:

```bash
# Create Dockerfile
cat > Dockerfile << 'EOF'
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY dist/ ./dist/
COPY samples/config/complete-config.json ./config.json

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S worker -u 1001
USER worker

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

EXPOSE 8080

CMD ["node", "dist/workers/container-worker.js"]
EOF

# Create docker-compose.yml
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  guardduty-worker:
    build: .
    environment:
      - NODE_ENV=production
    env_file:
      - complete-config.env
    ports:
      - "8080:8080"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
EOF

echo "Docker configuration created. Build and run with:"
echo "  docker-compose up --build"
```

### Option C: AWS Lambda Deployment

Create Lambda configuration:

```bash
# Create Lambda environment variables
cat > lambda-environment.json << 'EOF'
{
  "Variables": {
    "BATCH_SIZE": "100",
    "MAX_RETRIES": "3",
    "RETRY_BACKOFF_MS": "1000",
    "ENABLE_NORMALIZATION": "true",
    "AZURE_ENDPOINT": "YOUR_DCR_ENDPOINT",
    "DCR_IMMUTABLE_ID": "YOUR_DCR_IMMUTABLE_ID",
    "DCR_STREAM_NAME": "Custom-GuardDutyFindings",
    "AWS_REGION": "YOUR_AWS_REGION",
    "AWS_S3_BUCKET_NAME": "YOUR_S3_BUCKET_NAME",
    "AWS_S3_BUCKET_PREFIX": "AWSLogs/YOUR_ACCOUNT_ID/GuardDuty/",
    "AZURE_TENANT_ID": "YOUR_TENANT_ID",
    "AZURE_CLIENT_ID": "YOUR_CLIENT_ID",
    "AZURE_CLIENT_SECRET": "YOUR_CLIENT_SECRET",
    "AZURE_WORKSPACE_ID": "YOUR_WORKSPACE_ID",
    "AZURE_SUBSCRIPTION_ID": "YOUR_SUBSCRIPTION_ID",
    "AZURE_RESOURCE_GROUP_NAME": "YOUR_RESOURCE_GROUP",
    "DEDUPLICATION_ENABLED": "true",
    "DEDUPLICATION_STRATEGY": "findingId"
  }
}
EOF

# Create Lambda deployment script
cat > deploy-lambda.sh << 'EOF'
#!/bin/bash

# Build the project
npm run build

# Create deployment package
zip -r guardduty-worker.zip dist/ node_modules/ package.json

# Create or update Lambda function
aws lambda create-function \
    --function-name guardduty-sentinel-worker \
    --runtime nodejs18.x \
    --role arn:aws:iam::YOUR_ACCOUNT_ID:role/GuardDutySentinelWorkerRole \
    --handler dist/workers/lambda-worker.handler \
    --zip-file fileb://guardduty-worker.zip \
    --timeout 300 \
    --memory-size 512 \
    --environment file://lambda-environment.json

# Configure S3 trigger
aws lambda add-permission \
    --function-name guardduty-sentinel-worker \
    --principal s3.amazonaws.com \
    --action lambda:InvokeFunction \
    --source-arn arn:aws:s3:::YOUR_S3_BUCKET_NAME \
    --statement-id s3-trigger

# Add S3 event notification
aws s3api put-bucket-notification-configuration \
    --bucket YOUR_S3_BUCKET_NAME \
    --notification-configuration '{
        "LambdaConfigurations": [
            {
                "Id": "guardduty-processing",
                "LambdaFunctionArn": "arn:aws:lambda:YOUR_REGION:YOUR_ACCOUNT_ID:function:guardduty-sentinel-worker",
                "Events": ["s3:ObjectCreated:*"],
                "Filter": {
                    "Key": {
                        "FilterRules": [
                            {
                                "Name": "prefix",
                                "Value": "AWSLogs/"
                            },
                            {
                                "Name": "suffix",
                                "Value": ".jsonl.gz"
                            }
                        ]
                    }
                }
            }
        ]
    }'

echo "Lambda function deployed and configured"
EOF

chmod +x deploy-lambda.sh
echo "Lambda deployment script created. Update placeholders and run ./deploy-lambda.sh"
```

## Step 5: Test Configuration

Create a test script to verify the worker can connect to both AWS and Azure:

```bash
# Create connection test script
cat > test-connections.js << 'EOF'
const { ConfigurationManager } = require('../../src/services/configuration-manager');
const { S3Service } = require('../../src/services/s3-service');
const { AzureMonitorClient } = require('../../src/services/azure-monitor-client');

async function testConnections() {
    try {
        console.log('🔧 Loading configuration...');
        const configManager = new ConfigurationManager();
        const result = await configManager.loadConfiguration('complete-config.json');
        const config = result.config;
        
        console.log('✅ Configuration loaded successfully');
        
        // Test AWS S3 connection
        console.log('\n🔍 Testing AWS S3 connection...');
        const s3Service = new S3Service(config.aws);
        
        try {
            // List objects in the bucket (this tests permissions)
            const objects = await s3Service.listObjects(config.aws.s3BucketName, config.aws.s3BucketPrefix, 1);
            console.log(`✅ S3 connection successful. Found ${objects.length} objects.`);
        } catch (error) {
            console.log(`⚠️  S3 connection test failed: ${error.message}`);
            console.log('   This may be normal if no GuardDuty findings have been exported yet.');
        }
        
        // Test Azure Monitor connection
        console.log('\n🔍 Testing Azure Monitor connection...');
        const azureClient = new AzureMonitorClient(config);
        
        try {
            // Test authentication (this will fail if credentials are wrong)
            await azureClient.validateConnection();
            console.log('✅ Azure Monitor connection successful');
        } catch (error) {
            console.log(`❌ Azure Monitor connection failed: ${error.message}`);
            throw error;
        }
        
        console.log('\n🎉 All connection tests passed!');
        console.log('\nNext steps:');
        console.log('1. Deploy the worker using your chosen method');
        console.log('2. Generate test GuardDuty findings');
        console.log('3. Monitor the worker logs for processing activity');
        
    } catch (error) {
        console.error('\n❌ Connection test failed:');
        console.error(error.message);
        process.exit(1);
    }
}

testConnections();
EOF

echo "Connection test script created. Run 'node test-connections.js' after building the project."
```

## Step 6: Configure Monitoring

Set up monitoring and alerting for the worker:

```bash
# Create monitoring configuration
cat > monitoring-config.json << 'EOF'
{
  "monitoring": {
    "enableMetrics": true,
    "enableDetailedLogging": true,
    "healthCheckPort": 8080,
    "metricsBackend": {
      "type": "azure-monitor",
      "config": {
        "customMetricsEndpoint": "https://YOUR_WORKSPACE_ID.ods.opinsights.azure.com",
        "workspaceId": "YOUR_WORKSPACE_ID",
        "sharedKey": "YOUR_WORKSPACE_SHARED_KEY"
      }
    },
    "alerts": {
      "processingFailureThreshold": 5,
      "connectionFailureThreshold": 3,
      "alertWebhookUrl": "https://your-teams-or-slack-webhook-url"
    }
  }
}
EOF

echo "Monitoring configuration created. Integrate with your monitoring system."
```

## Configuration Reference

### Core Settings

| Setting | Description | Default | Valid Range |
|---------|-------------|---------|-------------|
| `batchSize` | Findings per batch | 100 | 1-1000 |
| `maxRetries` | Retry attempts | 3 | 0-10 |
| `retryBackoffMs` | Initial retry delay | 1000 | 100-60000 |
| `enableNormalization` | Transform data | false | true/false |
| `deadLetterQueue` | Failed findings queue | null | string |

### AWS Settings

| Setting | Description | Required |
|---------|-------------|----------|
| `aws.region` | AWS region | Yes |
| `aws.s3BucketName` | S3 bucket name | Yes |
| `aws.s3BucketPrefix` | S3 object prefix | No |
| `aws.kmsKeyArn` | KMS key ARN | No |

### Azure Settings

| Setting | Description | Required |
|---------|-------------|----------|
| `azureEndpoint` | DCR endpoint URL | Yes |
| `dcr.immutableId` | DCR immutable ID | Yes |
| `dcr.streamName` | Stream name | Yes |
| `azure.tenantId` | Azure tenant ID | Yes |
| `azure.clientId` | Service principal ID | Yes |
| `azure.clientSecret` | Service principal secret | Yes |

## Troubleshooting

### Configuration Issues

**Invalid Configuration Values**
- Check value ranges and data types
- Verify required fields are present
- Use the validation script to identify issues

**Environment Variable Override Issues**
- Check environment variable names match the mapping
- Verify boolean values use correct format (true/false, 1/0)
- Ensure URLs include protocol (https://)

### Connection Issues

**AWS Connection Failures**
- Verify AWS credentials and permissions
- Check S3 bucket exists and is accessible
- Test KMS key permissions if using custom key

**Azure Connection Failures**
- Verify service principal credentials
- Check DCR exists and is accessible
- Ensure service principal has "Monitoring Metrics Publisher" role

### Deployment Issues

**Azure Function Deployment**
- Check function app settings match configuration
- Verify storage account connection string
- Check function runtime version compatibility

**Container Deployment**
- Verify environment file is loaded correctly
- Check container has network access to AWS and Azure
- Monitor container logs for startup errors

**Lambda Deployment**
- Check IAM role has required permissions
- Verify S3 trigger is configured correctly
- Monitor CloudWatch logs for execution errors

## Next Steps

After configuring the worker:
1. Deploy using your chosen method
2. Run the [validation script](validation.md) to test end-to-end functionality
3. Monitor worker logs and metrics
4. Set up alerting for failures and performance issues