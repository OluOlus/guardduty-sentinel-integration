# AWS Infrastructure for GuardDuty to Sentinel Integration
# This module creates the necessary AWS resources for exporting GuardDuty findings to S3

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Data sources for current AWS context
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_partition" "current" {}

# GuardDuty detector (assumes it already exists)
data "aws_guardduty_detector" "main" {
  count = var.create_guardduty_detector ? 0 : 1
}

# Create GuardDuty detector if requested
resource "aws_guardduty_detector" "main" {
  count  = var.create_guardduty_detector ? 1 : 0
  enable = true

  datasources {
    s3_logs {
      enable = var.enable_s3_protection
    }
    kubernetes {
      audit_logs {
        enable = var.enable_kubernetes_protection
      }
    }
    malware_protection {
      scan_ec2_instance_with_findings {
        ebs_volumes {
          enable = var.enable_malware_protection
        }
      }
    }
  }

  tags = var.tags
}

# KMS key for S3 bucket encryption
resource "aws_kms_key" "guardduty_s3" {
  description             = "KMS key for GuardDuty S3 export encryption"
  deletion_window_in_days = var.kms_deletion_window
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EnableIAMUserPermissions"
        Effect = "Allow"
        Principal = {
          AWS = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "AllowGuardDutyKey"
        Effect = "Allow"
        Principal = {
          Service = "guardduty.amazonaws.com"
        }
        Action = "kms:GenerateDataKey"
        Resource = "*"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
            "aws:SourceArn" = "arn:${data.aws_partition.current.partition}:guardduty:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:detector/${local.detector_id}"
          }
        }
      }
    ]
  })

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-guardduty-s3-key"
  })
}

resource "aws_kms_alias" "guardduty_s3" {
  name          = "alias/${var.name_prefix}-guardduty-s3"
  target_key_id = aws_kms_key.guardduty_s3.key_id
}

# S3 bucket for GuardDuty findings export
resource "aws_s3_bucket" "guardduty_findings" {
  bucket        = var.s3_bucket_name != "" ? var.s3_bucket_name : "${var.name_prefix}-guardduty-findings-${random_id.bucket_suffix.hex}"
  force_destroy = var.s3_force_destroy

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-guardduty-findings"
  })
}

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

# S3 bucket versioning
resource "aws_s3_bucket_versioning" "guardduty_findings" {
  bucket = aws_s3_bucket.guardduty_findings.id
  versioning_configuration {
    status = "Enabled"
  }
}

# S3 bucket encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "guardduty_findings" {
  bucket = aws_s3_bucket.guardduty_findings.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.guardduty_s3.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

# S3 bucket public access block
resource "aws_s3_bucket_public_access_block" "guardduty_findings" {
  bucket = aws_s3_bucket.guardduty_findings.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# S3 bucket lifecycle configuration
resource "aws_s3_bucket_lifecycle_configuration" "guardduty_findings" {
  count  = var.s3_lifecycle_enabled ? 1 : 0
  bucket = aws_s3_bucket.guardduty_findings.id

  rule {
    id     = "guardduty_findings_lifecycle"
    status = "Enabled"

    expiration {
      days = var.s3_expiration_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.s3_noncurrent_version_expiration_days
    }
  }
}

# S3 bucket policy for GuardDuty access
resource "aws_s3_bucket_policy" "guardduty_findings" {
  bucket = aws_s3_bucket.guardduty_findings.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowGuardDutyGetBucketLocation"
        Effect = "Allow"
        Principal = {
          Service = "guardduty.amazonaws.com"
        }
        Action   = "s3:GetBucketLocation"
        Resource = aws_s3_bucket.guardduty_findings.arn
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
            "aws:SourceArn" = "arn:${data.aws_partition.current.partition}:guardduty:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:detector/${local.detector_id}"
          }
        }
      },
      {
        Sid    = "AllowGuardDutyPutObject"
        Effect = "Allow"
        Principal = {
          Service = "guardduty.amazonaws.com"
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.guardduty_findings.arn}/*"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
            "aws:SourceArn" = "arn:${data.aws_partition.current.partition}:guardduty:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:detector/${local.detector_id}"
          }
        }
      }
    ]
  })
}

# GuardDuty publishing destination
resource "aws_guardduty_publishing_destination" "s3" {
  detector_id     = local.detector_id
  destination_arn = aws_s3_bucket.guardduty_findings.arn
  kms_key_arn     = aws_kms_key.guardduty_s3.arn

  destination_type = "S3"

  depends_on = [
    aws_s3_bucket_policy.guardduty_findings
  ]
}

# IAM role for cross-service access (for ingestion workers)
resource "aws_iam_role" "guardduty_ingestion" {
  name = "${var.name_prefix}-guardduty-ingestion-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = var.ingestion_worker_services
        }
      },
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          AWS = var.cross_account_role_arns
        }
        Condition = var.cross_account_external_id != "" ? {
          StringEquals = {
            "sts:ExternalId" = var.cross_account_external_id
          }
        } : {}
      }
    ]
  })

  tags = var.tags
}

# IAM policy for S3 and KMS access
resource "aws_iam_role_policy" "guardduty_ingestion_s3" {
  name = "${var.name_prefix}-guardduty-ingestion-s3-policy"
  role = aws_iam_role.guardduty_ingestion.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.guardduty_findings.arn,
          "${aws_s3_bucket.guardduty_findings.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey"
        ]
        Resource = aws_kms_key.guardduty_s3.arn
      }
    ]
  })
}

# Optional CloudWatch log group for monitoring
resource "aws_cloudwatch_log_group" "guardduty_ingestion" {
  count             = var.create_cloudwatch_logs ? 1 : 0
  name              = "/aws/${var.name_prefix}/guardduty-ingestion"
  retention_in_days = var.cloudwatch_log_retention_days

  tags = var.tags
}

# Local values
locals {
  detector_id = var.create_guardduty_detector ? aws_guardduty_detector.main[0].id : data.aws_guardduty_detector.main[0].id
}