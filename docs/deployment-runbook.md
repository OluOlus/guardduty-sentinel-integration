# Deployment Runbook — GuardDuty → Sentinel Integration

This runbook covers the end-to-end deployment, upgrade, and rollback procedures for the GuardDuty Sentinel integration. Follow each section in order for a fresh deployment; for upgrades jump to [Upgrading an Existing Deployment](#upgrading-an-existing-deployment).

---

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [AWS-Side Setup](#aws-side-setup)
3. [Sentinel-Side Deployment](#sentinel-side-deployment)
4. [Lambda Handler Deployment (Optional)](#lambda-handler-deployment-optional)
5. [Post-Deployment Validation](#post-deployment-validation)
6. [Upgrading an Existing Deployment](#upgrading-an-existing-deployment)
7. [Rollback Procedure](#rollback-procedure)
8. [Operational Runbook](#operational-runbook)

---

## Pre-Deployment Checklist

Complete all items before starting deployment.

### Azure
- [ ] Sentinel workspace exists and is active
- [ ] You have **Contributor** or **Log Analytics Contributor** on the resource group
- [ ] Azure CLI installed and authenticated (`az account show`)
- [ ] Target resource group confirmed: `az group show --name <rg>`

### AWS
- [ ] GuardDuty enabled in the target region
- [ ] S3 bucket created for GuardDuty exports (or use automatic setup)
- [ ] SQS queue configured for S3 event notifications
- [ ] IAM role with required permissions (see [KMS Permissions Guide](kms-permissions.md))
- [ ] KMS key ARN noted (if GuardDuty exports are encrypted)

### Repository
- [ ] Cloned latest `main` branch
- [ ] `deployment/azuredeploy.json` present
- [ ] `scripts/lambda_ingestion_handler.py` present (if using Lambda path)

---

## AWS-Side Setup

### 1. Enable GuardDuty Export to S3

```bash
# Get your detector ID
DETECTOR_ID=$(aws guardduty list-detectors --query 'DetectorIds[0]' --output text)

# Create S3 publishing destination
aws guardduty create-publishing-destination \
  --detector-id "$DETECTOR_ID" \
  --destination-type S3 \
  --destination-properties \
    DestinationArn=arn:aws:s3:::your-guardduty-bucket,\
    KmsKeyArn=arn:aws:kms:eu-west-2:123456789012:key/your-key-id
```

### 2. Verify Export is Active

```bash
aws guardduty list-publishing-destinations --detector-id "$DETECTOR_ID"
# Status should be PUBLISHING
```

### 3. Confirm SQS Notifications

```bash
# Check S3 bucket notification config points to your SQS queue
aws s3api get-bucket-notification-configuration --bucket your-guardduty-bucket
```

---

## Sentinel-Side Deployment

### Option A — deploy.sh (Recommended)

```bash
cd guardduty-sentinel-integration

./deploy.sh \
  --resource-group  your-resource-group \
  --workspace       your-sentinel-workspace
```

The script validates prerequisites, creates a timestamped deployment, and prints next steps.

### Option B — Azure CLI

```bash
az deployment group create \
  --resource-group  your-resource-group \
  --name            guardduty-kql-$(date +%Y%m%d) \
  --template-file   deployment/azuredeploy.json \
  --parameters \
    workspaceName=your-sentinel-workspace
```

### Option C — PowerShell

```powershell
New-AzResourceGroupDeployment `
  -ResourceGroupName "your-resource-group" `
  -TemplateFile      "deployment/azuredeploy.json" `
  -workspaceName     "your-sentinel-workspace"
```

### Verify KQL Functions Deployed

```bash
az monitor log-analytics workspace saved-search list \
  --resource-group  your-resource-group \
  --workspace-name  your-sentinel-workspace \
  --query "[].properties.functionAlias" \
  --output table
```

Expected output includes all ten functions:
```
AWSGuardDuty_Config
AWSGuardDuty_Main
AWSGuardDuty_Network
AWSGuardDuty_IAM
AWSGuardDuty_S3
AWSGuardDuty_EKS
AWSGuardDuty_Malware
AWSGuardDuty_RDS
AWSGuardDuty_Schema
AWSGuardDuty_ASIMNetworkSession
```

---

## Lambda Handler Deployment (Optional)

Use this path when sub-minute latency is required.

### 1. Package the Function

```bash
cd scripts
zip lambda_ingestion_handler.zip lambda_ingestion_handler.py
```

### 2. Create the Lambda Function

```bash
aws lambda create-function \
  --function-name  guardduty-sentinel-ingestion \
  --runtime        python3.12 \
  --role           arn:aws:iam::123456789012:role/guardduty-lambda-role \
  --handler        lambda_ingestion_handler.handler \
  --zip-file       fileb://lambda_ingestion_handler.zip \
  --environment    "Variables={
    AZURE_TENANT_ID=your-tenant-id,
    AZURE_CLIENT_ID=your-client-id,
    AZURE_CLIENT_SECRET=retrieve-from-secrets-manager,
    AZURE_LOGS_INGESTION_ENDPOINT=https://your-dce.region.ingest.monitor.azure.com,
    AZURE_DCR_IMMUTABLE_ID=dcr-your-immutable-id,
    AZURE_DCR_STREAM_NAME=Microsoft-AWSGuardDuty,
    LOG_LEVEL=INFO,
    MAX_RETRIES=3
  }" \
  --timeout        30
```

### 3. Create EventBridge Rule

```bash
# Create rule matching GuardDuty findings
aws events put-rule \
  --name    guardduty-to-sentinel \
  --event-pattern '{"source":["aws.guardduty"],"detail-type":["GuardDuty Finding"]}' \
  --state   ENABLED

# Attach Lambda as target
aws events put-targets \
  --rule  guardduty-to-sentinel \
  --targets "Id=sentinel-lambda,Arn=arn:aws:lambda:eu-west-2:123456789012:function:guardduty-sentinel-ingestion"

# Grant EventBridge permission to invoke Lambda
aws lambda add-permission \
  --function-name  guardduty-sentinel-ingestion \
  --statement-id   EventBridgeInvoke \
  --action         lambda:InvokeFunction \
  --principal      events.amazonaws.com \
  --source-arn     arn:aws:events:eu-west-2:123456789012:rule/guardduty-to-sentinel
```

---

## Post-Deployment Validation

Run these immediately after deployment. All tests live in `validation/smoke_tests.kql`.

### Quick Health Check (Sentinel / Log Analytics)

```kql
// 1. Config function responds
AWSGuardDuty_Config()
| take 5

// 2. Data is flowing (adjust lookback if deployment is fresh)
AWSGuardDuty_Main(1d)
| summarize count() by SeverityLevel
| order by SeverityLevel asc

// 3. Network parser works
AWSGuardDuty_Network(7d)
| summarize count() by ThreatCategory

// 4. ASIM compliance
AWSGuardDuty_ASIMNetworkSession(1d)
| summarize count() by ASIMCompliance
```

### Expected Results

| Test | Pass Condition |
|------|---------------|
| Config responds | Returns ≥ 10 rows |
| Main parser | Returns rows with non-null FindingId |
| Network parser | Returns rows if network findings exist |
| ASIM | All rows show `Compliant` |

---

## Upgrading an Existing Deployment

1. **Pull latest changes**
   ```bash
   git pull origin main
   ```

2. **Check what changed**
   ```bash
   git diff HEAD~1 deployment/azuredeploy.json kql/
   ```

3. **Re-run deployment** using the same command as the initial deploy. ARM deployments are idempotent — existing functions are updated in-place.

4. **Validate** using the smoke tests above.

5. **Update Lambda** (if deployed):
   ```bash
   zip lambda_ingestion_handler.zip scripts/lambda_ingestion_handler.py
   aws lambda update-function-code \
     --function-name guardduty-sentinel-ingestion \
     --zip-file      fileb://lambda_ingestion_handler.zip
   ```

---

## Rollback Procedure

### KQL Functions

ARM deployments are versioned. Roll back to the previous deployment:

```bash
# List recent deployments
az deployment group list \
  --resource-group your-resource-group \
  --query "[].{name:name, timestamp:properties.timestamp, state:properties.provisioningState}" \
  --output table

# Redeploy a specific previous deployment
az deployment group create \
  --resource-group your-resource-group \
  --name           guardduty-rollback-$(date +%Y%m%d) \
  --template-file  deployment/azuredeploy.json \
  --parameters     workspaceName=your-sentinel-workspace
```

### Lambda Function

```bash
# List versions
aws lambda list-versions-by-function --function-name guardduty-sentinel-ingestion

# Roll back to a specific version by updating the alias
aws lambda update-alias \
  --function-name  guardduty-sentinel-ingestion \
  --name           live \
  --function-version 2   # previous stable version
```

---

## Operational Runbook

### Daily Health Check

```kql
// Ingestion rate — should be non-zero if GuardDuty has findings
AWSGuardDuty
| where TimeGenerated > ago(24h)
| summarize RecordCount = count() by bin(TimeGenerated, 1h)
| render timechart
```

### Alert: No Data for 2+ Hours

1. Check AWS GuardDuty console — are findings being generated?
2. Check SQS queue depth:
   ```bash
   aws sqs get-queue-attributes \
     --queue-url https://sqs.eu-west-2.amazonaws.com/123456789012/sentinel-guardduty-queue \
     --attribute-names ApproximateNumberOfMessages
   ```
3. Check Sentinel connector status in the Data Connectors blade.
4. Review KMS permissions: [kms-permissions.md](kms-permissions.md).

### Alert: Lambda Errors (if using Lambda path)

```bash
# Check recent Lambda errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/guardduty-sentinel-ingestion \
  --filter-pattern "ERROR" \
  --start-time $(date -d '1 hour ago' +%s000)
```

Common causes:
- Entra/DCR variables are missing or the credential has expired
- The application lacks `Monitoring Metrics Publisher` on the DCR
- Network connectivity to `*.ingest.monitor.azure.com`
- Lambda execution role missing CloudWatch Logs permissions

### Rotating the Entra Client Secret

1. Create a new credential for the ingestion application.
2. Update the value in the deployment's secret manager.
3. Update or redeploy the Lambda reference:
   ```bash
   aws lambda update-function-configuration \
     --function-name guardduty-sentinel-ingestion \
     --environment "Variables={AZURE_CLIENT_SECRET=new-secret,...}"
   ```
4. Verify ingestion resumes within 5 minutes.
