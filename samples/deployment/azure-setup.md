# Azure Manual Setup Guide

This guide walks you through manually setting up Azure resources for the GuardDuty to Sentinel integration.

## Overview

You'll create and configure:
1. Log Analytics workspace for data storage
2. Data Collection Rule (DCR) for data ingestion
3. Service principal for authentication
4. Sentinel workspace and analytics rules
5. KQL parser functions for data normalization

## Prerequisites

- Azure CLI installed and authenticated
- PowerShell 7+ with Azure PowerShell module
- Appropriate Azure permissions (see main README)

## Step 1: Set Up Variables

```bash
# Set your Azure configuration
export SUBSCRIPTION_ID="your-subscription-id"
export RESOURCE_GROUP="guardduty-sentinel-rg"
export LOCATION="eastus"
export WORKSPACE_NAME="guardduty-sentinel-workspace"
export DCR_NAME="guardduty-dcr"
export SERVICE_PRINCIPAL_NAME="guardduty-sentinel-sp"

# Login to Azure
az login
az account set --subscription $SUBSCRIPTION_ID
```

## Step 2: Create Resource Group

```bash
# Create resource group
az group create \
    --name $RESOURCE_GROUP \
    --location $LOCATION

echo "Resource group created: $RESOURCE_GROUP"
```

## Step 3: Create Log Analytics Workspace

```bash
# Create Log Analytics workspace
az monitor log-analytics workspace create \
    --resource-group $RESOURCE_GROUP \
    --workspace-name $WORKSPACE_NAME \
    --location $LOCATION \
    --sku PerGB2018

# Get workspace details
export WORKSPACE_ID=$(az monitor log-analytics workspace show \
    --resource-group $RESOURCE_GROUP \
    --workspace-name $WORKSPACE_NAME \
    --query customerId \
    --output tsv)

export WORKSPACE_RESOURCE_ID=$(az monitor log-analytics workspace show \
    --resource-group $RESOURCE_GROUP \
    --workspace-name $WORKSPACE_NAME \
    --query id \
    --output tsv)

echo "Workspace ID: $WORKSPACE_ID"
echo "Workspace Resource ID: $WORKSPACE_RESOURCE_ID"
```

## Step 4: Create Data Collection Rule (DCR)

### Create DCR Configuration

```bash
# Create DCR configuration file
cat > dcr-config.json << 'EOF'
{
    "location": "LOCATION",
    "kind": "Direct",
    "properties": {
        "streamDeclarations": {
            "Custom-GuardDutyFindings": {
                "columns": [
                    {
                        "name": "TimeGenerated",
                        "type": "datetime"
                    },
                    {
                        "name": "FindingId",
                        "type": "string"
                    },
                    {
                        "name": "AccountId",
                        "type": "string"
                    },
                    {
                        "name": "Region",
                        "type": "string"
                    },
                    {
                        "name": "Severity",
                        "type": "real"
                    },
                    {
                        "name": "Type",
                        "type": "string"
                    },
                    {
                        "name": "Title",
                        "type": "string"
                    },
                    {
                        "name": "Description",
                        "type": "string"
                    },
                    {
                        "name": "Service",
                        "type": "string"
                    },
                    {
                        "name": "ResourceType",
                        "type": "string"
                    },
                    {
                        "name": "InstanceId",
                        "type": "string"
                    },
                    {
                        "name": "RemoteIpAddress",
                        "type": "string"
                    },
                    {
                        "name": "RemoteIpCountry",
                        "type": "string"
                    },
                    {
                        "name": "RawJson",
                        "type": "string"
                    }
                ]
            }
        },
        "destinations": {
            "logAnalytics": [
                {
                    "workspaceResourceId": "WORKSPACE_RESOURCE_ID",
                    "name": "LogAnalyticsDest"
                }
            ]
        },
        "dataFlows": [
            {
                "streams": [
                    "Custom-GuardDutyFindings"
                ],
                "destinations": [
                    "LogAnalyticsDest"
                ],
                "transformKql": "source | extend TimeGenerated = now()",
                "outputStream": "Custom-RawGuardDuty_CL"
            }
        ]
    }
}
EOF

# Replace placeholders
sed -i "s/LOCATION/$LOCATION/g" dcr-config.json
sed -i "s|WORKSPACE_RESOURCE_ID|$WORKSPACE_RESOURCE_ID|g" dcr-config.json

# Create DCR
az monitor data-collection rule create \
    --resource-group $RESOURCE_GROUP \
    --name $DCR_NAME \
    --rule-file dcr-config.json

# Get DCR details
export DCR_IMMUTABLE_ID=$(az monitor data-collection rule show \
    --resource-group $RESOURCE_GROUP \
    --name $DCR_NAME \
    --query immutableId \
    --output tsv)

export DCR_ENDPOINT=$(az monitor data-collection rule show \
    --resource-group $RESOURCE_GROUP \
    --name $DCR_NAME \
    --query 'properties.endpoints.logsIngestion[0]' \
    --output tsv)

echo "DCR Immutable ID: $DCR_IMMUTABLE_ID"
echo "DCR Endpoint: $DCR_ENDPOINT"
```

