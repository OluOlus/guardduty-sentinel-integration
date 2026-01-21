# AWS Manual Setup Guide

This guide walks you through manually setting up AWS resources for the GuardDuty to Sentinel integration.

## Overview

You'll create and configure:
1. S3 bucket with KMS encryption for GuardDuty exports
2. GuardDuty publishing destination
3. IAM roles and policies for cross-service access
4. KMS key for S3 encryption (optional)

## Step 1: Create KMS Key (Optional)

You can use AWS managed keys or create a custom KMS key for additional control.

### Using AWS CLI

```bash
# Create KMS key
aws kms create-key \
    --description "GuardDuty S3 Export Encryption Key" \
    --key-usage ENCRYPT_DECRYPT \
    --key-spec SYMMETRIC_DEFAULT

# Note the KeyId from the response
export KMS_KEY_ID="your-key-id-here"

# Create alias for easier reference
aws kms create-alias \
    --alias-name alias/guardduty-s3-export \
    --target-key-id $KMS_KEY_ID
```

### Key Policy

Update the KMS key policy to allow GuardDuty access:

```bash
# Create key policy file
cat > kms-key-policy.json << 'EOF'
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "Enable IAM User Permissions",
            "Effect": "Allow",
            "Principal": {
                "AWS": "arn:aws:iam::ACCOUNT-ID:root"
            },
            "Action": "kms:*",
            "Resource": "*"
        },
        {
            "Sid": "AllowGuardDutyKey",
            "Effect": "Allow",
            "Principal": {
                "Service": "guardduty.amazonaws.com"
            },
            "Action": [
                "kms:GenerateDataKey",
                "kms:Decrypt"
            ],
            "Resource": "*",
            "Condition": {
                "StringEquals": {
                    "aws:SourceAccount": "ACCOUNT-ID"
                }
            }
        }
    ]
}
EOF

# Replace ACCOUNT-ID with your actual account ID
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
sed -i "s/ACCOUNT-ID/$ACCOUNT_ID/g" kms-key-policy.json

# Apply the policy
aws kms put-key-policy \
    --key-id $KMS_KEY_ID \
    --policy-name default \
    --policy file://kms-key-policy.json
```

## Step 2: Create S3 Bucket

### Using AWS CLI

```bash
# Set variables
export BUCKET_NAME="your-guardduty-export-bucket-$(date +%s)"
export AWS_REGION="us-east-1"  # Change to your preferred region

# Create bucket
aws s3 mb s3://$BUCKET_NAME --region $AWS_REGION

# Enable versioning (recommended)
aws s3api put-bucket-versioning \
    --bucket $BUCKET_NAME \
    --versioning-configuration Status=Enabled

# Configure server-side encryption
if [ -n "$KMS_KEY_ID" ]; then
    # Use custom KMS key
    aws s3api put-bucket-encryption \
        --bucket $BUCKET_NAME \
        --server-side-encryption-configuration '{
            "Rules": [
                {
                    "ApplyServerSideEncryptionByDefault": {
                        "SSEAlgorithm": "aws:kms",
                        "KMSMasterKeyID": "'$KMS_KEY_ID'"
                    },
                    "BucketKeyEnabled": true
                }
            ]
        }'
else
    # Use AWS managed key
    aws s3api put-bucket-encryption \
        --bucket $BUCKET_NAME \
        --server-side-encryption-configuration '{
            "Rules": [
                {
                    "ApplyServerSideEncryptionByDefault": {
                        "SSEAlgorithm": "aws:kms"
                    },
                    "BucketKeyEnabled": true
                }
            ]
        }'
fi
```

### Bucket Policy

Create a bucket policy to allow GuardDuty access:

```bash
# Create bucket policy
cat > s3-bucket-policy.json << 'EOF'
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowGuardDutyGetBucketLocation",
            "Effect": "Allow",
            "Principal": {
                "Service": "guardduty.amazonaws.com"
            },
            "Action": "s3:GetBucketLocation",
            "Resource": "arn:aws:s3:::BUCKET-NAME",
            "Condition": {
                "StringEquals": {
                    "aws:SourceAccount": "ACCOUNT-ID"
                }
            }
        },
        {
            "Sid": "AllowGuardDutyPutObject",
            "Effect": "Allow",
            "Principal": {
                "Service": "guardduty.amazonaws.com"
            },
            "Action": "s3:PutObject",
            "Resource": "arn:aws:s3:::BUCKET-NAME/*",
            "Condition": {
                "StringEquals": {
                    "aws:SourceAccount": "ACCOUNT-ID"
                }
            }
        }
    ]
}
EOF

# Replace placeholders
sed -i "s/BUCKET-NAME/$BUCKET_NAME/g" s3-bucket-policy.json
sed -i "s/ACCOUNT-ID/$ACCOUNT_ID/g" s3-bucket-policy.json

# Apply bucket policy
aws s3api put-bucket-policy \
    --bucket $BUCKET_NAME \
    --policy file://s3-bucket-policy.json
```

## Step 3: Configure GuardDuty Publishing Destination

### Get GuardDuty Detector ID

```bash
# List GuardDuty detectors
export DETECTOR_ID=$(aws guardduty list-detectors --query 'DetectorIds[0]' --output text)

if [ "$DETECTOR_ID" = "None" ]; then
    echo "No GuardDuty detector found. Creating one..."
    aws guardduty create-detector --enable
    export DETECTOR_ID=$(aws guardduty list-detectors --query 'DetectorIds[0]' --output text)
fi

echo "GuardDuty Detector ID: $DETECTOR_ID"
```

### Create Publishing Destination

```bash
# Create publishing destination
aws guardduty create-publishing-destination \
    --detector-id $DETECTOR_ID \
    --destination-type S3 \
    --destination-properties DestinationArn=arn:aws:s3:::$BUCKET_NAME,KmsKeyArn=arn:aws:kms:$AWS_REGION:$ACCOUNT_ID:key/$KMS_KEY_ID

# Get the destination ID
export DESTINATION_ID=$(aws guardduty list-publishing-destinations \
    --detector-id $DETECTOR_ID \
    --query 'Destinations[0].DestinationId' \
    --output text)

echo "Publishing Destination ID: $DESTINATION_ID"
```

## Step 4: Create IAM Role for Ingestion Worker

Create an IAM role that the ingestion worker can assume to access S3 and KMS:

```bash
# Create trust policy for the role
cat > worker-trust-policy.json << 'EOF'
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Service": [
                    "lambda.amazonaws.com",
                    "ecs-tasks.amazonaws.com"
                ]
            },
            "Action": "sts:AssumeRole"
        }
    ]
}
EOF

# Create the role
aws iam create-role \
    --role-name GuardDutySentinelWorkerRole \
    --assume-role-policy-document file://worker-trust-policy.json

# Create permissions policy
cat > worker-permissions-policy.json << 'EOF'
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::BUCKET-NAME",
                "arn:aws:s3:::BUCKET-NAME/*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "kms:Decrypt",
                "kms:GenerateDataKey"
            ],
            "Resource": "arn:aws:kms:AWS-REGION:ACCOUNT-ID:key/KMS-KEY-ID"
        },
        {
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ],
            "Resource": "arn:aws:logs:*:*:*"
        }
    ]
}
EOF

# Replace placeholders
sed -i "s/BUCKET-NAME/$BUCKET_NAME/g" worker-permissions-policy.json
sed -i "s/AWS-REGION/$AWS_REGION/g" worker-permissions-policy.json
sed -i "s/ACCOUNT-ID/$ACCOUNT_ID/g" worker-permissions-policy.json
sed -i "s/KMS-KEY-ID/$KMS_KEY_ID/g" worker-permissions-policy.json

# Attach policy to role
aws iam put-role-policy \
    --role-name GuardDutySentinelWorkerRole \
    --policy-name GuardDutySentinelWorkerPolicy \
    --policy-document file://worker-permissions-policy.json
```

