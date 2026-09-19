#!/usr/bin/env python3
"""Deterministic synthetic falsification harness for buffered specialist pooling.

This is experiment-only code. It does not read employee/payroll data and cannot
mutate production. Consequential scheduling authority remains outside this harness.

Hypothesis under test:
  A pooled specialist plan can retain zero uncovered mandatory windows under
  bounded production drift plus one surprise specialist absence, while using
  fewer dedicated specialist slots than line-by-line staffing.

Simple alternative:
  Keep one dedicated specialist slot per line.

Success threshold:
  zero uncovered mandatory windows across the locked scenario corpus and at
  least 5% fewer dedicated specialist slots.

Stop criterion:
  any uncovered mandatory window under the stated uncertainty boundary.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import argparse
import json
import random


@dataclass(frozen=True)
class Window:
    start: int
    end: int
    line: int


def build_scenario(seed: int, drift_minutes: int = 40, line_failure: bool = True) -> list[Window]:
    rng = random.Random(seed)
    failed_line = rng.randrange(10) if line_failure else None
    failure_at = rng.randint(120, 300) if line_failure else None
    failure_shift = rng.randint(20, 60) if line_failure else 0
    windows: list[Window] = []

    for line in range(10):
        phase = (line * 17) % 50
        for base in (55, 165, 275, 385):
            start = base + phase + rng.randint(-drift_minutes, drift_minutes)
            if line_failure and line == failed_line and start >= failure_at:
                start += failure_shift
            start = max(0, min(465, start))
            # 15-minute mandatory intervention plus conservative 5-minute move/reset buffer.
            windows.append(Window(start=start, end=start + 20, line=line))
    return windows


def peak_required_specialists(windows: list[Window]) -> int:
    events: list[tuple[int, int]] = []
    for w in windows:
        events.append((w.start, 1))
        events.append((w.end, -1))
    # At identical timestamps a completed window releases capacity before a new one starts.
    events.sort(key=lambda item: (item[0], item[1]))
    active = 0
    peak = 0
    for _, delta in events:
        active += delta
        peak = max(peak, active)
    return peak


def run(cases: int, drift_minutes: int) -> dict:
    peaks = [peak_required_specialists(build_scenario(seed, drift_minutes)) for seed in range(cases)]
    distribution = Counter(peaks)

    # Nine pooled slots becomes eight after one surprise absence.
    pooled_after_absence = 8
    uncovered_cases = sum(count for peak, count in distribution.items() if peak > pooled_after_absence)

    return {
        "cases": cases,
        "drift_minutes": drift_minutes,
        "line_failure_shift_minutes": [20, 60],
        "mandatory_window_minutes_including_move_buffer": 20,
        "peak_distribution": dict(sorted(distribution.items())),
        "nine_slot_pool_after_one_absence_capacity": pooled_after_absence,
        "uncovered_cases": uncovered_cases,
        "coverage_rate": (cases - uncovered_cases) / cases,
        "success_threshold_zero_uncovered": uncovered_cases == 0,
        "decision": "reject-nine-slot-hard-cut" if uncovered_cases else "survives-locked-corpus",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", type=int, default=20_000)
    parser.add_argument("--drift", type=int, default=40)
    args = parser.parse_args()
    print(json.dumps(run(args.cases, args.drift), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