## Step 5: Create Service Principal

```bash
# Create service principal
az ad sp create-for-rbac \
    --name $SERVICE_PRINCIPAL_NAME \
    --role "Monitoring Metrics Publisher" \
    --scopes $WORKSPACE_RESOURCE_ID \
    --output json > service-principal.json

# Extract service principal details
export CLIENT_ID=$(cat service-principal.json | jq -r '.appId')
export CLIENT_SECRET=$(cat service-principal.json | jq -r '.password')
export TENANT_ID=$(cat service-principal.json | jq -r '.tenant')

echo "Service Principal Client ID: $CLIENT_ID"
echo "Tenant ID: $TENANT_ID"
echo "Client Secret: [HIDDEN]"

# Also assign DCR permissions
az role assignment create \
    --assignee $CLIENT_ID \
    --role "Monitoring Metrics Publisher" \
    --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Insights/dataCollectionRules/$DCR_NAME"
```

## Step 6: Enable Sentinel (Optional)

If you want to use Azure Sentinel for analytics and incident management:

```bash
# Enable Sentinel on the workspace
az sentinel workspace create \
    --resource-group $RESOURCE_GROUP \
    --workspace-name $WORKSPACE_NAME

echo "Sentinel enabled on workspace: $WORKSPACE_NAME"
```

## Step 7: Create KQL Parser Function

Create a KQL function to normalize GuardDuty data:

```bash
# Create KQL function file
cat > guardduty-parser-function.kql << 'EOF'
// GuardDutyNormalized() - Parses raw GuardDuty findings into normalized format
// Usage: GuardDutyNormalized() | where Severity >= 7.0
let GuardDutyNormalized = () {
    RawGuardDuty_CL
    | extend ParsedJson = parse_json(RawJson)
    | extend 
        CreatedAt = todatetime(ParsedJson.createdAt),
        UpdatedAt = todatetime(ParsedJson.updatedAt),
        FindingTitle = tostring(ParsedJson.title),
        FindingDescription = tostring(ParsedJson.description),
        ServiceName = tostring(ParsedJson.service.serviceName),
        ResourceType = tostring(ParsedJson.resource.resourceType),
        InstanceId = tostring(ParsedJson.resource.instanceDetails.instanceId),
        RemoteIpCountry = tostring(ParsedJson.service.remoteIpDetails.country.countryName),
        RemoteIpAddress = tostring(ParsedJson.service.remoteIpDetails.ipAddressV4),
        ActionType = tostring(ParsedJson.service.action.actionType),
        ConnectionDirection = tostring(ParsedJson.service.action.networkConnectionAction.connectionDirection),
        EventFirstSeen = todatetime(ParsedJson.service.eventFirstSeen),
        EventLastSeen = todatetime(ParsedJson.service.eventLastSeen),
        Count = toint(ParsedJson.service.count),
        Archived = tobool(ParsedJson.service.archived)
    | project 
        TimeGenerated,
        FindingId,
        AccountId,
        Region,
        Severity,
        Type,
        CreatedAt,
        UpdatedAt,
        FindingTitle,
        FindingDescription,
        ServiceName,
        ResourceType,
        InstanceId,
        RemoteIpCountry,
        RemoteIpAddress,
        ActionType,
        ConnectionDirection,
        EventFirstSeen,
        EventLastSeen,
        Count,
        Archived,
        RawJson
};
GuardDutyNormalized
EOF

echo "KQL parser function created: guardduty-parser-function.kql"
echo "Deploy this function to your Log Analytics workspace using the Azure portal or REST API"
```

