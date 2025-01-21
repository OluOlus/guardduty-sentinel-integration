# Complete GuardDuty to Sentinel Integration Deployment Example
# This example deploys the full infrastructure stack

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 2.0"
    }
  }
}

# Configure providers
provider "aws" {
  region = var.aws_region
}

provider "azurerm" {
  features {}
}

provider "azuread" {}

# AWS Infrastructure
module "guardduty_aws" {
  source = "../../aws"

  name_prefix = var.name_prefix
  
  # S3 Configuration
  s3_bucket_name      = "${var.name_prefix}-guardduty-findings-${var.environment}"
  s3_expiration_days  = var.s3_retention_days
  s3_lifecycle_enabled = true
  
  # GuardDuty Configuration
  create_guardduty_detector = var.create_guardduty_detector
  enable_s3_protection      = true
  enable_kubernetes_protection = true
  enable_malware_protection = true
  
  # Cross-account access for Azure ingestion
  cross_account_role_arns = var.azure_ingestion_role_arns
  cross_account_external_id = var.cross_account_external_id
  
  # Monitoring
  create_cloudwatch_logs = true
  cloudwatch_log_retention_days = 14
  
  tags = local.common_tags
}

# Azure Infrastructure
module "guardduty_azure" {
  source = "../../azure"

  name_prefix = var.name_prefix
  location    = var.azure_location
  
  # Resource Group
  create_resource_group = true
  resource_group_name   = "${var.name_prefix}-rg-${var.environment}"
  
  # Log Analytics
  log_analytics_workspace_name = "${var.name_prefix}-law-${var.environment}"
  log_analytics_retention_days = var.log_analytics_retention_days
  log_analytics_sku           = "PerGB2018"
  
  # Data Collection
  enable_data_transformation = var.enable_data_transformation
  dce_public_network_access_enabled = var.dce_public_access
  
  # Optional Features
  create_kql_functions = true
  create_application_insights = var.enable_application_insights
  grant_log_analytics_access = false
  
  tags = local.common_tags
}

# Sentinel Analytics (depends on Azure infrastructure)
module "guardduty_sentinel" {
  source = "../../sentinel"

  resource_group_name          = module.guardduty_azure.resource_group_name
  log_analytics_workspace_name = module.guardduty_azure.log_analytics_workspace_name
  name_prefix                  = var.name_prefix
  
  # Sentinel Configuration
  enable_sentinel = var.enable_sentinel
  sentinel_customer_managed_key_enabled = false
  
  # Analytics Rules
  create_analytics_rules = true
  high_severity_threshold = var.high_severity_threshold
  
  # Workbooks and Automation
  create_workbooks = true
  create_automation_rules = var.enable_automation_rules
  default_incident_owner_id = var.default_incident_owner_id
  
  # Notifications
  notification_emails = var.notification_emails
  notification_webhooks = var.notification_webhooks
  
  # Custom Analytics Rule Frequencies
  analytics_rule_frequencies = var.analytics_rule_frequencies
  
  tags = local.common_tags

  depends_on = [module.guardduty_azure]
}

# Local values
locals {
  common_tags = merge(var.tags, {
    Environment = var.environment
    DeployedBy  = "terraform"
    Project     = "guardduty-sentinel-integration"
  })
}