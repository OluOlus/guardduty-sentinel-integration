# AWS Lambda Worker for GuardDuty to Sentinel Integration

This AWS Lambda worker processes GuardDuty findings from S3 events and posts them to Azure HTTP endpoints using cross-cloud authentication and network configuration.

## Features

- **S3 Event Processing**: Automatic processing of GuardDuty JSONL files
- **Cross-Cloud Authentication**: Service principal authentication with Azure
- **HTTP API Integration**: Direct HTTP calls to Azure Monitor Logs Ingestion API
- **Batch Processing**: Configurable batch sizes optimized for Lambda
- **Retry Logic**: Exponential backoff with configurable retry policies
- **Deduplication**: Optional finding deduplication to prevent duplicates
- **Health Monitoring**: Built-in health checks and CloudWatch metrics
- **Dead Letter Queue**: Failed processing handling with SQS DLQ

## Architecture

```
S3 Event → Lambda Function → Azure HTTP API → Azure Monitor Logs → Sentinel
```

The Lambda function:
1. Receives S3 event notifications for new GuardDuty files
2. Downloads and processes JSONL files with KMS decryption
3. Transforms findings (optional normalization)
4. Batches findings for efficient HTTP requests
5. Posts data to Azure Monitor via HTTP API with OAuth authentication
6. Provides health monitoring and error handling

## Prerequisites

- AWS account with appropriate permissions
- S3 bucket configured for GuardDuty findings export
- Azure subscription with Log Analytics workspace
- Data Collection Rule configured in Azure Monitor
- Service Principal with "Monitoring Metrics Publisher" role
- AWS SAM CLI for deployment

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
# Processing Configuration (Lambda optimized)
BATCH_SIZE=50                     # Findings per batch (1-500)
MAX_RETRIES=3                     # Retry attempts (0-10)
RETRY_BACKOFF_MS=1000            # Initial retry delay
ENABLE_NORMALIZATION=false        # Transform findings
DEAD_LETTER_QUEUE=guardduty-dlq  # Failed processing queue

# Deduplication (Lambda optimized)
ENABLE_DEDUPLICATION=true         # Enable deduplication
DEDUPLICATION_STRATEGY=findingId  # findingId|contentHash|timeWindow
DEDUPLICATION_TIME_WINDOW_MINUTES=60
DEDUPLICATION_CACHE_SIZE=5000     # Smaller cache for Lambda

# Monitoring (Lambda optimized)
ENABLE_METRICS=true               # Enable metrics collection
ENABLE_DETAILED_LOGGING=false     # Verbose logging
LOG_LEVEL=info                    # debug|info|warn|error
METRICS_BACKEND_TYPE=cloudwatch   # CloudWatch for Lambda
HTTP_TIMEOUT_MS=25000            # 25 seconds for Lambda
LAMBDA_MEMORY_SIZE=512           # Lambda memory in MB
```

## Deployment

### Automated Deployment with SAM

1. **Set environment variables**:
   ```bash
   export AWS_STACK_NAME="guardduty-sentinel-lambda"
   export AWS_REGION="us-east-1"
   export SAM_DEPLOYMENT_BUCKET="your-sam-bucket"
   # ... other required variables
   ```

2. **Run deployment script**:
   ```bash
   ./deploy.sh
   ```

### Manual Deployment

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Build the function**:
   ```bash
   npm run build
   ```

3. **Deploy with SAM**:
   ```bash
   sam build --use-container
   sam deploy --guided
   ```

### CloudFormation Parameters

When deploying, you'll be prompted for these parameters:

- **AzureTenantId**: Azure tenant ID
- **AzureClientId**: Azure service principal client ID
- **AzureClientSecret**: Azure service principal secret
- **AzureWorkspaceId**: Log Analytics workspace ID
- **AzureDcrImmutableId**: Data Collection Rule immutable ID
- **S3BucketName**: GuardDuty S3 bucket name
- **BatchSize**: Processing batch size (default: 50)
- **EnableNormalization**: Enable data transformation (default: false)
- **LogLevel**: Logging level (default: info)

## Usage

### S3 Event Processing

The Lambda function automatically processes S3 events:

1. **S3 Bucket Configuration**: Configure GuardDuty to export to S3
2. **Event Notifications**: S3 sends events to Lambda for new objects
3. **Automatic Processing**: Lambda processes JSONL files and sends to Azure

### Manual Processing

Use the API Gateway endpoints for manual processing:

#### Health Check
```bash
curl -X GET "https://your-api-id.execute-api.us-east-1.amazonaws.com/prod/health"
```

#### Manual Processing (All S3 Objects)
```bash
curl -X POST "https://your-api-id.execute-api.us-east-1.amazonaws.com/prod/process" \
  -H "Content-Type: application/json" \
  -d '{}'
