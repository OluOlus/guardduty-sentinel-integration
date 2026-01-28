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
4. WHEN processing data, THE system SHALL track and report ingestion latency metricsRequirements Document
Sentinel-AWS-GuardDuty-Bridge
1. Goal

Provide a simple, repeatable way to ingest AWS GuardDuty findings into Microsoft Sentinel, then normalize them with KQL functions so SOC teams can hunt, alert, and report consistently.

Non-goals (for MVP)

Building a new SIEM connector from scratch

Supporting every GuardDuty finding type on day one

Complex enrichment (GeoIP, threat intel) beyond basic fields

2. Architecture
MVP Data Flow (default)

AWS GuardDuty exports findings to S3 (JSON)

Ingestion Worker reads objects and sends to Azure Monitor Logs (DCR ingestion)

Logs land as raw records in Log Analytics (GuardDuty_CL with RawData)

KQL parsers create normalized functions:

AWSGuardDuty_Main

AWSGuardDuty_Network

AWSGuardDuty_IAM

Terraform is optional and only provides deployment accelerators.

3. Data Contract
Raw table contract (MVP)

Table: GuardDuty_CL

Required columns

TimeGenerated (datetime) – created automatically by Log Analytics

RawData (string) – the raw GuardDuty JSON

Parser contract

KQL parsers must assume only:

Table name + raw column name + default lookback are configurable via AWSGuardDuty_Config

4. Deliverables
MVP Deliverables (must-have)

AWS export configuration guide (S3 destination + encryption notes)

Ingestion worker (minimal) that:

reads S3 JSON objects

sends raw JSON to Azure Logs (DCR endpoint)

KQL functions:

AWSGuardDuty_Config

AWSGuardDuty_Main

AWSGuardDuty_Network

AWSGuardDuty_IAM

Deployment template (ARM/Bicep) to deploy KQL functions

Test pack:

sample data

test queries

CI checks for template + sample data validity

Nice-to-have (after MVP)

Deduplication store

DLQ

Workbooks + analytics rules

Multi-account export automation

ASIM full normalization (strict schema)

5. Requirements (MVP)
R1: GuardDuty Export to S3

User story: As a security engineer, I want GuardDuty findings exported to S3 so they can be ingested into Sentinel.

Acceptance criteria

GuardDuty findings must be exported as JSON to an S3 bucket.

Export must support KMS encryption (SSE-KMS) for data at rest.

Export must preserve the raw JSON structure (no modification).

Implementation note (MVP)

Use AWS GuardDuty publishing destination to S3.

Multi-account support is optional for MVP.

R2: Ingestion Worker (Minimal + Secure)

User story: As a security engineer, I want a simple ingestion component that moves findings from S3 to Azure Logs securely.

Acceptance criteria

Worker must authenticate to AWS using least-privileged credentials (assume role preferred).

Worker must be able to read encrypted objects (KMS decrypt permissions if needed).

Worker must send data to Azure Logs using HTTPS only.

Worker must send records in a format compatible with DCR ingestion (one record per finding).

Worker must validate that payload is valid JSON before sending (drop/

i dont want to create a connector from scratch.. usimng the existing guarduty  S3  connector.. we need to ensure they are easily parsed in sentinel.. use the internet for problem stement
Thought for 36s

Here’s a reworked requirements doc that does not build a connector, and instead assumes you’re using the existing Microsoft Sentinel “Amazon Web Services S3” connector. The focus becomes: make GuardDuty data easy to query + normalize (ASIM-aligned) once it lands in Sentinel.

Requirements Document
Sentinel-AWS-GuardDuty-Bridge (Parsing & Normalization Layer)
1) Problem statement (internet-backed)

Microsoft Sentinel supports ingesting AWS GuardDuty findings via the Amazon Web Services S3 connector (installed through Content Hub), where you configure an AWS role + SQS queue and select the destination table for the data type.

