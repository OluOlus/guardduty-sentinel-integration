# Outputs for Azure GuardDuty to Sentinel Integration Infrastructure

output "resource_group_name" {
  description = "Name of the resource group"
  value       = local.resource_group.name
}

output "resource_group_id" {
  description = "ID of the resource group"
  value       = local.resource_group.id
}

output "log_analytics_workspace_id" {
  description = "ID of the Log Analytics workspace"
  value       = azurerm_log_analytics_workspace.main.id
}

output "log_analytics_workspace_name" {
  description = "Name of the Log Analytics workspace"
  value       = azurerm_log_analytics_workspace.main.name
}

output "log_analytics_workspace_key" {
  description = "Primary shared key for Log Analytics workspace"
  value       = azurerm_log_analytics_workspace.main.primary_shared_key
  sensitive   = true
}

output "data_collection_endpoint_id" {
  description = "ID of the Data Collection Endpoint"
  value       = azurerm_monitor_data_collection_endpoint.main.id
}

output "data_collection_endpoint_logs_ingestion_uri" {
  description = "Logs ingestion URI for the Data Collection Endpoint"
  value       = azurerm_monitor_data_collection_endpoint.main.logs_ingestion_endpoint
}

output "data_collection_rule_id" {
  description = "ID of the Data Collection Rule"
  value       = azurerm_monitor_data_collection_rule.main.id
}

output "data_collection_rule_immutable_id" {
  description = "Immutable ID of the Data Collection Rule"
  value       = azurerm_monitor_data_collection_rule.main.immutable_id
}

output "service_principal_application_id" {
  description = "Application ID of the service principal"
  value       = azuread_application.guardduty_ingestion.application_id
}

output "service_principal_object_id" {
  description = "Object ID of the service principal"
  value       = azuread_service_principal.guardduty_ingestion.object_id
}

output "service_principal_client_secret" {
  description = "Client secret for the service principal"
  value       = azuread_service_principal_password.guardduty_ingestion.value
  sensitive   = true
}

output "application_insights_instrumentation_key" {
  description = "Application Insights instrumentation key (if created)"
  value       = var.create_application_insights ? azurerm_application_insights.main[0].instrumentation_key : null
  sensitive   = true
}

output "application_insights_connection_string" {
  description = "Application Insights connection string (if created)"
  value       = var.create_application_insights ? azurerm_application_insights.main[0].connection_string : null
  sensitive   = true
}

# Configuration values for ingestion workers
output "worker_configuration" {
  description = "Configuration values for ingestion workers"
  value = {
    tenant_id                    = data.azurerm_client_config.current.tenant_id
    subscription_id              = data.azurerm_client_config.current.subscription_id
    resource_group_name          = local.resource_group.name
    log_analytics_workspace_id   = azurerm_log_analytics_workspace.main.id
    data_collection_endpoint_uri = azurerm_monitor_data_collection_endpoint.main.logs_ingestion_endpoint
    data_collection_rule_id      = azurerm_monitor_data_collection_rule.main.immutable_id
    stream_name                  = "Custom-GuardDutyFindings"
    client_id                    = azuread_application.guardduty_ingestion.application_id
  }
}

# Sensitive configuration (use with care)
output "sensitive_worker_configuration" {
  description = "Sensitive configuration values for ingestion workers"
  value = {
    client_secret                = azuread_service_principal_password.guardduty_ingestion.value
    log_analytics_workspace_key  = azurerm_log_analytics_workspace.main.primary_shared_key
  }
  sensitive = true
}

# KQL Functions (if created)
output "kql_functions" {
  description = "Names of created KQL functions"
  value = var.create_kql_functions ? {
    guardduty_normalized    = azurerm_log_analytics_saved_search.guardduty_normalized[0].name
    guardduty_high_severity = azurerm_log_analytics_saved_search.guardduty_high_severity[0].name
  } : {}
}