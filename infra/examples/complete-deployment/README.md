# Complete GuardDuty to Sentinel Integration Deployment

This example demonstrates a complete deployment of the GuardDuty to Sentinel integration infrastructure, including AWS resources, Azure resources, and Sentinel analytics.

## Architecture

This deployment creates:

1. **AWS Infrastructure**:
   - S3 bucket with KMS encryption for GuardDuty findings
   - GuardDuty publishing destination (optional detector creation)
   - IAM roles for cross-service access
   - CloudWatch log groups for monitoring

2. **Azure Infrastructure**:
   - Resource group and Log Analytics workspace
   - Data Collection Endpoint and Data Collection Rule
   - Service principal for authentication
   - KQL functions for data normalization
   - Application Insights for monitoring (optional)

3. **Sentinel Analytics**:
   - Microsoft Sentinel workspace onboarding
   - Scheduled analytics rules for threat detection
   - Interactive workbooks for visualization
   - Automation rules for incident management
   - Action groups for notifications

## Prerequisites

### AWS Requirements
- AWS CLI configured with appropriate permissions
- GuardDuty service enabled (or permission to enable it)
- Permissions to create S3 buckets, KMS keys, and IAM roles

### Azure Requirements
- Azure CLI configured with appropriate permissions
- Permissions to create resource groups, Log Analytics workspaces
- Permissions to create service principals and assign RBAC roles
- Microsoft Sentinel license (if enabling Sentinel)

### Terraform Requirements
- Terraform >= 1.0
- AWS Provider ~> 5.0
- AzureRM Provider ~> 3.0
- AzureAD Provider ~> 2.0

## Quick Start

1. **Clone and Navigate**:
   ```bash
   git clone <repository>
   cd infra/examples/complete-deployment
   ```

2. **Configure Variables**:
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars with your specific values
   ```

3. **Initialize and Deploy**:
   ```bash
   terraform init
   terraform plan
   terraform apply
   ```

4. **Configure Ingestion Workers**:
   Use the output values to configure your ingestion workers (Lambda, Azure Function, or containers).

## Configuration

### Required Variables

```hcl
# Basic configuration
name_prefix = "my-company-guardduty"
environment = "prod"

# AWS and Azure regions
aws_region = "us-east-1"
azure_location = "East US"

# Notification configuration
notification_emails = ["security@company.com"]
```

### Optional Customizations

```hcl
# GuardDuty detector creation
create_guardduty_detector = false  # Use existing detector

# Data retention
s3_retention_days = 90
log_analytics_retention_days = 90

# Sentinel features
enable_sentinel = true
enable_automation_rules = true
high_severity_threshold = 7.0

# Analytics rule frequencies
analytics_rule_frequencies = {
  high_severity_findings = "PT30M"  # Every 30 minutes
  cryptocurrency_mining  = "PT2H"   # Every 2 hours
}
```

## Outputs

After deployment, Terraform provides several useful outputs:

### Worker Configuration
```bash
# Get configuration for ingestion workers
terraform output worker_configuration
```

### Resource URLs
```bash
# Get URLs for accessing deployed resources
terraform output resource_urls
```

### Sensitive Values
```bash
# Get sensitive configuration (Azure client secret, etc.)
terraform output -json sensitive_configuration
```

## Post-Deployment Steps

### 1. Verify GuardDuty Export
```bash
# Check GuardDuty publishing destination
aws guardduty get-detector --detector-id <detector-id>

# Verify S3 bucket permissions
aws s3 ls s3://<bucket-name>/
```

### 2. Test Azure Ingestion
```bash
# Test Data Collection Endpoint connectivity
curl -H "Authorization: Bearer <token>" \
     "<dce-uri>/dataCollectionRules/<dcr-id>/streams/Custom-GuardDutyFindings?api-version=2021-11-01-preview"
