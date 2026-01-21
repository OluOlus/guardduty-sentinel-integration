# Azure Sentinel Templates for GuardDuty Integration

This directory contains Azure Sentinel analytics rules, workbooks, incident templates, and playbooks for AWS GuardDuty integration.

## Directory Structure

```
samples/sentinel/
├── analytics-rules/          # KQL queries for scheduled analytics rules
├── incident-templates/       # Incident creation templates with context
├── workbooks/               # Custom workbooks for visualization
├── playbooks/               # Logic Apps for automated response
└── README.md               # This documentation
```

## Analytics Rules

### High Severity Findings (`high-severity-guardduty-findings.kql`)
- **Purpose**: Detects GuardDuty findings with severity >= 7.0
- **Frequency**: 5 minutes
- **Features**: 
  - Automatic severity categorization (Critical/High/Medium)
  - Threat category classification
  - Remediation priority assignment

### Cryptocurrency Mining Detection (`cryptocurrency-mining-detection.kql`)
- **Purpose**: Identifies cryptocurrency mining activities
- **Frequency**: 15 minutes
- **Features**:
  - Mining indicator analysis
  - Risk score calculation
  - DNS and network pattern detection

### Malware and Backdoor Detection (`malware-and-backdoor-detection.kql`)
- **Purpose**: Detects malware, trojans, and backdoors
- **Frequency**: 10 minutes
- **Features**:
  - Malware family classification
  - Infection vector analysis
  - Automated remediation action suggestions

### Data Exfiltration Detection (`data-exfiltration-detection.kql`)
- **Purpose**: Identifies potential data exfiltration activities
- **Frequency**: 5 minutes (15-minute lookback)
- **Features**:
  - Exfiltration method classification
  - Data sensitivity assessment
  - Investigation step recommendations

## Incident Templates

### GuardDuty Incident Template (`guardduty-incident-template.json`)
- **Purpose**: Standardized incident creation with context and tasks
- **Features**:
  - Dynamic severity assignment based on GuardDuty score
  - Contextual labels and custom details
  - Structured investigation tasks
  - Threat-specific remediation guidance

## Workbooks

### GuardDuty Overview Workbook (`guardduty-overview-workbook.json`)
- **Purpose**: Executive dashboard for GuardDuty security posture
- **Features**:
  - Security findings summary tiles
  - Severity and threat category distribution
  - Timeline analysis by AWS account
  - Top malicious IP addresses
  - Account and region breakdown

### GuardDuty Threat Hunting Workbook (`guardduty-threat-hunting-workbook.json`)
- **Purpose**: Advanced threat hunting and investigation
- **Features**:
  - Cryptocurrency mining investigation
  - Malware family analysis
  - Network-based threat hunting
  - Instance compromise investigation
  - DNS-based threat analysis
  - Timeline analysis for investigations

## Playbooks

### GuardDuty Response Playbook (`guardduty-response-playbook.json`)
- **Purpose**: Automated incident response for GuardDuty findings
- **Features**:
  - Automatic threat categorization
  - Cryptocurrency mining traffic blocking
  - Instance isolation for malware
  - IP blocking for data exfiltration
  - Slack notifications
  - Incident status updates

## Deployment Instructions

### Prerequisites
1. Azure Sentinel workspace with GuardDuty data ingestion configured
2. `GuardDutyNormalized()` KQL function deployed (see `../kql/guardduty-normalized-function.kql`)
3. Appropriate permissions for creating analytics rules and workbooks

### Analytics Rules Deployment

1. **Navigate to Azure Sentinel Analytics**:
   - Go to Azure Sentinel > Analytics > Create > Scheduled query rule

2. **Configure Rule Settings**:
   - **Name**: Use the filename without extension (e.g., "High Severity GuardDuty Findings")
   - **Description**: Copy from the KQL file comments
   - **Tactics**: Select appropriate MITRE ATT&CK tactics
   - **Severity**: Set based on rule purpose (High for critical findings)

3. **Set Rule Logic**:
   - Copy the KQL query from the respective `.kql` file
   - **Query scheduling**: Use frequency specified in file comments
   - **Lookup data**: Set to same as frequency for real-time detection

4. **Configure Incident Settings**:
   - **Create incidents**: Enabled
   - **Group related alerts**: By all entities (recommended)
   - **Re-open closed matching incidents**: Disabled

5. **Configure Automated Response**:
   - Attach the GuardDuty Response Playbook if deployed

### Workbook Deployment

1. **Navigate to Azure Sentinel Workbooks**:
   - Go to Azure Sentinel > Workbooks > Add workbook

2. **Import Workbook**:
   - Click "Advanced Editor"
   - Replace the default JSON with content from workbook files
   - Click "Apply" then "Done Editing"

3. **Save Workbook**:
   - Click "Save" and provide appropriate name and location

### Incident Template Usage

The incident template is referenced by analytics rules and provides:
- Structured incident creation with relevant context
- Pre-defined investigation tasks based on finding type
- Custom fields for GuardDuty-specific data
- Automated severity and classification assignment

### Playbook Deployment

1. **Deploy ARM Template**:
   ```bash
   az deployment group create \
     --resource-group <resource-group> \
     --template-file guardduty-response-playbook.json \
     --parameters PlaybookName="GuardDuty-AutoResponse" \
                  SlackWebhookUrl="<webhook-url>" \
                  AWSAccessKeyId="<access-key>" \
                  AWSSecretAccessKey="<secret-key>"
   ```

2. **Configure Connections**:
   - Authorize the Azure Sentinel connection
   - Test the playbook with sample data

3. **Attach to Analytics Rules**:
   - Edit analytics rules to include automated response
   - Select the deployed playbook in the "Automated response" tab

## Customization Guidelines

### Analytics Rules
- Adjust severity thresholds based on your environment
- Modify frequency based on data volume and response capabilities
- Add environment-specific filtering (accounts, regions)
- Customize threat categorization logic

### Workbooks
- Modify time ranges and default parameters
- Add organization-specific visualizations
- Customize color schemes and formatting
- Add additional KQL queries for specific use cases

### Incident Templates
- Customize task instructions for your procedures
- Add organization-specific labels and fields
- Modify severity mapping based on your classification system
- Update remediation guidance for your environment

### Playbooks
- Replace Slack integration with your notification system
- Add organization-specific AWS API calls
- Customize response actions based on your security policies
- Add integration with ITSM systems

## Monitoring and Maintenance

### Analytics Rule Performance
- Monitor rule execution time and resource usage
- Review false positive rates and adjust thresholds
- Update rules based on new GuardDuty finding types
- Validate rule effectiveness with security metrics

### Workbook Usage
- Track workbook usage and user feedback
- Update visualizations based on analyst needs
- Add new hunting queries based on threat landscape
- Optimize query performance for large datasets

### Playbook Reliability
- Monitor playbook execution success rates
- Test automated responses in non-production environments
- Update AWS API calls for new services and regions
- Validate notification delivery and escalation paths

## Troubleshooting

### Common Issues
1. **Missing GuardDuty data**: Verify data ingestion pipeline
2. **KQL function errors**: Ensure `GuardDutyNormalized()` is deployed
3. **Playbook failures**: Check AWS credentials and permissions
4. **Workbook performance**: Optimize queries and time ranges

### Support Resources
- Azure Sentinel documentation
- GuardDuty finding format reference
- KQL query optimization guides
- Logic Apps troubleshooting documentation