# Test strategy

## Test-system diagram

The architecture below is generated from
[`scripts/generate_test_system_diagram.py`](../scripts/generate_test_system_diagram.py):

![GuardDuty Sentinel integration test system](test-system.png)

Regenerate it after changing the test topology:

```bash
python -m pip install -e ".[diagram]"
python scripts/generate_test_system_diagram.py
```

The command requires Graphviz (`dot`) in addition to the Python package.

The test system uses several independent oracles. Passing one tier does not
substitute for another.

## Quality gates

| Tier | Runs | Proves | Does not prove |
|---|---|---|---|
| Unit + property | Every PR, Python 3.11–3.13 | Severity boundaries, validation, UTF-8 signing, DCR auth/request shape, retry classification, batching, Lambda exception semantics | Cloud permissions or service delivery |
| Versioned contracts | Every PR and scheduled dependency refresh | Fixtures match the AWS SDK `Finding` model and EventBridge envelope; DCR adapter matches the exact Microsoft table columns | Undocumented vendor behavior |
| LocalStack Testcontainer | Relevant PRs | GuardDuty-compatible JSON Lines GZIP packaging and S3 object-created notification delivery to SQS | GuardDuty itself; LocalStack is not the GuardDuty oracle |
| Kusto emulator Testcontainer | Relevant PRs | Canonical KQL compiles and executes against the native `AWSGuardDuty` table schema | Microsoft Sentinel control-plane deployment |
| Mutation | Weekly and before release | Tests fail when handler decisions are altered | External integration correctness |
| Live sandbox conformance | Before release and nightly where credentials are configured | A real GuardDuty sample traverses the selected AWS→Sentinel route and appears with contract-correct fields | Another route unless that route is run separately |

Run all deterministic local gates:

```bash
python -m pip install -e ".[test]"
scripts/gates.sh
```

Run Docker gates:

```bash
RUN_CONTAINER_TESTS=1 scripts/gates.sh
```

Run mutation tests:

```bash
python -m pip install -e ".[test,mutation]"
mutmut run
mutmut results
```

## Contract coverage

The fixture corpus must include network, IAM/API call, S3, EKS/Kubernetes,
malware scan, and RDS database activity before a release is declared broadly
compatible. Each class needs:

- direct AWS Finding and EventBridge-envelope forms;
- the minimum required AWS fields and a maximal nested example;
- unknown additive fields to verify forward compatibility;
- missing/wrong-type/range boundary negatives;
- Unicode content, empty optional arrays, IPv4/IPv6 where AWS supplies them;
- severity values at `1.0`, `4.0`, `7.0`, and `9.0`;
- duplicate delivery and out-of-order `updatedAt` cases.

The current synthetic network fixture is the baseline. Real AWS
`CreateSampleFindings` results are captured only as redacted CI artifacts in a
private sandbox; they must not be committed if they contain account-specific
identifiers.

## Failure and resilience coverage

Delivery is at-least-once. EventBridge/Lambda failures raise so AWS can retry
and route exhausted events to an on-failure destination. KQL deduplicates by
GuardDuty `Id`, retaining the newest `TimeGenerated`.

The release environment must test:

- `429`, each retryable `5xx`, timeout, connection reset, and permanent `4xx`;
- expired/rotated Azure credential and DCR RBAC denial;
- Lambda timeout after Azure accepts a request;
- EventBridge retry exhaustion and DLQ/on-failure delivery;
- S3 SSE-KMS allow and deny cases, malformed GZIP, malformed JSON Lines,
  duplicate SQS messages, visibility-timeout redelivery, and poison records;
- 900 KB boundary, oversize single finding, burst throttling, and backlog
  recovery;
- cross-account and `aws`, `aws-cn`, and `aws-us-gov` partition handling where
  those partitions are supported.

## Live release acceptance

Run each production route in an isolated workspace:

1. `eventbridge_dcr`: GuardDuty → EventBridge → Lambda → DCR Logs Ingestion.
2. `s3_sqs`: GuardDuty export → SSE-KMS S3 → SQS → Microsoft Sentinel connector.

For each route, create real AWS sample findings, record their IDs, and require
all IDs to appear in `AWSGuardDuty` before the route-specific latency SLO.
Compare account, region, type, severity, resource, service, creation time, and
update time. Then run both Microsoft ASIM testers against
`AWSGuardDuty_ASIMNetworkSession`.

Never run live conformance in a production detector or workspace. Sample
findings are real findings and can trigger automation.