## Step 8: Create Sample Analytics Rules

Create Sentinel analytics rules for common GuardDuty scenarios:

```bash
# Create high-severity findings rule
cat > high-severity-findings-rule.kql << 'EOF'
// High Severity GuardDuty Findings
// Triggers on findings with severity >= 7.0
GuardDutyNormalized()
| where Severity >= 7.0
| where TimeGenerated > ago(5m)
| extend 
    AlertSeverity = case(
        Severity >= 8.0, "High",
        Severity >= 7.0, "Medium",
        "Low"
    )
| project 
    TimeGenerated,
    FindingId,
    AccountId,
    Region,
    Type,
    FindingTitle,
    FindingDescription,
    Severity,
    AlertSeverity,
    ResourceType,
    InstanceId,
    RemoteIpAddress,
    RemoteIpCountry
EOF

# Create cryptocurrency mining rule
cat > crypto-mining-rule.kql << 'EOF'
// Cryptocurrency Mining Detection
// Detects GuardDuty findings related to cryptocurrency mining
GuardDutyNormalized()
| where Type contains "CryptoCurrency"
| where TimeGenerated > ago(5m)
| extend 
    ThreatCategory = "Cryptocurrency Mining",
    AlertSeverity = "High"
| project 
    TimeGenerated,
    FindingId,
    AccountId,
    Region,
    Type,
    FindingTitle,
    FindingDescription,
    Severity,
    ThreatCategory,
    AlertSeverity,
    ResourceType,
    InstanceId,
    RemoteIpAddress,
    RemoteIpCountry
EOF

# Create malware detection rule
cat > malware-detection-rule.kql << 'EOF'
// Malware Detection
// Detects GuardDuty findings related to malware
GuardDutyNormalized()
| where Type contains "Malware" or Type contains "Trojan" or Type contains "Backdoor"
| where TimeGenerated > ago(5m)
| extend 
    ThreatCategory = "Malware",
    AlertSeverity = case(
        Severity >= 8.0, "High",
        Severity >= 6.0, "Medium",
        "Low"
    )
| project 
    TimeGenerated,
    FindingId,
    AccountId,
    Region,
    Type,
    FindingTitle,
    FindingDescription,
    Severity,
    ThreatCategory,
    AlertSeverity,
    ResourceType,
    InstanceId,
    RemoteIpAddress,
    RemoteIpCountry
EOF

echo "Analytics rules created:"
echo "- high-severity-findings-rule.kql"
echo "- crypto-mining-rule.kql"
echo "- malware-detection-rule.kql"
```

## Step 9: Generate Configuration

Create configuration files with your Azure resource details:

```bash
# Generate Azure configuration
cat > ../config/generated-azure-config.json << EOF
{
  "azureEndpoint": "$DCR_ENDPOINT",
  "dcr": {
    "immutableId": "$DCR_IMMUTABLE_ID",
    "streamName": "Custom-GuardDutyFindings"
  },
  "azure": {
    "tenantId": "$TENANT_ID",
    "clientId": "$CLIENT_ID",
    "clientSecret": "$CLIENT_SECRET",
    "workspaceId": "$WORKSPACE_ID",
    "subscriptionId": "$SUBSCRIPTION_ID",
    "resourceGroupName": "$RESOURCE_GROUP"
  }
}
EOF

# Generate environment variables file
cat > ../config/generated-azure-env.env << EOF
# Azure Configuration
AZURE_ENDPOINT=$DCR_ENDPOINT
DCR_IMMUTABLE_ID=$DCR_IMMUTABLE_ID
DCR_STREAM_NAME=Custom-GuardDutyFindings
AZURE_TENANT_ID=$TENANT_ID
AZURE_CLIENT_ID=$CLIENT_ID
AZURE_CLIENT_SECRET=$CLIENT_SECRET
AZURE_WORKSPACE_ID=$WORKSPACE_ID
AZURE_SUBSCRIPTION_ID=$SUBSCRIPTION_ID
AZURE_RESOURCE_GROUP_NAME=$RESOURCE_GROUP
EOF

echo "Azure configuration saved to:"
echo "- ../config/generated-azure-config.json"
echo "- ../config/generated-azure-env.env"

# Clean up sensitive files
rm -f service-principal.json
```

## Step 10: Test Data Ingestion

Test the DCR configuration by sending sample data:

