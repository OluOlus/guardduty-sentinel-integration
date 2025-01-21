# Validation Guide

This guide provides scripts and procedures to validate that your GuardDuty to Sentinel integration is working correctly.

## Overview

The validation process tests:
1. AWS GuardDuty export to S3
2. Worker ability to read from S3 and send to Azure
3. Azure Monitor data ingestion and storage
4. KQL parser functionality
5. End-to-end data flow

## Prerequisites

- Completed AWS setup
- Completed Azure setup
- Worker configured and deployed
- Access to both AWS CLI and Azure CLI

## Step 1: Generate Test GuardDuty Findings

Create sample findings to test the export process:

```bash
#!/bin/bash
# generate-test-findings.sh

# Set variables from your AWS setup
export DETECTOR_ID="your-guardduty-detector-id"
export AWS_REGION="your-aws-region"
export S3_BUCKET="your-s3-bucket-name"

echo "🔍 Generating test GuardDuty findings..."

# Create sample findings of different types
aws guardduty create-sample-findings \
    --detector-id $DETECTOR_ID \
    --finding-types \
        "Backdoor:EC2/XORDDOS" \
        "CryptoCurrency:EC2/BitcoinTool.B!DNS" \
        "Malware:EC2/Suspicious.B" \
        "Trojan:EC2/DNSDataExfiltration" \
        "UnauthorizedAccess:EC2/SSHBruteForce"

echo "✅ Test findings generated. They will appear in S3 within 5-10 minutes."
echo "📍 Expected S3 location: s3://$S3_BUCKET/AWSLogs/$(aws sts get-caller-identity --query Account --output text)/GuardDuty/$AWS_REGION/"

# Wait and check for files
echo "⏳ Waiting for findings to be exported to S3..."
sleep 300  # Wait 5 minutes

# Check if files appeared
echo "🔍 Checking for exported findings..."
aws s3 ls s3://$S3_BUCKET/AWSLogs/ --recursive | grep GuardDuty | tail -5

echo "If you see .jsonl.gz files above, the export is working correctly."
```

## Step 2: Validate S3 Export

Check that GuardDuty findings are being exported to S3:

```bash
#!/bin/bash
# validate-s3-export.sh

export S3_BUCKET="your-s3-bucket-name"
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION="your-aws-region"

echo "🔍 Validating S3 export configuration..."

# Check bucket exists and is accessible
echo "📦 Checking S3 bucket accessibility..."
if aws s3 ls s3://$S3_BUCKET/ > /dev/null 2>&1; then
    echo "✅ S3 bucket is accessible"
else
    echo "❌ Cannot access S3 bucket. Check permissions."
    exit 1
fi

# Check for GuardDuty exports
echo "🔍 Looking for GuardDuty exports..."
EXPORT_PATH="s3://$S3_BUCKET/AWSLogs/$ACCOUNT_ID/GuardDuty/$AWS_REGION/"
FINDINGS=$(aws s3 ls $EXPORT_PATH --recursive | grep "\.jsonl\.gz$" | wc -l)

if [ $FINDINGS -gt 0 ]; then
    echo "✅ Found $FINDINGS GuardDuty export files"
    echo "📄 Recent files:"
    aws s3 ls $EXPORT_PATH --recursive | grep "\.jsonl\.gz$" | tail -3
else
    echo "⚠️  No GuardDuty export files found"
    echo "   This may be normal if:"
    echo "   - GuardDuty was recently enabled"
    echo "   - No findings have been generated yet"
    echo "   - Export frequency hasn't triggered yet"
fi

# Test downloading and reading a file
if [ $FINDINGS -gt 0 ]; then
    echo "🧪 Testing file download and decompression..."
    LATEST_FILE=$(aws s3 ls $EXPORT_PATH --recursive | grep "\.jsonl\.gz$" | tail -1 | awk '{print $4}')
    
    if [ -n "$LATEST_FILE" ]; then
        aws s3 cp s3://$S3_BUCKET/$LATEST_FILE ./test-finding.jsonl.gz
        
        if gunzip -t test-finding.jsonl.gz 2>/dev/null; then
            echo "✅ File compression is valid"
            
            # Show sample content
            echo "📋 Sample finding content:"
            gunzip -c test-finding.jsonl.gz | head -1 | jq -r '.type, .severity, .title' 2>/dev/null || echo "Raw JSON format detected"
            
            rm -f test-finding.jsonl.gz
        else
            echo "❌ File compression is invalid"
        fi
    fi
fi

echo "✅ S3 export validation complete"
```

