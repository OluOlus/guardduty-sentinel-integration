# Outputs for AWS GuardDuty to Sentinel Integration Infrastructure

output "guardduty_detector_id" {
  description = "GuardDuty detector ID"
  value       = local.detector_id
}

output "s3_bucket_name" {
  description = "Name of the S3 bucket for GuardDuty findings"
  value       = aws_s3_bucket.guardduty_findings.id
}

output "s3_bucket_arn" {
  description = "ARN of the S3 bucket for GuardDuty findings"
  value       = aws_s3_bucket.guardduty_findings.arn
}

output "kms_key_id" {
  description = "KMS key ID for S3 encryption"
  value       = aws_kms_key.guardduty_s3.key_id
}

output "kms_key_arn" {
  description = "KMS key ARN for S3 encryption"
  value       = aws_kms_key.guardduty_s3.arn
}

output "kms_key_alias" {
  description = "KMS key alias for S3 encryption"
  value       = aws_kms_alias.guardduty_s3.name
}

output "ingestion_role_arn" {
  description = "ARN of the IAM role for ingestion workers"
  value       = aws_iam_role.guardduty_ingestion.arn
}

output "ingestion_role_name" {
  description = "Name of the IAM role for ingestion workers"
  value       = aws_iam_role.guardduty_ingestion.name
}

output "publishing_destination_arn" {
  description = "ARN of the GuardDuty publishing destination"
  value       = aws_guardduty_publishing_destination.s3.destination_arn
}

output "cloudwatch_log_group_name" {
  description = "Name of the CloudWatch log group (if created)"
  value       = var.create_cloudwatch_logs ? aws_cloudwatch_log_group.guardduty_ingestion[0].name : null
}

output "cloudwatch_log_group_arn" {
  description = "ARN of the CloudWatch log group (if created)"
  value       = var.create_cloudwatch_logs ? aws_cloudwatch_log_group.guardduty_ingestion[0].arn : null
}

# Configuration values for ingestion workers
output "worker_configuration" {
  description = "Configuration values for ingestion workers"
  value = {
    aws_region         = data.aws_region.current.name
    aws_account_id     = data.aws_caller_identity.current.account_id
    s3_bucket_name     = aws_s3_bucket.guardduty_findings.id
    kms_key_arn        = aws_kms_key.guardduty_s3.arn
    ingestion_role_arn = aws_iam_role.guardduty_ingestion.arn
  }
}