# Variables for Azure GuardDuty to Sentinel Integration Infrastructure

variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
  default     = "guardduty-sentinel"
}

variable "location" {
  description = "Azure region for resources"
  type        = string
  default     = "East US"
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

# Resource Group Configuration
variable "create_resource_group" {
  description = "Whether to create a new resource group"
  type        = bool
  default     = true
}

variable "resource_group_name" {
  description = "Name of the resource group"
  type        = string
  default     = "rg-guardduty-sentinel"
}

# Log Analytics Workspace Configuration
variable "log_analytics_workspace_name" {
  description = "Name of the Log Analytics workspace"
  type        = string
  default     = "law-guardduty-sentinel"
}

variable "log_analytics_sku" {
  description = "SKU for Log Analytics workspace"
  type        = string
  default     = "PerGB2018"
  validation {
    condition = contains([
      "Free", "Standalone", "PerNode", "PerGB2018"
    ], var.log_analytics_sku)
    error_message = "Log Analytics SKU must be one of: Free, Standalone, PerNode, PerGB2018."
  }
}

variable "log_analytics_retention_days" {
  description = "Log Analytics workspace retention in days"
  type        = number
  default     = 30
  validation {
    condition     = var.log_analytics_retention_days >= 30 && var.log_analytics_retention_days <= 730
    error_message = "Log Analytics retention must be between 30 and 730 days."
  }
}

# Data Collection Configuration
variable "dce_public_network_access_enabled" {
  description = "Enable public network access for Data Collection Endpoint"
  type        = bool
  default     = true
}

variable "enable_data_transformation" {
  description = "Enable KQL transformation in Data Collection Rule"
  type        = bool
  default     = false
}

# Service Principal Configuration
variable "grant_log_analytics_access" {
  description = "Grant Log Analytics Contributor access to service principal"
  type        = bool
  default     = false
}

# Optional Features
variable "create_kql_functions" {
  description = "Create saved KQL functions for common queries"
  type        = bool
  default     = true
}

variable "create_application_insights" {
  description = "Create Application Insights for monitoring"
  type        = bool
  default     = false
}

# Sentinel Configuration (for future use)
variable "enable_sentinel" {
  description = "Enable Microsoft Sentinel on the Log Analytics workspace"
  type        = bool
  default     = false
}

variable "sentinel_daily_quota_gb" {
  description = "Daily quota for Sentinel in GB (-1 for unlimited)"
  type        = number
  default     = -1
}