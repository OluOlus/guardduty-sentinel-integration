# Azure Function Worker for GuardDuty to Sentinel Integration

This Azure Function worker processes GuardDuty findings from S3 and ingests them into Azure Monitor Logs for Sentinel analysis.

## Features

- **HTTP Trigger**: Manual processing and health checks
- **Timer Trigger**: Scheduled processing every 15 minutes
- **Batch Processing**: Configurable batch sizes for optimal throughput
- **Retry Logic**: Exponential backoff with configurable retry policies
- **Deduplication**: Optional finding deduplication to prevent duplicates
- **Health Monitoring**: Built-in health checks and metrics collection
- **Secure Configuration**: Environment-based configuration with validation

## Architecture

```
S3 Bucket (GuardDuty) → Azure Function → Azure Monitor Logs → Sentinel
```

The function:
1. Lists S3 objects from the configured GuardDuty bucket
2. Downloads and processes JSONL files with KMS decryption
3. Transforms findings (optional normalization)
4. Batches findings for efficient ingestion
5. Ingests data into Azure Monitor via Data Collection Rules
6. Provides health monitoring and metrics

## Prerequisites

- Azure subscription with appropriate permissions
- Azure Function App (Consumption or Premium plan)
- Log Analytics workspace with Data Collection Rule configured
- AWS S3 bucket with GuardDuty findings export
- Service Principal with "Monitoring Metrics Publisher" role

## Configuration

### Required Environment Variables

```bash
# Azure Configuration
AZURE_TENANT_ID=your-tenant-id
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret
AZURE_WORKSPACE_ID=your-workspace-id
AZURE_SUBSCRIPTION_ID=your-subscription-id
AZURE_RESOURCE_GROUP_NAME=your-resource-group
AZURE_DCR_IMMUTABLE_ID=dcr-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AZURE_DCR_STREAM_NAME=Custom-GuardDutyFindings

# AWS Configuration
AWS_REGION=us-east-1
AWS_S3_BUCKET_NAME=your-guardduty-bucket
AWS_S3_BUCKET_PREFIX=AWSLogs/123456789012/GuardDuty/
AWS_KMS_KEY_ARN=arn:aws:kms:us-east-1:123456789012:key/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### Optional Configuration

```bash
# Processing Configuration
BATCH_SIZE=100                    # Findings per batch (1-1000)
MAX_RETRIES=3                     # Retry attempts (0-10)
RETRY_BACKOFF_MS=1000            # Initial retry delay
ENABLE_NORMALIZATION=false        # Transform findings
DEAD_LETTER_QUEUE=your-dlq-name  # Failed processing queue

# Deduplication
ENABLE_DEDUPLICATION=true         # Enable deduplication
DEDUPLICATION_STRATEGY=findingId  # findingId|contentHash|timeWindow
DEDUPLICATION_TIME_WINDOW_MINUTES=60
DEDUPLICATION_CACHE_SIZE=10000

# Monitoring
ENABLE_METRICS=true               # Enable metrics collection
ENABLE_DETAILED_LOGGING=false     # Verbose logging
LOG_LEVEL=info                    # debug|info|warn|error
METRICS_BACKEND_TYPE=console      # console|prometheus|cloudwatch|azure-monitor
```

## Deployment

### Automated Deployment

1. **Set environment variables**:
   ```bash
   export AZURE_RESOURCE_GROUP_NAME="guardduty-sentinel-rg"
   export AZURE_FUNCTION_APP_NAME="guardduty-sentinel-func"
   export AZURE_LOCATION="eastus"
   # ... other required variables
   ```

2. **Run deployment script**:
   ```bash
   ./deploy.sh
   ```

### Manual Deployment

1. **Create Azure resources**:
   ```bash
   # Create resource group
   az group create --name guardduty-sentinel-rg --location eastus
   
   # Create storage account
   az storage account create \
     --name guarddutysentinelsa \
     --resource-group guardduty-sentinel-rg \
     --location eastus \
     --sku Standard_LRS
   
   # Create function app
   az functionapp create \
     --name guardduty-sentinel-func \
     --resource-group guardduty-sentinel-rg \
     --storage-account guarddutysentinelsa \
     --runtime node \
     --runtime-version 18 \
     --functions-version 4 \
     --consumption-plan-location eastus
   ```

2. **Configure application settings**:
   ```bash
   az functionapp config appsettings set \
     --name guardduty-sentinel-func \
     --resource-group guardduty-sentinel-rg \
     --settings @settings.json
   ```

3. **Build and deploy**:
   ```bash
   npm run build
   func azure functionapp publish guardduty-sentinel-func --typescript
   ```

## Usage

### HTTP Trigger

The HTTP trigger supports multiple endpoints:

#### Health Check
```bash
curl -X GET "https://guardduty-sentinel-func.azurewebsites.net/api/guardduty-http"
```

#### Manual Processing (All S3 Objects)
```bash
curl -X POST "https://guardduty-sentinel-func.azurewebsites.net/api/guardduty-http" \
  -H "Content-Type: application/json" \
  -d '{"mode": "auto"}'
