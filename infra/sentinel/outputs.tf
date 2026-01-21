# Outputs for Microsoft Sentinel GuardDuty Analytics

output "sentinel_workspace_id" {
  description = "ID of the Sentinel-enabled Log Analytics workspace"
  value       = var.enable_sentinel ? azurerm_sentinel_log_analytics_workspace_onboarding.main[0].workspace_id : null
}

output "action_group_id" {
  description = "ID of the action group for incident notifications"
  value       = azurerm_monitor_action_group.guardduty_incidents.id
}

output "action_group_name" {
  description = "Name of the action group for incident notifications"
  value       = azurerm_monitor_action_group.guardduty_incidents.name
}

# Analytics Rules
output "analytics_rules" {
  description = "Information about created analytics rules"
  value = var.create_analytics_rules ? {
    high_severity_findings = {
      id   = azurerm_sentinel_alert_rule_scheduled.high_severity_findings[0].id
      name = azurerm_sentinel_alert_rule_scheduled.high_severity_findings[0].name
    }
    cryptocurrency_mining = {
      id   = azurerm_sentinel_alert_rule_scheduled.cryptocurrency_mining[0].id
      name = azurerm_sentinel_alert_rule_scheduled.cryptocurrency_mining[0].name
    }
    data_exfiltration = {
      id   = azurerm_sentinel_alert_rule_scheduled.data_exfiltration[0].id
      name = azurerm_sentinel_alert_rule_scheduled.data_exfiltration[0].name
    }
    malware_backdoor = {
      id   = azurerm_sentinel_alert_rule_scheduled.malware_backdoor[0].id
      name = azurerm_sentinel_alert_rule_scheduled.malware_backdoor[0].name
    }
  } : {}
}

# Workbooks
output "workbooks" {
  description = "Information about created workbooks"
  value = var.create_workbooks ? {
    guardduty_overview = {
      id   = azurerm_sentinel_workbook.guardduty_overview[0].id
      name = azurerm_sentinel_workbook.guardduty_overview[0].name
    }
    guardduty_threat_hunting = {
      id   = azurerm_sentinel_workbook.guardduty_threat_hunting[0].id
      name = azurerm_sentinel_workbook.guardduty_threat_hunting[0].name
    }
  } : {}
}

# Automation Rules
output "automation_rules" {
  description = "Information about created automation rules"
  value = var.create_automation_rules ? {
    high_severity_auto_assign = {
      id   = azurerm_sentinel_automation_rule.high_severity_auto_assign[0].id
      name = azurerm_sentinel_automation_rule.high_severity_auto_assign[0].name
    }
  } : {}
}

# Configuration Summary
output "sentinel_configuration" {
  description = "Summary of Sentinel configuration"
  value = {
    sentinel_enabled        = var.enable_sentinel
    analytics_rules_count   = var.create_analytics_rules ? 4 : 0
    workbooks_count        = var.create_workbooks ? 2 : 0
    automation_rules_count = var.create_automation_rules ? 1 : 0
    notification_emails    = length(var.notification_emails)
    notification_webhooks  = length(var.notification_webhooks)
  }
}

# URLs for accessing resources
output "resource_urls" {
  description = "URLs for accessing Sentinel resources"
  value = var.enable_sentinel ? {
    sentinel_workspace = "https://portal.azure.com/#@${data.azurerm_log_analytics_workspace.main.workspace_id}/resource${data.azurerm_log_analytics_workspace.main.id}/overview"
    analytics_rules    = "https://portal.azure.com/#@${data.azurerm_log_analytics_workspace.main.workspace_id}/resource${data.azurerm_log_analytics_workspace.main.id}/analytics"
    workbooks         = "https://portal.azure.com/#@${data.azurerm_log_analytics_workspace.main.workspace_id}/resource${data.azurerm_log_analytics_workspace.main.id}/workbooks"
    incidents         = "https://portal.azure.com/#@${data.azurerm_log_analytics_workspace.main.workspace_id}/resource${data.azurerm_log_analytics_workspace.main.id}/incidents"
  } : {}
}