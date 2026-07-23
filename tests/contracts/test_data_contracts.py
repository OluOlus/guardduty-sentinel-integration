from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

from conftest import load_handler_module


ROOT = Path(__file__).resolve().parents[2]


def read_json(relative_path: str):
    return json.loads((ROOT / relative_path).read_text())


@pytest.fixture(scope="module")
def finding_schema():
    return read_json("contracts/aws/guardduty-finding.schema.json")


@pytest.fixture(scope="module")
def event_schema():
    return read_json("contracts/aws/eventbridge-guardduty.schema.json")


@pytest.fixture(scope="module")
def azure_schema():
    return read_json("contracts/azure/awsguardduty-table.schema.json")


def validator(schema, *referenced_schemas):
    registry = Registry()
    for referenced in referenced_schemas:
        registry = registry.with_resource(
            referenced["$id"], Resource.from_contents(referenced)
        )
    return Draft202012Validator(
        schema, registry=registry, format_checker=FormatChecker()
    )


def test_direct_fixture_matches_aws_finding_contract(
    finding, finding_schema
):
    validator(finding_schema).validate(finding)


def test_event_fixture_matches_eventbridge_and_finding_contracts(
    eventbridge_event, event_schema, finding_schema
):
    validator(event_schema, finding_schema).validate(eventbridge_event)


def test_aws_contract_rejects_missing_required_field(
    finding, finding_schema
):
    invalid = copy.deepcopy(finding)
    del invalid["updatedAt"]

    errors = list(validator(finding_schema).iter_errors(invalid))
    assert any("'updatedAt' is a required property" in error.message for error in errors)


def test_adapter_output_matches_exact_microsoft_table_contract(
    finding, azure_schema
):
    record = load_handler_module().to_azure_guardduty_record(finding)
    validator(azure_schema).validate(record)


def test_azure_contract_detects_accidental_custom_column(
    finding, azure_schema
):
    record = load_handler_module().to_azure_guardduty_record(finding)
    record["RawFinding"] = "{}"

    errors = list(validator(azure_schema).iter_errors(record))
    assert any("Additional properties are not allowed" in error.message for error in errors)


def test_versioned_contract_matches_current_botocore_guardduty_model(
    finding_schema
):
    """Fail when the official AWS SDK model changes its required boundary."""
    botocore_session = pytest.importorskip("botocore.session")
    service = botocore_session.Session().get_service_model("guardduty")
    finding_shape = service.shape_for("Finding")
    sdk_required = {
        member[:1].lower() + member[1:]
        for member in finding_shape.required_members
    }

    assert set(finding_schema["required"]) == sdk_required
