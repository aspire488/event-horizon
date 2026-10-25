# QA test matrix

Test status describes execution during this audit. “Not run” is not a pass.

| Area | Boundary / scenario | Method | Result |
|---|---|---|---|
| Baseline typecheck | Full TypeScript project | `npm run typecheck` | Pass, baseline and final |
| Core unit tests | 7 files / 46 assertions | `npm test` (Vitest) | Pass, baseline and final |
| Production build | TypeScript plus Vite production bundle | `npm run build` | Pass, baseline and final |
| Production preview | Local port 4173, current hashed bundle | HTTP fetch plus production-browser suite | Pass; rebuilt JS asset served |
| Development server | Local port 5173 | HTTP connection check | Not running |
| Initial rendering | Live scene, drawing buffer, visual pixels | Existing Playwright smoke | Pass |
| Gravity mechanics | Particle attraction and actual trajectory change | Existing Playwright smoke | Pass |
| Black-hole mechanics | Particle capture, count reduction, event | Existing Playwright smoke | Pass |
| Supernova mechanics | Shockwave, particle response, ejecta, event | Existing Playwright smoke | Pass |
| Repel tool | Select and place via canvas | Additional Playwright suite | Pass for placement; force-radius/strength boundaries not run |
| Observe tool | Select active tool | Additional Playwright suite | Pass for selection; selection/drag/deselect not run in this audit |
| Paint tool | Short drag action | Existing and additional Playwright smoke | Pass for emission/action; rapid/out-of-canvas/cancel/24k cap not run |
| Orbit tool | Planet placement and orbital speed | Existing Playwright smoke | Pass; long-term orbit stability covered by unit test only |
| Force Lab | Body/source parameter sliders at min/max | Source inspection only | Not run |
| Worlds | Prime, Binary, Singularity, Collapse, Slingshot, Chaos via UI | Additional Playwright suite; unit scenario checks | Pass, initial state has bodies and particles |
| World transitions | Twelve rapid repeated changes; renderer exceptions | Additional Playwright suite | Pass after QA-001 fix |
| Tabs | LAB, WORLDS, EVENTS, MISSIONS, ARCHIVE | Additional Playwright suite | Pass; all tabs clickable/rendered |
| Responsive geometry | 1920×1080, 1440×900, 1024×768, 820×720, 390×844, 360×800 | Real-browser bounds and hit-target checks | Pass; no horizontal overflow, tools in viewport with ≥30 px hit targets |
| Transport | Pause/resume; reset; speed controls | Existing smoke plus source/unit tests | Pause/resume and reset/undo pass; each speed chip not individually exercised in browser |
| History | Undo/redo object edit; reset undo; snapshot/history unit coverage | Existing smoke and Vitest | Pass for exercised paths; full branch/eviction/checkpoint matrix not run |
| Persistence | Save, reload, load; JSON export/import; malformed short import | Existing Playwright smoke | Pass; quota/corrupt-storage/oversized adversarial cases not run |
| Input robustness | Typing does not invoke numeric tool shortcut; Escape closes help | Additional Playwright suite | Pass |
| Events / discoveries | Real capture, supernova and scenario event behavior | Existing smoke; source/unit review | Partial; every discovery and cooldown not individually completed |
| Physics numerics | Softened gravity, fixed timestep accumulation, orbit, merge momentum, capture, shockwave, collapse, determinism | Vitest core tests | Pass for assertions present; max-mass/body-count long runs not run |
| Performance | Default scene under software WebGL | Existing smoke readout | ~12–13 FPS at ~4,872 particles; observation only, not hardware benchmark |
| High-count stress | 1k/5k/10k/18k/24k controlled scenes | Not run | Not run |
| Rendering lifecycle | WebGL context loss/restore, GPU disposal/memory, physical GPU shader warnings | Not available in this run | Not run |
| Audio | Audible output, mute/volume, initialization failure, node lifecycle | Browser was muted; no audio assertions | Not run |
| Touch/reduced motion | Physical touch, pinch, pointer cancel, prefers-reduced-motion | Not exercised | Not run |
| Runtime/network health | Page exceptions, console errors, failed network requests | Additional production-browser suite | Pass after fix |
| Integration suite | No integration test script/package configured | Package inspection | Not available |

## Unit test topics present in the repository

Clock accumulation/pause/backlog cap; snapshot history; event log; objectives; gravity/softening/orbits; particle capture; momentum-aware merge; shockwave; stellar collapse; slingshot; scenario generation/determinism; and basic experiment round-trip, malformed documents, non-finite particle rejection, and body sanitization.
