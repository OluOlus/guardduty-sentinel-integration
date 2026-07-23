from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
MODULE_NAME = "scripts.lambda_ingestion_handler"


def load_handler_module():
    sys.modules.pop(MODULE_NAME, None)
    return importlib.import_module(MODULE_NAME)


@pytest.fixture
def handler_module():
    return load_handler_module()


@pytest.fixture
def finding():
    return json.loads(
        (ROOT / "tests/fixtures/guardduty/network-finding.json").read_text()
    )


@pytest.fixture
def eventbridge_event():
    return json.loads(
        (ROOT / "tests/fixtures/guardduty/network-eventbridge.json").read_text()
    )
