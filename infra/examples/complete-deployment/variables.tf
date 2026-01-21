# Variables for Complete GuardDuty to Sentinel Integration Deployment

variable "name_prefix" {
  description = "Prefix for all resource names"
  type        = string
  default     = "guardduty-sentinel"
}

variable "environment" {
  description = "Environment name (e.g., dev, staging, prod)"
  type        = string
  default     = "prod"
}

variable "aws_region" {
  description = "AWS region for GuardDuty and S3 resources"
  type        = string
  default     = "us-east-1"
}

variable "azure_location" {
  description = "Azure region for Log Analytics and Sentinel resources"
  type        = string
  default     = "East US"
}

variable "tags" {
  description = "Additional tags to apply to all resources"
  type        = map(string)
  default = {
    Owner       = "security-team"
    CostCenter  = "security"
  }
}

# AWS Configuration
variable "create_guardduty_detector" {
  description = "Whether to create a new GuardDuty detector"
  type        = bool
  default     = false
}

variable "s3_retention_days" {
  description = "Number of days to retain GuardDuty findings in S3"
  type        = number
  default     = 90
}

variable "azure_ingestion_role_arns" {
  description = "List of Azure ingestion role ARNs for cross-account access"
  type        = list(string)
  default     = []
}

variable "cross_account_external_id" {
  description = "External ID for cross-account role assumption"
  type        = string
  default     = ""
}

# Azure Configuration
variable "log_analytics_retention_days" {
  description = "Log Analytics workspace retention in days"
  type        = number
  default     = 90
}

variable "enable_data_transformation" {
  description = "Enable KQL transformation in Data Collection Rule"
  type        = bool
  default     = false
}

variable "dce_public_access" {
  description = "Enable public network access for Data Collection Endpoint"
  type        = bool
  default     = true
}

variable "enable_application_insights" {
  description = "Create Application Insights for monitoring"
  type        = bool
  default     = true
}

# Sentinel Configuration
variable "enable_sentinel" {
  description = "Enable Microsoft Sentinel on the Log Analytics workspace"
  type        = bool
  default     = true
}

variable "high_severity_threshold" {
  description = "Severity threshold for high severity analytics rule"
  type        = number
  default     = 7.0
}

variable "enable_automation_rules" {
  description = "Create automation rules for incident management"
  type        = bool
  default     = true
}

variable "default_incident_owner_id" {
  description = "Default owner ID for auto-assigned incidents (Azure AD user/group object ID)"
  type        = string
  default     = ""
}

# Notification Configuration
variable "notification_emails" {
  description = "List of email addresses for incident notifications"
  type        = list(string)
  default     = []
}

variable "notification_webhooks" {
  description = "List of webhook URLs for incident notifications"
  type        = list(string)
  default     = []
}

# Analytics Rule Customization
variable "analytics_rule_frequencies" {
  description = "Custom frequencies for analytics rules"
  type = object({
    high_severity_findings    = optional(string, "PT1H")
    cryptocurrency_mining     = optional(string, "PT4H")
    data_exfiltration        = optional(string, "PT2H")
    malware_backdoor         = optional(string, "PT1H")
  })
  default = {}
}