# Variables for Microsoft Sentinel GuardDuty Analytics

variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
  default     = "guardduty-sentinel"
}

variable "resource_group_name" {
  description = "Name of the resource group containing the Log Analytics workspace"
  type        = string
}

variable "log_analytics_workspace_name" {
  description = "Name of the Log Analytics workspace"
  type        = string
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

# Sentinel Configuration
variable "enable_sentinel" {
  description = "Enable Microsoft Sentinel on the Log Analytics workspace"
  type        = bool
  default     = true
}

variable "sentinel_customer_managed_key_enabled" {
  description = "Enable customer-managed key encryption for Sentinel"
  type        = bool
  default     = false
}

# Analytics Rules Configuration
variable "create_analytics_rules" {
  description = "Create scheduled analytics rules for GuardDuty findings"
  type        = bool
  default     = true
}

# Workbooks Configuration
variable "create_workbooks" {
  description = "Create Sentinel workbooks for GuardDuty visualization"
  type        = bool
  default     = true
}

# Automation Rules Configuration
variable "create_automation_rules" {
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
variable "high_severity_threshold" {
  description = "Severity threshold for high severity analytics rule"
  type        = number
  default     = 7.0
  validation {
    condition     = var.high_severity_threshold >= 0.0 && var.high_severity_threshold <= 10.0
    error_message = "High severity threshold must be between 0.0 and 10.0."
  }
}

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

# Incident Configuration
variable "incident_grouping_enabled" {
  description = "Enable incident grouping for analytics rules"
  type        = bool
  default     = true
}

variable "incident_grouping_lookback_duration" {
  description = "Lookback duration for incident grouping"
  type        = string
  default     = "PT6H"
}

# Custom KQL Queries
variable "custom_analytics_rules" {
  description = "Custom analytics rules to create"
  type = list(object({
    name         = string
    display_name = string
    description  = string
    severity     = string
    query        = string
    frequency    = string
    period       = string
    threshold    = number
    enabled      = optional(bool, true)
  }))
  default = []
}