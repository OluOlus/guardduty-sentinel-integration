# Versioned data contracts

These schemas are executable compatibility boundaries, not replacements for
the vendor documentation.

| Contract | Authority | Local policy |
|---|---|---|
| `aws/guardduty-finding.schema.json` | [AWS Finding API](https://docs.aws.amazon.com/guardduty/latest/APIReference/API_Finding.html) | Stable required fields are strict; nested AWS additions are allowed. |
| `aws/eventbridge-guardduty.schema.json` | [GuardDuty EventBridge events](https://docs.aws.amazon.com/guardduty/latest/ug/guardduty_findings_eventbridge.html) | Validates the AWS envelope and delegates `detail` to the Finding contract. |
| `azure/awsguardduty-table.schema.json` | [Microsoft AWSGuardDuty table](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/awsguardduty) | Exact column names and types accepted by the direct DCR adapter. |

The source URLs and review date are stored in each schema. A scheduled
contract-drift workflow re-fetches the authoritative documentation and opens a
failure for human review when the documented field set changes. Vendor schemas
remain forward-compatible where AWS explicitly allows new nested members.

Fixtures under `tests/fixtures/guardduty/` are synthetic, non-secret examples
shaped from the AWS API contract. Live sample findings generated with
`CreateSampleFindings` are tested only in an isolated AWS account because that
API creates real GuardDuty findings.

