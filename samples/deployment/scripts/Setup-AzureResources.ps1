# GuardDuty to Sentinel Integration - Azure Resources Setup Script
# This script automates the creation of Azure resources for manual deployment

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$SubscriptionId,
    
    [Parameter(Mandatory = $false)]
    [string]$ResourceGroupName = "guardduty-sentinel-rg",
    
    [Parameter(Mandatory = $false)]
    [string]$Location = "eastus",
    
    [Parameter(Mandatory = $false)]
    [string]$WorkspaceName = "guardduty-sentinel-workspace",
    
    [Parameter(Mandatory = $false)]
    [string]$DcrName = "guardduty-dcr",
    
    [Parameter(Mandatory = $false)]
    [string]$ServicePrincipalName = "guardduty-sentinel-sp",
    
    [Parameter(Mandatory = $false)]
    [switch]$EnableSentinel,
    
    [Parameter(Mandatory = $false)]
    [switch]$SkipConfirmation
)

# Color functions for output
function Write-ColorOutput {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,
        
        [Parameter(Mandatory = $false)]
        [ValidateSet("Info", "Success", "Warning", "Error")]
        [string]$Type = "Info"
    )
    
    switch ($Type) {
        "Info" { Write-Host "[INFO] $Message" -ForegroundColor Blue }
        "Success" { Write-Host "[SUCCESS] $Message" -ForegroundColor Green }
        "Warning" { Write-Host "[WARNING] $Message" -ForegroundColor Yellow }
        "Error" { Write-Host "[ERROR] $Message" -ForegroundColor Red }
    }
}

# Function to check prerequisites
function Test-Prerequisites {
    Write-ColorOutput "Checking prerequisites..." -Type Info
    
    # Check Azure CLI
    try {
        $azVersion = az version --output json | ConvertFrom-Json
        Write-ColorOutput "Azure CLI version: $($azVersion.'azure-cli')" -Type Info
    }
    catch {
        Write-ColorOutput "Azure CLI is not installed or not in PATH. Please install it first." -Type Error
        exit 1
    }
    
    # Check Azure authentication
    try {
        $account = az account show --output json | ConvertFrom-Json
        Write-ColorOutput "Authenticated as: $($account.user.name)" -Type Info
    }
    catch {
        Write-ColorOutput "Not authenticated to Azure. Run 'az login' first." -Type Error
        exit 1
    }
    
    # Check PowerShell version
    if ($PSVersionTable.PSVersion.Major -lt 7) {
        Write-ColorOutput "PowerShell 7+ is recommended for best compatibility." -Type Warning
    }
    
    Write-ColorOutput "Prerequisites check passed" -Type Success
}

# Function to get user configuration
function Get-UserConfiguration {
    Write-ColorOutput "Gathering configuration..." -Type Info
    
    # Get subscription ID if not provided
    if (-not $SubscriptionId) {
        $currentSub = az account show --query id --output tsv
        $SubscriptionId = Read-Host "Azure Subscription ID [$currentSub]"
        if (-not $SubscriptionId) {
            $SubscriptionId = $currentSub
        }
    }
    
    # Set subscription
    az account set --subscription $SubscriptionId
    
    # Get other parameters if not provided
    if (-not $SkipConfirmation) {
        $tempRg = Read-Host "Resource Group Name [$ResourceGroupName]"
        if ($tempRg) { $ResourceGroupName = $tempRg }
        
        $tempLocation = Read-Host "Location [$Location]"
        if ($tempLocation) { $Location = $tempLocation }
        
        $tempWorkspace = Read-Host "Workspace Name [$WorkspaceName]"
        if ($tempWorkspace) { $WorkspaceName = $tempWorkspace }
        
        $tempDcr = Read-Host "DCR Name [$DcrName]"
        if ($tempDcr) { $DcrName = $tempDcr }
        
        $tempSp = Read-Host "Service Principal Name [$ServicePrincipalName]"
        if ($tempSp) { $ServicePrincipalName = $tempSp }
        
        $enableSentinelInput = Read-Host "Enable Azure Sentinel? (y/N)"
        $EnableSentinel = $enableSentinelInput -match "^[Yy]"
    }
    
    Write-ColorOutput "Configuration:" -Type Info
    Write-ColorOutput "  Subscription: $SubscriptionId" -Type Info
    Write-ColorOutput "  Resource Group: $ResourceGroupName" -Type Info
    Write-ColorOutput "  Location: $Location" -Type Info
    Write-ColorOutput "  Workspace: $WorkspaceName" -Type Info
    Write-ColorOutput "  DCR: $DcrName" -Type Info
    Write-ColorOutput "  Service Principal: $ServicePrincipalName" -Type Info
    Write-ColorOutput "  Enable Sentinel: $EnableSentinel" -Type Info
    
    if (-not $SkipConfirmation) {
        $confirm = Read-Host "Continue with this configuration? (Y/n)"
        if ($confirm -match "^[Nn]") {
            Write-ColorOutput "Setup cancelled by user" -Type Info
            exit 0
        }
    }
}

