# Azure Infrastructure Module

This Terraform module creates the necessary Azure infrastructure for the GuardDuty to Sentinel integration.

## Resources Created

- **Resource Group**: Container for all Azure resources (optional)
- **Log Analytics Workspace**: Central workspace for log ingestion and analysis
- **Data Collection Endpoint (DCE)**: Modern ingestion endpoint for Azure Monitor
- **Data Collection Rule (DCR)**: Configuration for data ingestion and transformation
- **Service Principal**: Authentication identity for ingestion workers
- **RBAC Assignments**: Permissions for data ingestion
- **KQL Functions**: Saved queries for data normalization and analysis (optional)
- **Application Insights**: Monitoring and telemetry (optional)

## Requirements

| Name | Version |
|------|---------|
| terraform | >= 1.0 |
| azurerm | ~> 3.0 |
| azuread | ~> 2.0 |

## Usage

```hcl
module "guardduty_azure" {
  source = "./infra/azure"

  name_prefix = "my-guardduty-integration"
  location    = "East US"
  
  # Resource Group
  create_resource_group = true
  resource_group_name   = "rg-guardduty-sentinel"
  
  # Log Analytics
  log_analytics_workspace_name = "law-guardduty-sentinel"
  log_analytics_retention_days = 90
  
  # Data Collection
  enable_data_transformation = false
  dce_public_network_access_enabled = true
  
  # Optional Features
  create_kql_functions = true
  create_application_insights = false
  grant_log_analytics_access = false
  
  tags = {
    Environment = "production"
    Project     = "security-integration"
  }
}
```

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|:--------:|
| name_prefix | Prefix for resource names | `string` | `"guardduty-sentinel"` | no |
| location | Azure region for resources | `string` | `"East US"` | no |
| tags | Tags to apply to all resources | `map(string)` | `{}` | no |
| create_resource_group | Whether to create a new resource group | `bool` | `true` | no |
| resource_group_name | Name of the resource group | `string` | `"rg-guardduty-sentinel"` | no |
| log_analytics_workspace_name | Name of the Log Analytics workspace | `string` | `"law-guardduty-sentinel"` | no |
| log_analytics_sku | SKU for Log Analytics workspace | `string` | `"PerGB2018"` | no |
| log_analytics_retention_days | Log Analytics retention in days | `number` | `30` | no |
| dce_public_network_access_enabled | Enable public network access for DCE | `bool` | `true` | no |
| enable_data_transformation | Enable KQL transformation in DCR | `bool` | `false` | no |
| grant_log_analytics_access | Grant Log Analytics Contributor access | `bool` | `false` | no |
| create_kql_functions | Create saved KQL functions | `bool` | `true` | no |
| create_application_insights | Create Application Insights | `bool` | `false` | no |
| enable_sentinel | Enable Microsoft Sentinel | `bool` | `false` | no |
| sentinel_daily_quota_gb | Daily quota for Sentinel in GB | `number` | `-1` | no |

## Outputs

| Name | Description |
|------|-------------|
| resource_group_name | Name of the resource group |
| resource_group_id | ID of the resource group |
| log_analytics_workspace_id | ID of the Log Analytics workspace |
| log_analytics_workspace_name | Name of the Log Analytics workspace |
| log_analytics_workspace_key | Primary shared key (sensitive) |
| data_collection_endpoint_id | ID of the Data Collection Endpoint |
| data_collection_endpoint_logs_ingestion_uri | Logs ingestion URI |
| data_collection_rule_id | ID of the Data Collection Rule |
| data_collection_rule_immutable_id | Immutable ID of the DCR |
| service_principal_application_id | Application ID of the service principal |
| service_principal_object_id | Object ID of the service principal |
| service_principal_client_secret | Client secret (sensitive) |
| worker_configuration | Configuration object for ingestion workers |
| sensitive_worker_configuration | Sensitive configuration (sensitive) |
| kql_functions | Names of created KQL functions |

## Data Collection Architecture

This module implements Azure's modern Logs Ingestion API pattern:

1. **Data Collection Endpoint (DCE)**: Provides the ingestion endpoint URL
2. **Data Collection Rule (DCR)**: Defines data schema, transformation, and destination
3. **Service Principal**: Authenticates ingestion requests with "Monitoring Metrics Publisher" role
4. **Log Analytics Workspace**: Stores ingested data in `RawGuardDuty_CL` table

### Data Schema

The DCR defines the following schema for GuardDuty findings:

```json
{
  "TimeGenerated": "datetime",
  "FindingId": "string",
  "AccountId": "string", 
  "Region": "string",
  "Severity": "real",
  "Type": "string",
  "RawJson": "string"
}
```

### KQL Functions

When `create_kql_functions = true`, the module creates:

- **GuardDutyNormalized**: Parses raw JSON and extracts common fields
- **GuardDutyHighSeverity**: Filters high-severity findings from the last 24 hours

## Security Considerations

1. **Authentication**: Service principal with minimal required permissions
2. **Network Access**: Configurable public/private endpoint access
3. **Data Encryption**: All data encrypted in transit and at rest
4. **RBAC**: Principle of least privilege for service principal permissions
5. **Secrets Management**: Client secrets marked as sensitive in Terraform state

## Manual Setup Alternative

If you prefer not to use Terraform, you can manually create these resources using the Azure CLI or Portal. See the `samples/deployment/azure-setup.md` file for manual setup instructions.

## Validation

After deployment, validate the setup:

1. Test data ingestion endpoint connectivity
2. Verify service principal permissions
3. Check Log Analytics workspace configuration
4. Test KQL functions (if created)

```bash
# Test DCE connectivity
curl -H "Authorization: Bearer <token>" \
     "<dce-logs-ingestion-uri>/dataCollectionRules/<dcr-immutable-id>/streams/Custom-GuardDutyFindings?api-version=2021-11-01-preview"

# Query Log Analytics workspace
az monitor log-analytics query \
  --workspace "<workspace-id>" \
  --analytics-query "RawGuardDuty_CL | take 10"
```

## Integration with Sentinel

To enable Microsoft Sentinel:

1. Set `enable_sentinel = true` in the module configuration
2. Configure Sentinel analytics rules using the separate Sentinel module
3. Use the created KQL functions in your analytics rules

## Troubleshooting

Common issues and solutions:

1. **Permission Errors**: Ensure service principal has "Monitoring Metrics Publisher" role
2. **Network Connectivity**: Check DCE public access settings and firewall rules
3. **Schema Validation**: Verify data matches the DCR stream declaration
4. **Authentication**: Confirm client ID and secret are correct

For detailed troubleshooting, check the Application Insights logs (if enabled) or Azure Monitor diagnostic settings.