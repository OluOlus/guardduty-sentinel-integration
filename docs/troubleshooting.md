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
- High resource consumption in Log Analytics

**Solutions:**

1. **Use smaller time ranges:**
   ```kql
   // Instead of this:
   AWSGuardDuty_Main(30d)
   
   // Use this:
   AWSGuardDuty_Main(1d)
   ```

2. **Add filters early in the query:**
   ```kql
   // Good - filter before parsing
   AWSGuardDuty_Main(7d)
   | where SeverityLevel == "High"
   
   // Better - use specific parsers for focused analysis
   AWSGuardDuty_Network(7d)
   | where ThreatCategory == "High Risk"
   ```

3. **Use summarization for trend analysis:**
   ```kql
   AWSGuardDuty_Main(7d)
   | summarize count() by bin(EventTime, 1h), FindingType
   | render timechart
   ```

4. **Optimize configuration settings:**
   ```kql
   // Check current configuration
   AWSGuardDuty_Config()
   | where Setting in ("DefaultLookback", "MaxLookback", "EnableDataValidation")
   ```

### Memory and Resource Optimization

**For large datasets:**

1. **Disable data validation temporarily:**
   ```kql
   // Redeploy with enableDataValidation = false for better performance
   ```

2. **Use streaming for real-time analysis:**
   ```kql
   AWSGuardDuty_Main(1h)
   | where EventTime > ago(15m)
   | where SeverityLevel in ("High", "Critical")
   ```

3. **Implement data retention policies:**
   ```kql
   // Monitor data volume
   AWSGuardDuty
   | where TimeGenerated > ago(30d)
   | summarize DataSizeMB = sum(estimate_data_size(*)) / 1024 / 1024 by bin(TimeGenerated, 1d)
   | render timechart
   ```

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

3. **Check parser performance:**
   ```kql
   // Enable performance logging in config and monitor
   AWSGuardDuty_Main(1h)
   | extend QueryDuration = now() - ParsingTimestamp
   | summarize avg(QueryDuration), max(QueryDuration) by bin(TimeGenerated, 5m)
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

4. **Test KMS permissions:**
   ```bash
   # Test decrypt permissions
   aws kms decrypt --ciphertext-blob fileb://sample-encrypted-file --output text --query Plaintext
   ```

### Test Data Flow Manually

1. **Generate test GuardDuty finding:**
   ```bash
   # Create a test EC2 instance with a security group allowing SSH from 0.0.0.0/0
   # This should trigger GuardDuty findings within 15-30 minutes
   aws ec2 run-instances --image-id ami-12345678 --instance-type t2.micro --security-group-ids sg-12345678
   ```

2. **Monitor for the test finding:**
   ```kql
   AWSGuardDuty_Main(2h)
   | where FindingType contains "UnauthorizedAPICall" or FindingType contains "Recon"
   | order by EventTime desc
   ```

3. **Validate end-to-end parsing:**
   ```kql
   // Test all parser functions with the same finding
   let testFindingId = "your-test-finding-id";
   union
   (AWSGuardDuty_Main(2h) | where FindingId == testFindingId | extend Parser = "Main"),
   (AWSGuardDuty_Network(2h) | where FindingId == testFindingId | extend Parser = "Network"),
   (AWSGuardDuty_IAM(2h) | where FindingId == testFindingId | extend Parser = "IAM"),
   (AWSGuardDuty_ASIMNetworkSession(2h) | where NetworkSessionId == testFindingId | extend Parser = "ASIM")
   | project Parser, FindingId, FindingType, EventTime
   ```

## Data Quality and Validation Issues

### Schema Validation Problems

**Symptoms:**
- AWSGuardDuty_Schema returns many "Invalid" records
- Parsing functions return inconsistent results

**Diagnosis:**
```kql
// Comprehensive data quality report
AWSGuardDuty_Schema(1d)
| summarize count() by QualityCategory
| extend Percentage = round(count_ * 100.0 / toscalar(AWSGuardDuty_Schema(1d) | count()), 2)
| order by count_ desc
```

**Solutions:**

1. **Identify schema version issues:**
   ```kql
   AWSGuardDuty_Schema(1d)
   | where QualityCategory contains "Schema"
   | summarize count() by SchemaVersion
   ```

2. **Handle mixed schema versions:**
   ```kql
   // Temporarily disable validation for mixed environments
   // Redeploy with enableDataValidation = false
   ```

3. **Update parser for new schema versions:**
   ```kql
   // Check for new GuardDuty schema versions
   AWSGuardDuty
   | extend gd = parse_json(EventData)
   | extend SchemaVersion = tostring(gd.schemaVersion)
   | summarize count() by SchemaVersion
   | order by SchemaVersion desc
   ```

### Field Extraction Issues

**Common missing fields:**

1. **Network fields missing:**
   ```kql
   // Check what network data is available
   AWSGuardDuty_Main(1d)
   | where ActionType == "NETWORK_CONNECTION"
   | extend NetworkAction = gd.service.action.networkConnectionAction
   | project FindingId, FindingType, NetworkAction
   | take 5
   ```

2. **IAM fields missing:**
   ```kql
   // Check what IAM data is available
   AWSGuardDuty_Main(1d)
   | where ActionType == "AWS_API_CALL"
   | extend ApiAction = gd.service.action.awsApiCallAction
   | project FindingId, FindingType, ApiAction
   | take 5
   ```

## Integration and Compatibility Issues

### ASIM Compliance Problems

**Symptoms:**
- AWSGuardDuty_ASIMNetworkSession returns empty results
- ASIM fields not populating correctly

**Diagnosis:**
```kql
// Check ASIM compliance status
AWSGuardDuty_ASIMNetworkSession(1d)
| summarize count() by ASIMCompliance
```

**Solutions:**

1. **Disable ASIM compliance filtering for debugging:**
   ```kql
   // Modify the ASIM parser to comment out the compliance filter
   // | where ASIMCompliance == "Compliant"
   ```

2. **Check required ASIM fields:**
   ```kql
   AWSGuardDuty_Network(1d)
   | extend 
       HasSrcIp = isnotempty(PrivateIp),
       HasDstIp = isnotempty(RemoteIp),
       HasProtocol = isnotempty(Protocol)
   | summarize 
       SrcIpCount = countif(HasSrcIp),
       DstIpCount = countif(HasDstIp),
       ProtocolCount = countif(HasProtocol),
       TotalRecords = count()
   ```

### Cross-Source Correlation Issues

**For hunting across multiple data sources:**

1. **Verify field consistency:**
   ```kql
   // Compare IP address formats across sources
   union
   (AWSGuardDuty_ASIMNetworkSession(1d) | project Source = "GuardDuty", SrcIpAddr, DstIpAddr),
   (CommonSecurityLog | where TimeGenerated > ago(1d) | project Source = "Firewall", SrcIpAddr = SourceIP, DstIpAddr = DestinationIP)
   | where isnotempty(SrcIpAddr)
   | take 10
   ```

2. **Test correlation queries:**
   ```kql
   // Example correlation between GuardDuty and other security logs
   let GuardDutyIPs = AWSGuardDuty_ASIMNetworkSession(1d)
       | where ThreatRiskLevel > 70
       | distinct DstIpAddr;
   CommonSecurityLog
   | where TimeGenerated > ago(1d)
   | where DestinationIP in (GuardDutyIPs)
   | project TimeGenerated, SourceIP, DestinationIP, Activity
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