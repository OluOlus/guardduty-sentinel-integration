# KMS Permissions for GuardDuty Integration

KMS (Key Management Service) permissions are the **most common cause** of GuardDuty ingestion failures in Microsoft Sentinel. This guide explains why and how to fix it.

## Why KMS Permissions Matter

AWS GuardDuty findings are typically encrypted at rest using KMS when exported to S3. The Microsoft Sentinel AWS S3 connector needs to decrypt these files to read the GuardDuty findings.

**Common scenario:**
1. GuardDuty exports findings to S3 bucket (encrypted with KMS)
2. S3 sends notification to SQS queue ✅
3. Sentinel connector receives SQS message ✅
4. Connector tries to read S3 object ❌ **Access Denied (KMS decrypt)**
5. Connector status shows "Connected" but no data flows

## Identifying KMS Issues

### Symptoms
- Connector shows "Connected" status
- No GuardDuty data in Sentinel (empty AWSGuardDuty table)
- No obvious error messages
- S3 bucket contains GuardDuty files
- SQS queue receives notifications

### Diagnostic Steps

1. **Check if GuardDuty uses KMS encryption:**
   ```bash
   aws guardduty get-publishing-destination \
     --detector-id YOUR_DETECTOR_ID \
     --destination-id YOUR_DESTINATION_ID
   ```
   
   Look for `KmsKeyArn` in the response.

2. **Verify S3 bucket encryption:**
   ```bash
   aws s3api head-object \
     --bucket your-guardduty-bucket \
     --key "path/to/guardduty/finding.json"
   ```
   
   Look for `ServerSideEncryption` and `SSEKMSKeyId` in the response.

3. **Test IAM role permissions:**
   ```bash
   # Assume the Sentinel IAM role
   aws sts assume-role \
     --role-arn arn:aws:iam::ACCOUNT:role/SentinelConnectorRole \
     --role-session-name test-session
   
   # Try to decrypt a GuardDuty object
   aws s3 cp s3://your-guardduty-bucket/path/to/finding.json ./test.json
   ```

## Required KMS Permissions

The IAM role used by the Sentinel connector needs these KMS permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "kms:Decrypt",
                "kms:DescribeKey"
            ],
            "Resource": [
                "arn:aws:kms:REGION:ACCOUNT:key/YOUR-GUARDDUTY-KMS-KEY-ID"
            ]
        }
    ]
}
```

### Finding Your GuardDuty KMS Key

#### Method 1: GuardDuty Console
1. Go to AWS GuardDuty console
2. Navigate to **Settings** → **Findings export options**
3. Look for the KMS key ARN in the S3 export configuration

#### Method 2: CLI Command
```bash
aws guardduty get-publishing-destination \
  --detector-id $(aws guardduty list-detectors --query 'DetectorIds[0]' --output text) \
  --destination-id YOUR_DESTINATION_ID \
  --query 'KmsKeyArn' --output text
```

#### Method 3: S3 Object Metadata
```bash
aws s3api head-object \
  --bucket your-guardduty-bucket \
  --key "AWSLogs/ACCOUNT/GuardDuty/REGION/2024/01/28/finding.json" \
  --query 'SSEKMSKeyId' --output text
```

## Implementation Steps

### Step 1: Identify the KMS Key

Use one of the methods above to find your GuardDuty KMS key ARN.

### Step 2: Update IAM Role Policy

Add KMS permissions to your Sentinel connector IAM role:

```bash
# Create KMS policy document
cat > kms-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "kms:Decrypt",
                "kms:DescribeKey"
            ],
            "Resource": "arn:aws:kms:us-east-1:123456789012:key/your-key-id"
        }
    ]
}
EOF

# Attach policy to role
aws iam put-role-policy \
  --role-name SentinelConnectorRole \
  --policy-name GuardDutyKMSAccess \
  --policy-document file://kms-policy.json
```

### Step 3: Update KMS Key Policy (If Needed)

Sometimes the KMS key policy also needs to allow the IAM role:

```bash
# Get current key policy
aws kms get-key-policy \
  --key-id your-key-id \
  --policy-name default \
  --output text > current-policy.json

