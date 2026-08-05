from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

import pytest

from conftest import ROOT, load_handler_module


pytestmark = [
    pytest.mark.container,
    pytest.mark.skipif(
        os.environ.get("RUN_CONTAINER_TESTS") != "1",
        reason="set RUN_CONTAINER_TESTS=1 to run Docker integration tests",
    ),
]


def kusto_request(endpoint: str, path: str, database: str, csl: str):
    request = urllib.request.Request(
        endpoint + path,
        data=json.dumps(
            {"db": database, "csl": csl, "properties": {"Options": {}}}
        ).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read())
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise AssertionError(
            f"Kusto HTTP {error.code} for {csl[:80]!r}: {body}"
        ) from error
    if "error" in payload:
        raise AssertionError(payload["error"])
    return payload


def wait_for_kusto(endpoint: str):
    deadline = time.monotonic() + 120
    last_error = None
    while time.monotonic() < deadline:
        try:
            return kusto_request(
                endpoint, "/v1/rest/query", "NetDefaultDB", "print Ready=1"
            )
        except (AssertionError, OSError, urllib.error.URLError) as error:
            last_error = error
            time.sleep(1)
    raise AssertionError(f"Kusto emulator did not become ready: {last_error}")


def let_definition(name: str) -> str:
    content = (ROOT / f"kql/{name}.kql").read_text().rstrip()
    suffix = f"\n{name}"
    assert content.endswith(suffix)
    return content[: -len(suffix)]


def table_rows(response):
    primary = next(
        table
        for table in response["Tables"]
        if table.get("TableKind") == "PrimaryResult"
        or any(
            column["ColumnName"] == "FindingId"
            for column in table.get("Columns", [])
        )
    )
    columns = [column["ColumnName"] for column in primary["Columns"]]
    return [dict(zip(columns, row, strict=True)) for row in primary["Rows"]]


def test_canonical_kql_executes_against_native_table_contract(finding):
    containers = pytest.importorskip("testcontainers.core.container")
    DockerContainer = containers.DockerContainer

    with (
        DockerContainer(
            "mcr.microsoft.com/azuredataexplorer/kustainer-linux:latest"
        )
        .with_exposed_ports(8080)
        .with_env("ACCEPT_EULA", "Y")
    ) as container:
        endpoint = f"http://{container.get_container_host_ip()}:{container.get_exposed_port(8080)}"
        wait_for_kusto(endpoint)

        create_table = """.create-merge table AWSGuardDuty (
AccountId:string, ActivityType:string, Arn:string, Description:string,
Id:string, Partition:string, Region:string, ResourceDetails:dynamic,
SchemaVersion:string, ServiceDetails:dynamic, Severity:int,
TimeCreated:datetime, TimeGenerated:datetime, Title:string
)"""
        kusto_request(
            endpoint, "/v1/rest/mgmt", "NetDefaultDB", create_table
        )

        record = load_handler_module().to_azure_guardduty_record(finding)
        row = (
            json.dumps(record["AccountId"])
            + ","
            + json.dumps(record["ActivityType"])
            + ","
            + json.dumps(record["Arn"])
            + ","
            + json.dumps(record["Description"])
            + ","
            + json.dumps(record["Id"])
            + ","
            + json.dumps(record["Partition"])
            + ","
            + json.dumps(record["Region"])
            + ",dynamic("
            + json.dumps(record["ResourceDetails"], separators=(",", ":"))
            + "),"
            + json.dumps(record["SchemaVersion"])
            + ",dynamic("
            + json.dumps(record["ServiceDetails"], separators=(",", ":"))
            + "),"
            + str(record["Severity"])
            + ",datetime("
            + record["TimeCreated"]
            + "),datetime("
            + record["TimeGenerated"]
            + "),"
            + json.dumps(record["Title"])
        )
        ingest = (
            ".set-or-append AWSGuardDuty <| datatable("
            "AccountId:string, ActivityType:string, Arn:string, "
            "Description:string, Id:string, Partition:string, Region:string, "
            "ResourceDetails:dynamic, SchemaVersion:string, "
            "ServiceDetails:dynamic, Severity:int, TimeCreated:datetime, "
            f"TimeGenerated:datetime, Title:string)[{row}]"
        )
        kusto_request(endpoint, "/v1/rest/mgmt", "NetDefaultDB", ingest)

        config_query = "\n".join(
            [
                let_definition("AWSGuardDuty_Config"),
                "AWSGuardDuty_Config() | take 1",
            ]
        )
        kusto_request(
            endpoint, "/v1/rest/query", "NetDefaultDB", config_query
        )

        query = "\n".join(
            [
                let_definition("AWSGuardDuty_Config"),
                let_definition("AWSGuardDuty_Main"),
                "AWSGuardDuty_Main(30d)",
                "| project FindingId, SeverityLevel, ResourceType, ActionType",
            ]
        )
        result = kusto_request(
            endpoint, "/v1/rest/query", "NetDefaultDB", query
        )
        rows = table_rows(result)
        assert rows == [
            {
                "FindingId": finding["id"],
                "SeverityLevel": "High",
                "ResourceType": "Instance",
                "ActionType": "NETWORK_CONNECTION",
            }
        ]
