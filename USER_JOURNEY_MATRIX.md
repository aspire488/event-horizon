# User journey matrix

| Workflow | Status | Method and evidence |
|---|---|---|
| Fresh first launch, title, scene render, hint, world/tool/counts | PASS | Isolated Chromium; `session-a-first-contact-1440x900.png`; report JSON records URL/title and canvas pixel samples. |
| Help open/dismiss, tabs, tool discovery | PASS | Actual clicks and Escape; `session-a-help.png`; all 5 tabs asserted active. |
| Place/select force source, pause/resume, speed, zoom/pan | PASS | UI and mouse interaction in Session A. |
| Build Binary Dance experiment using all 7 tools | PASS | Gravity, Black Hole, Supernova, Repel, Paint, Orbit plus Observe selection/drag; `session-b-force-lab.png`, `session-b-events.png`. |
| Force slider min/max and source drag | PASS | Keyboard Home/End on exact labels; observed mass 0, radius 70, influence 2200, strength 0.1; dragged selected well. |
| Six worlds, two tools each, pause/resume | PASS | Actual UI visits and screenshots for Prime, Binary, Singularity, Collapse, Slingshot, Chaos. |
| Rapid world changes | PASS | 20 UI-driven world loads; renderer remained active, under particle cap, no page exception. |
| Save/rename/reload/restore/export/import/delete isolated experiment | PASS | UI-driven archive actions; 351,102-byte export; sample experiments remained. |
| Checkpoint, rewind, branch after rewind | PASS | Oldest retained keyframe restored at time 0; simulation paused after restore; new action truncated future. Explicit resume added before waiting for snapshots. |
| Delete/undo/redo/reset recovery | PASS | UI interaction; undo restored deletion/reset; new action branched history. |
| Quality, labels, performance, audio controls, hide UI | PASS | UI-driven checks; mute/volume and labels toggled; `h` checked after focus left slider. Audible output not physically evaluated. |
| Responsive layouts | PASS | Screenshots inspected at 1920×1080, 1440×900, 1024×768, 820×720, 390×844, 360×800. Mobile panel takes substantial canvas area but toggle/actions remain usable. |
| Touch | PASS (emulated) | Playwright mobile/touch context tapped Gravity and placed a source; not physical hardware. |
| Reduced motion | PASS | Fresh context with reduced-motion preference; app flag and reduced trail value checked; screenshot captured. |
| Mobile archive notification obstruction | PASS | Toast and archive action geometry inspected at 390×844; did not overlap saved-item actions; screenshot captured. |
| Extended interaction | PASS | 600.9 seconds, 40 cycles; before/after screenshots; no page exceptions. |
| Final browser console/network | PASS | Zero console errors, page errors, failed requests, and failed responses after favicon fix. |
| Physical GPU, context-loss restoration, storage quota, physical touch, browser zoom | NOT TESTED | Capability/environment limits; no result inferred. |
| Exhaustive adversarial import corpus and all storage/history boundaries | NOT TESTED | Outside the exercised human journeys; see engineering QA limitations. |
| Final built-preview smoke suite | PASS | `npm.cmd run smoke`: 18/18 passed after final build, including favicon response and import round-trip regression checks. Fresh report: `scripts/user-acceptance-smoke-report.json`. Preview served rebuilt JS/CSS and `/favicon.svg` returned HTTP 200. |