However, teams still struggle to operationalize GuardDuty data because:

Ingestion success ≠ usable data: the connector can show “connected” even when no data is actually ingested yet.

GuardDuty ingestion failures commonly come down to KMS permissions when logs are encrypted (a frequent real-world issue).

Even when GuardDuty lands successfully (for example in the AWSGuardDuty table), analysts still need consistent schemas to hunt and correlate across data sources. Microsoft’s ASIM exists specifically to enable normalized queries that work across sources.

Therefore: the project’s value is a reusable KQL parsing + normalization package (functions + config + tests + deployment) that makes GuardDuty immediately queryable and ASIM-friendly once ingested.

2) Scope
In scope (MVP)

Use existing Sentinel AWS S3 connector for ingestion (no custom connector).

Provide:

Configurable KQL parsing functions for GuardDuty

ASIM-aligned outputs (at minimum: network-session friendly fields)

Deployment template (ARM/Bicep) to install functions

Testing pack (sample data + expected query outputs + CI validation)

Out of scope (MVP)

Building/hosting a new ingestion pipeline (Function App / Logstash / etc.)

Full ASIM certification across all schemas (we’ll be “ASIM-aligned” first)

Full analytics rules library (optional add-on)

3) Assumptions & data sources

GuardDuty findings are collected using the Amazon Web Services S3 connector in Sentinel.

GuardDuty data lands in a dedicated table (commonly AWSGuardDuty when using Sentinel’s connector for that data type).

The table contains structured columns (e.g., AccountId, ActivityType, etc.), but the solution must also preserve raw JSON where possible for troubleshooting.

4) Goals

Make GuardDuty findings easy to query with simple, consistent KQL functions.

Enable SOC teams to hunt using normalized field names aligned to ASIM concepts.

Reduce onboarding friction: one config function + one deployment template.

5) Functional requirements (straightforward)
FR1 — Connector readiness validation

User story: As an engineer, I want to quickly validate the connector is truly ingesting data (not just “connected”).

Acceptance criteria

Provide a “smoke test” KQL query that confirms:

data exists in the GuardDuty destination table (e.g., AWSGuardDuty)

newest record time is within expected window

Provide troubleshooting checks for the known GuardDuty failure mode: KMS permissions.

FR2 — Config-first parsing layer

User story: As a user, I want to change table/columns once and have all parsers follow.

Acceptance criteria

A single function AWSGuardDuty_Config defines:

TableName

RawColumn (if present / optional)

DefaultLookback

All other functions read config, not hardcoded strings.

FR3 — Base parser function

User story: As an analyst, I want a single “main” parser that standardizes core finding fields.

Acceptance criteria

Function: AWSGuardDuty_Main(lookback=DefaultLookback)

Must output consistent columns (minimum):

TimeGenerated, EventTime

FindingId, FindingType, Severity, Title

AwsAccountId, AwsRegion

ActionType (from GuardDuty action)

RawJson (if available)

Parsed dynamic object (gd) if raw JSON exists (so downstream parsers don’t re-parse)

FR4 — Specialized parsers

User story: As an analyst, I want focused parsers for common GuardDuty operational use cases.

Acceptance criteria

AWSGuardDuty_Network() extracts:

RemoteIp, RemotePort, LocalIp, LocalPort, Protocol, Direction

best-effort instance context (InstanceId/VpcId/SubnetId)

AWSGuardDuty_IAM() extracts:

API call details (service, API name, error code)

identity context (user/role/access key where available)

FR5 — ASIM-aligned outputs (minimum viable)

User story: As an analyst, I want GuardDuty network findings to be usable in network-session style hunting.

Acceptance criteria

Provide an additional function (or view-style function) that maps GuardDuty network fields into an ASIM Network Session-friendly set (not necessarily full schema on day one).
ASIM’s purpose is to let queries work across normalized sources.

FR6 — Deployment (one-click)

User story: As an engineer, I want to deploy parsers quickly into a workspace.

