# GuardDuty Sentinel Integration - Deployment Runbook

## Overview

This runbook provides step-by-step instructions for deploying the GuardDuty Sentinel Integration solution. The deployment process is designed to be reliable, repeatable, and suitable for both development and production environments.

## Prerequisites

### Required Tools
- **Azure CLI** (version 2.30.0 or later)
- **PowerShell** (version 7.0 or later recommended)
- **Git** for cloning the repository

### Required Permissions
- **Log Analytics Contributor** role on the target workspace
- **Reader** role on the resource group containing the workspace
- Ability to create and modify KQL functions in Microsoft Sentinel

### Environment Requirements
- **Microsoft Sentinel workspace** with AWS S3 connector configured
- **AWS GuardDuty** enabled and exporting findings to S3
- **Network connectivity** to Azure and GitHub

## Pre-Deployment Checklist

### ✅ Verify Prerequisites

1. **Check Azure CLI Authentication**
   ```bash
   az account show
   az account list --query "[].{Name:name, SubscriptionId:id, State:state}"
   ```

2. **Verify Workspace Access**
   ```bash
   az monitor log-analytics workspace show \
     --workspace-name "your-workspace-name" \
     --resource-group "your-resource-group"
   ```

3. **Test KQL Function Creation Permissions**
   ```bash
   # This should not return permission errors
   az monitor log-analytics workspace saved-search list \
     --workspace-name "your-workspace-name" \
     --resource-group "your-resource-group"
   ```

### ✅ Validate AWS S3 Connector

1. **Check Connector Status in Sentinel**
   - Navigate to Microsoft Sentinel → Data connectors
   - Find "Amazon Web Services S3" connector
   - Verify status shows "Connected"

2. **Verify GuardDuty Table Exists**
   ```kql
   // Run in Sentinel Logs
   AWSGuardDuty
   | getschema
   ```

3. **Check Recent Data Ingestion**
   ```kql
   // Should show recent records
   AWSGuardDuty
   | where TimeGenerated >= ago(24h)
   | take 10
   ```

## Deployment Process

### Step 1: Clone Repository

```bash
# Clone the repository
git clone https://github.com/your-org/guardduty-sentinel-integration
cd guardduty-sentinel-integration

# Verify file structure
ls -la kql/
ls -la deployment/
```

### Step 2: Configure Environment Parameters

Choose the appropriate parameter file for your environment:

**For Development:**
```bash
cp deployment/parameters/dev.parameters.json deployment/parameters/my-dev.parameters.json
```

**For Production:**
```bash
cp deployment/parameters/prod.parameters.json deployment/parameters/my-prod.parameters.json
```

**Edit the parameter file:**
```json
{
  "parameters": {
    "workspaceName": {
      "value": "YOUR_WORKSPACE_NAME"
    },
    "guardDutyTableName": {
      "value": "AWSGuardDuty"  // Verify this matches your table
    },
    "rawDataColumn": {
      "value": "EventData"    // Check with: AWSGuardDuty | getschema
    },
    "environment": {
      "value": "prod"         // or "dev", "test", "staging"
    }
  }
}
```

### Step 3: Deploy KQL Functions

**Option A: Using Azure CLI (Recommended)**
```bash
# Set your subscription
az account set --subscription "your-subscription-id"

# Deploy to development
az deployment group create \
  --resource-group "your-resource-group" \
  --template-file deployment/deploy.bicep \
  --parameters @deployment/parameters/my-dev.parameters.json

# Deploy to production
az deployment group create \
  --resource-group "your-resource-group" \
  --template-file deployment/deploy.bicep \
  --parameters @deployment/parameters/my-prod.parameters.json
```

**Option B: Using PowerShell**
```powershell
# Connect to Azure
Connect-AzAccount

# Deploy functions
New-AzResourceGroupDeployment `
  -ResourceGroupName "your-resource-group" `
  -TemplateFile "deployment/deploy.bicep" `
  -TemplateParameterFile "deployment/parameters/my-prod.parameters.json"
```

### Step 4: Validate Deployment

**Run Automated Validation:**
```powershell
# Run validation script
./scripts/validate-deployment.ps1 `
  -WorkspaceName "your-workspace-name" `
  -ResourceGroupName "your-resource-group" `
  -RunSmokeTests
```

**Manual Validation Queries:**
```kql
// 1. Test configuration function
AWSGuardDuty_Config()

// 2. Test main parser
AWSGuardDuty_Main(1d) | take 5

// 3. Test network parser
AWSGuardDuty_Network(1d) | where isnotempty(RemoteIp) | take 5

// 4. Test IAM parser  
AWSGuardDuty_IAM(1d) | where isnotempty(ApiName) | take 5

// 5. Test ASIM normalization
AWSGuardDuty_ASIMNetworkSession(1d) | take 5

// 6. Test schema validation
AWSGuardDuty_Schema(1d) | summarize count() by QualityCategory
```

