# Microsoft Sentinel Analytics Module

This Terraform module creates Microsoft Sentinel analytics rules, workbooks, and incident response automation for GuardDuty findings.

## Resources Created

- **Sentinel Workspace Onboarding**: Enables Microsoft Sentinel on Log Analytics workspace
- **Action Group**: Notification configuration for incidents and alerts
- **Scheduled Analytics Rules**: Automated detection rules for GuardDuty findings
  - High Severity Findings Detection
  - Cryptocurrency Mining Detection
  - Data Exfiltration Detection
  - Malware and Backdoor Detection
- **Workbooks**: Interactive dashboards for GuardDuty data visualization
  - GuardDuty Overview Dashboard
  - GuardDuty Threat Hunting Workbook
- **Automation Rules**: Automated incident management and assignment

## Requirements

| Name | Version |
|------|---------|
| terraform | >= 1.0 |
| azurerm | ~> 3.0 |

## Prerequisites

- Log Analytics workspace with GuardDuty data ingestion configured
- RawGuardDuty_CL table with GuardDuty findings data
- Appropriate permissions to create Sentinel resources

## Usage

```hcl
module "guardduty_sentinel" {
  source = "./infra/sentinel"

  resource_group_name          = "rg-guardduty-sentinel"
  log_analytics_workspace_name = "law-guardduty-sentinel"
  name_prefix                  = "my-guardduty"
  
  # Sentinel Configuration
  enable_sentinel = true
  sentinel_customer_managed_key_enabled = false
  
  # Analytics Rules
  create_analytics_rules = true
  high_severity_threshold = 7.0
  
  # Workbooks and Automation
  create_workbooks = true
  create_automation_rules = true
  default_incident_owner_id = "user-or-group-object-id"
  
  # Notifications
  notification_emails = [
    "security-team@company.com",
    "soc@company.com"
  ]
  
  notification_webhooks = [
    "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"
  ]
  
  # Custom Analytics Rule Frequencies
  analytics_rule_frequencies = {
    high_severity_findings = "PT30M"  # Every 30 minutes
    cryptocurrency_mining  = "PT2H"   # Every 2 hours
  }
  
  tags = {
    Environment = "production"
    Project     = "security-integration"
  }
}
```

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|:--------:|
| resource_group_name | Name of the resource group | `string` | n/a | yes |
| log_analytics_workspace_name | Name of the Log Analytics workspace | `string` | n/a | yes |
| name_prefix | Prefix for resource names | `string` | `"guardduty-sentinel"` | no |
| tags | Tags to apply to all resources | `map(string)` | `{}` | no |
| enable_sentinel | Enable Microsoft Sentinel | `bool` | `true` | no |
| sentinel_customer_managed_key_enabled | Enable customer-managed key encryption | `bool` | `false` | no |
| create_analytics_rules | Create scheduled analytics rules | `bool` | `true` | no |
| create_workbooks | Create Sentinel workbooks | `bool` | `true` | no |
| create_automation_rules | Create automation rules | `bool` | `true` | no |
| default_incident_owner_id | Default owner for auto-assigned incidents | `string` | `""` | no |
| notification_emails | Email addresses for notifications | `list(string)` | `[]` | no |
| notification_webhooks | Webhook URLs for notifications | `list(string)` | `[]` | no |
| high_severity_threshold | Severity threshold for high severity rule | `number` | `7.0` | no |
| analytics_rule_frequencies | Custom frequencies for analytics rules | `object` | `{}` | no |
| incident_grouping_enabled | Enable incident grouping | `bool` | `true` | no |
| incident_grouping_lookback_duration | Lookback duration for grouping | `string` | `"PT6H"` | no |
| custom_analytics_rules | Custom analytics rules to create | `list(object)` | `[]` | no |

## Outputs

| Name | Description |
|------|-------------|
| sentinel_workspace_id | ID of the Sentinel-enabled workspace |
| action_group_id | ID of the action group |
| action_group_name | Name of the action group |
| analytics_rules | Information about created analytics rules |
| workbooks | Information about created workbooks |
| automation_rules | Information about created automation rules |
| sentinel_configuration | Summary of Sentinel configuration |
| resource_urls | URLs for accessing Sentinel resources |

## Analytics Rules

### High Severity Findings Detection
- **Purpose**: Detects GuardDuty findings with severity >= 7.0
- **Frequency**: Every 1 hour (configurable)
- **Entities**: Account, IP Address
- **Incident Creation**: Enabled with grouping by account and IP

