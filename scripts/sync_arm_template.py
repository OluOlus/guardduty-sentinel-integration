#!/usr/bin/env python3
"""Generate the ARM saved-search template from the canonical KQL files."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
KQL_DIR = ROOT / "kql"
OUTPUT = ROOT / "deployment" / "azuredeploy.json"
FUNCTION_ORDER = [
    "AWSGuardDuty_Config",
    "AWSGuardDuty_Main",
    "AWSGuardDuty_Network",
    "AWSGuardDuty_IAM",
    "AWSGuardDuty_S3",
    "AWSGuardDuty_EKS",
    "AWSGuardDuty_Malware",
    "AWSGuardDuty_RDS",
    "AWSGuardDuty_ASIMNetworkSession",
    "AWSGuardDuty_Schema",
]
NO_PARAMETERS = {"AWSGuardDuty_Config"}


def build_template() -> dict:
    resources = []
    for function_name in FUNCTION_ORDER:
        query = (KQL_DIR / f"{function_name}.kql").read_text()
        resources.append(
            {
                "type": "Microsoft.OperationalInsights/workspaces/savedSearches",
                "apiVersion": "2020-08-01",
                "name": (
                    "[concat(parameters('workspaceName'), "
                    f"'/{function_name}')]"
                ),
                "properties": {
                    "category": "GuardDuty",
                    "displayName": function_name,
                    "functionAlias": function_name,
                    "functionParameters": (
                        ""
                        if function_name in NO_PARAMETERS
                        else "lookback:timespan=timespan(null)"
                    ),
                    "query": query,
                    "tags": {
                        "Environment": "[parameters('environment')]",
                        "Version": "1.5.0",
                    },
                },
            }
        )

    return {
        "$schema": (
            "https://schema.management.azure.com/schemas/"
            "2019-04-01/deploymentTemplate.json#"
        ),
        "contentVersion": "1.5.0.0",
        "metadata": {
            "generatedBy": "scripts/sync_arm_template.py",
            "source": "kql/*.kql",
        },
        "parameters": {
            "workspaceName": {
                "type": "string",
                "metadata": {
                    "description": "Existing Log Analytics workspace name"
                },
            },
            "environment": {
                "type": "string",
                "defaultValue": "prod",
                "allowedValues": ["dev", "test", "staging", "prod"],
            },
        },
        "resources": resources,
        "outputs": {
            "deployedFunctions": {
                "type": "array",
                "value": FUNCTION_ORDER,
            }
        },
    }


def rendered_template() -> str:
    return json.dumps(build_template(), indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail instead of updating when the generated file is stale",
    )
    args = parser.parse_args()
    expected = rendered_template()

    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != expected:
            print(
                "deployment/azuredeploy.json is stale; run "
                "python scripts/sync_arm_template.py"
            )
            return 1
        print("ARM template matches all canonical KQL files")
        return 0

    OUTPUT.write_text(expected)
    print(f"updated {OUTPUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