## Step 3: Test Worker Connectivity

Validate that the worker can connect to both AWS and Azure:

```bash
#!/bin/bash
# test-worker-connectivity.sh

echo "🔧 Testing worker connectivity..."

# Test AWS connectivity
echo "🔍 Testing AWS S3 connectivity..."
if aws s3 ls s3://your-s3-bucket-name/ > /dev/null 2>&1; then
    echo "✅ AWS S3 connection successful"
else
    echo "❌ AWS S3 connection failed"
    echo "   Check AWS credentials and S3 bucket permissions"
fi

# Test Azure connectivity using Azure CLI
echo "🔍 Testing Azure connectivity..."
if az account show > /dev/null 2>&1; then
    echo "✅ Azure CLI authentication successful"
    
    # Test Log Analytics workspace access
    WORKSPACE_ID="your-workspace-id"
    RESOURCE_GROUP="your-resource-group"
    WORKSPACE_NAME="your-workspace-name"
    
    if az monitor log-analytics workspace show \
        --resource-group $RESOURCE_GROUP \
        --workspace-name $WORKSPACE_NAME > /dev/null 2>&1; then
        echo "✅ Azure Log Analytics workspace accessible"
    else
        echo "❌ Cannot access Log Analytics workspace"
    fi
    
    # Test DCR access
    DCR_NAME="your-dcr-name"
    if az monitor data-collection rule show \
        --resource-group $RESOURCE_GROUP \
        --name $DCR_NAME > /dev/null 2>&1; then
        echo "✅ Data Collection Rule accessible"
    else
        echo "❌ Cannot access Data Collection Rule"
    fi
else
    echo "❌ Azure authentication failed"
    echo "   Run 'az login' to authenticate"
fi

echo "✅ Connectivity test complete"
```

## Step 4: Validate Azure Data Ingestion

Test that data is being ingested into Azure Monitor:

```bash
#!/bin/bash
# validate-azure-ingestion.sh

echo "🔍 Validating Azure data ingestion..."

# Set variables
WORKSPACE_ID="your-workspace-id"
RESOURCE_GROUP="your-resource-group"
WORKSPACE_NAME="your-workspace-name"

# Check for RawGuardDuty_CL table
echo "📊 Checking for RawGuardDuty_CL table..."

# Create KQL query to check for recent data
cat > check-data.kql << 'EOF'
RawGuardDuty_CL
| where TimeGenerated > ago(1h)
| summarize Count = count() by bin(TimeGenerated, 5m)
| order by TimeGenerated desc
| limit 10
EOF

echo "🔍 Querying Log Analytics workspace for recent data..."
echo "   Run this KQL query in Azure Portal or using Azure CLI:"
echo "   az monitor log-analytics query --workspace $WORKSPACE_ID --analytics-query \"\$(cat check-data.kql)\""

# Alternative: Use REST API to query (requires additional authentication setup)
echo "📋 Manual verification steps:"
echo "1. Open Azure Portal"
echo "2. Navigate to your Log Analytics workspace: $WORKSPACE_NAME"
echo "3. Go to Logs section"
echo "4. Run this query:"
cat check-data.kql
echo ""
echo "5. You should see data points if ingestion is working"

# Check DCR metrics
echo "📈 Checking DCR ingestion metrics..."
echo "   In Azure Portal, navigate to your DCR and check the Metrics tab"
echo "   Look for 'Logs Ingestion Requests' and 'Logs Ingestion Bytes' metrics"

rm -f check-data.kql
```

## Step 5: Test KQL Parser Function

Validate the KQL parser function works correctly:

```bash
#!/bin/bash
# test-kql-parser.sh

echo "🔍 Testing KQL parser function..."

# Create test queries
cat > test-parser.kql << 'EOF'
// Test 1: Basic parser functionality
GuardDutyNormalized()
| limit 5
| project TimeGenerated, FindingId, Type, Severity, AccountId, Region

// Test 2: High severity findings
GuardDutyNormalized()
| where Severity >= 7.0
| summarize Count = count() by Type
| order by Count desc

// Test 3: Recent findings by region
GuardDutyNormalized()
| where TimeGenerated > ago(24h)
| summarize Count = count() by Region, bin(TimeGenerated, 1h)
| order by TimeGenerated desc

// Test 4: Malware detections
GuardDutyNormalized()
| where Type contains "Malware" or Type contains "Trojan" or Type contains "Backdoor"
| project TimeGenerated, Type, FindingTitle, Severity, InstanceId, RemoteIpAddress
| order by TimeGenerated desc

// Test 5: Data quality check
GuardDutyNormalized()
| summarize 
    TotalFindings = count(),
    UniqueTypes = dcount(Type),
    UniqueAccounts = dcount(AccountId),
    UniqueRegions = dcount(Region),
    AvgSeverity = avg(Severity),
    LatestFinding = max(TimeGenerated)
EOF

echo "📋 KQL test queries created: test-parser.kql"
echo ""
echo "Manual testing steps:"
echo "1. Open Azure Portal"
echo "2. Navigate to your Log Analytics workspace"
echo "3. Go to Logs section"
echo "4. Run each query from test-parser.kql"
echo "5. Verify results make sense and data is properly parsed"
echo ""
echo "Expected results:"
echo "- Test 1: Should show parsed fields from raw JSON"
echo "- Test 2: Should show high-severity finding counts by type"
echo "- Test 3: Should show temporal distribution by region"
echo "- Test 4: Should show malware-related findings"
echo "- Test 5: Should show data quality metrics"

rm -f test-parser.kql
```

## Step 6: End-to-End Validation Script

Comprehensive validation script that tests the entire pipeline:

```bash
#!/bin/bash
# end-to-end-validation.sh

echo "🚀 Starting end-to-end validation..."

# Configuration
export DETECTOR_ID="your-guardduty-detector-id"
export S3_BUCKET="your-s3-bucket-name"
export WORKSPACE_ID="your-workspace-id"
export RESOURCE_GROUP="your-resource-group"
export WORKSPACE_NAME="your-workspace-name"

# Step 1: Generate test finding
echo "1️⃣ Generating test GuardDuty finding..."
FINDING_TYPE="Backdoor:EC2/XORDDOS"
aws guardduty create-sample-findings \
    --detector-id $DETECTOR_ID \
    --finding-types $FINDING_TYPE

echo "✅ Test finding generated: $FINDING_TYPE"

# Step 2: Wait for S3 export
echo "2️⃣ Waiting for S3 export (5 minutes)..."
sleep 300

# Step 3: Check S3 for new files
echo "3️⃣ Checking S3 for exported findings..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=$(aws configure get region)
EXPORT_PATH="s3://$S3_BUCKET/AWSLogs/$ACCOUNT_ID/GuardDuty/$AWS_REGION/"

NEW_FILES=$(aws s3 ls $EXPORT_PATH --recursive | grep "$(date +%Y/%m/%d)" | wc -l)
if [ $NEW_FILES -gt 0 ]; then
    echo "✅ Found $NEW_FILES new export files today"
else
    echo "⚠️  No new export files found today"
    echo "   Checking for any recent files..."
    aws s3 ls $EXPORT_PATH --recursive | tail -3
fi

# Step 4: Wait for worker processing
echo "4️⃣ Waiting for worker processing (2 minutes)..."
sleep 120

# Step 5: Check Azure for ingested data
echo "5️⃣ Checking Azure for ingested data..."
echo "   Creating validation query..."

cat > validation-query.kql << 'EOF'
RawGuardDuty_CL
| where TimeGenerated > ago(10m)
| where Type == "Backdoor:EC2/XORDDOS"
| project TimeGenerated, FindingId, Type, Severity, AccountId
| order by TimeGenerated desc
| limit 1
EOF

echo "📋 Run this query in Azure Portal to verify data ingestion:"
cat validation-query.kql
echo ""

# Step 6: Test normalization
echo "6️⃣ Testing data normalization..."
cat > normalization-test.kql << 'EOF'
GuardDutyNormalized()
| where TimeGenerated > ago(10m)
| where Type == "Backdoor:EC2/XORDDOS"
| project TimeGenerated, FindingId, Type, Severity, FindingTitle, ResourceType
| limit 1
EOF

echo "📋 Run this query to test KQL parser normalization:"
cat normalization-test.kql
echo ""

# Step 7: Performance check
echo "7️⃣ Performance validation..."
cat > performance-check.kql << 'EOF'
RawGuardDuty_CL
| where TimeGenerated > ago(1h)
| summarize 
    TotalFindings = count(),
    ProcessingLatency = avg(datetime_diff('second', now(), TimeGenerated)),
    DataVolume = sum(strlen(RawJson)) / 1024 / 1024  // MB
| extend 
    LatencyMinutes = ProcessingLatency / 60,
    DataVolumeMB = round(DataVolume, 2)
| project TotalFindings, LatencyMinutes, DataVolumeMB
EOF

echo "📊 Performance metrics query:"
cat performance-check.kql
echo ""

# Cleanup
rm -f validation-query.kql normalization-test.kql performance-check.kql

echo "✅ End-to-end validation setup complete!"
echo ""
echo "📋 Manual verification checklist:"
echo "□ GuardDuty test finding was generated"
echo "□ Finding was exported to S3 within 10 minutes"
echo "□ Worker processed the S3 file without errors"
echo "□ Raw data appeared in RawGuardDuty_CL table"
echo "□ Normalized data is accessible via GuardDutyNormalized() function"
echo "□ Processing latency is acceptable (< 15 minutes end-to-end)"
echo "□ No errors in worker logs"
echo ""
echo "🔧 If any step fails, check the troubleshooting section below."
```

## Step 7: Automated Health Check

Create a health check script that can be run regularly:

```bash
#!/bin/bash
# health-check.sh

echo "🏥 GuardDuty-Sentinel Integration Health Check"
echo "=============================================="

# Configuration
WORKSPACE_ID="your-workspace-id"
RESOURCE_GROUP="your-resource-group"
WORKSPACE_NAME="your-workspace-name"
S3_BUCKET="your-s3-bucket-name"

# Health check results
HEALTH_SCORE=0
MAX_SCORE=6

# Check 1: S3 bucket accessibility
echo "1️⃣ Checking S3 bucket accessibility..."
if aws s3 ls s3://$S3_BUCKET/ > /dev/null 2>&1; then
    echo "   ✅ S3 bucket accessible"
    ((HEALTH_SCORE++))
else
    echo "   ❌ S3 bucket not accessible"
fi

# Check 2: Recent S3 exports
echo "2️⃣ Checking for recent S3 exports..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=$(aws configure get region)
RECENT_EXPORTS=$(aws s3 ls s3://$S3_BUCKET/AWSLogs/$ACCOUNT_ID/GuardDuty/$AWS_REGION/ --recursive | grep "$(date -d '1 day ago' +%Y/%m/%d)\|$(date +%Y/%m/%d)" | wc -l)

if [ $RECENT_EXPORTS -gt 0 ]; then
    echo "   ✅ Found $RECENT_EXPORTS recent exports"
    ((HEALTH_SCORE++))
else
    echo "   ⚠️  No recent exports found (may be normal)"
fi

# Check 3: Azure workspace accessibility
echo "3️⃣ Checking Azure workspace accessibility..."
if az monitor log-analytics workspace show --resource-group $RESOURCE_GROUP --workspace-name $WORKSPACE_NAME > /dev/null 2>&1; then
    echo "   ✅ Azure workspace accessible"
    ((HEALTH_SCORE++))
else
    echo "   ❌ Azure workspace not accessible"
fi

# Check 4: Recent data ingestion
echo "4️⃣ Checking recent data ingestion..."
# This would require Azure CLI query capability or REST API call
echo "   ℹ️  Manual check required: Query RawGuardDuty_CL | where TimeGenerated > ago(1h) | count"

# Check 5: Worker health endpoint (if deployed)
echo "5️⃣ Checking worker health endpoint..."
if curl -f http://localhost:8080/health > /dev/null 2>&1; then
    echo "   ✅ Worker health endpoint responding"
    ((HEALTH_SCORE++))
else
    echo "   ⚠️  Worker health endpoint not accessible (may be normal if not deployed locally)"
fi

# Check 6: Error rate check
echo "6️⃣ Checking error rates..."
echo "   ℹ️  Manual check required: Review worker logs for error patterns"

# Overall health assessment
echo ""
echo "🏥 Health Assessment: $HEALTH_SCORE/$MAX_SCORE"
if [ $HEALTH_SCORE -ge 4 ]; then
    echo "   ✅ System appears healthy"
    exit 0
elif [ $HEALTH_SCORE -ge 2 ]; then
    echo "   ⚠️  System has some issues"
    exit 1
else
    echo "   ❌ System has significant issues"
    exit 2
fi
```