# Function to create resource group
function New-ResourceGroupIfNotExists {
    Write-ColorOutput "Creating resource group..." -Type Info
    
    $existingRg = az group show --name $ResourceGroupName --output json 2>$null
    if ($existingRg) {
        Write-ColorOutput "Resource group already exists: $ResourceGroupName" -Type Warning
    }
    else {
        az group create --name $ResourceGroupName --location $Location --output none
        Write-ColorOutput "Resource group created: $ResourceGroupName" -Type Success
    }
}

# Function to create Log Analytics workspace
function New-LogAnalyticsWorkspace {
    Write-ColorOutput "Creating Log Analytics workspace..." -Type Info
    
    $workspace = az monitor log-analytics workspace create `
        --resource-group $ResourceGroupName `
        --workspace-name $WorkspaceName `
        --location $Location `
        --sku PerGB2018 `
        --output json | ConvertFrom-Json
    
    $script:WorkspaceId = $workspace.customerId
    $script:WorkspaceResourceId = $workspace.id
    
    Write-ColorOutput "Workspace created successfully" -Type Success
    Write-ColorOutput "  Workspace ID: $WorkspaceId" -Type Info
    Write-ColorOutput "  Resource ID: $WorkspaceResourceId" -Type Info
}

# Function to create Data Collection Rule
function New-DataCollectionRule {
    Write-ColorOutput "Creating Data Collection Rule..." -Type Info
    
    # Create DCR configuration
    $dcrConfig = @{
        location = $Location
        kind = "Direct"
        properties = @{
            streamDeclarations = @{
                "Custom-GuardDutyFindings" = @{
                    columns = @(
                        @{ name = "TimeGenerated"; type = "datetime" },
                        @{ name = "FindingId"; type = "string" },
                        @{ name = "AccountId"; type = "string" },
                        @{ name = "Region"; type = "string" },
                        @{ name = "Severity"; type = "real" },
                        @{ name = "Type"; type = "string" },
                        @{ name = "Title"; type = "string" },
                        @{ name = "Description"; type = "string" },
                        @{ name = "Service"; type = "string" },
                        @{ name = "ResourceType"; type = "string" },
                        @{ name = "InstanceId"; type = "string" },
                        @{ name = "RemoteIpAddress"; type = "string" },
                        @{ name = "RemoteIpCountry"; type = "string" },
                        @{ name = "RawJson"; type = "string" }
                    )
                }
            }
            destinations = @{
                logAnalytics = @(
                    @{
                        workspaceResourceId = $WorkspaceResourceId
                        name = "LogAnalyticsDest"
                    }
                )
            }
            dataFlows = @(
                @{
                    streams = @("Custom-GuardDutyFindings")
                    destinations = @("LogAnalyticsDest")
                    transformKql = "source | extend TimeGenerated = now()"
                    outputStream = "Custom-RawGuardDuty_CL"
                }
            )
        }
    }
    
    # Save DCR config to temp file
    $dcrConfigPath = [System.IO.Path]::GetTempFileName() + ".json"
    $dcrConfig | ConvertTo-Json -Depth 10 | Out-File -FilePath $dcrConfigPath -Encoding UTF8
    
    try {
        # Create DCR
        $dcr = az monitor data-collection rule create `
            --resource-group $ResourceGroupName `
            --name $DcrName `
            --rule-file $dcrConfigPath `
            --output json | ConvertFrom-Json
        
        $script:DcrImmutableId = $dcr.immutableId
        $script:DcrEndpoint = $dcr.properties.endpoints.logsIngestion[0]
        
        Write-ColorOutput "DCR created successfully" -Type Success
        Write-ColorOutput "  DCR Immutable ID: $DcrImmutableId" -Type Info
        Write-ColorOutput "  DCR Endpoint: $DcrEndpoint" -Type Info
    }
    finally {
        # Clean up temp file
        Remove-Item -Path $dcrConfigPath -Force -ErrorAction SilentlyContinue
    }
}

# Function to create service principal
function New-ServicePrincipal {
    Write-ColorOutput "Creating service principal..." -Type Info
    
    # Create service principal
    $sp = az ad sp create-for-rbac `
        --name $ServicePrincipalName `
        --role "Monitoring Metrics Publisher" `
        --scopes $WorkspaceResourceId `
        --output json | ConvertFrom-Json
    
    $script:ClientId = $sp.appId
    $script:ClientSecret = $sp.password
    $script:TenantId = $sp.tenant
    
    # Also assign DCR permissions
    $dcrResourceId = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.Insights/dataCollectionRules/$DcrName"
    az role assignment create `
        --assignee $ClientId `
        --role "Monitoring Metrics Publisher" `
        --scope $dcrResourceId `
        --output none
    
    Write-ColorOutput "Service principal created successfully" -Type Success
    Write-ColorOutput "  Client ID: $ClientId" -Type Info
    Write-ColorOutput "  Tenant ID: $TenantId" -Type Info
    Write-ColorOutput "  Client Secret: [HIDDEN]" -Type Info
}

# Function to enable Sentinel
function Enable-Sentinel {
    if ($EnableSentinel) {
        Write-ColorOutput "Enabling Azure Sentinel..." -Type Info
        
        try {
            az sentinel workspace create `
                --resource-group $ResourceGroupName `
                --workspace-name $WorkspaceName `
                --output none
            
            Write-ColorOutput "Sentinel enabled successfully" -Type Success
        }
        catch {
            Write-ColorOutput "Failed to enable Sentinel. You may need to enable it manually." -Type Warning
        }
    }
}

