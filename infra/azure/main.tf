# Azure Infrastructure for GuardDuty to Sentinel Integration
# This module creates the necessary Azure resources for ingesting GuardDuty findings

terraform {
  required_version = ">= 1.0"
  required_providers {
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

# Data sources for current Azure context
data "azurerm_client_config" "current" {}
data "azuread_client_config" "current" {}

# Resource group for all resources
resource "azurerm_resource_group" "main" {
  count    = var.create_resource_group ? 1 : 0
  name     = var.resource_group_name
  location = var.location

  tags = var.tags
}

# Use existing resource group if not creating new one
data "azurerm_resource_group" "existing" {
  count = var.create_resource_group ? 0 : 1
  name  = var.resource_group_name
}

# Log Analytics Workspace
resource "azurerm_log_analytics_workspace" "main" {
  name                = var.log_analytics_workspace_name
  location            = local.resource_group.location
  resource_group_name = local.resource_group.name
  sku                 = var.log_analytics_sku
  retention_in_days   = var.log_analytics_retention_days

  tags = var.tags
}

# Service Principal for Data Collection
resource "azuread_application" "guardduty_ingestion" {
  display_name = "${var.name_prefix}-guardduty-ingestion"
  owners       = [data.azuread_client_config.current.object_id]

  required_resource_access {
    resource_app_id = "https://monitor.azure.com/"

    resource_access {
      id   = "b340eb25-3456-403f-be2f-af728629cc50" # Monitoring Metrics Publisher
      type = "Role"
    }
  }
}

resource "azuread_service_principal" "guardduty_ingestion" {
  application_id = azuread_application.guardduty_ingestion.application_id
  owners         = [data.azuread_client_config.current.object_id]
}

resource "azuread_service_principal_password" "guardduty_ingestion" {
  service_principal_id = azuread_service_principal.guardduty_ingestion.object_id
  display_name         = "GuardDuty Ingestion Client Secret"
}

# Data Collection Endpoint (DCE)
resource "azurerm_monitor_data_collection_endpoint" "main" {
  name                          = "${var.name_prefix}-dce"
  resource_group_name           = local.resource_group.name
  location                      = local.resource_group.location
  kind                          = "Linux"
  public_network_access_enabled = var.dce_public_network_access_enabled

  tags = var.tags
}

# Data Collection Rule (DCR)
resource "azurerm_monitor_data_collection_rule" "main" {
  name                        = "${var.name_prefix}-dcr"
  resource_group_name         = local.resource_group.name
  location                    = local.resource_group.location
  data_collection_endpoint_id = azurerm_monitor_data_collection_endpoint.main.id
  kind                        = "Linux"

  destinations {
    log_analytics {
      workspace_resource_id = azurerm_log_analytics_workspace.main.id
      name                  = "LogAnalyticsDest"
    }
  }

  data_flow {
    streams      = ["Custom-GuardDutyFindings"]
    destinations = ["LogAnalyticsDest"]
    transform_kql = var.enable_data_transformation ? local.transform_kql : "source"
    output_stream = "Custom-RawGuardDuty_CL"
  }

  stream_declaration {
    stream_name = "Custom-GuardDutyFindings"
    column {
      name = "TimeGenerated"
      type = "datetime"
    }
    column {
      name = "FindingId"
      type = "string"
    }
    column {
      name = "AccountId"
      type = "string"
    }
    column {
      name = "Region"
      type = "string"
    }
    column {
      name = "Severity"
      type = "real"
    }
    column {
      name = "Type"
      type = "string"
    }
    column {
      name = "RawJson"
      type = "string"
    }
  }

  tags = var.tags
}

# RBAC assignment for service principal
resource "azurerm_role_assignment" "monitoring_metrics_publisher" {
  scope                = azurerm_monitor_data_collection_rule.main.id
  role_definition_name = "Monitoring Metrics Publisher"
  principal_id         = azuread_service_principal.guardduty_ingestion.object_id
}

# Optional: Log Analytics Workspace RBAC
resource "azurerm_role_assignment" "log_analytics_contributor" {
  count                = var.grant_log_analytics_access ? 1 : 0
  scope                = azurerm_log_analytics_workspace.main.id
  role_definition_name = "Log Analytics Contributor"
  principal_id         = azuread_service_principal.guardduty_ingestion.object_id
}

# KQL Function for data normalization
resource "azurerm_log_analytics_saved_search" "guardduty_normalized" {
  count                      = var.create_kql_functions ? 1 : 0
  name                       = "GuardDutyNormalized"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  category                   = "GuardDuty Integration"
  display_name               = "GuardDuty Normalized View"
  query                      = local.guardduty_normalized_kql

  tags = var.tags
}

# Additional KQL functions for common queries
resource "azurerm_log_analytics_saved_search" "guardduty_high_severity" {
  count                      = var.create_kql_functions ? 1 : 0
  name                       = "GuardDutyHighSeverity"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  category                   = "GuardDuty Integration"
  display_name               = "GuardDuty High Severity Findings"
  query                      = local.guardduty_high_severity_kql

  tags = var.tags
}

# Application Insights for monitoring (optional)
resource "azurerm_application_insights" "main" {
  count               = var.create_application_insights ? 1 : 0
  name                = "${var.name_prefix}-appinsights"
  location            = local.resource_group.location
  resource_group_name = local.resource_group.name
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "other"

  tags = var.tags
}

# Local values
locals {
  resource_group = var.create_resource_group ? azurerm_resource_group.main[0] : data.azurerm_resource_group.existing[0]

  # KQL transformation for DCR
  transform_kql = <<-EOT
    source
    | extend TimeGenerated = now()
    | extend ParsedJson = parse_json(RawJson)
    | extend 
        CreatedAt = todatetime(ParsedJson.createdAt),
        UpdatedAt = todatetime(ParsedJson.updatedAt),
        Title = tostring(ParsedJson.title),
        Description = tostring(ParsedJson.description)
  EOT

  # GuardDuty normalized KQL function
  guardduty_normalized_kql = <<-EOT
    RawGuardDuty_CL
    | extend ParsedJson = parse_json(RawJson)
    | extend 
        CreatedAt = todatetime(ParsedJson.createdAt),
        UpdatedAt = todatetime(ParsedJson.updatedAt),
        Title = tostring(ParsedJson.title),
        Description = tostring(ParsedJson.description),
        Service = tostring(ParsedJson.service.serviceName),
        ResourceType = tostring(ParsedJson.resource.resourceType),
        InstanceId = tostring(ParsedJson.resource.instanceDetails.instanceId),
        RemoteIpCountry = tostring(ParsedJson.service.remoteIpDetails.country.countryName),
        RemoteIpAddress = tostring(ParsedJson.service.remoteIpDetails.ipAddressV4),
        ActionType = tostring(ParsedJson.service.action.actionType),
        ConnectionDirection = tostring(ParsedJson.service.action.networkConnectionAction.connectionDirection)
    | project TimeGenerated, FindingId, AccountId, Region, Severity, Type, 
              CreatedAt, UpdatedAt, Title, Description, Service, ResourceType, 
              InstanceId, RemoteIpCountry, RemoteIpAddress, ActionType, 
              ConnectionDirection, RawJson
  EOT

  # High severity findings KQL
  guardduty_high_severity_kql = <<-EOT
    GuardDutyNormalized
    | where Severity >= 7.0
    | where TimeGenerated >= ago(24h)
    | summarize Count = count() by Type, AccountId, Region, bin(TimeGenerated, 1h)
    | order by TimeGenerated desc
  EOT
}