# GuardDuty Sentinel Integration - Deployment Validation Script
# This script validates that all KQL functions are properly deployed and functional

param(
    [Parameter(Mandatory=$true)]
    [string]$WorkspaceName,
    
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [string]$SubscriptionId,
    
    [Parameter(Mandatory=$false)]
    [switch]$RunSmokeTests = $false
)

# Set error action preference
$ErrorActionPreference = "Stop"

Write-Host "=== GuardDuty Sentinel Integration - Deployment Validation ===" -ForegroundColor Green
Write-Host "Workspace: $WorkspaceName" -ForegroundColor Yellow
Write-Host "Resource Group: $ResourceGroupName" -ForegroundColor Yellow

# Set subscription if provided
if ($SubscriptionId) {
    Write-Host "Setting subscription context: $SubscriptionId" -ForegroundColor Yellow
    az account set --subscription $SubscriptionId
}

# Verify Azure CLI is logged in
Write-Host "`n1. Verifying Azure CLI authentication..." -ForegroundColor Cyan
$account = az account show --query "user.name" -o tsv
if (-not $account) {
    Write-Error "Azure CLI not authenticated. Please run 'az login' first."
}
Write-Host "   Authenticated as: $account" -ForegroundColor Green

# Verify workspace exists
Write-Host "`n2. Verifying Log Analytics workspace..." -ForegroundColor Cyan
$workspace = az monitor log-analytics workspace show --workspace-name $WorkspaceName --resource-group $ResourceGroupName --query "name" -o tsv 2>$null
if (-not $workspace) {
    Write-Error "Workspace '$WorkspaceName' not found in resource group '$ResourceGroupName'"
}
Write-Host "   Workspace found: $workspace" -ForegroundColor Green

# Define expected functions
$expectedFunctions = @(
    "AWSGuardDuty_Config",
    "AWSGuardDuty_Schema", 
    "AWSGuardDuty_Main",
    "AWSGuardDuty_Network",
    "AWSGuardDuty_IAM",
    "AWSGuardDuty_ASIMNetworkSession"
)

# Verify KQL functions are deployed
Write-Host "`n3. Verifying KQL functions deployment..." -ForegroundColor Cyan
$deployedFunctions = @()
$missingFunctions = @()

foreach ($functionName in $expectedFunctions) {
    Write-Host "   Checking function: $functionName" -ForegroundColor Yellow
    
    $function = az monitor log-analytics workspace saved-search show `
        --workspace-name $WorkspaceName `
        --resource-group $ResourceGroupName `
        --saved-search-id $functionName `
        --query "properties.functionAlias" -o tsv 2>$null
    
    if ($function -eq $functionName) {
        $deployedFunctions += $functionName
        Write-Host "     ✓ Found" -ForegroundColor Green
    } else {
        $missingFunctions += $functionName
        Write-Host "     ✗ Missing" -ForegroundColor Red
    }
}

# Report function deployment status
Write-Host "`n4. Function Deployment Summary:" -ForegroundColor Cyan
Write-Host "   Deployed: $($deployedFunctions.Count)/$($expectedFunctions.Count)" -ForegroundColor $(if ($deployedFunctions.Count -eq $expectedFunctions.Count) { "Green" } else { "Yellow" })

if ($missingFunctions.Count -gt 0) {
    Write-Host "   Missing functions:" -ForegroundColor Red
    foreach ($missing in $missingFunctions) {
        Write-Host "     - $missing" -ForegroundColor Red
    }
}

# Test basic function execution
Write-Host "`n5. Testing function execution..." -ForegroundColor Cyan

