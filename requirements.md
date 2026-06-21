# Requirements Document — Sentinel-AWS-GuardDuty-Bridge (Parsing & Normalization Layer)

---

## 1. Problem Statement

Microsoft Sentinel supports ingesting AWS GuardDuty findings via the **Amazon Web Services S3 connector** (installed through Content Hub). The connector uses an AWS IAM role and SQS queue to pull findings from S3 into a dedicated Log Analytics table.

However, teams regularly struggle to operationalize GuardDuty data after ingestion because:

- **Ingestion success ≠ queryable data.** The connector shows "Connected" even when no data has arrived.
- **KMS encryption is the #1 silent failure mode.** When findings are encrypted at rest, the connector silently drops records if the IAM role lacks `kms:Decrypt` on the GuardDuty KMS key.
- **Raw table data is inconsistent across delivery formats.** GuardDuty findings arrive either as direct JSON or wrapped in an EventBridge envelope (`detail-type: "GuardDuty Finding"`). Parsers must handle both.
- **No normalized schema for cross-source hunting.** Analysts need ASIM-aligned field names to write queries that work across GuardDuty, Defender, and other sources.
- **Multiple finding categories (Network, IAM, S3, EKS) require category-specific field extraction.** A single flat parser is insufficient.

**This project's value is a reusable KQL parsing and normalization package** — functions, config, tests, and deployment — that makes GuardDuty immediately queryable and ASIM-aligned once the connector is configured.

---

## 2. Scope

### In Scope (MVP)

- Use the existing Microsoft Sentinel AWS S3 connector for ingestion (no custom connector).
- KQL parsing functions for all major GuardDuty finding categories.
- ASIM-aligned outputs (at minimum: Network Session schema).
- ARM/Bicep deployment template to install all functions in one step.
- Testing pack: sample data, unit test queries using `datatable()`, CI validation.
- Documentation: connector setup guide, KMS troubleshooting, smoke tests, deployment runbook.

### Out of Scope (MVP)

- Building or hosting a custom ingestion pipeline (Function App, Logstash, etc.).
- Full ASIM schema certification across all schemas.
- Complete analytics rules library (optional add-on post-MVP).
- Multi-account export automation.
- Deduplication store or DLQ.

---

## 3. Assumptions & Data Sources

- GuardDuty findings are delivered to a Log Analytics table via the **Amazon Web Services S3 connector** in Microsoft Sentinel Content Hub.
- The default destination table is `AWSGuardDuty`. The table name is configurable.
- Raw JSON column is typically `EventData` with `Message` as a fallback; both are configurable.
- GuardDuty findings arrive in **two formats** that parsers must handle:
  - **Direct format** — the raw object IS the GuardDuty finding (`schemaVersion`, `id`, `type`, etc. at root level).
  - **EventBridge envelope format** — the finding is nested under a `detail` key (`detail-type: "GuardDuty Finding"`).
- `schemaVersion` is `2.0` for current GuardDuty findings.

---

## 4. Goals

1. Make GuardDuty findings easy to query with simple, consistent KQL functions.
2. Enable SOC teams to hunt using normalized field names aligned to ASIM concepts.
3. Cover all major GuardDuty finding categories: Network, IAM, S3, and EKS/Kubernetes.
4. Reduce onboarding friction: one config function, one deployment template.
5. Provide built-in validation and troubleshooting for the most common connector failures.

---

## 5. Functional Requirements

### FR1 — Connector Readiness Validation

**User story:** As an engineer, I want to quickly validate the connector is truly ingesting data (not just "connected").

**Acceptance criteria:**
- Provide a smoke-test KQL query confirming data exists in the GuardDuty table and the newest record is within the expected window.
- Provide structured troubleshooting checks for the known KMS failure mode (connector reports success but no data flows).
- Smoke tests must run without modifying the workspace (read-only queries only).

---

### FR2 — Config-First Parsing Layer

**User story:** As a user, I want to change table/column names once and have all parsers follow.

