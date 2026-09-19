#!/usr/bin/env python3
"""Experiment-only falsification harness for N-1 specialist pooling.

No employee/payroll data. No production writes. Consequential scheduling authority
remains outside this harness.

Hypothesis:
  A nine-slot specialist pool plus existing cross-trained reserves can retain zero
  uncovered mandatory windows after any one specialist loss when real skill
  qualifications and inter-site travel are modelled.

Simple alternative:
  Keep ten dedicated specialist slots.

Success threshold:
  Zero uncovered windows across the locked synthetic corpus and >=5% lower net
  specialist capacity than the ten-slot alternative.

Stop criterion:
  Any uncovered mandatory window under the stated bounded assumptions.
"""
from __future__ import annotations

from dataclasses import dataclass
import argparse
import json
import random
from typing import FrozenSet

SKILLS = ("A", "B", "C", "D", "E")
LINE_SITES = (0, 0, 0, 0, 1, 1, 1, 2, 2, 2)
LINE_SKILLS = ("A", "B", "C", "D", "E", "A", "B", "C", "D", "E")

TRAVEL = {
    "compact": ((0, 4, 8), (4, 0, 6), (8, 6, 0)),
    "campus": ((0, 10, 22), (10, 0, 18), (22, 18, 0)),
    "separate": ((0, 35, 55), (35, 0, 45), (55, 45, 0)),
}


@dataclass(frozen=True)
class Window:
    start: int
    end: int
    site: int
    line: int
    skill: str


@dataclass(frozen=True)
class Worker:
    wid: int
    home_site: int
    skills: FrozenSet[str]
    reserve: bool = False
    blocked: tuple[tuple[int, int], ...] = ()


WORKERS = (
    Worker(0, 0, frozenset(("A", "B"))),
    Worker(1, 0, frozenset(("B", "C"))),
    Worker(2, 0, frozenset(("C", "D"))),
    Worker(3, 0, frozenset(("D", "E"))),
    Worker(4, 1, frozenset(("E", "A"))),
    Worker(5, 1, frozenset(("A", "C"))),
    Worker(6, 1, frozenset(("B", "D"))),
    Worker(7, 2, frozenset(("C", "E"))),
    Worker(8, 2, frozenset(("D", "A"))),
    # Existing cross-trained operators; their normal jobs make them unavailable
    # during these blocks, so reserve labour is not treated as free capacity.
    Worker(9, 0, frozenset(("A", "C")), True, ((110, 165), (300, 350))),
    Worker(10, 2, frozenset(("B", "D", "E")), True, ((130, 185), (285, 340))),
)


def overlaps(a0: int, a1: int, b0: int, b1: int) -> bool:
    return a0 < b1 and b0 < a1


def build_scenario(seed: int, drift_minutes: int = 40) -> list[Window]:
    rng = random.Random(seed)
    windows: list[Window] = []
    for line in range(10):
        phase = (line * 13) % 36
        for base in (85, 295):
            start = base + phase + rng.randint(-drift_minutes, drift_minutes)
            start = max(0, min(450, start))
            duration = rng.randint(16, 24)
            windows.append(Window(start, start + duration, LINE_SITES[line], line, LINE_SKILLS[line]))

    # One bounded production disruption moves a later intervention by 20-60 min.
    disrupted_line = rng.randrange(10)
    disruption_shift = rng.randint(20, 60)
    for i, window in enumerate(windows):
        if window.line == disrupted_line and window.start > 200:
            start = min(455, window.start + disruption_shift)
            windows[i] = Window(start, start + (window.end - window.start), window.site, window.line, window.skill)
    return windows


def break_blocks(worker: Worker) -> tuple[tuple[int, int], ...]:
    start = 210 + (worker.wid % 3) * 10
    return ((start, start + 25),)


def worker_can_take(worker: Worker, window: Window, assigned: list[Window], travel) -> bool:
    if window.skill not in worker.skills:
        return False

    # Home-to-first-task reachability is conservative and deterministic.
    if not assigned and travel[worker.home_site][window.site] > window.start:
        return False

    occupied_start = window.start
    occupied_end = window.end
    for b0, b1 in break_blocks(worker) + worker.blocked:
        if overlaps(occupied_start, occupied_end, b0, b1):
            return False

    for other in assigned:
        if other.end <= window.start:
            if other.end + travel[other.site][window.site] > window.start:
                return False
        elif window.end <= other.start:
            if window.end + travel[window.site][other.site] > other.start:
                return False
        else:
            return False
    return True


def feasible(windows: list[Window], layout: str, absent_core: int) -> bool:
    travel = TRAVEL[layout]
    workers = [w for w in WORKERS if w.wid != absent_core]
    assigned: dict[int, list[Window]] = {w.wid: [] for w in workers}
    remaining = list(windows)

    def search() -> bool:
        if not remaining:
            return True

        best_index = -1
        best_candidates: list[Worker] | None = None
        for i, window in enumerate(remaining):
            candidates = [
                w for w in workers
                if worker_can_take(w, window, assigned[w.wid], travel)
            ]
            if not candidates:
                return False
            if best_candidates is None or len(candidates) < len(best_candidates):
                best_index = i
                best_candidates = candidates
                if len(candidates) == 1:
                    break

        assert best_candidates is not None
        window = remaining.pop(best_index)
        # Prefer core specialists over reserves, then shorter home travel.
        best_candidates.sort(key=lambda w: (w.reserve, travel[w.home_site][window.site], w.wid))
        for worker in best_candidates:
            assigned[worker.wid].append(window)
            assigned[worker.wid].sort(key=lambda x: x.start)
            if search():
                return True
            assigned[worker.wid].remove(window)
        remaining.insert(best_index, window)
        return False

    return search()


def run(cases: int, drift_minutes: int) -> dict:
    results = {}
    for layout in TRAVEL:
        failed_absence_scenarios = 0
        shifts_with_any_failure = 0
        for seed in range(cases):
            windows = build_scenario(seed, drift_minutes)
            any_failure = False
            for absent in range(9):
                if not feasible(windows, layout, absent):
                    failed_absence_scenarios += 1
                    any_failure = True
            shifts_with_any_failure += int(any_failure)
        total = cases * 9
        qualified_shifts = cases - shifts_with_any_failure
        results[layout] = {
            "absence_scenarios": total,
            "failed_absence_scenarios": failed_absence_scenarios,
            "failure_rate": failed_absence_scenarios / total,
            "shifts_with_any_failure": shifts_with_any_failure,
            "qualified_shifts_if_skill_aware_gate_used": qualified_shifts,
            "qualification_rate": qualified_shifts / cases,
            "decision": "reject-generic-pooling" if failed_absence_scenarios else "survives-locked-corpus",
        }
    return {
        "cases": cases,
        "drift_minutes": drift_minutes,
        "line_disruption_shift_minutes": [20, 60],
        "layouts": results,
        "safety_boundary": "synthetic only; no production, payroll or employee actions",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", type=int, default=100)
    parser.add_argument("--drift", type=int, default=40)
    args = parser.parse_args()
    print(json.dumps(run(args.cases, args.drift), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
