# GuardDuty Connector Troubleshooting Guide

This guide helps diagnose and fix common issues with GuardDuty data ingestion and parsing in Microsoft Sentinel.

## Quick Diagnostic Checklist

Run these queries to quickly identify issues:

```kql
// 1. Check if connector is receiving ANY AWS data
search "*" 
| where TimeGenerated > ago(1h)
| where $table startswith "AWS"
| summarize count() by $table

// 2. Check GuardDuty table specifically
AWSGuardDuty
| where TimeGenerated > ago(24h)
| take 5

// 3. Test parsing functions
AWSGuardDuty_Config()

// 4. Check for parsing errors
AWSGuardDuty_Main(1d)
| where isempty(FindingId)
| take 10
```

## Common Issues and Solutions

### Issue 1: Connector Shows "Connected" But No Data

**Symptoms:**
- AWS S3 connector status is "Connected"
- No records in AWSGuardDuty table
- No error messages visible

**Diagnosis:**
```kql
// Check all AWS tables for any data
search "*"
| where TimeGenerated > ago(24h) 
| where $table contains "AWS"
| summarize count() by $table
```

**Common Causes & Solutions:**

#### A. KMS Permissions (Most Common)
GuardDuty exports are often encrypted with KMS. The IAM role needs decrypt permissions.

**Fix:**
1. Identify the KMS key used by GuardDuty:
   ```bash
   aws guardduty get-publishing-destination \
     --detector-id YOUR_DETECTOR_ID \
     --destination-id YOUR_DESTINATION_ID
   ```

2. Add KMS permissions to the IAM role:
   ```json
   {
     "Effect": "Allow",
     "Action": [
       "kms:Decrypt",
       "kms:DescribeKey"
     ],
     "Resource": "arn:aws:kms:region:account:key/your-guardduty-key-id"
   }
   ```

#### B. S3 Bucket Permissions
**Fix:**
```json
{
  "Effect": "Allow",
  "Action": [
    "s3:GetObject",
    "s3:ListBucket"
  ],
  "Resource": [
    "arn:aws:s3:::your-guardduty-bucket",
    "arn:aws:s3:::your-guardduty-bucket/*"
  ]
}
```

#### C. SQS Queue Configuration
**Fix:**
Ensure S3 bucket notifications are properly configured to send to SQS:
```bash
aws s3api put-bucket-notification-configuration \
  --bucket your-guardduty-bucket \
  --notification-configuration file://notification-config.json
```

### Issue 2: Data Ingestion Stops After Working

**Symptoms:**
- Data was flowing previously
- Sudden stop in new records
- Connector still shows "Connected"

**Diagnosis:**
```kql
AWSGuardDuty
| summarize 
    LatestRecord = max(TimeGenerated),
    RecordCount = count()
    by bin(TimeGenerated, 1h)
| order by TimeGenerated desc
| take 48  // Last 48 hours
```

**Common Causes:**
1. **AWS credentials expired** - Regenerate and update
2. **S3 bucket policy changed** - Verify permissions
3. **GuardDuty export disabled** - Check GuardDuty console
4. **SQS queue issues** - Check for dead letter queue messages

### Issue 3: Parsing Functions Return Empty Results

**Symptoms:**
- Data exists in AWSGuardDuty table
- `AWSGuardDuty_Main()` returns no results
- Raw data looks correct

**Diagnosis:**
```kql
// Check raw data structure
AWSGuardDuty
| take 1
| project *

// Check if EventData column exists and has content
AWSGuardDuty
| where TimeGenerated > ago(1h)
| project TimeGenerated, EventData
| where isnotempty(EventData)
| take 5
```

**Solutions:**

#### A. Wrong Column Name
The parsing functions expect data in the `EventData` column. If your data is in a different column:

1. **Check actual column names:**
   ```kql
   AWSGuardDuty | getschema
   ```

2. **Update configuration:**
   - Redeploy with correct `rawDataColumn` parameter
   - Or manually update the config function

#### B. Data Format Issues
```kql
// Check if data is valid JSON
AWSGuardDuty
| where TimeGenerated > ago(1h)
| extend ParseTest = parse_json(EventData)
| where isnull(ParseTest)
| take 10  // These records have invalid JSON
```

### Issue 4: High Severity Findings Not Appearing

**Symptoms:**
- Low/medium findings appear
- High severity findings missing
- AWS console shows high severity findings

**Diagnosis:**
```kql
// Check severity distribution
AWSGuardDuty_Main(7d)
| summarize count() by SeverityLevel, Severity
| order by Severity desc
```