**Acceptance criteria:**
- A single function `AWSGuardDuty_Config()` defines: `TableName`, `RawColumn`, `AlternateRawColumn`, `DefaultLookback`, `MaxLookback`, `MinSeverityScore`, `MaxSeverityScore`, `EnableGeoEnrichment`, `EnableASIMNormalization`, `EnableDataValidation`, `HandleEventBridgeEnvelope`, `ParserVersion`.
- All other functions read config values; no table names or column names are hardcoded in downstream parsers.

---

### FR3 — Base Parser Function

**User story:** As an analyst, I want a single "main" parser that standardizes core finding fields regardless of input format.

**Acceptance criteria:**
- Function: `AWSGuardDuty_Main(lookback: timespan)`
- Must auto-detect and unwrap the EventBridge envelope format when `detail-type == "GuardDuty Finding"`.
- Must output consistent columns (minimum):

  | Column | Type | Description |
  |---|---|---|
  | `TimeGenerated` | datetime | Log Analytics ingest time |
  | `EventTime` | datetime | GuardDuty finding creation time |
  | `FindingId` | string | Unique finding identifier |
  | `FindingType` | string | GuardDuty finding type (e.g., `Backdoor:EC2/DenialOfService.Tcp`) |
  | `Severity` | double | Numeric severity 0–10 |
  | `SeverityLevel` | string | `Critical` / `High` / `Medium` / `Low` / `Informational` |
  | `Title` | string | Human-readable finding title |
  | `Description` | string | Finding description |
  | `AwsAccountId` | string | AWS account ID (12-digit) |
  | `AwsRegion` | string | AWS region |
  | `ActionType` | string | GuardDuty action type (`NETWORK_CONNECTION`, `AWS_API_CALL`, etc.) |
  | `ResourceType` | string | Affected resource type |
  | `DataQualityScore` | int | 0–100 data completeness score |
  | `RawJson` | string | Original raw JSON for traceability |
  | `gd` | dynamic | Parsed JSON object passed to downstream parsers |

- Must apply a data quality score and optionally filter low-quality records when `EnableDataValidation` is true.

---

### FR4 — Specialized Parsers

**User story:** As an analyst, I want focused parsers for each major GuardDuty finding category.

**Acceptance criteria — AWSGuardDuty_Network():**
- Filters for `NETWORK_CONNECTION` action type and network-related finding types.
- Extracts: `RemoteIp`, `RemoteIpV6`, `RemotePort`, `RemotePortName`, `LocalPort`, `LocalPortName`, `Protocol`, `ConnectionDirection`, `IsBlocked`.
- Extracts geographic details from GuardDuty native fields (country, city, lat/lon, ISP, ASN).
- Optionally enriches with `geo_info_from_ip_address()` when `EnableGeoEnrichment` is true.
- Extracts instance context: `InstanceId`, `VpcId`, `SubnetId`, `PrivateIp`, `PublicIp`, `SecurityGroupIds`.
- Calculates `NetworkRiskScore` and `ThreatCategory`.

**Acceptance criteria — AWSGuardDuty_IAM():**
- Filters for `AWS_API_CALL` action type and identity-related finding types.
- Extracts: `ApiName`, `ServiceName_API`, `CallerType`, `ErrorCode`, `UserAgent`.
- Extracts identity context: `UserName`, `UserType`, `AccessKeyId`, `PrincipalId`, `SessionName`.
- Determines `AuthenticationMethod`, `ActionResult`, `FindingCategory`, and `RiskScore`.
- Flags `ThreatIndicators` for high-risk geographies, anonymization services, and privilege operations.

**Acceptance criteria — AWSGuardDuty_S3():**
- Filters for S3-related finding types (`Policy:S3/*`, `Stealth:S3/*`, `Discovery:S3/*`, `Impact:S3/*`, `Exfiltration:S3/*`).
- Extracts: `BucketName`, `BucketArn`, `BucketOwner`, `BucketCreatedAt`.
- Extracts encryption details: `EncryptionType`, `KmsKeyArn`.
- Extracts public access configuration: `BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy`, `RestrictPublicBuckets`, `EffectivePermission`.
- Extracts S3 ACL-level and bucket-level public access flags.
- Provides `S3RiskCategory` (data exposure, reconnaissance, lateral movement, etc.).
- Correlates with the IAM caller context when present.

