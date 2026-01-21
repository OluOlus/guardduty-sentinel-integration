# GuardDuty to Sentinel Integration - Troubleshooting Guide

## Overview

This guide provides detailed troubleshooting procedures for common issues encountered in the GuardDuty to Sentinel integration system.

## Table of Contents

1. [Quick Diagnostic Commands](#quick-diagnostic-commands)
2. [Authentication Issues](#authentication-issues)
3. [Data Processing Issues](#data-processing-issues)
4. [Performance Problems](#performance-problems)
5. [Network Connectivity Issues](#network-connectivity-issues)
6. [Configuration Problems](#configuration-problems)
7. [Azure Monitor Issues](#azure-monitor-issues)
8. [AWS S3 Issues](#aws-s3-issues)
9. [Container and Deployment Issues](#container-and-deployment-issues)
10. [Advanced Debugging](#advanced-debugging)

## Quick Diagnostic Commands

### System Health Check

```bash
# Overall health status
curl -s http://localhost:3000/health | jq '.'

# Component-specific health
curl -s http://localhost:3000/health | jq '.components[]'

# Check if service is responding
curl -I http://localhost:3000/health
```

### Metrics Overview

```bash
# Get all metrics
curl -s http://localhost:3000/metrics

# Key performance metrics
curl -s http://localhost:3000/metrics | grep -E "(findings_processed|batch_processing|error_rate)"

# Memory and CPU metrics
curl -s http://localhost:3000/metrics | grep -E "(process_resident_memory|process_cpu)"
```

### Log Analysis

```bash
# Recent error logs
docker logs guardduty-integration --since 1h | grep ERROR

# Count error types
docker logs guardduty-integration --since 1h | grep ERROR | awk '{print $5}' | sort | uniq -c

# Search for specific patterns
docker logs guardduty-integration | grep -i "authentication\|timeout\|connection"
```

## Authentication Issues

### Azure Authentication Problems

#### Symptoms
- 401 Unauthorized errors
- "Invalid client credentials" messages
- Azure ingestion failures

#### Diagnostic Steps

```bash
# Test Azure CLI authentication
az login --service-principal \
  -u $AZURE_CLIENT_ID \
  -p $AZURE_CLIENT_SECRET \
  --tenant $AZURE_TENANT_ID

# Verify service principal permissions
az role assignment list --assignee $AZURE_CLIENT_ID

# Test DCR access
az monitor data-collection rule show \
  --name $DCR_NAME \
  --resource-group $RESOURCE_GROUP
```

#### Common Solutions

1. **Expired Credentials**
   ```bash
   # Check credential expiration
   az ad sp show --id $AZURE_CLIENT_ID --query "passwordCredentials[].endDate"
   
   # Rotate credentials
   az ad sp credential reset --id $AZURE_CLIENT_ID
   ```

2. **Insufficient Permissions**
   ```bash
   # Add required role
   az role assignment create \
     --assignee $AZURE_CLIENT_ID \
     --role "Monitoring Metrics Publisher" \
     --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP"
   ```

3. **Incorrect Tenant ID**
   ```bash
   # Verify tenant ID
   az account show --query "tenantId"
   ```

### AWS Authentication Problems

#### Symptoms
- Access denied errors for S3
- KMS decryption failures
- "Invalid security token" messages

#### Diagnostic Steps

```bash
# Test AWS credentials
aws sts get-caller-identity

# Test S3 access
aws s3 ls s3://$S3_BUCKET_NAME

# Test KMS access
aws kms describe-key --key-id $KMS_KEY_ARN
```

#### Common Solutions

1. **IAM Role Issues**
   ```bash
   # Check assumed role
   aws sts get-caller-identity
   
   # Verify role permissions
   aws iam get-role-policy --role-name $ROLE_NAME --policy-name $POLICY_NAME
   ```

2. **S3 Bucket Policy**
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "AWS": "arn:aws:iam::ACCOUNT:role/ROLE_NAME"
         },
         "Action": [
           "s3:GetObject",
           "s3:ListBucket"
         ],
         "Resource": [
           "arn:aws:s3:::BUCKET_NAME",
           "arn:aws:s3:::BUCKET_NAME/*"
         ]
       }
     ]
   }
   ```

3. **KMS Key Policy**
   ```json
   {
     "Sid": "AllowGuardDutyAccess",
     "Effect": "Allow",
     "Principal": {
       "AWS": "arn:aws:iam::ACCOUNT:role/ROLE_NAME"
     },
     "Action": [
       "kms:Decrypt",
       "kms:GenerateDataKey"
     ],
     "Resource": "*"
   }
   ```

## Data Processing Issues

### Missing Findings

#### Symptoms
- Expected findings not appearing in Azure
- Processing count doesn't match S3 objects
- Gaps in data timeline

#### Diagnostic Steps

```bash
# Check S3 object listing
aws s3 ls s3://$S3_BUCKET_NAME/$PREFIX --recursive

# Verify processing metrics
curl -s http://localhost:3000/metrics | grep findings_processed_total

# Check for processing errors
docker logs guardduty-integration | grep -i "processing.*error"
```

#### Investigation Queries

```kql
// Check ingestion timeline
RawGuardDuty_CL
| where TimeGenerated > ago(24h)
| summarize count() by bin(TimeGenerated, 1h)
| render timechart

// Find missing time periods
let expected_hours = range(ago(24h), now(), 1h);
let actual_hours = RawGuardDuty_CL
| where TimeGenerated > ago(24h)
| summarize by bin(TimeGenerated, 1h);
expected_hours
| join kind=leftanti actual_hours on TimeGenerated
```

#### Common Solutions

1. **S3 Event Configuration**
   ```json
   {
     "Rules": [
       {
         "Name": "GuardDutyNotification",
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
         },
         "Status": "Enabled",
         "Configuration": {
           "LambdaConfiguration": {
             "LambdaFunctionArn": "arn:aws:lambda:region:account:function:guardduty-processor"
           }
         }
       }
     ]
   }
   ```

2. **Processing Queue Issues**
   ```bash
   # Check queue status
   curl -s http://localhost:3000/health | jq '.components[] | select(.name=="BatchProcessor")'
   
   # Clear stuck batches (if safe)
   curl -X POST http://localhost:3000/admin/clear-queue
   ```

### Duplicate Findings

#### Symptoms
- Same finding appearing multiple times
- Deduplication not working
- Inflated processing counts

#### Diagnostic Steps

```kql
// Find duplicate findings
RawGuardDuty_CL
| where TimeGenerated > ago(24h)
| summarize count() by FindingId
| where count_ > 1
| top 10 by count_

// Check deduplication metrics
```

```bash
# Check deduplication configuration
curl -s http://localhost:3000/health | jq '.components[] | select(.name=="DeduplicationService")'

# Review deduplication logs
docker logs guardduty-integration | grep -i deduplication
```

#### Common Solutions

1. **Deduplication Configuration**
   ```javascript
   // Adjust deduplication settings
   {
     "deduplication": {
       "enabled": true,
       "strategy": "findingId",
       "timeWindowMinutes": 60,
       "cacheSize": 10000
     }
   }
   ```

2. **Cache Size Optimization**
   ```bash
   # Monitor cache hit rate
   curl -s http://localhost:3000/metrics | grep deduplication_cache_hit_rate
   
   # Increase cache size if hit rate is low
   export DEDUPLICATION_CACHE_SIZE=20000
   ```

### Data Transformation Issues

#### Symptoms
- Malformed data in Azure
- Schema validation errors
- Missing fields in normalized view

#### Diagnostic Steps

```bash
# Check transformation logs
docker logs guardduty-integration | grep -i "transformation\|schema"

# Test transformation with sample data
npm run test:transformation

# Validate JSON schema
npm run validate:schema
```

#### Common Solutions

1. **Schema Validation**
   ```javascript
   // Add schema validation
   const schema = {
     type: "object",
     required: ["id", "type", "severity"],
     properties: {
       id: { type: "string" },
       type: { type: "string" },
       severity: { type: "number", minimum: 0, maximum: 8.9 }
     }
   };
   ```

2. **Field Mapping Issues**
   ```kql
   // Check for missing fields
   RawGuardDuty_CL
   | where TimeGenerated > ago(1h)
   | extend ParsedJson = parse_json(RawJson)
   | where isnull(ParsedJson.id) or isnull(ParsedJson.type)
   | take 10
   ```

## Performance Problems

### High Processing Latency

#### Symptoms
- Findings taking > 5 minutes to appear
- High queue depths
- Timeout errors

#### Diagnostic Steps

```bash
# Check processing duration
curl -s http://localhost:3000/metrics | grep batch_processing_duration

# Monitor queue status
watch -n 5 'curl -s http://localhost:3000/health | jq ".components[] | select(.name==\"BatchProcessor\")"'

# Check resource utilization
docker stats guardduty-integration
```

#### Performance Tuning

1. **Batch Size Optimization**
   ```bash
   # Test different batch sizes
   for size in 50 100 200 500; do
     echo "Testing batch size: $size"
     BATCH_SIZE=$size npm run test:performance
   done
   ```

2. **Parallel Processing**
   ```javascript
   // Increase concurrency
   const config = {
     batchSize: 200,
     maxConcurrentBatches: 5,
     processingTimeout: 30000
   };
   ```

3. **Memory Optimization**
   ```bash
   # Monitor memory usage
   docker exec guardduty-integration node -e "
     setInterval(() => {
       const mem = process.memoryUsage();
       console.log(\`Memory: \${Math.round(mem.rss/1024/1024)}MB RSS, \${Math.round(mem.heapUsed/1024/1024)}MB Heap\`);
     }, 5000);
   "
   ```

### Memory Leaks

#### Symptoms
- Gradually increasing memory usage
- Out of memory errors
- Container restarts

#### Diagnostic Steps

```bash
# Monitor memory over time
docker stats guardduty-integration --no-stream

# Generate heap dump
docker exec guardduty-integration kill -USR2 1

# Analyze heap dump
npm install -g clinic
clinic doctor -- node dist/index.js
```

#### Common Solutions

1. **Event Listener Cleanup**
   ```javascript
   // Proper cleanup
   class Processor {
     constructor() {
       this.cleanup = [];
     }
     
     addListener(emitter, event, handler) {
       emitter.on(event, handler);
       this.cleanup.push(() => emitter.removeListener(event, handler));
     }
     
     destroy() {
       this.cleanup.forEach(fn => fn());
     }
   }
   ```

2. **Stream Processing**
   ```javascript
   // Use streams for large files
   const stream = fs.createReadStream(filePath)
     .pipe(zlib.createGunzip())
     .pipe(split())
     .on('data', processLine)
     .on('end', () => stream.destroy());
   ```

## Network Connectivity Issues

### Azure Monitor Connection Problems

#### Symptoms
- Connection timeouts to Azure
- DNS resolution failures
- SSL/TLS errors

#### Diagnostic Steps

```bash
# Test DNS resolution
nslookup $DCR_ENDPOINT

# Test connectivity
curl -v https://$DCR_ENDPOINT

# Check SSL certificate
openssl s_client -connect $DCR_ENDPOINT:443 -servername $DCR_ENDPOINT
```

#### Common Solutions

1. **Firewall Configuration**
   ```bash
   # Allow Azure Monitor endpoints
   # *.ingest.monitor.azure.com:443
   # login.microsoftonline.com:443
   ```

2. **Proxy Configuration**
   ```bash
   # Configure proxy if needed
   export HTTPS_PROXY=http://proxy.company.com:8080
   export NO_PROXY=localhost,127.0.0.1,.local
   ```

### AWS S3 Connection Problems

#### Symptoms
- S3 access timeouts
- Connection refused errors
- Slow S3 operations

#### Diagnostic Steps

```bash
# Test S3 connectivity
aws s3 ls s3://$S3_BUCKET_NAME --debug

# Check regional endpoints
aws configure get region

# Test with different endpoints
aws s3 ls s3://$S3_BUCKET_NAME --endpoint-url https://s3.$AWS_REGION.amazonaws.com
```

#### Common Solutions

1. **VPC Endpoint Configuration**
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": "*",
         "Action": [
           "s3:GetObject",
           "s3:ListBucket"
         ],
         "Resource": [
           "arn:aws:s3:::bucket-name",
           "arn:aws:s3:::bucket-name/*"
         ]
       }
     ]
   }
   ```

2. **Connection Pooling**
   ```javascript
   // Optimize S3 client
   const s3Client = new S3Client({
     region: process.env.AWS_REGION,
     maxAttempts: 3,
     requestHandler: {
       connectionTimeout: 5000,
       socketTimeout: 30000
     }
   });
   ```

## Configuration Problems

### Environment Variable Issues

#### Symptoms
- "Missing required configuration" errors
- Default values being used unexpectedly
- Configuration validation failures

#### Diagnostic Steps

```bash
# Check environment variables
env | grep -E "(AZURE|AWS|BATCH|DCR)"

# Validate configuration
npm run validate:config

# Test configuration loading
node -e "console.log(JSON.stringify(require('./dist/config'), null, 2))"
```

#### Common Solutions

1. **Configuration Validation**
   ```javascript
   // Add validation
   const requiredVars = [
     'AZURE_TENANT_ID',
     'AZURE_CLIENT_ID',
     'AZURE_CLIENT_SECRET',
     'AWS_REGION',
     'AWS_S3_BUCKET_NAME'
   ];
   
   const missing = requiredVars.filter(v => !process.env[v]);
   if (missing.length > 0) {
     throw new Error(`Missing required variables: ${missing.join(', ')}`);
   }
   ```

2. **Configuration File Loading**
   ```javascript
   // Load from file if environment variables missing
   const config = {
     ...defaultConfig,
     ...loadConfigFile('./config.json'),
     ...loadEnvironmentConfig()
   };
   ```

### Docker Configuration Issues

#### Symptoms
- Container startup failures
- Environment variables not passed correctly
- Volume mount issues

#### Diagnostic Steps

```bash
# Check container logs
docker logs guardduty-integration

# Inspect container configuration
docker inspect guardduty-integration

# Test environment variables
docker exec guardduty-integration env | grep -E "(AZURE|AWS)"
```

#### Common Solutions

1. **Docker Compose Environment**
   ```yaml
   # Use .env file
   env_file:
     - .env
   
   # Or explicit environment
   environment:
     - AZURE_TENANT_ID=${AZURE_TENANT_ID}
     - AWS_REGION=${AWS_REGION}
   ```

2. **Kubernetes ConfigMap**
   ```yaml
   apiVersion: v1
   kind: ConfigMap
   metadata:
     name: guardduty-config
   data:
     BATCH_SIZE: "100"
     MAX_RETRIES: "3"
   ```

## Azure Monitor Issues

### DCR Configuration Problems

#### Symptoms
- "DCR not found" errors
- Schema validation failures
- Ingestion rejected

#### Diagnostic Steps

```bash
# Verify DCR exists
az monitor data-collection rule show \
  --name $DCR_NAME \
  --resource-group $RESOURCE_GROUP

# Check DCR configuration
az monitor data-collection rule show \
  --name $DCR_NAME \
  --resource-group $RESOURCE_GROUP \
  --query "properties.dataFlows"
```

#### Common Solutions

1. **DCR Stream Configuration**
   ```json
   {
     "streamDeclarations": {
       "Custom-GuardDutyFindings": {
         "columns": [
           {"name": "TimeGenerated", "type": "datetime"},
           {"name": "FindingId", "type": "string"},
           {"name": "RawJson", "type": "string"}
         ]
       }
     }
   }
   ```

2. **Data Flow Mapping**
   ```json
   {
     "dataFlows": [{
       "streams": ["Custom-GuardDutyFindings"],
       "destinations": ["LogAnalyticsDest"],
       "transformKql": "source | extend TimeGenerated = now()",
       "outputStream": "Custom-RawGuardDuty_CL"
     }]
   }
   ```

### Log Analytics Query Issues

#### Symptoms
- KQL queries failing
- Performance issues with queries
- Missing data in queries

#### Diagnostic Steps

```kql
// Check table schema
RawGuardDuty_CL
| getschema

// Verify data ingestion
RawGuardDuty_CL
| where TimeGenerated > ago(1h)
| summarize count() by bin(TimeGenerated, 5m)

// Check for parsing errors
RawGuardDuty_CL
| where TimeGenerated > ago(1h)
| extend ParsedJson = parse_json(RawJson)
| where isnull(ParsedJson)
| take 10
```

#### Common Solutions

1. **Query Optimization**
   ```kql
   // Use time filters
   RawGuardDuty_CL
   | where TimeGenerated > ago(1h)  // Always filter by time first
   | where Severity > 7.0
   | project TimeGenerated, FindingId, Type, Severity
   ```

2. **Function Creation**
   ```kql
   // Create reusable function
   .create function GuardDutyNormalized() {
     RawGuardDuty_CL
     | extend ParsedJson = parse_json(RawJson)
     | project 
       TimeGenerated,
       FindingId,
       Type = tostring(ParsedJson.type),
       Severity = todouble(ParsedJson.severity)
   }
   ```

## AWS S3 Issues

### S3 Access Problems

#### Symptoms
- "Access Denied" errors
- Bucket not found errors
- KMS decryption failures

#### Diagnostic Steps

```bash
# Test bucket access
aws s3 ls s3://$S3_BUCKET_NAME

# Check bucket policy
aws s3api get-bucket-policy --bucket $S3_BUCKET_NAME

# Test object access
aws s3api head-object --bucket $S3_BUCKET_NAME --key $OBJECT_KEY
```

#### Common Solutions

1. **Bucket Policy Update**
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "AllowGuardDutyAccess",
         "Effect": "Allow",
         "Principal": {
           "Service": "guardduty.amazonaws.com"
         },
         "Action": "s3:PutObject",
         "Resource": "arn:aws:s3:::bucket-name/*"
       }
     ]
   }
   ```

2. **Cross-Region Access**
   ```bash
   # Ensure correct region
   aws configure set region $AWS_REGION
   
   # Use regional endpoint
   aws s3 ls s3://$S3_BUCKET_NAME --region $AWS_REGION
   ```

### GuardDuty Export Issues

#### Symptoms
- No new files in S3
- Export destination not working
- Findings not being exported

#### Diagnostic Steps

```bash
# Check GuardDuty detector
aws guardduty list-detectors

# Check publishing destinations
aws guardduty list-publishing-destinations --detector-id $DETECTOR_ID

# Verify export configuration
aws guardduty describe-publishing-destination \
  --detector-id $DETECTOR_ID \
  --destination-id $DESTINATION_ID
```

#### Common Solutions

1. **Publishing Destination Configuration**
   ```bash
   # Create publishing destination
   aws guardduty create-publishing-destination \
     --detector-id $DETECTOR_ID \
     --destination-type S3 \
     --destination-properties DestinationArn=arn:aws:s3:::bucket-name,KmsKeyArn=arn:aws:kms:region:account:key/key-id
   ```

2. **GuardDuty Service Role**
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "s3:PutObject",
           "s3:GetBucketLocation"
         ],
         "Resource": [
           "arn:aws:s3:::bucket-name",
           "arn:aws:s3:::bucket-name/*"
         ]
       }
     ]
   }
   ```

## Container and Deployment Issues

### Kubernetes Deployment Problems

#### Symptoms
- Pods not starting
- CrashLoopBackOff status
- ImagePullBackOff errors

#### Diagnostic Steps

```bash
# Check pod status
kubectl get pods -n guardduty-integration

# Describe problematic pod
kubectl describe pod $POD_NAME -n guardduty-integration

# Check pod logs
kubectl logs $POD_NAME -n guardduty-integration

# Check events
kubectl get events -n guardduty-integration --sort-by='.lastTimestamp'
```

#### Common Solutions

1. **Resource Limits**
   ```yaml
   resources:
     limits:
       memory: "2Gi"
       cpu: "1000m"
     requests:
       memory: "1Gi"
       cpu: "500m"
   ```

2. **Health Check Configuration**
   ```yaml
   livenessProbe:
     httpGet:
       path: /health
       port: 3000
     initialDelaySeconds: 60
     periodSeconds: 30
   
   readinessProbe:
     httpGet:
       path: /ready
       port: 3000
     initialDelaySeconds: 30
     periodSeconds: 10
   ```

### Docker Container Issues

#### Symptoms
- Container exits immediately
- Permission denied errors
- Network connectivity issues

#### Diagnostic Steps

```bash
# Check container status
docker ps -a

# Inspect container
docker inspect guardduty-integration

# Check container logs
docker logs guardduty-integration --tail 100

# Test container interactively
docker run -it --rm guardduty-integration /bin/sh
```

#### Common Solutions

1. **User Permissions**
   ```dockerfile
   # Create non-root user
   RUN addgroup -g 1001 -S guardduty && \
       adduser -S guardduty -u 1001 -G guardduty
   
   USER guardduty
   ```

2. **Volume Permissions**
   ```bash
   # Fix volume permissions
   docker run --rm -v $(pwd)/logs:/app/logs \
     alpine chown -R 1001:1001 /app/logs
   ```

## Advanced Debugging

### Memory Profiling

```bash
# Generate heap snapshot
docker exec guardduty-integration node -e "
  const v8 = require('v8');
  const fs = require('fs');
  const snapshot = v8.writeHeapSnapshot();
  console.log('Heap snapshot written to:', snapshot);
"

# Analyze with Chrome DevTools
# Open chrome://inspect and load the snapshot
```

### CPU Profiling

```bash
# Install clinic.js
npm install -g clinic

# Profile CPU usage
clinic doctor -- node dist/index.js

# Profile performance
clinic flame -- node dist/index.js
```

### Network Debugging

```bash
# Capture network traffic
docker exec guardduty-integration tcpdump -i any -w /tmp/capture.pcap

# Analyze with Wireshark or tcpdump
tcpdump -r /tmp/capture.pcap -A | grep -i "azure\|aws"
```

### Application Debugging

```bash
# Enable debug logging
export DEBUG=guardduty:*
export LOG_LEVEL=debug

# Use Node.js inspector
node --inspect=0.0.0.0:9229 dist/index.js

# Connect with Chrome DevTools
# Open chrome://inspect
```

### Database Query Debugging

```kql
// Enable query diagnostics
set query_results_cache_max_age = 0d;

// Check query performance
RawGuardDuty_CL
| where TimeGenerated > ago(1h)
| summarize count() by bin(TimeGenerated, 5m)
| render timechart
```

For additional support and advanced troubleshooting scenarios, consult the [Operations Guide](operations-guide.md) or contact the development team.