## Troubleshooting Common Issues

### No Data in Azure

**Symptoms**: RawGuardDuty_CL table is empty or has no recent data

**Possible Causes**:
1. Worker not running or configured incorrectly
2. Authentication issues with Azure
3. DCR configuration problems
4. Network connectivity issues

**Debugging Steps**:
```bash
# Check worker logs
docker logs guardduty-worker  # For container deployment
# or check Azure Function logs in portal

# Test DCR endpoint
curl -X POST "https://your-dcr-endpoint/dataCollectionRules/your-dcr-id/streams/Custom-GuardDutyFindings?api-version=2021-11-01-preview" \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '[{"TimeGenerated":"2024-01-01T00:00:00Z","FindingId":"test","AccountId":"123456789012","Region":"us-east-1","Severity":5.0,"Type":"Test","RawJson":"{}"}]'
```

### High Processing Latency

**Symptoms**: Long delay between GuardDuty finding generation and appearance in Azure

**Possible Causes**:
1. GuardDuty export frequency settings
2. Worker batch processing delays
3. Azure ingestion throttling
4. Network latency

**Debugging Steps**:
```bash
# Check GuardDuty export frequency
aws guardduty describe-publishing-destination --detector-id your-detector-id --destination-id your-destination-id

# Monitor worker processing metrics
# Check batch sizes and retry configurations
```

### Authentication Failures

**Symptoms**: Worker logs show authentication errors

**Possible Causes**:
1. Expired service principal credentials
2. Incorrect tenant/client ID
3. Missing role assignments
4. AWS credential issues

**Debugging Steps**:
```bash
# Test Azure service principal
az login --service-principal -u your-client-id -p your-client-secret --tenant your-tenant-id

# Test AWS credentials
aws sts get-caller-identity

# Check role assignments
az role assignment list --assignee your-client-id
```

## Performance Benchmarks

Expected performance characteristics:

| Metric | Expected Value | Notes |
|--------|---------------|-------|
| End-to-end latency | < 15 minutes | From finding generation to Azure availability |
| Processing throughput | 100-500 findings/minute | Depends on batch size and worker resources |
| S3 export delay | 5-10 minutes | GuardDuty export frequency |
| Azure ingestion delay | < 1 minute | After worker sends data |
| Error rate | < 1% | Under normal conditions |

## Next Steps

After successful validation:
1. Set up monitoring and alerting
2. Configure Sentinel analytics rules
3. Create custom workbooks and dashboards
4. Implement operational procedures
5. Plan for scaling and optimization

## Support

If validation fails:
1. Check the troubleshooting sections in each setup guide
2. Review worker logs for specific error messages
3. Verify all configuration values are correct
4. Test individual components in isolation
5. Refer to the main project documentation