**Acceptance criteria — AWSGuardDuty_EKS():**
- Filters for Kubernetes/EKS finding types (`*:Kubernetes/*`, `*:Runtime/*`).
- Extracts Kubernetes audit log fields: `K8sApiName`, `K8sApiVerb`, `K8sNamespace`, `K8sObjectKind`, `K8sObjectName`.
- Extracts Kubernetes user context: `K8sUsername`, `K8sUserGroups`, `K8sUserType`.
- Extracts source IP and user agent for the Kubernetes API call.
- Provides `K8sThreatCategory` (privilege escalation, container escape, persistence, etc.).

---

### FR5 — ASIM-Aligned Output (Minimum Viable)

**User story:** As an analyst, I want GuardDuty network findings to be usable in network-session style hunting across sources.

**Acceptance criteria:**
- Function: `AWSGuardDuty_ASIMNetworkSession(lookback: timespan)`
- Maps GuardDuty network fields to ASIM Network Session schema v0.2.6.
- Required ASIM fields: `EventType`, `EventVendor`, `EventProduct`, `EventSchemaVersion`, `SrcIpAddr`, `DstIpAddr`, `NetworkProtocol`, `NetworkDirection`.
- Maps threat fields: `ThreatName`, `ThreatCategory`, `ThreatRiskLevel`, `ThreatIpAddr`.
- Packs AWS-specific context into `AdditionalFields` bag for traceability.
- Only references columns that exist in the `AWSGuardDuty_Network()` output schema.

---

### FR6 — Schema Validation Function

**User story:** As an engineer, I want to assess the quality and structure of ingested GuardDuty data.

**Acceptance criteria:**
- Function: `AWSGuardDuty_Schema(lookback: timespan)`
- Validates presence and correctness of required fields: `id`, `type`, `severity`, `accountId`, `region`, `createdAt`.
- Validates data types: severity in range 0–10, accountId is 12 digits, timestamp is after 2010.
- Produces per-record quality scores: `RequiredFieldsScore`, `ValidationScore`, `OverallQualityScore`, `QualityCategory`.

---

### FR7 — Deployment (One-Click)

**User story:** As an engineer, I want to deploy all parsers quickly into a Log Analytics workspace.

**Acceptance criteria:**
- ARM template (`deployment/azuredeploy.json`) and Bicep (`deployment/deploy.bicep`) deploy **all** functions:
  - `AWSGuardDuty_Config`
  - `AWSGuardDuty_Main`
  - `AWSGuardDuty_Network`
  - `AWSGuardDuty_IAM`
  - `AWSGuardDuty_S3`
  - `AWSGuardDuty_EKS`
  - `AWSGuardDuty_ASIMNetworkSession`
  - `AWSGuardDuty_Schema`
- Template parameters: `workspaceName`, `guardDutyTableName`, `rawDataColumn`, `defaultLookback`.
- README includes: connector prerequisites, validation queries, known KMS issue callout, parser function reference.

---

## 6. Non-Functional Requirements

| Requirement | Description |
|---|---|
| **Maintainable** | Shared config + shared base parser pattern. No hardcoded strings in specialized parsers. |
| **Performant** | Parse JSON once in `AWSGuardDuty_Main`; downstream parsers consume the `gd` dynamic object. |
| **Auditable** | Preserve `RawJson` in all parsers for full traceability back to the original finding. |
| **Portable** | Config-driven; no assumption of a fixed table name or column name. |
| **Resilient** | Use `try_parse_json()` and `coalesce()` throughout; never fail on a missing field. |
| **Correct** | All column references in specialized parsers must exist in the upstream parser's output schema. |

---

## 7. Testing Requirements

**No production AWS environment is required to run tests.**