Acceptance criteria

ARM/Bicep deploys:

config function

main + specialized parsers

README includes:

connector prerequisites

validation queries

known issue callout (GuardDuty + KMS)

6) Non-functional requirements

Maintainable: shared config + shared base parser pattern

Performant: parse JSON once, avoid repeated parse_json where possible

Auditable: keep RawJson (when possible) for traceability

Portable: doesn’t assume a single table name; config-driven

7) Testing requirements (no production AWS needed)

Acceptance criteria

Repo includes:

sample-data/guardduty_findings.jsonl (small set)

“local KQL unit tests” pattern using datatable() to simulate the destination table

test queries + expected results (documented)

CI checks:

ARM template JSON validity

sample data validity

presence of required parser files

8) Deliverables checklist (MVP)

Parsers/

AWSGuardDuty_Config.kql

AWSGuardDuty_Main.kql

AWSGuardDuty_Network.kql

AWSGuardDuty_IAM.kql

AWSGuardDuty_ASIMNetworkSession.kql (minimal ASIM-aligned mapping)

Deploy/azuredeploy.json

sample-data/…

README.md (with connector validation + KMS troubleshooting note)

9) Implementation steps (simple)

Install & configure AWS S3 connector for GuardDuty (Content Hub → AWS solution → connector)

Confirm GuardDuty table has data (smoke test query)

Deploy parser package (ARM)

Run parser test queries

(Optional) Add 2–3 detections + workbook later

If you paste what table the connector is writing GuardDuty into in your workspace (sometimes it’s AWSGuardDuty), I’ll tailor the config + parsers to match that exactly and include the correct smoke-test queries.

how easy is this for implementation?
Thought for 55s

If you use the existing Sentinel “Amazon Web Services S3” connector, this becomes very implementable. The “heavy lift” is mostly configuration, not software engineering.

What’s easy vs what’s tricky
Easy parts

No custom connector: Microsoft’s AWS S3 connector already supports GuardDuty as an ingestible log type.

Automatic setup exists: Microsoft provides an automation script that can create the AWS-side plumbing (OIDC provider, IAM role, S3 bucket/SQS, permissions, and service export configuration).

Your open-source deliverable is mainly KQL functions + deployment template (fast iteration, no deep backend build).

Tricky parts (but predictable)

These are the usual reasons people think it’s “impossible”:

“Connected” doesn’t mean “data ingested.” The status can be green even when nothing has arrived yet.

KMS encryption permissions are a common GuardDuty-specific failure mode (no errors, just no data).

S3/SQS wiring rules: separate SQS per log type, and often per path/prefix.

Log format constraints: GuardDuty is expected as json-line (and optionally GZIP) per the connector requirements.

How “easy” is implementation in practice?

Low-to-medium difficulty because:

The connector + script removes most of the AWS complexity.

Your work is “productizing” the analysis layer: parsers, config, tests, deployment.

Minimal implementation path (what you actually do)

Install the Amazon Web Services solution from Sentinel Content Hub and open the AWS S3 connector.

Run automatic setup (recommended) to generate the AWS role + SQS URL and connect it in Sentinel.

Validate ingestion with a quick KQL “smoke test” (and know that “connected” ≠ “ingesting”).

Deploy your KQL package (Config + Main + Network + IAM) and verify the functions run.

If GuardDuty data doesn’t show up, first check the known GuardDuty causes: KMS permissions + S3→SQS notifications + required policies.

Why this is feasible for <2 years experience

You’re not inventing infrastructure. You’re shipping:

A clean, config-driven parsing layer

A deployment template

A test pack + troubleshooting notes for the most common connector failures (especially KMS)

That’s exactly the kind of “high impact, low code” open-source project that looks mature.

If you tell me what table your connector writes GuardDuty into in your workspace (often AWSGuardDuty), I’ll tailor the smoke-test queries + parsers config to match it exactly.