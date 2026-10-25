# GOD MODE QA audit

**Audit date:** 2026-10-25  
**Scope:** Read-only baseline inspection, source review, automated unit checks, and real-browser interaction checks against the local production preview. This audit fixes reproducible defects and records checks that could not be completed; it does not claim exhaustive coverage.

## Baseline and environment

- Workspace: `D:\godmode`. There is no `.git` directory, so Git status, commit identity, and tracked/untracked change attribution were unavailable. No existing application files were overwritten except the smoke test assertion described below; the original supplied smoke report was copied to `scripts/smoke-report.baseline.json` and restored to `scripts/smoke-report.json` after each smoke run.
- Runtime: Node v24.18.0, npm 11.16.0, Vite 5.4.21, TypeScript 5.9.3, Vitest 2.1.9, Three.js 0.169.0, Playwright Core 1.64.1. Chrome was present at the smoke script's standard Windows path. Browser version was not captured by the available command.
- `http://localhost:4173/` returned the expected GOD MODE HTML and served the rebuilt production asset `index-B1WlDJO4.js` after the fix. `http://localhost:5173/` was not listening.
- Browser checks used headless Chrome with SwiftShader software WebGL and muted audio. The observed ~12–13 FPS at about 4,872 particles is only a software-rendered observation, not a GPU performance result.
- Initial independent baseline: typecheck passed; 46/46 unit tests passed; production build passed. The first independent run of the supplied smoke script reported 16 passed and one failed because the test read the latest toast, which could be an unrelated discovery toast even when import succeeded. The test was corrected to find the import confirmation among active toasts. The final supplied suite passed 17/17.

## Architecture reviewed

The app is vanilla TypeScript with a Three.js WebGL renderer. `src/core` contains a DOM-independent world model, typed-array particles, seeded scenarios, a fixed 60 Hz accumulator, semi-implicit particle integration, events, objectives, snapshots, and schema-1 serialization. `src/app.ts` coordinates simulation, renderer, input, UI, audio and storage. Experiments and preferences use localStorage; imported experiments are parsed and sanitized before application. The renderer maintains body views in a cache keyed by body ID.

## Findings and fixes

### QA-001 — Renderer reused a body view after scenario IDs changed kind (high)

Rapidly loading different worlds through the UI reuses numeric body IDs for different body kinds. The renderer cache previously keyed views only by ID. A star could receive a reused view without its shader's `uIntensity` uniform, throwing `TypeError: Cannot set properties of undefined (setting 'value')` during every render update. `src/render/renderer.ts` now records each cached view's body kind and disposes/recreates the view when that kind changes, both during scenario refresh and normal synchronization. The browser regression repeatedly switches Prime Field, Total Chaos, Binary Dance, and Stellar Collapse and asserts no page exceptions; it passed after the fix.

### QA-002 — Existing import smoke assertion raced with notifications (low)

The import check waited for the import event but asserted against only the newest toast. An independently generated discovery toast could appear later. The smoke check now searches active toast text for the import confirmation. The final 17-check browser suite passed; this changes test reliability, not app behavior.

## Results

- **Unit:** 7 test files, 46 tests passed before and after the application fix.
- **Typecheck:** passed before and after the fix.
- **Production build:** passed before and after the fix. The production preview served the rebuilt hashed JS asset.
- **Existing browser smoke:** 17 passed, 0 failed after the toast assertion repair. Covers startup/rendering, pause/resume, gravity, black-hole capture, supernova, scenario loading, undo/redo, paint/orbit, reset, archive save/reload, JSON export/import and invalid-import rejection, perf panel, help/labels/hide UI, laptop/narrow layout, first-run samples, and runtime errors.
- **Additional browser interaction suite:** 7 passed, 0 failed. Exercises all six scenarios from the UI; selects all seven tools and performs placement/detonation/paint actions; visits all five tabs; checks toolbar hit targets and viewport bounds at all six requested sizes; checks input focus and Escape; performs twelve scenario changes; and checks page exceptions, console errors, and failed requests.
- `scripts/qa-report.json` and `scripts/qa-smoke-report.json` contain the machine-readable results. The supplied `scripts/smoke-report.json` is preserved; its original contents are also in `scripts/smoke-report.baseline.json`.

## Coverage not established

The checks above do **not** establish full verification of every stated mission item. In particular, this environment run did not exercise real GPU performance or GPU memory, WebGL context loss/restoration, shader diagnostics on physical hardware, audio node lifecycle or audible output, touch hardware, reduced-motion behavior, every slider at every boundary, pointer cancellation/out-of-canvas painting, body/source dragging under every tool, 1k/5k/10k/18k/24k controlled particle benchmarks, storage quota exhaustion, interrupted writes, all import adversarial cases (including size/particle caps and duplicate IDs), every mission completion condition, every event cooldown/locate edge, or all rewind/checkpoint/undo branch and eviction boundaries. Browser checks used isolated browser contexts and did not delete user saves. Performance numbers from SwiftShader are not representative of a GPU. No integration-test command or linter is configured in `package.json`; no standalone integration suite was available to run.

The tested default scene was about 4,872 particles. No hardware-backed FPS, memory-growth, or large-scene performance claim is made. The source review found sanitizer limits for 6 MB imports, 18,000 serialized particles, 24,000 simulation capacity, and eight saves, but this audit did not execute every limit/quota boundary. These are remaining risks, not passing checks.
