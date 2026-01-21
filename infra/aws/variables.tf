# Variables for AWS GuardDuty to Sentinel Integration Infrastructure

variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
  default     = "guardduty-sentinel"
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default = {
    Project     = "GuardDuty-Sentinel-Integration"
    Environment = "production"
    ManagedBy   = "terraform"
  }
}

# GuardDuty Configuration
variable "create_guardduty_detector" {
  description = "Whether to create a new GuardDuty detector or use existing one"
  type        = bool
  default     = false
}

variable "enable_s3_protection" {
  description = "Enable GuardDuty S3 protection"
  type        = bool
  default     = true
}

variable "enable_kubernetes_protection" {
  description = "Enable GuardDuty Kubernetes protection"
  type        = bool
  default     = true
}

variable "enable_malware_protection" {
  description = "Enable GuardDuty malware protection"
  type        = bool
  default     = true
}

# S3 Configuration
variable "s3_bucket_name" {
  description = "Name for the S3 bucket (leave empty for auto-generated name)"
  type        = string
  default     = ""
}

variable "s3_force_destroy" {
  description = "Allow Terraform to destroy the S3 bucket even if it contains objects"
  type        = bool
  default     = false
}

variable "s3_lifecycle_enabled" {
  description = "Enable S3 lifecycle management"
  type        = bool
  default     = true
}

variable "s3_expiration_days" {
  description = "Number of days after which objects expire"
  type        = number
  default     = 90
}

variable "s3_noncurrent_version_expiration_days" {
  description = "Number of days after which noncurrent versions expire"
  type        = number
  default     = 30
}

# KMS Configuration
variable "kms_deletion_window" {
  description = "KMS key deletion window in days"
  type        = number
  default     = 7
}

# IAM Configuration
variable "ingestion_worker_services" {
  description = "List of AWS services that can assume the ingestion role"
  type        = list(string)
  default     = ["lambda.amazonaws.com", "ecs-tasks.amazonaws.com"]
}

variable "cross_account_role_arns" {
  description = "List of cross-account role ARNs that can assume the ingestion role"
  type        = list(string)
  default     = []
}

variable "cross_account_external_id" {
  description = "External ID for cross-account role assumption"
  type        = string
  default     = ""
}

# CloudWatch Configuration
variable "create_cloudwatch_logs" {
  description = "Create CloudWatch log group for monitoring"
  type        = bool
  default     = true
}

variable "cloudwatch_log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 14
}