if ($deployedFunctions -contains "AWSGuardDuty_Config") {
    Write-Host "   Testing AWSGuardDuty_Config..." -ForegroundColor Yellow
    
    $configQuery = "AWSGuardDuty_Config() | take 10"
    $configResult = az monitor log-analytics query `
        --workspace $WorkspaceName `
        --analytics-query $configQuery `
        --query "tables[0].rows" -o json 2>$null
    
    if ($configResult) {
        Write-Host "     ✓ Config function working" -ForegroundColor Green
    } else {
        Write-Host "     ✗ Config function failed" -ForegroundColor Red
    }
}

# Check for GuardDuty table
Write-Host "`n6. Checking GuardDuty data table..." -ForegroundColor Cyan
$tableQuery = "AWSGuardDuty | getschema | take 1"
$tableResult = az monitor log-analytics query `
    --workspace $WorkspaceName `
    --analytics-query $tableQuery `
    --query "tables[0].rows" -o json 2>$null

if ($tableResult) {
    Write-Host "   ✓ AWSGuardDuty table exists" -ForegroundColor Green
} else {
    Write-Host "   ⚠ AWSGuardDuty table not found or no data" -ForegroundColor Yellow
    Write-Host "     This is normal if the AWS S3 connector hasn't ingested data yet" -ForegroundColor Gray
}

# Run smoke tests if requested
if ($RunSmokeTests -and ($deployedFunctions.Count -eq $expectedFunctions.Count)) {
    Write-Host "`n7. Running smoke tests..." -ForegroundColor Cyan
    
    # Test data availability
    $dataQuery = "AWSGuardDuty | where TimeGenerated >= ago(7d) | count"
    $dataResult = az monitor log-analytics query `
        --workspace $WorkspaceName `
        --analytics-query $dataQuery `
        --query "tables[0].rows[0][0]" -o tsv 2>$null
    
    if ($dataResult -and [int]$dataResult -gt 0) {
        Write-Host "   ✓ GuardDuty data available: $dataResult records" -ForegroundColor Green
        
        # Test main parser
        $mainQuery = "AWSGuardDuty_Main(1d) | count"
        $mainResult = az monitor log-analytics query `
            --workspace $WorkspaceName `
            --analytics-query $mainQuery `
            --query "tables[0].rows[0][0]" -o tsv 2>$null
        
        if ($mainResult) {
            Write-Host "   ✓ Main parser working: $mainResult parsed records" -ForegroundColor Green
        } else {
            Write-Host "   ✗ Main parser failed" -ForegroundColor Red
        }
    } else {
        Write-Host "   ⚠ No GuardDuty data found in last 7 days" -ForegroundColor Yellow
        Write-Host "     Check AWS S3 connector configuration" -ForegroundColor Gray
    }
}

# Generate validation report
Write-Host "`n=== Validation Report ===" -ForegroundColor Green
Write-Host "Deployment Status: $(if ($deployedFunctions.Count -eq $expectedFunctions.Count) { "✓ COMPLETE" } else { "⚠ INCOMPLETE" })" -ForegroundColor $(if ($deployedFunctions.Count -eq $expectedFunctions.Count) { "Green" } else { "Yellow" })
Write-Host "Functions Deployed: $($deployedFunctions.Count)/$($expectedFunctions.Count)" -ForegroundColor White
Write-Host "Workspace: $WorkspaceName" -ForegroundColor White
Write-Host "Resource Group: $ResourceGroupName" -ForegroundColor White

if ($deployedFunctions.Count -eq $expectedFunctions.Count) {
    Write-Host "`n✓ All functions deployed successfully!" -ForegroundColor Green
    Write-Host "`nNext steps:" -ForegroundColor Cyan
    Write-Host "1. Verify AWS S3 connector is configured and ingesting data" -ForegroundColor White
    Write-Host "2. Run: AWSGuardDuty | getschema" -ForegroundColor White
    Write-Host "3. Test parsing: AWSGuardDuty_Main(1d) | take 10" -ForegroundColor White
    Write-Host "4. Review troubleshooting guide if no data appears" -ForegroundColor White
} else {
    Write-Host "`n⚠ Deployment incomplete. Please redeploy missing functions." -ForegroundColor Yellow
}

Write-Host "`nValidation completed at $(Get-Date)" -ForegroundColor Gray