```

#### Process Specific S3 Objects
```bash
curl -X POST "https://guardduty-sentinel-func.azurewebsites.net/api/guardduty-http" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "specific",
    "s3Objects": [
      {
        "bucket": "my-guardduty-bucket",
        "key": "AWSLogs/123456789012/GuardDuty/us-east-1/2024/01/20/finding.jsonl.gz",
        "size": 1024,
        "lastModified": "2024-01-20T10:00:00Z",
        "etag": "abc123"
      }
    ]
  }'
```

#### Process Findings Directly
```bash
curl -X POST "https://guardduty-sentinel-func.azurewebsites.net/api/guardduty-http" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "findings",
    "findings": [
      {
        "id": "finding-123",
        "accountId": "123456789012",
        "region": "us-east-1",
        "type": "Trojan:EC2/DNSDataExfiltration",
        "severity": 8.0,
        "createdAt": "2024-01-20T10:00:00Z",
        "title": "DNS data exfiltration detected"
      }
    ]
  }'
```

### Timer Trigger

The timer trigger runs automatically every 15 minutes (configurable in `host.json`):

```json
{
  "schedule": "0 */15 * * * *"
}
```

To modify the schedule, update the `app.timer` configuration in `index.ts`.

## Monitoring

### Health Checks

The function provides comprehensive health monitoring:

```bash
# Check overall health
curl "https://guardduty-sentinel-func.azurewebsites.net/api/guardduty-http"

# Response example
{
  "status": "healthy",
  "timestamp": "2024-01-20T10:00:00Z",
  "components": [
    {
      "name": "S3Service",
      "status": "healthy",
      "message": "S3 bucket accessible",
      "lastCheck": "2024-01-20T10:00:00Z"
    },
    {
      "name": "AzureMonitor",
      "status": "healthy",
      "message": "Azure Monitor accessible",
      "lastCheck": "2024-01-20T10:00:00Z"
    }
  ],
  "uptime": 3600,
  "version": "1.0.0"
}
```

### Logs

View function logs:

```bash
# Stream logs
az functionapp log tail \
  --name guardduty-sentinel-func \
  --resource-group guardduty-sentinel-rg

# View logs in Azure Portal
# Navigate to Function App > Functions > Monitor
```

### Metrics

The function emits custom metrics:

- `batches_completed`: Number of successfully processed batches
- `batches_failed`: Number of failed batches
- `findings_ingested`: Number of findings sent to Azure Monitor

View metrics in Azure Portal or configure custom dashboards.

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Verify Azure service principal has correct permissions
   - Check AWS credentials and S3 bucket access
   - Ensure KMS key permissions for GuardDuty service

2. **Configuration Errors**
   - Validate all required environment variables are set
   - Check DCR immutable ID and stream name
   - Verify S3 bucket name and prefix

3. **Processing Errors**
   - Check S3 object format (should be JSONL compressed)
   - Verify GuardDuty finding structure
   - Monitor batch processing metrics

4. **Azure Ingestion Errors**
   - Verify DCR configuration and schema
   - Check Azure Monitor service limits
   - Monitor ingestion response errors

### Debug Mode

Enable detailed logging:

```bash
az functionapp config appsettings set \
  --name guardduty-sentinel-func \
  --resource-group guardduty-sentinel-rg \
  --settings "LOG_LEVEL=debug" "ENABLE_DETAILED_LOGGING=true"
```

### Performance Tuning

- Adjust `BATCH_SIZE` based on finding size and processing time
- Increase `MAX_RETRIES` for unreliable network conditions
- Enable deduplication to reduce duplicate processing
- Use Premium plan for consistent performance

## Security Considerations

- Store sensitive configuration in Azure Key Vault
- Use managed identity instead of service principal when possible
- Enable Application Insights for security monitoring
- Regularly rotate credentials and access keys
- Monitor function access logs and metrics

## Cost Optimization

- Use Consumption plan for variable workloads
- Configure appropriate batch sizes to minimize executions
- Enable deduplication to reduce unnecessary processing
- Monitor and optimize function execution time
- Use Azure Monitor alerts for cost thresholds