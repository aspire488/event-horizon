# GOD MODE user acceptance report

## Outcome

UAT was performed against the production preview at `http://localhost:4173/` using a newly launched Playwright Chromium process and fresh isolated browser contexts. The destination returned HTTP 200, the title was GOD MODE — Cosmic Sandbox, and the rendered canvas contained visible scene pixels. The test browser was Chromium 156.0.8078.47 (headless); WebGL used SwiftShader, so no physical-GPU performance claim is made. Node was v24.18.0. The separate dev URL on port 5173 was not listening. The workspace has no `.git` directory, so repository status/diff could not be obtained; existing QA reports were preserved.

The final interactive rerun passed all six user journeys, responsive screenshot capture at all six requested viewports, touch emulation, reduced-motion checks, and the final console/network audit: **11 PASS, 0 FAIL, 1 NOT TESTED**. The extended session ran separately for 600.9 seconds with 40 interaction cycles and completed without page exceptions. It began with 6,000 particles in Performance quality and ended with 1,874 particles, 3 bodies, and 2 events. This was real elapsed browser interaction, not a simulated duration.

Final regression: `npm.cmd run typecheck`, `npm.cmd test` (46/46), `npm.cmd run build`, and the production browser smoke suite (18/18). The new favicon regression check passed, and the import round-trip check was stabilized to assert the durable import event and restored state rather than a transient toast that can be replaced by legitimate discovery notifications. The prior `scripts/smoke-report.json` was restored byte-for-byte from its preserved baseline; fresh 18-check output is in `scripts/user-acceptance-smoke-report.json`. The final UAT browser run recorded no console errors, page exceptions, failed requests, or failed HTTP responses after the favicon fix.

## User journeys actually exercised

- First contact: identified Prime Field, initial Gravity tool, hint, initial particle/body counts, opened/dismissed Help, navigated all five tabs, placed and selected a Gravity source, paused/resumed, selected 2× speed, zoomed by wheel and panned by right drag.
- Experiment building: loaded Binary Dance; exercised Gravity, Black Hole, Supernova, Repel, Paint, and Orbit; adjusted force sliders to their edges; dragged a created well; observed events and mission progress.
- Worlds: visited Prime Field, Binary Dance, The Hungry Singularity, Stellar Collapse, Slingshot, and Total Chaos, tried Gravity and Supernova in each, paused/resumed, and switched worlds 20 times rapidly.
- Save and recovery: created, renamed, exported, imported, reloaded, restored, and deleted an isolated test experiment; verified supported body/particle state and that sample experiments remained. Checkpoint, rewind to oldest retained keyframe, and new-branch creation were exercised. Rewind restored a discrete snapshot and paused the simulation.
- Mistakes: selected/deleted/undid objects, changed branch after undo, reset and undid, used controls near the canvas, and tested the hidden-interface shortcut after moving focus away from a range control.
- Interface: quality presets, labels, performance display, mute/volume, help, notifications, archive actionability, and UI visibility were exercised. Responsive screenshots were captured at 1920×1080, 1440×900, 1024×768, 820×720, 390×844, and 360×800. Touch was emulated, not physically verified. Reduced-motion preference was checked in a fresh context.

## Defect found and fixed

**UAT-001, low severity — missing favicon produced 404 console errors.** Reproduction: open the production preview in a fresh browser context and inspect requests/console. Before the fix, the browser requested `/favicon.ico` and emitted three 404 resource errors across the initial multi-navigation session. Root cause: the page had no declared favicon or served icon. Added a small SVG icon and a `<link rel="icon">` in `index.html`. Rebuilt and reran browser journeys; final console and network audit had zero errors/failures. Details are in `USER_BUGS.md`.

The first broad run also reported failures in the test harness: one ambiguous slider label locator, a rewind check that did not resume the paused simulation before expecting new snapshots, and a keyboard-shortcut check that left focus in a range input. These were corrected in the test procedure and independently retested. They were not application defects, and the retests passed. The original output is not represented as a product failure.

## Evidence

Screenshots and JSON outputs are in [`artifacts/user-acceptance/`](artifacts/user-acceptance/). The machine-readable run is [`scripts/user-acceptance-report.json`](scripts/user-acceptance-report.json); targeted retests are [`artifacts/user-acceptance/retest-results.json`](artifacts/user-acceptance/retest-results.json). The long-session before/after screenshots and all viewport/world screenshots are listed in the JSON report.

## Remaining limitations

- Physical touchscreen and pinch gestures were unavailable; only touch emulation was run.
- WebGL used SwiftShader. Hardware frame-time/GPU-memory claims are unavailable.
- WebGL context loss/restoration and forced storage-quota exhaustion were not injected.
- Browser-level zoom, physical audio output, and interruption during a persistent write were not tested.
- This UAT does not constitute exhaustive numeric fuzzing of every import boundary, every slider range, or the complete rewind/history eviction matrix. Consult the existing `QA_AUDIT.md` and `QA_TEST_MATRIX.md` for the separate engineering QA scope.
- The initial screen is visually clear enough to identify the current world/tool and contains a first-run hint, but the hint is a single mechanic prompt rather than a guided tutorial. Mobile panels intentionally occupy a large portion of the canvas; their toggle and controls remained reachable in the captured sizes.
