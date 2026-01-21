# Microsoft Sentinel Analytics for GuardDuty Integration
# This module creates Sentinel analytics rules, workbooks, and incident response automation

terraform {
  required_version = ">= 1.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

# Data sources
data "azurerm_log_analytics_workspace" "main" {
  name                = var.log_analytics_workspace_name
  resource_group_name = var.resource_group_name
}

# Enable Microsoft Sentinel on the workspace
resource "azurerm_sentinel_log_analytics_workspace_onboarding" "main" {
  count                        = var.enable_sentinel ? 1 : 0
  workspace_id                 = data.azurerm_log_analytics_workspace.main.id
  customer_managed_key_enabled = var.sentinel_customer_managed_key_enabled
}

# Action Group for incident notifications
resource "azurerm_monitor_action_group" "guardduty_incidents" {
  name                = "${var.name_prefix}-guardduty-incidents"
  resource_group_name = var.resource_group_name
  short_name          = "GDIncidents"

  dynamic "email_receiver" {
    for_each = var.notification_emails
    content {
      name          = "email-${email_receiver.key}"
      email_address = email_receiver.value
    }
  }

  dynamic "webhook_receiver" {
    for_each = var.notification_webhooks
    content {
      name        = "webhook-${webhook_receiver.key}"
      service_uri = webhook_receiver.value
    }
  }

  tags = var.tags
}

# Scheduled Analytics Rule: High Severity GuardDuty Findings
resource "azurerm_sentinel_alert_rule_scheduled" "high_severity_findings" {
  count                      = var.create_analytics_rules ? 1 : 0
  name                       = "GuardDuty High Severity Findings"
  log_analytics_workspace_id = data.azurerm_log_analytics_workspace.main.id
  display_name               = "GuardDuty High Severity Findings"
  description                = "Detects high severity (7.0+) GuardDuty findings that require immediate attention"
  severity                   = "High"
  enabled                    = true

  query = <<-EOT
    let lookbackTime = 1h;
    RawGuardDuty_CL
    | where TimeGenerated >= ago(lookbackTime)
    | where Severity >= 7.0
    | extend ParsedJson = parse_json(RawJson)
    | extend 
        CreatedAt = todatetime(ParsedJson.createdAt),
        Title = tostring(ParsedJson.title),
        Description = tostring(ParsedJson.description),
        Service = tostring(ParsedJson.service.serviceName),
        ResourceType = tostring(ParsedJson.resource.resourceType),
        InstanceId = tostring(ParsedJson.resource.instanceDetails.instanceId),
        RemoteIpAddress = tostring(ParsedJson.service.remoteIpDetails.ipAddressV4),
        RemoteIpCountry = tostring(ParsedJson.service.remoteIpDetails.country.countryName)
    | project TimeGenerated, FindingId, AccountId, Region, Severity, Type, 
              CreatedAt, Title, Description, Service, ResourceType, 
              InstanceId, RemoteIpAddress, RemoteIpCountry, RawJson
    | summarize 
        Count = count(),
        FirstSeen = min(TimeGenerated),
        LastSeen = max(TimeGenerated),
        FindingIds = make_set(FindingId),
        Titles = make_set(Title)
      by AccountId, Region, Type, Severity
  EOT

  query_frequency   = "PT1H"
  query_period      = "PT1H"
  trigger_operator  = "GreaterThan"
  trigger_threshold = 0

  entity_mapping {
    entity_type = "Account"
    field_mapping {
      identifier = "Name"
      column_name = "AccountId"
    }
  }

  entity_mapping {
    entity_type = "IP"
    field_mapping {
      identifier = "Address"
      column_name = "RemoteIpAddress"
    }
  }

  incident_configuration {
    create_incident = true
    grouping {
      enabled                 = true
      lookback_duration       = "PT6H"
      reopen_closed_incidents = false
      entity_matching_method  = "Selected"
      group_by_entities       = ["Account", "IP"]
      group_by_alert_details  = ["DisplayName"]
      group_by_custom_details = []
    }
  }

  alert_details_override {
    display_name_format   = "GuardDuty High Severity: {{Type}} in {{AccountId}}"
    description_format    = "High severity GuardDuty finding detected: {{Count}} findings of type {{Type}} in account {{AccountId}} ({{Region}})"
    severity_column_name  = "Severity"
    tactics_column_name   = ""
  }

  depends_on = [azurerm_sentinel_log_analytics_workspace_onboarding.main]
}

# Scheduled Analytics Rule: Cryptocurrency Mining Detection
resource "azurerm_sentinel_alert_rule_scheduled" "cryptocurrency_mining" {
  count                      = var.create_analytics_rules ? 1 : 0
  name                       = "GuardDuty Cryptocurrency Mining Detection"
  log_analytics_workspace_id = data.azurerm_log_analytics_workspace.main.id
  display_name               = "GuardDuty Cryptocurrency Mining Detection"
  description                = "Detects cryptocurrency mining activities reported by GuardDuty"
  severity                   = "Medium"
  enabled                    = true

  query = <<-EOT
    let lookbackTime = 4h;
    RawGuardDuty_CL
    | where TimeGenerated >= ago(lookbackTime)
    | where Type contains "CryptoCurrency"
    | extend ParsedJson = parse_json(RawJson)
    | extend 
        Title = tostring(ParsedJson.title),
        Description = tostring(ParsedJson.description),
        InstanceId = tostring(ParsedJson.resource.instanceDetails.instanceId),
        RemoteIpAddress = tostring(ParsedJson.service.remoteIpDetails.ipAddressV4)
    | summarize 
        Count = count(),
        FirstSeen = min(TimeGenerated),
        LastSeen = max(TimeGenerated),
        FindingIds = make_set(FindingId)
      by AccountId, Region, InstanceId, RemoteIpAddress
  EOT

  query_frequency   = "PT4H"
  query_period      = "PT4H"
  trigger_operator  = "GreaterThan"
  trigger_threshold = 0

  entity_mapping {
    entity_type = "Host"
    field_mapping {
      identifier = "HostName"
      column_name = "InstanceId"
    }
  }

  incident_configuration {
    create_incident = true
  }

  depends_on = [azurerm_sentinel_log_analytics_workspace_onboarding.main]
}

# Scheduled Analytics Rule: Data Exfiltration Detection
resource "azurerm_sentinel_alert_rule_scheduled" "data_exfiltration" {
  count                      = var.create_analytics_rules ? 1 : 0
  name                       = "GuardDuty Data Exfiltration Detection"
  log_analytics_workspace_id = data.azurerm_log_analytics_workspace.main.id
  display_name               = "GuardDuty Data Exfiltration Detection"
  description                = "Detects potential data exfiltration activities reported by GuardDuty"
  severity                   = "High"
  enabled                    = true

  query = <<-EOT
    let lookbackTime = 2h;
    RawGuardDuty_CL
    | where TimeGenerated >= ago(lookbackTime)
    | where Type contains "Exfiltration" or Type contains "DNSDataExfiltration"
    | extend ParsedJson = parse_json(RawJson)
    | extend 
        Title = tostring(ParsedJson.title),
        Description = tostring(ParsedJson.description),
        InstanceId = tostring(ParsedJson.resource.instanceDetails.instanceId),
        RemoteIpAddress = tostring(ParsedJson.service.remoteIpDetails.ipAddressV4),
        RemoteIpCountry = tostring(ParsedJson.service.remoteIpDetails.country.countryName)
    | summarize 
        Count = count(),
        FirstSeen = min(TimeGenerated),
        LastSeen = max(TimeGenerated),
        FindingIds = make_set(FindingId),
        RemoteCountries = make_set(RemoteIpCountry)
      by AccountId, Region, InstanceId, Type
  EOT

  query_frequency   = "PT2H"
  query_period      = "PT2H"
  trigger_operator  = "GreaterThan"
  trigger_threshold = 0

  entity_mapping {
    entity_type = "Host"
    field_mapping {
      identifier = "HostName"
      column_name = "InstanceId"
    }
  }

  incident_configuration {
    create_incident = true
  }

  depends_on = [azurerm_sentinel_log_analytics_workspace_onboarding.main]
}

# Scheduled Analytics Rule: Malware and Backdoor Detection
resource "azurerm_sentinel_alert_rule_scheduled" "malware_backdoor" {
  count                      = var.create_analytics_rules ? 1 : 0
  name                       = "GuardDuty Malware and Backdoor Detection"
  log_analytics_workspace_id = data.azurerm_log_analytics_workspace.main.id
  display_name               = "GuardDuty Malware and Backdoor Detection"
  description                = "Detects malware and backdoor activities reported by GuardDuty"
  severity                   = "High"
  enabled                    = true

  query = <<-EOT
    let lookbackTime = 1h;
    RawGuardDuty_CL
    | where TimeGenerated >= ago(lookbackTime)
    | where Type contains "Backdoor" or Type contains "Trojan" or Type contains "Malware"
    | extend ParsedJson = parse_json(RawJson)
    | extend 
        Title = tostring(ParsedJson.title),
        Description = tostring(ParsedJson.description),
        InstanceId = tostring(ParsedJson.resource.instanceDetails.instanceId),
        RemoteIpAddress = tostring(ParsedJson.service.remoteIpDetails.ipAddressV4)
    | summarize 
        Count = count(),
        FirstSeen = min(TimeGenerated),
        LastSeen = max(TimeGenerated),
        FindingIds = make_set(FindingId),
        MalwareTypes = make_set(Type)
      by AccountId, Region, InstanceId
  EOT

  query_frequency   = "PT1H"
  query_period      = "PT1H"
  trigger_operator  = "GreaterThan"
  trigger_threshold = 0

  entity_mapping {
    entity_type = "Host"
    field_mapping {
      identifier = "HostName"
      column_name = "InstanceId"
    }
  }

  incident_configuration {
    create_incident = true
  }

  depends_on = [azurerm_sentinel_log_analytics_workspace_onboarding.main]
}

# Workbook: GuardDuty Overview
resource "azurerm_sentinel_workbook" "guardduty_overview" {
  count                      = var.create_workbooks ? 1 : 0
  name                       = "${var.name_prefix}-guardduty-overview"
  resource_group_name        = var.resource_group_name
  log_analytics_workspace_id = data.azurerm_log_analytics_workspace.main.id
  display_name               = "GuardDuty Overview"
  description                = "Overview dashboard for GuardDuty findings and trends"

  template_content = jsonencode({
    version = "Notebook/1.0"
    items = [
      {
        type = 1
        content = {
          json = "# GuardDuty Overview Dashboard\n\nThis workbook provides an overview of AWS GuardDuty findings ingested into Azure Sentinel."
        }
      },
      {
        type = 3
        content = {
          version = "KqlItem/1.0"
          query = "RawGuardDuty_CL | where TimeGenerated >= ago(24h) | summarize Count = count() by bin(TimeGenerated, 1h) | render timechart"
          size = 0
          title = "GuardDuty Findings Over Time (24h)"
          timeContext = {
            durationMs = 86400000
          }
        }
      },
      {
        type = 3
        content = {
          version = "KqlItem/1.0"
          query = "RawGuardDuty_CL | where TimeGenerated >= ago(24h) | summarize Count = count() by Severity | render piechart"
          size = 1
          title = "Findings by Severity"
        }
      },
      {
        type = 3
        content = {
          version = "KqlItem/1.0"
          query = "RawGuardDuty_CL | where TimeGenerated >= ago(24h) | summarize Count = count() by Type | top 10 by Count | render barchart"
          size = 0
          title = "Top 10 Finding Types"
        }
      }
    ]
  })

  depends_on = [azurerm_sentinel_log_analytics_workspace_onboarding.main]
}

# Workbook: GuardDuty Threat Hunting
resource "azurerm_sentinel_workbook" "guardduty_threat_hunting" {
  count                      = var.create_workbooks ? 1 : 0
  name                       = "${var.name_prefix}-guardduty-threat-hunting"
  resource_group_name        = var.resource_group_name
  log_analytics_workspace_id = data.azurerm_log_analytics_workspace.main.id
  display_name               = "GuardDuty Threat Hunting"
  description                = "Advanced threat hunting queries for GuardDuty findings"

  template_content = jsonencode({
    version = "Notebook/1.0"
    items = [
      {
        type = 1
        content = {
          json = "# GuardDuty Threat Hunting\n\nAdvanced queries for threat hunting and investigation using GuardDuty findings."
        }
      },
      {
        type = 3
        content = {
          version = "KqlItem/1.0"
          query = "RawGuardDuty_CL | where Severity >= 7.0 | extend ParsedJson = parse_json(RawJson) | extend RemoteIp = tostring(ParsedJson.service.remoteIpDetails.ipAddressV4) | where isnotempty(RemoteIp) | summarize Count = count() by RemoteIp | top 20 by Count"
          size = 0
          title = "Top Remote IPs in High Severity Findings"
        }
      },
      {
        type = 3
        content = {
          version = "KqlItem/1.0"
          query = "RawGuardDuty_CL | extend ParsedJson = parse_json(RawJson) | extend Country = tostring(ParsedJson.service.remoteIpDetails.country.countryName) | where isnotempty(Country) | summarize Count = count() by Country | top 15 by Count"
          size = 1
          title = "Findings by Country"
        }
      }
    ]
  })

  depends_on = [azurerm_sentinel_log_analytics_workspace_onboarding.main]
}

# Automation Rule for High Severity Incidents
resource "azurerm_sentinel_automation_rule" "high_severity_auto_assign" {
  count                      = var.create_automation_rules ? 1 : 0
  name                       = "GuardDuty High Severity Auto Assignment"
  log_analytics_workspace_id = data.azurerm_log_analytics_workspace.main.id
  display_name               = "GuardDuty High Severity Auto Assignment"
  order                      = 1
  enabled                    = true

  condition {
    property = "IncidentSeverity"
    operator = "Equals"
    values   = ["High"]
  }

  condition {
    property = "IncidentTitle"
    operator = "Contains"
    values   = ["GuardDuty"]
  }

  action_incident {
    order  = 1
    status = "Active"
    classification = "Undetermined"
    owner_id = var.default_incident_owner_id
  }

  depends_on = [azurerm_sentinel_log_analytics_workspace_onboarding.main]
}