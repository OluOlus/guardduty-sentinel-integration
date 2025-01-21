# Azure Sentinel GuardDuty Templates Deployment Script
# This script deploys analytics rules, workbooks, and playbooks for GuardDuty integration

param(
    [Parameter(Mandatory=$true)]
    [string]$SubscriptionId,
    
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$true)]
    [string]$WorkspaceName,
    
    [Parameter(Mandatory=$false)]
    [string]$SlackWebhookUrl = "",
    
    [Parameter(Mandatory=$false)]
    [string]$AWSAccessKeyId = "",
    
    [Parameter(Mandatory=$false)]
    [string]$AWSSecretAccessKey = "",
    
    [Parameter(Mandatory=$false)]
    [switch]$DeployPlaybooks = $false,
    
    [Parameter(Mandatory=$false)]
    [switch]$DeployAnalyticsRules = $true,
    
    [Parameter(Mandatory=$false)]
    [switch]$DeployWorkbooks = $true
)

# Set error action preference
$ErrorActionPreference = "Stop"

# Function to write colored output
function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    Write-Host $Message -ForegroundColor $Color
}

# Function to deploy analytics rule
function Deploy-AnalyticsRule {
    param(
        [string]$RuleName,
        [string]$KqlFile,
        [string]$Description,
        [string]$Severity,
        [int]$FrequencyMinutes,
        [string[]]$Tactics
    )
    
    Write-ColorOutput "Deploying analytics rule: $RuleName" "Yellow"
    
    $kqlQuery = Get-Content -Path $KqlFile -Raw
    
    $ruleProperties = @{
        displayName = $RuleName
        description = $Description
        severity = $Severity
        enabled = $true
        query = $kqlQuery
        queryFrequency = "PT$($FrequencyMinutes)M"
        queryPeriod = "PT$($FrequencyMinutes)M"
        triggerOperator = "GreaterThan"
        triggerThreshold = 0
        suppressionDuration = "PT5H"
        suppressionEnabled = $false
        tactics = $Tactics
        incidentConfiguration = @{
            createIncident = $true
            groupingConfiguration = @{
                enabled = $true
                reopenClosedIncident = $false
                lookbackDuration = "PT5H"
                matchingMethod = "AllEntities"
            }
        }
    }
    
    $body = @{
        kind = "Scheduled"
        properties = $ruleProperties
    } | ConvertTo-Json -Depth 10
    
    $uri = "https://management.azure.com/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.OperationalInsights/workspaces/$WorkspaceName/providers/Microsoft.SecurityInsights/alertRules/$($RuleName -replace ' ', '-')?api-version=2021-10-01"
    
    try {
        $response = Invoke-RestMethod -Uri $uri -Method PUT -Body $body -Headers $headers -ContentType "application/json"
        Write-ColorOutput "✓ Successfully deployed: $RuleName" "Green"
    }
    catch {
        Write-ColorOutput "✗ Failed to deploy: $RuleName - $($_.Exception.Message)" "Red"
    }
}

# Function to deploy workbook
function Deploy-Workbook {
    param(
        [string]$WorkbookName,
        [string]$WorkbookFile
    )
    
    Write-ColorOutput "Deploying workbook: $WorkbookName" "Yellow"
    
    $workbookContent = Get-Content -Path $WorkbookFile -Raw | ConvertFrom-Json
    
    $workbookProperties = @{
        displayName = $WorkbookName
        serializedData = ($workbookContent | ConvertTo-Json -Depth 20)
        category = "sentinel"
        sourceId = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.OperationalInsights/workspaces/$WorkspaceName"
    }
    
    $body = @{
        kind = "shared"
        properties = $workbookProperties
    } | ConvertTo-Json -Depth 25
    
    $uri = "https://management.azure.com/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.Insights/workbooks/$($WorkbookName -replace ' ', '-')?api-version=2021-08-01"
    
    try {
        $response = Invoke-RestMethod -Uri $uri -Method PUT -Body $body -Headers $headers -ContentType "application/json"
        Write-ColorOutput "✓ Successfully deployed: $WorkbookName" "Green"
    }
    catch {
        Write-ColorOutput "✗ Failed to deploy: $WorkbookName - $($_.Exception.Message)" "Red"
    }
}

# Main deployment script
Write-ColorOutput "Starting Azure Sentinel GuardDuty Templates Deployment" "Cyan"
Write-ColorOutput "Subscription: $SubscriptionId" "Gray"
Write-ColorOutput "Resource Group: $ResourceGroupName" "Gray"
Write-ColorOutput "Workspace: $WorkspaceName" "Gray"

