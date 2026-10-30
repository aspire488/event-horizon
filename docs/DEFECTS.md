# Defects found and fixed during the instrument transformation

## D-1 — Rewind slider lagged page state (surfaced by UAT Session D)

**Severity:** low for humans (≤110 ms stale UI), high for verification (test
flakes / hides real regressions).
**Found:** full user-acceptance run against the final build — Session D failed
`not enough rewind frames: 1` while `page state had ≥3 keyframes.
**Preserved evidence:** `artifacts/user-acceptance/session-d-failure-report-20261030.json`.

### Root cause

`App.frame()` throttled `syncUi()` to once per 110 ms (`nowMs - lastSync > 110`).
`Timeline.maybeCapture()` pushes a keyframe mid-frame, but `.rewind-slider#max`
is only derived from that state during `syncUi()`. A consumer that observes
`timeline.keyframes.length ≥ 3` (Playwright's rAF-polling condition) can read
the DOM **before the next throttled sync**, getting `max = 1` (state: 2
keyframes). Pass/fail depends on the frame phase of the push relative to the
throttle window — pure race.

### Evidence (focused repro: `scripts/rewind-sync-repro.mjs`, same pause →
resume → 4× tail as Session D)

| Build | Immediate-read failures | Worst DOM convergence lag |
|---|---:|---:|
| Baseline `1b73ef5` (unfixed) | **4 / 6** | 70 ms |
| Final, pre-fix | 1 / 5 | 69 ms |
| Final, post-fix | **0 / 5** | **0 ms** |

The baseline numbers prove the race **predates the transformation** (the
110 ms throttle is byte-identical at `1b73ef5`); the transformation's frame
cadence changes merely moved its manifestation. It was therefore a latent
product defect, not a regression — and a verification hazard either way.

### Fix

1. **Product** (`src/app.ts`, `frame()`): force one `syncUi()` whenever
   `timeline.keyframes.length` changes, so discrete history events reach the
   rewind UI the instant they exist. Continuous telemetry keeps the 110 ms
   throttle; a keyframe capture happens at most once per 3 sim-seconds, so the
   added sync frequency is negligible (~1/s worst case).
2. **Harness** (`scripts/user-acceptance.mjs`, Session D): assert the DOM
   contract directly — wait until `.rewind-slider[max] ≥ 2` (with the original
   assertion retained as a belt-and-braces check) instead of racing page state
   against a throttled DOM read.

### Regression coverage

- `scripts/rewind-sync-repro.mjs` reproduces the exact race in isolation and
  exits non-zero on any immediate-read failure or non-zero convergence lag
  (`GODMODE_URL=… REPRO_ITER=n`).
- Session D in `scripts/user-acceptance.mjs` runs on every UAT pass.