**Solution:**
This is usually a data lag issue. High severity findings may take longer to export from GuardDuty.

### Issue 5: Network/IAM Parsers Return No Data

**Symptoms:**
- `AWSGuardDuty_Main()` works
- `AWSGuardDuty_Network()` or `AWSGuardDuty_IAM()` return empty

**Diagnosis:**
```kql
// Check what finding types you have
AWSGuardDuty_Main(7d)
| summarize count() by FindingType
| order by count_ desc

// Check for network-related findings
AWSGuardDuty_Main(7d)
| where FindingType contains "Network" or 
        FindingType contains "Backdoor" or
        FindingType contains "Trojan"
| take 10
```

**Solution:**
This is often normal - not all GuardDuty findings have network or IAM components. The specialized parsers only return data for relevant finding types.

## Advanced Troubleshooting

### Enable Detailed Logging

1. **Check connector logs** in Azure Monitor:
   ```kql
   AzureDiagnostics
   | where ResourceProvider == "MICROSOFT.SECURITYINSIGHTS"
   | where Category == "DataConnectors"
   | where OperationName contains "AWS"
   | order by TimeGenerated desc
   ```

2. **Monitor ingestion metrics:**
   ```kql
   Usage
   | where DataType == "AWSGuardDuty"
   | where TimeGenerated > ago(7d)
   | summarize sum(Quantity) by bin(TimeGenerated, 1d)
   | render timechart
   ```

### Validate AWS-Side Configuration

1. **Check GuardDuty export status:**
   ```bash
   aws guardduty list-publishing-destinations --detector-id YOUR_DETECTOR_ID
   aws guardduty describe-publishing-destination --detector-id YOUR_DETECTOR_ID --destination-id YOUR_DESTINATION_ID
   ```

2. **Verify S3 bucket contents:**
   ```bash
   aws s3 ls s3://your-guardduty-bucket/ --recursive | head -10
   ```

3. **Check SQS queue for messages:**
   ```bash
   aws sqs get-queue-attributes --queue-url YOUR_QUEUE_URL --attribute-names All
   ```

### Test Data Flow Manually

1. **Generate test GuardDuty finding:**
   ```bash
   # Create a test EC2 instance with a security group allowing SSH from 0.0.0.0/0
   # This should trigger GuardDuty findings within 15-30 minutes
   ```

2. **Monitor for the test finding:**
   ```kql
   AWSGuardDuty_Main(2h)
   | where FindingType contains "UnauthorizedAPICall" or FindingType contains "Recon"
   | order by EventTime desc
   ```

## Performance Issues

### Slow Query Performance

**Symptoms:**
- Parsing functions take a long time to run
- Timeouts on large time ranges

**Solutions:**

1. **Use smaller time ranges:**
   ```kql
   // Instead of this:
   AWSGuardDuty_Main(30d)
   
   // Use this:
   AWSGuardDuty_Main(1d)
   ```

2. **Add filters early:**
   ```kql
   // Good - filter before parsing
   AWSGuardDuty_Main(7d)
   | where SeverityLevel == "High"
   
   // Better - filter in the function if possible
   ```

3. **Use summarization:**
   ```kql
   AWSGuardDuty_Main(7d)
   | summarize count() by bin(EventTime, 1h), FindingType
   | render timechart
   ```

## Getting Help

### Before Opening an Issue

1. Run the [smoke tests](../validation/smoke_tests.kql)
2. Check this troubleshooting guide
3. Verify AWS-side configuration
4. Test with a small time range first

### Information to Include

When reporting issues, include:

1. **Connector status** (Connected/Disconnected)
2. **Sample raw data** (anonymized):
   ```kql
   AWSGuardDuty | take 1 | project EventData
   ```
3. **Error messages** from parsing functions
4. **AWS configuration** (IAM role, S3 bucket, SQS queue)
5. **Sentinel workspace** region and tier

### Useful Diagnostic Queries

```kql
// Full diagnostic report
print "=== GuardDuty Diagnostic Report ==="
| union (
    print "1. Connector Data Availability"
    | union (AWSGuardDuty | summarize RecordCount = count(), LatestRecord = max(TimeGenerated))
),
(
    print "2. Parsing Function Status" 
    | union (AWSGuardDuty_Config() | summarize ConfigEntries = count())
),
(
    print "3. Data Quality Check"
    | union (
        AWSGuardDuty_Main(1d) 
        | summarize 
            ParsedRecords = count(),
            UniqueFindings = dcount(FindingId),
            SeverityDistribution = make_bag(pack(SeverityLevel, count()))
    )
)
```

This diagnostic query provides a comprehensive overview of your GuardDuty integration health.