### Cryptocurrency Mining Detection
- **Purpose**: Detects cryptocurrency mining activities
- **Frequency**: Every 4 hours (configurable)
- **Entities**: Host
- **Filters**: Finding types containing "CryptoCurrency"

### Data Exfiltration Detection
- **Purpose**: Detects potential data exfiltration
- **Frequency**: Every 2 hours (configurable)
- **Entities**: Host
- **Filters**: Finding types containing "Exfiltration" or "DNSDataExfiltration"

### Malware and Backdoor Detection
- **Purpose**: Detects malware and backdoor activities
- **Frequency**: Every 1 hour (configurable)
- **Entities**: Host
- **Filters**: Finding types containing "Backdoor", "Trojan", or "Malware"

## Workbooks

### GuardDuty Overview Dashboard
Provides high-level visibility into GuardDuty findings:
- Findings over time (24-hour trend)
- Distribution by severity
- Top 10 finding types
- Summary statistics

### GuardDuty Threat Hunting Workbook
Advanced queries for threat hunting:
- Top remote IPs in high-severity findings
- Geographic distribution of threats
- Temporal analysis of attack patterns
- Custom investigation queries

## Automation Rules

### High Severity Auto Assignment
- Automatically assigns high-severity GuardDuty incidents
- Sets status to "Active" and classification to "Undetermined"
- Assigns to specified default owner
- Triggers on incidents with "GuardDuty" in title and "High" severity

## Custom Analytics Rules

You can create additional custom analytics rules:

```hcl
custom_analytics_rules = [
  {
    name         = "GuardDuty Custom Rule"
    display_name = "Custom GuardDuty Detection"
    description  = "Custom detection logic for specific use case"
    severity     = "Medium"
    query        = "RawGuardDuty_CL | where ..."
    frequency    = "PT2H"
    period       = "PT2H"
    threshold    = 1
    enabled      = true
  }
]
```

## Notification Configuration

Configure multiple notification channels:

```hcl
# Email notifications
notification_emails = [
  "security-team@company.com",
  "soc-analyst@company.com"
]

# Webhook notifications (Slack, Teams, etc.)
notification_webhooks = [
  "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK",
  "https://outlook.office.com/webhook/YOUR/TEAMS/WEBHOOK"
]
```

## Monitoring and Maintenance

### Regular Tasks
1. **Review Analytics Rules**: Adjust thresholds and frequencies based on alert volume
2. **Update Workbooks**: Add new visualizations as requirements evolve
3. **Monitor Incident Volume**: Ensure incident grouping is working effectively
4. **Validate Notifications**: Test email and webhook delivery regularly

### Performance Tuning
- Adjust query frequencies based on data volume and urgency requirements
- Optimize KQL queries for better performance
- Configure incident grouping to reduce noise
- Set appropriate severity thresholds to balance detection and false positives

### Troubleshooting

Common issues and solutions:

1. **No Incidents Generated**: 
   - Verify GuardDuty data is flowing to RawGuardDuty_CL table
   - Check analytics rule queries and thresholds
   - Ensure Sentinel is properly enabled

2. **Too Many False Positives**:
   - Increase severity thresholds
   - Refine KQL queries with additional filters
   - Adjust incident grouping settings

3. **Missing Notifications**:
   - Verify action group configuration
   - Check email addresses and webhook URLs
   - Test action group manually

4. **Performance Issues**:
   - Optimize KQL queries with proper indexing
   - Reduce query frequency for non-critical rules
   - Use summarization to reduce data volume

## Integration with SOAR

This module creates the foundation for Security Orchestration, Automation, and Response (SOAR) integration:

- **Logic Apps**: Use the action group to trigger Logic Apps for automated response
- **Azure Functions**: Integrate with Azure Functions for custom response actions
- **Third-party SOAR**: Configure webhooks to integrate with external SOAR platforms
- **Playbooks**: Create Sentinel playbooks for standardized incident response

## Security Considerations

1. **Access Control**: Ensure proper RBAC for Sentinel resources
2. **Data Retention**: Configure appropriate retention policies for compliance
3. **Encryption**: Enable customer-managed keys if required
4. **Network Security**: Restrict access to Sentinel workspace as needed
5. **Audit Logging**: Enable diagnostic settings for audit trails