# Authenticate to Azure
Write-ColorOutput "Authenticating to Azure..." "Yellow"
try {
    $context = Get-AzContext
    if (-not $context) {
        Connect-AzAccount
    }
    Set-AzContext -SubscriptionId $SubscriptionId
    $token = [Microsoft.Azure.Commands.Common.Authentication.AzureSession]::Instance.AuthenticationFactory.Authenticate($context.Account, $context.Environment, $context.Tenant.Id, $null, "Never", $null, "https://management.azure.com/").AccessToken
    $headers = @{
        'Authorization' = "Bearer $token"
        'Content-Type' = 'application/json'
    }
    Write-ColorOutput "✓ Successfully authenticated" "Green"
}
catch {
    Write-ColorOutput "✗ Authentication failed: $($_.Exception.Message)" "Red"
    exit 1
}

# Verify workspace exists
Write-ColorOutput "Verifying workspace exists..." "Yellow"
try {
    $workspace = Get-AzOperationalInsightsWorkspace -ResourceGroupName $ResourceGroupName -Name $WorkspaceName
    Write-ColorOutput "✓ Workspace verified" "Green"
}
catch {
    Write-ColorOutput "✗ Workspace not found: $($_.Exception.Message)" "Red"
    exit 1
}

# Deploy Analytics Rules
if ($DeployAnalyticsRules) {
    Write-ColorOutput "`nDeploying Analytics Rules..." "Cyan"
    
    Deploy-AnalyticsRule -RuleName "High Severity GuardDuty Findings" `
                        -KqlFile "analytics-rules/high-severity-guardduty-findings.kql" `
                        -Description "Detects GuardDuty findings with severity >= 7.0 and generates incidents" `
                        -Severity "High" `
                        -FrequencyMinutes 5 `
                        -Tactics @("InitialAccess", "Execution", "Persistence")
    
    Deploy-AnalyticsRule -RuleName "Cryptocurrency Mining Detection" `
                        -KqlFile "analytics-rules/cryptocurrency-mining-detection.kql" `
                        -Description "Detects GuardDuty findings related to cryptocurrency mining activities" `
                        -Severity "Medium" `
                        -FrequencyMinutes 15 `
                        -Tactics @("Impact", "ResourceHijacking")
    
    Deploy-AnalyticsRule -RuleName "Malware and Backdoor Detection" `
                        -KqlFile "analytics-rules/malware-and-backdoor-detection.kql" `
                        -Description "Detects GuardDuty findings related to malware, trojans, and backdoors" `
                        -Severity "High" `
                        -FrequencyMinutes 10 `
                        -Tactics @("InitialAccess", "Execution", "Persistence", "CommandAndControl")
    
    Deploy-AnalyticsRule -RuleName "Data Exfiltration Detection" `
                        -KqlFile "analytics-rules/data-exfiltration-detection.kql" `
                        -Description "Detects GuardDuty findings related to potential data exfiltration activities" `
                        -Severity "High" `
                        -FrequencyMinutes 5 `
                        -Tactics @("Exfiltration", "CommandAndControl")
}

# Deploy Workbooks
if ($DeployWorkbooks) {
    Write-ColorOutput "`nDeploying Workbooks..." "Cyan"
    
    Deploy-Workbook -WorkbookName "GuardDuty Overview Dashboard" `
                   -WorkbookFile "workbooks/guardduty-overview-workbook.json"
    
    Deploy-Workbook -WorkbookName "GuardDuty Threat Hunting" `
                   -WorkbookFile "workbooks/guardduty-threat-hunting-workbook.json"
}

# Deploy Playbooks
if ($DeployPlaybooks) {
    if (-not $SlackWebhookUrl -or -not $AWSAccessKeyId -or -not $AWSSecretAccessKey) {
        Write-ColorOutput "⚠ Skipping playbook deployment - missing required parameters (SlackWebhookUrl, AWSAccessKeyId, AWSSecretAccessKey)" "Yellow"
    }
    else {
        Write-ColorOutput "`nDeploying Playbooks..." "Cyan"
        
        try {
            $deployment = New-AzResourceGroupDeployment `
                -ResourceGroupName $ResourceGroupName `
                -TemplateFile "playbooks/guardduty-response-playbook.json" `
                -PlaybookName "GuardDuty-AutoResponse" `
                -SlackWebhookUrl $SlackWebhookUrl `
                -AWSAccessKeyId $AWSAccessKeyId `
                -AWSSecretAccessKey (ConvertTo-SecureString $AWSSecretAccessKey -AsPlainText -Force)
            
            Write-ColorOutput "✓ Successfully deployed GuardDuty Response Playbook" "Green"
        }
        catch {
            Write-ColorOutput "✗ Failed to deploy playbook: $($_.Exception.Message)" "Red"
        }
    }
}

Write-ColorOutput "`nDeployment completed!" "Cyan"
Write-ColorOutput "Next steps:" "Yellow"
Write-ColorOutput "1. Verify analytics rules are enabled in Azure Sentinel > Analytics" "White"
Write-ColorOutput "2. Test workbooks in Azure Sentinel > Workbooks" "White"
Write-ColorOutput "3. Configure playbook connections if deployed" "White"
Write-ColorOutput "4. Validate GuardDuty data ingestion is working" "White"