**Acceptance criteria:**
- `sample-data/guardduty_findings.jsonl` — representative findings covering: Network (INBOUND/OUTBOUND), IAM (API call), S3 (public access), EKS (audit log), high/medium/low severity, both direct JSON and EventBridge envelope formats.
- `sample-data/test_queries.kql` — KQL unit tests using `datatable()` to simulate the `AWSGuardDuty` table without a live workspace.
- CI checks on every push/PR to `kql/**`, `deployment/**`, `sample-data/**`:
  - ARM template JSON is valid.
  - All JSONL sample data lines are valid JSON.
  - All required parser `.kql` files exist.
  - Basic KQL bracket balance check.
  - Config function contains `datatable` keyword.
  - Specialized parsers reference `AWSGuardDuty_Config` or `AWSGuardDuty_Main`.
  - Required documentation files exist.
  - Required ARM template parameters exist.

---

## 8. Deliverables Checklist (MVP)

### KQL Parsers (`kql/`)
- [x] `AWSGuardDuty_Config.kql`
- [x] `AWSGuardDuty_Main.kql`
- [x] `AWSGuardDuty_Network.kql`
- [x] `AWSGuardDuty_IAM.kql`
- [x] `AWSGuardDuty_S3.kql`
- [x] `AWSGuardDuty_EKS.kql`
- [x] `AWSGuardDuty_ASIMNetworkSession.kql`
- [x] `AWSGuardDuty_Schema.kql`

### Deployment (`deployment/`)
- [x] `azuredeploy.json` — deploys all 8 parsers
- [x] `deploy.bicep`
- [x] `parameters/dev.parameters.json`
- [x] `parameters/prod.parameters.json`

### Validation (`validation/`)
- [x] `smoke_tests.kql`
- [x] `troubleshooting.kql`

### Sample Data (`sample-data/`)
- [x] `guardduty_findings.jsonl` — covers Network, IAM, S3, EKS, EventBridge envelope
- [x] `test_queries.kql`

### Documentation (`docs/`)
- [x] `connector-setup.md`
- [x] `troubleshooting.md`
- [x] `kms-permissions.md`
- [x] `deployment-runbook.md`

### CI/CD (`.github/workflows/`)
- [x] `validate-kql.yml`

---

## 9. Implementation Steps

1. Install **Amazon Web Services** solution from Sentinel Content Hub; open the AWS S3 connector.
2. Run the automatic setup script to create the AWS IAM role, SQS queue, and S3 bucket notification.
3. Configure the GuardDuty publishing destination to point to the S3 bucket.
4. **Critical:** Verify the GuardDuty KMS key policy allows `kms:Decrypt` for the Sentinel connector IAM role. See `docs/kms-permissions.md`.
5. Run smoke-test queries from `validation/smoke_tests.kql` to confirm data is flowing.
6. Deploy the KQL parser package:
   ```bash
   az deployment group create \
     --resource-group <rg> \
     --template-file deployment/azuredeploy.json \
     --parameters workspaceName=<workspace>
   ```
7. Run validation queries from `sample-data/test_queries.kql`.
8. (Optional) Deploy analytics rules and workbooks.

---

## 10. Known Failure Modes

| Failure | Symptom | Root Cause | Fix |
|---|---|---|---|
| KMS decrypt failure | Connector "Connected", zero rows in table | GuardDuty IAM role missing `kms:Decrypt` | See `docs/kms-permissions.md` |
| EventBridge envelope mismatch | Parsers return empty results | Finding JSON nested under `detail` key | Parsers auto-detect since v1.2.0 |
| Wrong table name | All parsers return zero rows | Table name differs from connector config | Update `TableName` in `AWSGuardDuty_Config` |
| Schema version mismatch | Main parser filters all records | GuardDuty schema not starting with `2.` | Disable `EnableDataValidation` to diagnose |
| SQS notification missing | Data in S3 but not in Sentinel | S3 bucket event notification not set to SQS | Configure S3 → SQS event notification |