```

### 3. Configure Ingestion Workers
Use the worker configuration output to set up your ingestion workers:

```json
{
  "aws_region": "us-east-1",
  "s3_bucket_name": "my-company-guardduty-findings-prod",
  "azure_tenant_id": "12345678-1234-1234-1234-123456789012",
  "data_collection_endpoint_uri": "https://...",
  "data_collection_rule_id": "dcr-...",
  "client_id": "87654321-4321-4321-4321-210987654321"
}
```

### 4. Validate Sentinel Analytics
1. Navigate to the Sentinel workspace in Azure Portal
2. Check that analytics rules are enabled and running
3. Verify workbooks are accessible
4. Test notification configuration

## Monitoring and Maintenance

### Health Checks
```bash
# Check Terraform state
terraform plan

# Validate resource health
terraform refresh
```

### Updating Configuration
```bash
# Update variables in terraform.tfvars
# Apply changes
terraform plan
terraform apply
```

### Scaling Considerations
- **S3 Costs**: Monitor S3 storage costs and adjust retention policies
- **Log Analytics Costs**: Monitor ingestion volume and retention costs
- **Sentinel Costs**: Sentinel pricing is based on data ingestion volume
- **Analytics Rule Performance**: Monitor rule execution times and adjust frequencies

## Security Best Practices

### AWS Security
- Use least-privilege IAM policies
- Enable CloudTrail for audit logging
- Regularly rotate access keys
- Monitor S3 bucket access patterns

### Azure Security
- Use managed identities where possible
- Enable diagnostic logging for all resources
- Implement network security groups if using private endpoints
- Regularly review service principal permissions

### Cross-Cloud Security
- Use external IDs for cross-account role assumption
- Implement network-level security controls
- Monitor cross-cloud data transfer
- Encrypt all data in transit and at rest

## Troubleshooting

### Common Issues

1. **GuardDuty Not Exporting**:
   - Check publishing destination configuration
   - Verify S3 bucket permissions
   - Ensure KMS key policy allows GuardDuty access

2. **Azure Ingestion Failures**:
   - Verify service principal permissions
   - Check Data Collection Rule configuration
   - Validate network connectivity to DCE

3. **Sentinel Analytics Not Triggering**:
   - Ensure data is flowing to RawGuardDuty_CL table
   - Check analytics rule queries and thresholds
   - Verify Sentinel is properly enabled

4. **Missing Notifications**:
   - Test action group configuration
   - Verify email addresses and webhook URLs
   - Check incident creation settings

### Debugging Commands

```bash
# Check Terraform state
terraform show

# Validate configuration
terraform validate

# Get detailed output
terraform apply -auto-approve -detailed-exitcode

# Check provider versions
terraform version
```

## Cost Optimization

### AWS Costs
- Implement S3 lifecycle policies for cost optimization
- Use S3 Intelligent Tiering for automatic cost optimization
- Monitor KMS key usage and costs

### Azure Costs
- Choose appropriate Log Analytics pricing tier
- Implement data retention policies
- Monitor Sentinel data ingestion costs
- Use commitment tiers for predictable workloads

### Monitoring Costs
```bash
# AWS Cost Explorer API
aws ce get-cost-and-usage --time-period Start=2024-01-01,End=2024-01-31 --granularity MONTHLY --metrics BlendedCost

# Azure Cost Management
az consumption usage list --start-date 2024-01-01 --end-date 2024-01-31
```

## Advanced Configuration

### Custom Analytics Rules
Add custom detection logic by extending the `custom_analytics_rules` variable:

```hcl
custom_analytics_rules = [
  {
    name         = "GuardDuty Suspicious Login"
    display_name = "Suspicious Login Activity"
    description  = "Detects suspicious login patterns"
    severity     = "Medium"
    query        = "RawGuardDuty_CL | where Type contains 'UnauthorizedAPICall' | ..."
    frequency    = "PT1H"
    period       = "PT1H"
    threshold    = 1
  }
]
```

### Multi-Region Deployment
Deploy across multiple regions by creating separate Terraform configurations or using modules with different provider aliases.

### Integration with SIEM/SOAR
Configure webhooks to integrate with external SIEM/SOAR platforms:

```hcl
notification_webhooks = [
  "https://your-siem.company.com/api/webhooks/guardduty",
  "https://your-soar.company.com/api/incidents/create"
]
```