# Function to create KQL parser function
function New-KqlParserFunction {
    Write-ColorOutput "Creating KQL parser function..." -Type Info
    
    $kqlFunction = @"
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
"@
    
    $kqlFunctionPath = Join-Path $PSScriptRoot "..\config\guardduty-parser-function.kql"
    $kqlFunction | Out-File -FilePath $kqlFunctionPath -Encoding UTF8
    
    Write-ColorOutput "KQL parser function saved to: $kqlFunctionPath" -Type Success
    Write-ColorOutput "Deploy this function to your Log Analytics workspace using Azure Portal" -Type Info
}

# Function to generate configuration files
function New-ConfigurationFiles {
    Write-ColorOutput "Generating configuration files..." -Type Info
    
    $configDir = Join-Path $PSScriptRoot "..\config"
    if (-not (Test-Path $configDir)) {
        New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    }
    
    # Generate Azure configuration JSON
    $azureConfig = @{
        azureEndpoint = $DcrEndpoint
        dcr = @{
            immutableId = $DcrImmutableId
            streamName = "Custom-GuardDutyFindings"
        }
        azure = @{
            tenantId = $TenantId
            clientId = $ClientId
            clientSecret = $ClientSecret
            workspaceId = $WorkspaceId
            subscriptionId = $SubscriptionId
            resourceGroupName = $ResourceGroupName
        }
        metadata = @{
            createdAt = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
            createdBy = "Setup-AzureResources.ps1"
            subscriptionId = $SubscriptionId
            location = $Location
        }
    }
    
    $azureConfigPath = Join-Path $configDir "generated-azure-config.json"
    $azureConfig | ConvertTo-Json -Depth 10 | Out-File -FilePath $azureConfigPath -Encoding UTF8
    
    # Generate environment variables file
    $envConfig = @"
# Azure Configuration
AZURE_ENDPOINT=$DcrEndpoint
DCR_IMMUTABLE_ID=$DcrImmutableId
DCR_STREAM_NAME=Custom-GuardDutyFindings
AZURE_TENANT_ID=$TenantId
AZURE_CLIENT_ID=$ClientId
AZURE_CLIENT_SECRET=$ClientSecret
AZURE_WORKSPACE_ID=$WorkspaceId
AZURE_SUBSCRIPTION_ID=$SubscriptionId
AZURE_RESOURCE_GROUP_NAME=$ResourceGroupName
"@
    
    $envConfigPath = Join-Path $configDir "generated-azure-env.env"
    $envConfig | Out-File -FilePath $envConfigPath -Encoding UTF8
    
    Write-ColorOutput "Configuration files generated:" -Type Success
    Write-ColorOutput "  JSON Config: $azureConfigPath" -Type Info
    Write-ColorOutput "  Environment: $envConfigPath" -Type Info
}

