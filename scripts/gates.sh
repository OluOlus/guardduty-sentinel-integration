#!/usr/bin/env bash
set -euo pipefail

python3 scripts/sync_arm_template.py --check
python3 -m pytest \
  -m "not container and not live" \
  --cov=scripts \
  --cov-report=term-missing
bash -n deploy.sh

if [[ "${RUN_CONTAINER_TESTS:-0}" == "1" ]]; then
  python3 -m pytest -m container -v
fi