```

#### Process Specific S3 Objects
```bash
curl -X POST "https://your-api-id.execute-api.us-east-1.amazonaws.com/prod/process" \
  -H "Content-Type: application/json" \
  -d '{
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
curl -X POST "https://your-api-id.execute-api.us-east-1.amazonaws.com/prod/process" \
  -H "Content-Type: application/json" \
  -d '{
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

## Monitoring

### CloudWatch Metrics

The Lambda function emits custom metrics:

- `lambda_invocations`: Number of Lambda invocations
- `s3_records_processed`: Number of S3 records processed
- `findings_processed`: Number of findings processed
- `findings_ingested`: Number of findings sent to Azure
- `lambda_errors`: Number of Lambda errors
- `lambda_failures`: Number of Lambda failures

### CloudWatch Logs

View Lambda logs:

```bash
# Stream logs
aws logs tail /aws/lambda/guardduty-sentinel-lambda-guardduty-processor --follow

# View logs in AWS Console
# Navigate to CloudWatch > Log groups > /aws/lambda/your-function-name
```

### CloudWatch Dashboard

The deployment creates a CloudWatch dashboard with:

- Lambda invocation metrics
- Error rates and duration
- Recent error logs
- Custom metrics from the application

### Health Checks

The health check endpoint provides detailed status:

```bash
curl "https://your-api-id.execute-api.us-east-1.amazonaws.com/prod/health"

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
      "name": "AzureHttpClient",
      "status": "healthy",
      "message": "Azure HTTP endpoint accessible",
      "lastCheck": "2024-01-20T10:00:00Z"
    }
  ],
  "uptime": 3600,
  "version": "1.0.0"
}
```

### Dead Letter Queue

Failed processing is sent to an SQS Dead Letter Queue:

```bash
# View DLQ messages
aws sqs receive-message --queue-url "https://sqs.us-east-1.amazonaws.com/123456789012/guardduty-sentinel-lambda-processing-dlq"

# Process DLQ messages manually
aws sqs get-queue-attributes --queue-url "your-dlq-url" --attribute-names All
```

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Verify Azure service principal has correct permissions
   - Check AWS Lambda execution role permissions
   - Ensure KMS key permissions for GuardDuty service

2. **S3 Event Processing Errors**
   - Verify S3 bucket event notifications are configured
   - Check S3 object key format (should be JSONL compressed)
   - Ensure Lambda has S3 read permissions

3. **Azure HTTP Errors**
   - Verify DCR immutable ID and stream name
   - Check Azure Monitor service limits
   - Monitor HTTP response codes and errors

4. **Lambda Timeout Errors**
   - Reduce batch size for large findings
   - Increase Lambda timeout (max 15 minutes)
   - Monitor Lambda duration metrics

### Debug Mode

Enable detailed logging:

```bash
aws lambda update-function-configuration \
  --function-name guardduty-sentinel-lambda-guardduty-processor \
  --environment Variables='{
    "LOG_LEVEL": "debug",
    "ENABLE_DETAILED_LOGGING": "true"
  }'
```

### Performance Tuning

- **Batch Size**: Adjust based on finding size and processing time
- **Memory**: Increase Lambda memory for better performance
- **Concurrency**: Set reserved concurrency to control costs
- **Timeout**: Balance between processing time and cost
- **Deduplication Cache**: Adjust cache size based on memory usage

## Security Considerations

- Store sensitive configuration in AWS Systems Manager Parameter Store or Secrets Manager
- Use IAM roles instead of access keys when possible
- Enable CloudTrail for API call auditing
- Monitor Lambda function access and invocations
- Regularly rotate Azure service principal credentials
- Use VPC endpoints for S3 access if required

## Cost Optimization

- Use appropriate Lambda memory allocation
- Set reserved concurrency to control costs
- Monitor and optimize batch sizes
- Use CloudWatch alarms for cost thresholds
- Consider Provisioned Concurrency for consistent performance
- Optimize S3 event filtering to reduce unnecessary invocations

## Scaling Considerations

- Lambda automatically scales based on S3 events
- Set reserved concurrency to prevent overwhelming Azure
- Monitor Azure Monitor rate limits
- Consider using SQS for buffering high-volume events
- Use multiple Lambda functions for different AWS regions
- Implement circuit breaker pattern for Azure failures