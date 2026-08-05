from __future__ import annotations

import json
from pathlib import Path

from conftest import ROOT


def test_arm_is_generated_from_every_canonical_kql_file():
    template = json.loads((ROOT / "deployment/azuredeploy.json").read_text())
    resources = {
        resource["properties"]["functionAlias"]: resource["properties"]["query"]
        for resource in template["resources"]
    }
    kql = {
        path.stem: path.read_text()
        for path in sorted((ROOT / "kql").glob("AWSGuardDuty_*.kql"))
    }

    assert resources == kql
    assert template["outputs"]["deployedFunctions"]["value"] == list(
        resources
    )


def test_arm_generator_reports_repository_is_in_sync():
    from scripts.sync_arm_template import OUTPUT, rendered_template

    assert OUTPUT.read_text() == rendered_template()


def test_bicep_loads_every_canonical_kql_file():
    bicep = (ROOT / "deployment/deploy.bicep").read_text()
    for path in (ROOT / "kql").glob("AWSGuardDuty_*.kql"):
        assert f"loadTextContent('../kql/{path.name}')" in bicep


def test_native_table_parser_does_not_assume_nonexistent_raw_columns():
    main = (ROOT / "kql/AWSGuardDuty_Main.kql").read_text()
    config = (ROOT / "kql/AWSGuardDuty_Config.kql").read_text()

    assert "EventData" not in main
    assert "column_ifexists" not in main
    assert "table(" not in main
    assert "ResourceDetails" in main
    assert "ServiceDetails" in main
    assert "there is no EventData/Message" in config


def test_aws_severity_and_asim_versions_are_pinned():
    main = (ROOT / "kql/AWSGuardDuty_Main.kql").read_text()
    asim = (ROOT / "kql/AWSGuardDuty_ASIMNetworkSession.kql").read_text()

    assert 'Severity >= 9.0, "Critical"' in main
    assert "Severity >= 8.5" not in main
    assert 'EventSchemaVersion     = "0.2.7"' in asim
    assert "0.2.6" not in asim


def test_parameter_files_only_supply_declared_arm_parameters():
    template = json.loads((ROOT / "deployment/azuredeploy.json").read_text())
    declared = set(template["parameters"])
    for path in (ROOT / "deployment").glob("**/*.parameters.json"):
        supplied = set(json.loads(path.read_text())["parameters"])
        assert supplied <= declared, f"{path} has undeclared parameters"