## Post-Deployment Configuration

### Configure Alerting Rules

1. **High Severity Findings Alert**
   ```kql
   AWSGuardDuty_Main(5m)
   | where SeverityLevel == "Critical" or SeverityLevel == "High"
   | project EventTime, FindingType, Title, AwsAccountId, AwsRegion, Severity
   ```

2. **Network Threat Detection**
   ```kql
   AWSGuardDuty_Network(5m)
   | where ThreatCategory in ("Backdoor", "Trojan", "DDoS")
   | project EventTime, FindingType, RemoteIp, RemoteCountry, InstanceId
   ```

### Create Workbooks

1. **GuardDuty Overview Dashboard**
   - Finding trends over time
   - Severity distribution
   - Top finding types
   - Geographic threat map

2. **Network Security Dashboard**
   - Remote IP analysis
   - Port and protocol usage
   - Geographic distribution of threats
   - Instance impact analysis

### Set Up Automated Response

1. **Logic Apps Integration**
   - Automatic ticket creation for high-severity findings
   - Slack/Teams notifications
   - Email alerts to security team

2. **Playbook Automation**
   - Instance isolation for critical threats
   - Security group modifications
   - Automated investigation workflows

## Troubleshooting

### Common Issues

#### Issue 1: Functions Not Deploying
**Symptoms:** Deployment fails with permission errors
**Solution:**
```bash
# Check permissions
az role assignment list --assignee $(az account show --query user.name -o tsv) --scope "/subscriptions/your-sub-id/resourceGroups/your-rg"

# Verify workspace access
az monitor log-analytics workspace show --workspace-name "workspace" --resource-group "rg"
```

#### Issue 2: No Data in Parsers
**Symptoms:** Functions deploy but return no results
**Solution:**
```kql
// Check raw table
AWSGuardDuty | take 10

// Check column names
AWSGuardDuty | getschema

// Verify configuration
AWSGuardDuty_Config() | where Setting in ("TableName", "RawColumn")
```

#### Issue 3: Parsing Errors
**Symptoms:** Functions return errors or empty results
**Solution:**
```kql
// Test JSON parsing
AWSGuardDuty
| extend ParsedJson = parse_json(EventData)
| where isnotempty(ParsedJson)
| take 5

// Check data quality
AWSGuardDuty_Schema(1d)
| summarize count() by QualityCategory
```

### Performance Optimization

#### Query Performance
- Use appropriate time ranges (avoid queries > 30 days)
- Filter early in queries (use `where` clauses first)
- Limit result sets with `take` or `top`

#### Resource Usage
- Monitor workspace ingestion limits
- Set up data retention policies
- Use summarization for long-term analysis

## Maintenance

### Regular Tasks

#### Weekly
- Review data quality metrics
- Check for new GuardDuty finding types
- Validate connector health

#### Monthly  
- Update parser functions if needed
- Review and optimize alerting rules
- Analyze performance metrics

#### Quarterly
- Review and update documentation
- Test disaster recovery procedures
- Evaluate new GuardDuty features

### Version Updates

When updating the parser functions:

1. **Test in Development First**
   ```bash
   # Deploy to dev environment
   az deployment group create \
     --resource-group "dev-rg" \
     --template-file deployment/deploy.bicep \
     --parameters @deployment/parameters/dev.parameters.json
   ```

2. **Validate New Version**
   ```powershell
   ./scripts/validate-deployment.ps1 -WorkspaceName "dev-workspace" -ResourceGroupName "dev-rg" -RunSmokeTests
   ```

3. **Deploy to Production**
   ```bash
   # Only after successful dev testing
   az deployment group create \
     --resource-group "prod-rg" \
     --template-file deployment/deploy.bicep \
     --parameters @deployment/parameters/prod.parameters.json
   ```

## Support and Escalation

### Internal Support
- **Level 1:** Check troubleshooting guide and run validation scripts
- **Level 2:** Review Azure activity logs and connector status
- **Level 3:** Engage Microsoft Support for Sentinel-specific issues

### External Resources
- **Microsoft Sentinel Documentation:** https://docs.microsoft.com/azure/sentinel/
- **AWS GuardDuty Documentation:** https://docs.aws.amazon.com/guardduty/
- **KQL Reference:** https://docs.microsoft.com/azure/data-explorer/kusto/

### Emergency Contacts
- **Security Team:** security@company.com
- **Azure Support:** [Support Case Portal]
- **On-Call Engineer:** [Contact Information]

---

**Document Version:** 1.1.0  
**Last Updated:** 2024-02-01  
**Next Review:** 2024-05-01