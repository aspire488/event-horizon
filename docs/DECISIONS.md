# Decision record — Event Horizon instrument transformation

## Direction

Event Horizon becomes a **bespoke observatory instrument**: the universe fills the frame; controls read as machined instrument surfaces (near-solid dark panels, hairline edges, corner registration ticks, tabular monospace telemetry), not floating glass cards. Motion communicates physics; chrome stays still. No backdrop blur on panels (visual identity + integrated-GPU cost). A faint world-space graticule in the background shader moves with the camera and gives scale — a functional annotation, not decoration.

## Decisions

| # | Decision | Rationale |
| - | --- | --- |
| D1 | Keep the existing stack (vanilla TS + Three.js, fixed-step core, vitest, playwright-core). No new runtime dependencies. | The architecture is sound; the gap is presentation and polish, not structure. |
| D2 | In-app title stays **GOD MODE**; README's public name stays Event Horizon. | Existing documented decision; renaming churns tests, README and save-key identity for no user value. |
| D3 | Fix visibility shader-side (point-size curve, palette brightness, per-type size shaping) before considering more particles. | Larger, structured particles raise perceived density at zero physics cost and scale down on weak hardware. |
| D4 | Slingshot = close approach **then** outbound escape (two-phase detection via particle flags). | A circular orbiter is not a slingshot; the detector must see an actual flyby. |
| D5 | Quality levels become rendering-only. `QualityLevel` gains `'auto'`; a measured controller (rolling p95 frame time, hysteresis + cooldown) steps quality up/down. User picks override it. | Gate C requires quality changes not to alter physics; auto-tier satisfies "graceful adaptation to stronger hardware". |
| D6 | Remove the 6,000-particle trim on performance mode. | It silently mutates the simulation; rendering-only tiers preserve determinism. |
| D7 | First-run coach is passive and skippable: it observes real actions (paint → place well → pause) and never intercepts input. | Teaches the interaction model through actual actions without modal dialogs; zero interference with automated journeys. |
| D8 | Benchmarks run headless, record the WebGL renderer string from the app's own context, and are labelled with GPU/quality/scenario/duration. Verified reality: `--use-angle=d3d11` selects the iGPU (Radeon 740M); the RTX 3050 is only reachable via Vulkan-over-ANGLE (`--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan --use-angle=vulkan`), confirmed by the unmasked renderer string (`scripts/probe-gpu2.mjs`). Baseline and final always run with identical flags. | Honest, reproducible performance claims — the label is read from the driver, never assumed. |
| D9 | Trails become vertex-faded additive lines; black holes gain a photon ring and stronger doppler asymmetry; stars gain a crisp photosphere + limb darkening; background gains the world-anchored graticule. | Highest visual-impact changes that stay physically motivated and cheap. |

## Acceptance criteria (measured, not asserted)

- A1 — Prime Field's spiral structure is clearly visible at the default camera distance in a 1440×900 screenshot (visual review of committed artifacts).
- A2 — No slingshot discovery within the first 60 s of an untouched Prime Field run; a genuine paint-into-orbit flyby still triggers it (regression test).
- A3 — Switching quality at runtime leaves `world.particles.count`, positions and velocities byte-identical (browser regression check).
- A4 — `npm run verify` passes; existing 46 tests still pass (suite now 65 with the new regression tests); new tests cover the slingshot fix, determinism, adaptive-quality controller and pause/speed edges.
- A5 — Benchmark report contains baseline vs final p50/p95/p99 frame times on the RTX 3050 for identical scenarios.

## Status (implementation complete — evidence-backed)

| Gate | Result | Evidence |
| --- | --- | --- |
| A — Functional correctness | **PASS** — smoke 18/18; qa-smoke 6/6 (tools, tabs, 6-viewport layout, focus, no listener accumulation); user-sim 10/10 personas + 100/100 fuzz sessions with zero invariant violations | `scripts/smoke-report.json`, `scripts/qa-smoke-report.json`, `artifacts/user-sim/report.json` |
| B — P95 ≤ 16.7 ms | **PASS** — official RTX 3050 passes measured 7.0 ms P95 at every tier/scenario; worst pass observed on any build 13.9 ms; baseline ≡ final (no regression); `auto` controller observed both holding `balanced` and raising to `cinematic` | `docs/BENCHMARKS.md`, `artifacts/benchmark-{final,baseline}/` |
| C — Quality never alters physics | **PASS** — pause-first full-field FNV hash invariant across `cinematic→performance→balanced→auto→cinematic` in every qualityTour/fuzz session; adaptive-quality unit tests | `artifacts/user-sim/report.json`, `src/perf.test.ts` |
| D — 10-minute stability | **PASS** — 600.9 s continuous interaction, 36 cycles, particle count stable at 9,288, zero console errors/exceptions/failed requests | `artifacts/user-acceptance/extended-session-{before,after}.png` + suite JSON |
| E — Responsive + accessibility | **PASS** — four target viewports capture with 0 console errors; qa-smoke layout at six sizes with hit-target checks; `:focus-visible` styling; ARIA toolbar/tablist/`aria-pressed`/`aria-selected`/labels with per-frame state sync | `artifacts/final/`, `src/ui/ui.ts` |
| F — Production quality | **PASS** — `npm run verify` green (tsc + 65/65 tests + build); full UAT **12/12 PASS** including the 600.8 s extended session with zero console errors/exceptions/failed requests; defect D-1 found by UAT, fixed and regression-covered | `docs/DEFECTS.md`, `scripts/user-acceptance-report.json` |

Commits: `852e4bb` (physics/perf/quality) → `74bc47f` (visuals/sound/UI) →
`75b5694` (harnesses/docs/evidence) → `d64d951` (graticule/merge flash/ARIA) →
rewind-sync fix + benchmark honesty fixes (this pass).
