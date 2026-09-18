#!/usr/bin/env python3
"""Deterministically distinguish GitHub Actions control-plane failures from test failures.

This classifier is intentionally data-only: it consumes saved GitHub run/job JSON and
never mutates GitHub, deployments, tenants, or production state.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

CONTROL_PLANE = "control_plane_or_runner_start_failure"
PRODUCT_OR_TEST = "product_or_test_failure"
NOT_FAILED = "not_failed"
UNKNOWN = "unknown_failure_shape"


def classify(run: dict[str, Any], jobs: dict[str, Any] | list[dict[str, Any]]) -> str:
    if run.get("status") != "completed" or run.get("conclusion") != "failure":
        return NOT_FAILED

    job_list = jobs.get("jobs", []) if isinstance(jobs, dict) else jobs
    if not job_list:
        return UNKNOWN

    failed = [job for job in job_list if job.get("conclusion") == "failure"]
    if not failed:
        return UNKNOWN

    def never_started(job: dict[str, Any]) -> bool:
        steps = job.get("steps")
        logs_url = job.get("logs_url")
        return steps in (None, []) and logs_url in (None, "")

    if all(never_started(job) for job in failed):
        return CONTROL_PLANE

    return PRODUCT_OR_TEST


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("run_json", type=Path)
    parser.add_argument("jobs_json", type=Path)
    args = parser.parse_args()

    run = json.loads(args.run_json.read_text())
    jobs = json.loads(args.jobs_json.read_text())
    result = classify(run, jobs)
    print(result)

    # Non-zero codes make the guard usable in release tooling without pretending
    # that provider failure is a product test failure.
    return {
        NOT_FAILED: 0,
        CONTROL_PLANE: 42,
        PRODUCT_OR_TEST: 1,
        UNKNOWN: 2,
    }[result]


if __name__ == "__main__":
    raise SystemExit(main())
