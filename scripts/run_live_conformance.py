#!/usr/bin/env python3
"""Create real GuardDuty samples and verify their arrival in Sentinel.

This is intentionally credentials-gated and refuses to run without an
explicit confirmation. Use only in an isolated detector and workspace.
"""

from __future__ import annotations

import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

import boto3


def required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def azure_token() -> str:
    tenant = required("AZURE_TENANT_ID")
    form = urllib.parse.urlencode(
        {
            "client_id": required("AZURE_CLIENT_ID"),
            "client_secret": required("AZURE_CLIENT_SECRET"),
            "scope": "https://api.loganalytics.io/.default",
            "grant_type": "client_credentials",
        }
    ).encode()
    request = urllib.request.Request(
        f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
        data=form,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read())
    return payload["access_token"]


def log_query(token: str, query: str) -> list[dict[str, Any]]:
    workspace = required("AZURE_WORKSPACE_ID")
    request = urllib.request.Request(
        f"https://api.loganalytics.io/v1/workspaces/{workspace}/query",
        data=json.dumps({"query": query}).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read())
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Log Analytics query failed ({error.code}): {body}"
        ) from error

    if not payload.get("tables"):
        return []
    table = payload["tables"][0]
    names = [column["name"] for column in table["columns"]]
    return [
        dict(zip(names, row, strict=True))
        for row in table.get("rows", [])
    ]


def guardduty_samples(
    client: Any,
    detector_id: str,
    started_at: datetime.datetime,
) -> list[dict[str, Any]]:
    types = [
        item.strip()
        for item in os.environ.get("LIVE_FINDING_TYPES", "").split(",")
        if item.strip()
    ]
    arguments: dict[str, Any] = {"DetectorId": detector_id}
    if types:
        arguments["FindingTypes"] = types
    client.create_sample_findings(**arguments)

    deadline = time.monotonic() + 180
    started_ms = int(started_at.timestamp() * 1000)
    findings: list[dict[str, Any]] = []
    while time.monotonic() < deadline and not findings:
        response = client.list_findings(
            DetectorId=detector_id,
            FindingCriteria={
                "Criterion": {"updatedAt": {"Gte": started_ms}}
            },
            SortCriteria={
                "AttributeName": "updatedAt",
                "OrderBy": "DESC",
            },
            MaxResults=50,
        )
        if response["FindingIds"]:
            findings = client.get_findings(
                DetectorId=detector_id,
                FindingIds=response["FindingIds"],
            )["Findings"]
        if not findings:
            time.sleep(5)
    if not findings:
        raise RuntimeError("GuardDuty did not return newly created samples")
    return findings


def wait_for_sentinel(
    token: str,
    finding_ids: list[str],
    started_at: datetime.datetime,
) -> list[dict[str, Any]]:
    quoted_ids = ",".join(json.dumps(item) for item in finding_ids)
    query = f"""
AWSGuardDuty
| where TimeGenerated >= datetime({started_at.isoformat()})
| where Id in ({quoted_ids})
| summarize arg_max(TimeGenerated, *) by Id
| project Id, AccountId, ActivityType, Region, Severity,
          TimeCreated, TimeGenerated, ResourceDetails, ServiceDetails
"""
    timeout_seconds = int(os.environ.get("LIVE_TIMEOUT_SECONDS", "900"))
    deadline = time.monotonic() + timeout_seconds
    rows: list[dict[str, Any]] = []
    while time.monotonic() < deadline:
        rows = log_query(token, query)
        if {row["Id"] for row in rows} >= set(finding_ids):
            return rows
        time.sleep(15)
    received = {row["Id"] for row in rows}
    missing = sorted(set(finding_ids) - received)
    raise RuntimeError(f"Sentinel did not receive finding IDs: {missing}")


def assert_contract_parity(
    aws_findings: list[dict[str, Any]],
    sentinel_rows: list[dict[str, Any]],
) -> None:
    by_id = {row["Id"]: row for row in sentinel_rows}
    mismatches = []
    for finding in aws_findings:
        row = by_id[finding["Id"]]
        expected = {
            "AccountId": finding["AccountId"],
            "ActivityType": finding["Type"],
            "Region": finding["Region"],
            "Severity": int(finding["Severity"]),
        }
        for field, value in expected.items():
            if row[field] != value:
                mismatches.append(
                    f"{finding['Id']} {field}: {row[field]!r} != {value!r}"
                )
    if mismatches:
        raise AssertionError("\n".join(mismatches))


def run_asim_testers(token: str) -> None:
    if os.environ.get("RUN_ASIM_TESTERS") != "1":
        return
    for tester in ("ASimSchemaTester", "ASimDataTester"):
        log_query(
            token,
            (
                "AWSGuardDuty_ASIMNetworkSession(2h) "
                f"| invoke {tester}('NetworkSession')"
            ),
        )


def main() -> int:
    if os.environ.get("CONFIRM_LIVE_CONFORMANCE") != "YES":
        print(
            "Refusing to create real findings. Set "
            "CONFIRM_LIVE_CONFORMANCE=YES in an isolated sandbox.",
            file=sys.stderr,
        )
        return 2

    route = required("LIVE_ROUTE")
    if route not in {"eventbridge_dcr", "s3_sqs"}:
        raise RuntimeError(
            "LIVE_ROUTE must be eventbridge_dcr or s3_sqs"
        )
    detector_id = required("AWS_GUARDDUTY_DETECTOR_ID")
    region = required("AWS_REGION")
    started_at = datetime.datetime.now(datetime.timezone.utc)
    guardduty = boto3.client("guardduty", region_name=region)
    aws_findings = guardduty_samples(
        guardduty, detector_id, started_at
    )
    token = azure_token()
    rows = wait_for_sentinel(
        token,
        [finding["Id"] for finding in aws_findings],
        started_at,
    )
    assert_contract_parity(aws_findings, rows)
    run_asim_testers(token)
    print(
        json.dumps(
            {
                "route": route,
                "findings_created": len(aws_findings),
                "findings_observed": len(rows),
                "contract_parity": "passed",
                "asim_testers": (
                    "passed"
                    if os.environ.get("RUN_ASIM_TESTERS") == "1"
                    else "not requested"
                ),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

