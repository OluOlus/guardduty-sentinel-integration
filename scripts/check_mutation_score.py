#!/usr/bin/env python3
"""Fail CI when the mutmut score falls below the configured ratchet."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--minimum", type=float, default=70.0)
    parser.add_argument(
        "--stats", type=Path, default=Path("mutants/mutmut-cicd-stats.json")
    )
    args = parser.parse_args()

    data = json.loads(args.stats.read_text())
    scored = data["killed"] + data["survived"]
    if not scored:
        print("No killed or surviving mutations were reported")
        return 1
    score = 100.0 * data["killed"] / scored
    print(
        f"mutation score: {score:.2f}% "
        f"({data['killed']} killed, {data['survived']} survived)"
    )
    if score < args.minimum:
        print(f"required mutation score: {args.minimum:.2f}%")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

