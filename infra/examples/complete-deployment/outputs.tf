# Outputs for Complete GuardDuty to Sentinel Integration Deployment

# AWS Outputs
output "aws_configuration" {
  description = "AWS infrastructure configuration"
  value = {
    guardduty_detector_id      = module.guardduty_aws.guardduty_detector_id
    s3_bucket_name            = module.guardduty_aws.s3_bucket_name
    s3_bucket_arn             = module.guardduty_aws.s3_bucket_arn
    kms_key_arn               = module.guardduty_aws.kms_key_arn
    ingestion_role_arn        = module.guardduty_aws.ingestion_role_arn
    publishing_destination_arn = module.guardduty_aws.publishing_destination_arn
  }
}

# Azure Outputs
output "azure_configuration" {
  description = "Azure infrastructure configuration"
  value = {
    resource_group_name               = module.guardduty_azure.resource_group_name
    log_analytics_workspace_id        = module.guardduty_azure.log_analytics_workspace_id
    data_collection_endpoint_uri      = module.guardduty_azure.data_collection_endpoint_logs_ingestion_uri
    data_collection_rule_immutable_id = module.guardduty_azure.data_collection_rule_immutable_id
    service_principal_application_id  = module.guardduty_azure.service_principal_application_id
  }
}

# Sentinel Outputs
output "sentinel_configuration" {
  description = "Sentinel analytics configuration"
  value = {
    sentinel_workspace_id = module.guardduty_sentinel.sentinel_workspace_id
    action_group_id      = module.guardduty_sentinel.action_group_id
    analytics_rules      = module.guardduty_sentinel.analytics_rules
    workbooks           = module.guardduty_sentinel.workbooks
    automation_rules    = module.guardduty_sentinel.automation_rules
  }
}

# Worker Configuration (for ingestion workers)
output "worker_configuration" {
  description = "Configuration values for ingestion workers"
  value = {
    # AWS Configuration
    aws_region         = var.aws_region
    aws_account_id     = module.guardduty_aws.worker_configuration.aws_account_id
    s3_bucket_name     = module.guardduty_aws.worker_configuration.s3_bucket_name
    kms_key_arn        = module.guardduty_aws.worker_configuration.kms_key_arn
    ingestion_role_arn = module.guardduty_aws.worker_configuration.ingestion_role_arn
    
    # Azure Configuration
    tenant_id                    = module.guardduty_azure.worker_configuration.tenant_id
    subscription_id              = module.guardduty_azure.worker_configuration.subscription_id
    resource_group_name          = module.guardduty_azure.worker_configuration.resource_group_name
    data_collection_endpoint_uri = module.guardduty_azure.worker_configuration.data_collection_endpoint_uri
    data_collection_rule_id      = module.guardduty_azure.worker_configuration.data_collection_rule_id
    stream_name                  = module.guardduty_azure.worker_configuration.stream_name
    client_id                    = module.guardduty_azure.worker_configuration.client_id
  }
}

# Sensitive Configuration (use with care)
output "sensitive_configuration" {
  description = "Sensitive configuration values"
  value = {
    azure_client_secret             = module.guardduty_azure.service_principal_client_secret
    log_analytics_workspace_key     = module.guardduty_azure.log_analytics_workspace_key
    application_insights_key        = module.guardduty_azure.application_insights_instrumentation_key
    application_insights_connection = module.guardduty_azure.application_insights_connection_string
  }
  sensitive = true
}

# Resource URLs
output "resource_urls" {
  description = "URLs for accessing deployed resources"
  value = {
    # AWS Console URLs
    guardduty_console = "https://console.aws.amazon.com/guardduty/home?region=${var.aws_region}#/findings"
    s3_console       = "https://console.aws.amazon.com/s3/buckets/${module.guardduty_aws.s3_bucket_name}"
    
    # Azure Portal URLs
    log_analytics_workspace = "https://portal.azure.com/#@/resource${module.guardduty_azure.log_analytics_workspace_id}/overview"
    sentinel_workspace     = module.guardduty_sentinel.resource_urls.sentinel_workspace
    sentinel_analytics     = module.guardduty_sentinel.resource_urls.analytics_rules
    sentinel_workbooks     = module.guardduty_sentinel.resource_urls.workbooks
    sentinel_incidents     = module.guardduty_sentinel.resource_urls.incidents
  }
}

# Deployment Summary
output "deployment_summary" {
  description = "Summary of deployed resources"
  value = {
    environment                = var.environment
    aws_region                = var.aws_region
    azure_location            = var.azure_location
    guardduty_detector_created = var.create_guardduty_detector
    sentinel_enabled          = var.enable_sentinel
    analytics_rules_count     = module.guardduty_sentinel.sentinel_configuration.analytics_rules_count
    workbooks_count          = module.guardduty_sentinel.sentinel_configuration.workbooks_count
    automation_rules_count   = module.guardduty_sentinel.sentinel_configuration.automation_rules_count
    notification_emails      = length(var.notification_emails)
    notification_webhooks    = length(var.notification_webhooks)
  }
}