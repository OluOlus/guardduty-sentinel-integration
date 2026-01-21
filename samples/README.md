# Sample Configurations and Data

This directory contains sample configurations, test data, and deployment guides for manual setup.

## Structure

- `config/` - Sample configuration files for different deployment scenarios
- `data/` - Sample GuardDuty findings and test data
- `kql/` - Sample KQL queries and functions for Sentinel
- `sentinel/` - Azure Sentinel analytics rules, workbooks, and playbooks

## Sample Data

The sample GuardDuty findings in `data/` cover various finding types:
- EC2 instance-based findings
- S3 bucket-based findings  
- IAM-based findings
- Network-based findings
- Kubernetes-based findings

## Configuration Examples

The `config/` directory includes:
- Azure Function deployment configuration
- Container App deployment configuration
- Lambda-to-HTTP deployment configuration
- Development and testing configurations

## Manual Deployment

See individual directories for deployment guides:
- AWS resource setup (S3, GuardDuty, IAM)
- Azure resource setup (Log Analytics, DCR, Service Principal)  
- Worker deployment options
- Sentinel analytics rules and workbooks deployment

## Azure Sentinel Integration

The `sentinel/` directory provides complete Azure Sentinel integration templates:
- **Analytics Rules**: Automated detection for high-severity findings, cryptocurrency mining, malware, and data exfiltration
- **Workbooks**: Executive dashboards and threat hunting workbooks for GuardDuty data visualization
- **Incident Templates**: Structured incident creation with investigation tasks and remediation guidance
- **Playbooks**: Automated response actions for common threat scenarios
- **Deployment Scripts**: PowerShell scripts for automated template deployment

See `sentinel/README.md` for detailed deployment instructions and customization guidelines.