# Function to test configuration
function Test-Configuration {
    Write-ColorOutput "Testing configuration..." -Type Info
    
    # Test workspace access
    try {
        az monitor log-analytics workspace show `
            --resource-group $ResourceGroupName `
            --workspace-name $WorkspaceName `
            --output none
        Write-ColorOutput "Workspace access: OK" -Type Success
    }
    catch {
        Write-ColorOutput "Workspace access: FAILED" -Type Error
    }
    
    # Test DCR access
    try {
        az monitor data-collection rule show `
            --resource-group $ResourceGroupName `
            --name $DcrName `
            --output none
        Write-ColorOutput "DCR access: OK" -Type Success
    }
    catch {
        Write-ColorOutput "DCR access: FAILED" -Type Error
    }
    
    # Test service principal permissions
    try {
        $roleAssignments = az role assignment list --assignee $ClientId --output json | ConvertFrom-Json
        $hasMonitoringRole = $roleAssignments | Where-Object { $_.roleDefinitionName -eq "Monitoring Metrics Publisher" }
        
        if ($hasMonitoringRole) {
            Write-ColorOutput "Service principal permissions: OK" -Type Success
        }
        else {
            Write-ColorOutput "Service principal permissions: MISSING" -Type Warning
        }
    }
    catch {
        Write-ColorOutput "Service principal permissions: UNKNOWN" -Type Warning
    }
}

# Function to display next steps
function Show-NextSteps {
    Write-ColorOutput "Azure setup completed successfully!" -Type Success
    Write-Host ""
    Write-ColorOutput "Next steps:" -Type Info
    Write-Host "1. Proceed to worker configuration: ..\worker-configuration.md"
    Write-Host "2. Combine with AWS configuration from setup-aws-resources.sh"
    Write-Host "3. Deploy and test the ingestion worker"
    Write-Host "4. Run the validation script"
    Write-Host ""
    Write-ColorOutput "Resources created:" -Type Info
    Write-Host "- Resource Group: $ResourceGroupName"
    Write-Host "- Log Analytics Workspace: $WorkspaceName ($WorkspaceId)"
    Write-Host "- Data Collection Rule: $DcrName ($DcrImmutableId)"
    Write-Host "- Service Principal: $ServicePrincipalName ($ClientId)"
    if ($EnableSentinel) {
        Write-Host "- Azure Sentinel: Enabled"
    }
    Write-Host ""
    Write-ColorOutput "Configuration files:" -Type Info
    Write-Host "- generated-azure-config.json"
    Write-Host "- generated-azure-env.env"
    Write-Host "- guardduty-parser-function.kql"
}

# Function to handle errors
function Handle-Error {
    param($ErrorRecord)
    
    Write-ColorOutput "Setup failed with error: $($ErrorRecord.Exception.Message)" -Type Error
    Write-ColorOutput "Partial cleanup may be required. Check Azure Portal for created resources." -Type Warning
    exit 1
}

# Main execution
function Main {
    try {
        Write-ColorOutput "Starting Azure resources setup for GuardDuty-Sentinel integration..." -Type Info
        
        Test-Prerequisites
        Get-UserConfiguration
        New-ResourceGroupIfNotExists
        New-LogAnalyticsWorkspace
        New-DataCollectionRule
        New-ServicePrincipal
        Enable-Sentinel
        New-KqlParserFunction
        New-ConfigurationFiles
        Test-Configuration
        Show-NextSteps
        
        Write-ColorOutput "Setup completed successfully!" -Type Success
    }
    catch {
        Handle-Error $_
    }
}

# Run main function
Main