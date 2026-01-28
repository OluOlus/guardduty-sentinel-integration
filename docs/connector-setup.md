# GuardDuty Connector Setup Guide

This guide walks you through setting up AWS GuardDuty ingestion into Microsoft Sentinel using the existing AWS S3 connector, then deploying the GuardDuty parsing functions.

## Prerequisites

- Microsoft Sentinel workspace with appropriate permissions
- AWS account with GuardDuty enabled
- Azure CLI or PowerShell for deployment

## Step 1: Install AWS S3 Connector in Sentinel

1. **Navigate to Content Hub**
   - In Microsoft Sentinel, go to **Content Hub**
   - Search for "Amazon Web Services"
   - Install the **Amazon Web Services** solution

2. **Configure the AWS S3 Connector**
   - Go to **Data connectors** in Sentinel
   - Find "Amazon Web Services S3" connector
   - Click **Open connector page**

## Step 2: AWS-Side Configuration

### Option A: Automatic Setup (Recommended)

The AWS S3 connector provides an automation script that creates all required AWS resources:

1. **Download the automation script** from the connector page
2. **Run the script** in your AWS environment:
   ```bash
   # The script will create:
   # - OIDC Identity Provider
   # - IAM Role with required permissions
   # - S3 bucket for GuardDuty exports
   # - SQS queue for notifications
   # - GuardDuty publishing destination
   ```

3. **Copy the generated values**:
   - Role ARN
   - SQS URL
   - External ID

### Option B: Manual Setup

If you prefer manual setup, create these resources:

#### 1. Create S3 Bucket
```bash
aws s3 mb s3://your-guardduty-exports-bucket
```

#### 2. Create SQS Queue
```bash
aws sqs create-queue --queue-name sentinel-guardduty-queue
```

#### 3. Configure GuardDuty Export
```bash
aws guardduty create-publishing-destination \
    --detector-id YOUR_DETECTOR_ID \
    --destination-type S3 \
    --destination-properties DestinationArn=arn:aws:s3:::your-guardduty-exports-bucket,KmsKeyArn=arn:aws:kms:region:account:key/key-id
```

#### 4. Set up S3 Event Notifications
Configure your S3 bucket to send notifications to the SQS queue when new GuardDuty findings are uploaded.

## Step 3: Configure Connector in Sentinel

1. **Enter AWS Details** in the connector configuration:
   - **Role ARN**: The IAM role created in Step 2
   - **External ID**: Generated during setup
   - **SQS URL**: The queue URL from Step 2

2. **Select Log Types**:
   - Check **GuardDuty** in the log types list
   - Destination table will be **AWSGuardDuty**

3. **Test Connection**:
   - Click **Test connection**
   - Status should show "Connected" (note: this doesn't guarantee data flow)

## Step 4: Verify Data Ingestion

**Important**: "Connected" status doesn't mean data is flowing. Use these queries to verify:

```kql
// Check if GuardDuty table exists and has data
AWSGuardDuty
| where TimeGenerated > ago(24h)
| take 10
```

If no data appears after 30 minutes, see the [Troubleshooting Guide](troubleshooting.md).

## Step 5: Deploy GuardDuty Parsing Functions

### Using Azure CLI

1. **Clone this repository**:
   ```bash
   git clone https://github.com/your-org/guardduty-sentinel-integration
   cd guardduty-sentinel-integration
   ```

2. **Update parameters**:
   ```bash
   # Edit deployment/azuredeploy.parameters.json
   {
     "workspaceName": {"value": "your-sentinel-workspace"},
     "guardDutyTableName": {"value": "AWSGuardDuty"},
     "rawDataColumn": {"value": "EventData"}
   }
   ```

3. **Deploy the template**:
   ```bash
   az deployment group create \
     --resource-group your-resource-group \
     --template-file deployment/azuredeploy.json \
     --parameters @deployment/azuredeploy.parameters.json
   ```

### Using PowerShell

```powershell
New-AzResourceGroupDeployment `
  -ResourceGroupName "your-resource-group" `
  -TemplateFile "deployment/azuredeploy.json" `
  -TemplateParameterFile "deployment/azuredeploy.parameters.json"
```

## Step 6: Test the Parsing Functions

Run the smoke tests to verify everything is working:

```kql
// Run the smoke tests
// Copy and paste queries from validation/smoke_tests.kql
```

Expected results:
- ✅ GuardDuty data is available
- ✅ Data structure is valid
- ✅ Multiple finding types detected
- ✅ Network and IAM findings parse correctly

## Step 7: Start Using GuardDuty Data

Now you can use the parsing functions in your queries:

```kql
// Get high-severity findings from last 24 hours
AWSGuardDuty_Main(1d)
| where SeverityLevel == "High"
| project EventTime, FindingType, Title, AwsAccountId

// Analyze network threats
AWSGuardDuty_Network(7d)
| where isnotempty(RemoteIp)
| summarize count() by RemoteCountry, FindingType
```

## Common Configuration Issues

### 1. KMS Permissions
If GuardDuty uses KMS encryption, ensure the IAM role has `kms:Decrypt` permissions for the GuardDuty KMS key.

### 2. S3 Bucket Policies
The IAM role needs `s3:GetObject` permissions on the GuardDuty export bucket.

### 3. SQS Permissions
The role needs `sqs:ReceiveMessage`, `sqs:DeleteMessage`, and `sqs:GetQueueAttributes` on the SQS queue.

### 4. GuardDuty Export Format
Ensure GuardDuty is exporting in JSON format (not CSV) to the S3 bucket.

## Next Steps

- Review [sample queries](../sample-data/test_queries.kql) for analysis examples
- Set up [analytics rules](../samples/sentinel/analytics-rules/) for automated detection
- Configure [workbooks](../samples/sentinel/workbooks/) for dashboards
- See [troubleshooting guide](troubleshooting.md) for common issues

## Support

For issues with:
- **AWS S3 Connector**: Check Microsoft Sentinel documentation
- **GuardDuty Parsing Functions**: See this repository's issues
- **AWS GuardDuty**: Consult AWS documentation