# Requirements Document

## Introduction

This document specifies the requirements for an end-to-end AWS GuardDuty to Azure Sentinel integration system. The system enables security teams to centralize AWS threat detection findings in Azure Sentinel for unified security operations, correlation, and incident response.

## Glossary

- **GuardDuty_Service**: AWS GuardDuty threat detection service that generates security findings
- **S3_Export_System**: AWS S3 bucket with KMS encryption for storing GuardDuty findings
- **Ingestion_Worker**: Processing component (Azure Function/container/Lambda) that reads S3 objects and sends data to Azure
- **Azure_Monitor_Logs**: Azure service for log ingestion via Data Collection Rules
- **Log_Analytics_Workspace**: Azure workspace containing RawGuardDuty_CL table and normalized views
- **Sentinel_Analytics**: Azure Sentinel scheduled analytics rules that generate incidents and alerts
- **DCR**: Data Collection Rule - Azure's modern ingestion path configuration
- **DCE**: Data Collection Endpoint - Azure endpoint for log ingestion
- **KQL_Parser**: Kusto Query Language function for data normalization
- **Terraform_Modules**: Infrastructure-as-code deployment accelerator (optional)

## Requirements

### Requirement 1: GuardDuty Findings Export

**User Story:** As a security engineer, I want GuardDuty findings automatically exported to S3, so that they can be processed and ingested into Azure Sentinel.

#### Acceptance Criteria

1. WHEN GuardDuty generates a finding, THE S3_Export_System SHALL store the finding as JSON in an encrypted S3 bucket
2. WHEN storing findings, THE S3_Export_System SHALL encrypt data using AWS KMS keys
3. THE GuardDuty_Service SHALL publish findings to a designated S3 destination via aws_guardduty_publishing_destination
4. WHEN findings are exported, THE S3_Export_System SHALL maintain the original JSON structure and metadata

### Requirement 2: Secure Data Ingestion

**User Story:** As a security engineer, I want the ingestion worker to securely read S3 findings and send them to Azure, so that data remains protected during transit and processing.

#### Acceptance Criteria

1. WHEN the Ingestion_Worker accesses S3 objects, THE system SHALL authenticate using appropriate AWS credentials
2. WHEN reading encrypted S3 objects, THE Ingestion_Worker SHALL decrypt data using the associated KMS key
3. WHEN sending data to Azure, THE Ingestion_Worker SHALL use secure HTTPS connections
4. WHEN processing findings, THE Ingestion_Worker SHALL validate JSON structure before transmission

### Requirement 3: Batch Processing and Reliability

**User Story:** As a system administrator, I want the ingestion worker to process findings efficiently with retry logic, so that the system handles failures gracefully and processes data reliably.

#### Acceptance Criteria

1. WHEN processing multiple S3 objects, THE Ingestion_Worker SHALL batch findings to optimize throughput
2. WHEN transmission failures occur, THE Ingestion_Worker SHALL implement exponential backoff retry logic
3. WHEN retries are exhausted, THE Ingestion_Worker SHALL log failures and optionally send to dead letter queue
4. WHEN processing large volumes, THE Ingestion_Worker SHALL maintain configurable batch sizes
5. WHEN duplicate findings are detected, THE Ingestion_Worker SHALL handle deduplication appropriately

### Requirement 4: Azure Monitor Logs Integration

**User Story:** As a security analyst, I want findings ingested into Azure Monitor Logs via modern DCR architecture, so that data follows Azure's recommended ingestion patterns.

#### Acceptance Criteria

1. WHEN ingesting data, THE Azure_Monitor_Logs SHALL use Data Collection Endpoint and Data Collection Rule configuration
2. WHEN receiving findings, THE Log_Analytics_Workspace SHALL store raw JSON in RawGuardDuty_CL table
3. THE system SHALL support both raw and normalized data ingestion modes
4. WHEN normalization is enabled, THE Ingestion_Worker SHALL transform findings before sending to Azure

### Requirement 5: Data Normalization and Parsing

**User Story:** As a security analyst, I want GuardDuty findings normalized into a consistent schema, so that I can query and correlate data effectively across different AWS accounts and regions.

#### Acceptance Criteria

1. THE KQL_Parser SHALL create normalized views from RawGuardDuty_CL table data
2. WHEN parsing findings, THE KQL_Parser SHALL extract standard fields like severity, finding type, account ID, and region
3. WHEN normalization is optional, THE system SHALL function with raw JSON data only
4. WHEN parsing fails, THE KQL_Parser SHALL handle malformed JSON gracefully and log errors

### Requirement 6: Sentinel Analytics and Alerting

**User Story:** As a security analyst, I want automated analytics rules to generate incidents and alerts from GuardDuty findings, so that threats are detected and escalated promptly.

#### Acceptance Criteria

1. THE Sentinel_Analytics SHALL run scheduled KQL queries against normalized GuardDuty data
2. WHEN high-severity findings are detected, THE Sentinel_Analytics SHALL generate incidents automatically
3. WHEN generating alerts, THE Sentinel_Analytics SHALL include relevant context and remediation guidance
4. THE system SHALL support custom workbooks for GuardDuty data visualization

### Requirement 7: Modular Architecture

**User Story:** As a DevOps engineer, I want the core system to work without Terraform dependencies, so that teams can deploy using their preferred infrastructure tools.

#### Acceptance Criteria

1. THE core system SHALL function with manual Azure and AWS resource configuration
2. WHEN Terraform is not used, THE system SHALL provide sample configurations and deployment guides
3. THE Terraform_Modules SHALL serve as deployment accelerators under infra/ directory
4. WHEN using Terraform, THE modules SHALL be minimal but valuable for common deployment scenarios

### Requirement 8: Testing and Validation

**User Story:** As a developer, I want comprehensive testing capabilities including sample data, so that I can validate the integration works correctly.

#### Acceptance Criteria

1. THE system SHALL include sample GuardDuty findings for testing ingestion workflows
2. WHEN testing, THE system SHALL provide unit tests for data transformation and parsing logic
3. THE system SHALL include integration tests that validate end-to-end data flow
4. WHEN validating KQL queries, THE system SHALL provide test data and expected results

### Requirement 9: Configuration Management

**User Story:** As a system administrator, I want configurable settings for batch sizes, retry policies, and normalization options, so that I can tune the system for different environments.

#### Acceptance Criteria

1. THE Ingestion_Worker SHALL support configurable batch sizes for S3 object processing
2. WHEN configuring retries, THE system SHALL allow customizable retry counts and backoff intervals
3. THE system SHALL support environment-specific configuration for AWS and Azure connection settings
4. WHEN normalization is optional, THE system SHALL provide configuration flags to enable/disable transformation

### Requirement 10: Monitoring and Observability

**User Story:** As a system administrator, I want visibility into ingestion performance and errors, so that I can monitor system health and troubleshoot issues.

#### Acceptance Criteria

1. THE Ingestion_Worker SHALL emit metrics for processed findings, success rates, and error counts
2. WHEN errors occur, THE system SHALL log detailed error information with context
3. THE system SHALL provide health check endpoints for monitoring system availability
4. WHEN processing data, THE system SHALL track and report ingestion latency metrics