```bash
# Create test data
cat > test-guardduty-finding.json << 'EOF'
[
    {
        "TimeGenerated": "2024-01-15T10:30:00Z",
        "FindingId": "test-finding-12345",
        "AccountId": "123456789012",
        "Region": "us-east-1",
        "Severity": 8.5,
        "Type": "Backdoor:EC2/XORDDOS",
        "Title": "Test GuardDuty Finding",
        "Description": "This is a test finding for validation",
        "Service": "guardduty",
        "ResourceType": "Instance",
        "InstanceId": "i-1234567890abcdef0",
        "RemoteIpAddress": "198.51.100.1",
        "RemoteIpCountry": "United States",
        "RawJson": "{\"test\": \"data\"}"
    }
]
EOF

# Test ingestion using Azure CLI (requires additional setup)
echo "Test data created: test-guardduty-finding.json"
echo "Use the Azure Monitor Data Collection API to test ingestion"
echo "Endpoint: $DCR_ENDPOINT"
echo "Stream: Custom-GuardDutyFindings"
```

## Verification

Verify your Azure setup:

1. **Check Log Analytics workspace**:
   ```bash
   az monitor log-analytics workspace show \
       --resource-group $RESOURCE_GROUP \
       --workspace-name $WORKSPACE_NAME
   ```

2. **Verify DCR configuration**:
   ```bash
   az monitor data-collection rule show \
       --resource-group $RESOURCE_GROUP \
       --name $DCR_NAME
   ```

3. **Test service principal permissions**:
   ```bash
   az role assignment list \
       --assignee $CLIENT_ID \
       --all
   ```

4. **Check Sentinel status** (if enabled):
   ```bash
   az sentinel workspace show \
       --resource-group $RESOURCE_GROUP \
       --workspace-name $WORKSPACE_NAME
   ```

## PowerShell Alternative

For PowerShell users, here's an equivalent setup script:

```powershell
# PowerShell setup script
# Run this in PowerShell 7+ with Azure PowerShell module

# Set variables
$SubscriptionId = "your-subscription-id"
$ResourceGroup = "guardduty-sentinel-rg"
$Location = "eastus"
$WorkspaceName = "guardduty-sentinel-workspace"
$DcrName = "guardduty-dcr"
$ServicePrincipalName = "guardduty-sentinel-sp"

# Connect to Azure
Connect-AzAccount
Set-AzContext -SubscriptionId $SubscriptionId

# Create resource group
New-AzResourceGroup -Name $ResourceGroup -Location $Location

# Create Log Analytics workspace
$Workspace = New-AzOperationalInsightsWorkspace `
    -ResourceGroupName $ResourceGroup `
    -Name $WorkspaceName `
    -Location $Location `
    -Sku "PerGB2018"

Write-Host "Workspace ID: $($Workspace.CustomerId)"
Write-Host "Workspace Resource ID: $($Workspace.ResourceId)"

# Continue with DCR and service principal creation...
# (Similar to bash script but using PowerShell cmdlets)
```

## Cleanup (Optional)

To remove the Azure resources:

```bash
# Delete the entire resource group (removes all resources)
az group delete --name $RESOURCE_GROUP --yes --no-wait

# Or delete individual resources
az monitor data-collection rule delete \
    --resource-group $RESOURCE_GROUP \
    --name $DCR_NAME

az monitor log-analytics workspace delete \
    --resource-group $RESOURCE_GROUP \
    --workspace-name $WORKSPACE_NAME

az ad sp delete --id $CLIENT_ID
```

## Next Steps

After completing the Azure setup:
1. Proceed to [Worker Configuration](worker-configuration.md)
2. Combine your AWS and Azure configurations
3. Deploy and test the ingestion worker
4. Run the validation script

## Troubleshooting

### Common Issues

**DCR Authentication Failed**
- Verify service principal has "Monitoring Metrics Publisher" role
- Check client ID, secret, and tenant ID are correct
- Ensure DCR permissions are assigned to the service principal

**Data Not Appearing in Workspace**
- Check DCR stream name matches the configuration
- Verify workspace ID is correct
- Check data format matches DCR schema

**Service Principal Creation Failed**
- Ensure you have permission to create service principals
- Try creating the service principal manually in Azure Portal
- Check subscription and resource group permissions

**KQL Function Deployment Issues**
- Use Azure Portal to deploy KQL functions
- Verify function syntax is correct
- Check workspace permissions for function creation