## Step 5: Generate Configuration

Create a configuration file with your AWS resource details:

```bash
# Generate configuration
cat > ../config/generated-aws-config.json << EOF
{
  "aws": {
    "region": "$AWS_REGION",
    "s3BucketName": "$BUCKET_NAME",
    "s3BucketPrefix": "AWSLogs/$ACCOUNT_ID/GuardDuty/",
    "kmsKeyArn": "arn:aws:kms:$AWS_REGION:$ACCOUNT_ID:key/$KMS_KEY_ID",
    "workerRoleArn": "arn:aws:iam::$ACCOUNT_ID:role/GuardDutySentinelWorkerRole"
  },
  "guardduty": {
    "detectorId": "$DETECTOR_ID",
    "destinationId": "$DESTINATION_ID"
  }
}
EOF

echo "AWS configuration saved to ../config/generated-aws-config.json"
```

## Step 6: Test GuardDuty Export

Generate a test finding to verify the export is working:

```bash
# Create a test finding (this creates a sample threat)
# Note: This is for testing only and may trigger alerts
aws guardduty create-sample-findings \
    --detector-id $DETECTOR_ID \
    --finding-types "Backdoor:EC2/XORDDOS"

echo "Test finding created. Check S3 bucket in 5-10 minutes for exported findings."
echo "Bucket: s3://$BUCKET_NAME"
echo "Expected path: AWSLogs/$ACCOUNT_ID/GuardDuty/$AWS_REGION/"
```

## Verification

After setup, verify your configuration:

1. **Check S3 bucket exists and has proper encryption**:
   ```bash
   aws s3api get-bucket-encryption --bucket $BUCKET_NAME
   ```

2. **Verify GuardDuty publishing destination**:
   ```bash
   aws guardduty describe-publishing-destination \
       --detector-id $DETECTOR_ID \
       --destination-id $DESTINATION_ID
   ```

3. **Test IAM role permissions**:
   ```bash
   aws iam simulate-principal-policy \
       --policy-source-arn arn:aws:iam::$ACCOUNT_ID:role/GuardDutySentinelWorkerRole \
       --action-names s3:GetObject \
       --resource-arns arn:aws:s3:::$BUCKET_NAME/test-object
   ```

## Cleanup (Optional)

To remove the resources created by this guide:

```bash
# Delete publishing destination
aws guardduty delete-publishing-destination \
    --detector-id $DETECTOR_ID \
    --destination-id $DESTINATION_ID

# Delete S3 bucket (remove all objects first)
aws s3 rm s3://$BUCKET_NAME --recursive
aws s3 rb s3://$BUCKET_NAME

# Delete IAM role
aws iam delete-role-policy \
    --role-name GuardDutySentinelWorkerRole \
    --policy-name GuardDutySentinelWorkerPolicy
aws iam delete-role --role-name GuardDutySentinelWorkerRole

# Delete KMS key (optional - this schedules deletion)
aws kms schedule-key-deletion --key-id $KMS_KEY_ID --pending-window-in-days 7
```

## Next Steps

After completing the AWS setup:
1. Proceed to [Azure Setup](azure-setup.md)
2. Configure the ingestion worker with your AWS resource details
3. Run the validation script to test the integration

## Troubleshooting

### Common Issues

**S3 Access Denied**
- Verify bucket policy includes GuardDuty service principal
- Check IAM role has s3:GetObject and s3:ListBucket permissions
- Ensure bucket and role are in the same account

**KMS Decryption Errors**
- Verify KMS key policy allows GuardDuty service
- Check worker role has kms:Decrypt permission
- Ensure KMS key is in the same region as S3 bucket

**GuardDuty Export Not Working**
- Verify publishing destination status is PUBLISHING
- Check S3 bucket policy allows GuardDuty PutObject
- Wait 5-10 minutes after creating test findings

**IAM Permission Issues**
- Use `aws iam simulate-principal-policy` to test permissions
- Check trust policy allows the correct service principals
- Verify policy ARNs match your actual resources