# Edit the policy to add your IAM role ARN
# Then update the key policy
aws kms put-key-policy \
  --key-id your-key-id \
  --policy-name default \
  --policy file://updated-policy.json
```

Example KMS key policy addition:
```json
{
    "Sid": "AllowSentinelConnector",
    "Effect": "Allow",
    "Principal": {
        "AWS": "arn:aws:iam::ACCOUNT:role/SentinelConnectorRole"
    },
    "Action": [
        "kms:Decrypt",
        "kms:DescribeKey"
    ],
    "Resource": "*"
}
```

### Step 4: Test the Fix

1. **Wait 5-10 minutes** for permissions to propagate
2. **Test decryption manually:**
   ```bash
   aws s3 cp s3://your-guardduty-bucket/path/to/finding.json ./test.json
   ```
3. **Check Sentinel for new data:**
   ```kql
   AWSGuardDuty
   | where TimeGenerated > ago(30m)
   | take 5
   ```

## Common KMS Scenarios

### Scenario 1: Default GuardDuty KMS Key
GuardDuty uses the default AWS managed key `aws/guardduty`.

**Solution:**
```json
{
    "Resource": "arn:aws:kms:*:*:key/aws/guardduty"
}
```

### Scenario 2: Customer Managed KMS Key
GuardDuty uses a custom KMS key you created.

**Solution:**
```json
{
    "Resource": "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012"
}
```

### Scenario 3: Cross-Account KMS Key
GuardDuty uses a KMS key from a different AWS account.

**Solution:**
1. Add permissions to the IAM role in the Sentinel account
2. Add cross-account permissions to the KMS key policy in the GuardDuty account

### Scenario 4: Multiple Regions
GuardDuty exports from multiple regions, each with different KMS keys.

**Solution:**
```json
{
    "Resource": [
        "arn:aws:kms:us-east-1:123456789012:key/key-id-1",
        "arn:aws:kms:us-west-2:123456789012:key/key-id-2",
        "arn:aws:kms:eu-west-1:123456789012:key/key-id-3"
    ]
}
```

## Troubleshooting KMS Issues

### Issue: Still No Data After Adding Permissions

**Check:**
1. **Permission propagation** - Wait 10-15 minutes
2. **Key policy** - Ensure KMS key policy allows the role
3. **Region mismatch** - Verify KMS key region matches GuardDuty region
4. **Key rotation** - Check if KMS key was rotated recently

### Issue: Access Denied Errors in CloudTrail

**Look for:**
- `kms:Decrypt` denied events
- Source IP from Microsoft Azure ranges
- IAM role ARN in the events

**Fix:**
- Add missing KMS permissions
- Check resource ARN matches exactly

### Issue: Intermittent Data Flow

**Possible causes:**
- Multiple KMS keys in use
- Key rotation in progress
- Cross-region replication with different keys

**Solution:**
- Add permissions for all relevant KMS keys
- Use wildcard for regions if appropriate

## Best Practices

1. **Use least privilege** - Only grant decrypt permissions for GuardDuty KMS keys
2. **Monitor access** - Set up CloudTrail logging for KMS key usage
3. **Document keys** - Keep track of which KMS keys are used for GuardDuty
4. **Test regularly** - Verify permissions after any AWS account changes
5. **Automate** - Include KMS permissions in your infrastructure as code

## Validation Query

After fixing KMS permissions, use this query to validate data flow:

```kql
// Check for recent GuardDuty data
AWSGuardDuty
| where TimeGenerated > ago(1h)
| summarize 
    RecordCount = count(),
    LatestRecord = max(TimeGenerated),
    DataLag = now() - max(TimeGenerated)
| extend Status = case(
    RecordCount == 0, "❌ No data - check KMS permissions",
    DataLag > 30m, "⚠️ Data lag detected",
    "✅ KMS permissions working"
)
```

Remember: KMS permission issues are silent failures. The connector will show "Connected" even when it can't decrypt the data.