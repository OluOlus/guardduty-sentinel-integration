# AWS Infrastructure Module

This Terraform module creates the necessary AWS infrastructure for the GuardDuty to Sentinel integration.

## Resources Created

- **S3 Bucket**: Encrypted bucket for storing GuardDuty findings exports
- **KMS Key**: Customer-managed key for S3 bucket encryption
- **GuardDuty Publishing Destination**: Configuration to export findings to S3
- **IAM Role**: Cross-service access role for ingestion workers
- **CloudWatch Log Group**: Optional log group for monitoring (if enabled)

## Requirements

| Name | Version |
|------|---------|
| terraform | >= 1.0 |
| aws | ~> 5.0 |

## Usage

```hcl
module "guardduty_aws" {
  source = "./infra/aws"

  name_prefix = "my-guardduty-integration"
  
  # S3 Configuration
  s3_bucket_name      = "my-guardduty-findings-bucket"
  s3_expiration_days  = 90
  
  # GuardDuty Configuration
  create_guardduty_detector = false  # Use existing detector
  enable_s3_protection      = true
  enable_kubernetes_protection = true
  enable_malware_protection = true
  
  # Cross-account access (if needed)
  cross_account_role_arns = [
    "arn:aws:iam::123456789012:role/AzureIngestionRole"
  ]
  
  tags = {
    Environment = "production"
    Project     = "security-integration"
  }
}
```

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|:--------:|
| name_prefix | Prefix for resource names | `string` | `"guardduty-sentinel"` | no |
| tags | Tags to apply to all resources | `map(string)` | `{}` | no |
| create_guardduty_detector | Whether to create a new GuardDuty detector | `bool` | `false` | no |
| enable_s3_protection | Enable GuardDuty S3 protection | `bool` | `true` | no |
| enable_kubernetes_protection | Enable GuardDuty Kubernetes protection | `bool` | `true` | no |
| enable_malware_protection | Enable GuardDuty malware protection | `bool` | `true` | no |
| s3_bucket_name | Name for the S3 bucket (auto-generated if empty) | `string` | `""` | no |
| s3_force_destroy | Allow Terraform to destroy bucket with objects | `bool` | `false` | no |
| s3_lifecycle_enabled | Enable S3 lifecycle management | `bool` | `true` | no |
| s3_expiration_days | Days after which objects expire | `number` | `90` | no |
| s3_noncurrent_version_expiration_days | Days after which old versions expire | `number` | `30` | no |
| kms_deletion_window | KMS key deletion window in days | `number` | `7` | no |
| ingestion_worker_services | AWS services that can assume ingestion role | `list(string)` | `["lambda.amazonaws.com", "ecs-tasks.amazonaws.com"]` | no |
| cross_account_role_arns | Cross-account role ARNs for ingestion | `list(string)` | `[]` | no |
| cross_account_external_id | External ID for cross-account access | `string` | `""` | no |
| create_cloudwatch_logs | Create CloudWatch log group | `bool` | `true` | no |
| cloudwatch_log_retention_days | CloudWatch log retention in days | `number` | `14` | no |

## Outputs

| Name | Description |
|------|-------------|
| guardduty_detector_id | GuardDuty detector ID |
| s3_bucket_name | Name of the S3 bucket |
| s3_bucket_arn | ARN of the S3 bucket |
| kms_key_id | KMS key ID |
| kms_key_arn | KMS key ARN |
| kms_key_alias | KMS key alias |
| ingestion_role_arn | IAM role ARN for ingestion workers |
| ingestion_role_name | IAM role name for ingestion workers |
| publishing_destination_arn | GuardDuty publishing destination ARN |
| cloudwatch_log_group_name | CloudWatch log group name |
| worker_configuration | Configuration object for ingestion workers |

## Security Considerations

1. **Encryption**: All data is encrypted at rest using customer-managed KMS keys
2. **Access Control**: S3 bucket policy restricts access to GuardDuty service only
3. **Cross-Account Access**: Optional external ID for secure cross-account role assumption
4. **Public Access**: S3 bucket blocks all public access by default
5. **Versioning**: S3 versioning enabled for data protection

## Manual Setup Alternative

If you prefer not to use Terraform, you can manually create these resources using the AWS CLI or Console. See the `samples/deployment/aws-setup.md` file for manual setup instructions.

## Validation

After deployment, validate the setup:

1. Check GuardDuty publishing destination is active
2. Verify S3 bucket permissions and encryption
3. Test IAM role assumption for ingestion workers
4. Monitor CloudWatch logs for any issues

```bash
# Validate GuardDuty publishing destination
aws guardduty get-detector --detector-id <detector-id>

# Test S3 bucket access
aws s3 ls s3://<bucket-name>/

# Validate KMS key permissions
aws kms describe-key --key-id <key-id>
```