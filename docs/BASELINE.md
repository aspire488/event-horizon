# Baseline report — before the instrument transformation

**Date:** 2026-10-29 · **Branch:** `main` @ `1b73ef5` · **Working tree:** clean except `.gitignore` (adds `.vercel/`) and one untracked user-acceptance screenshot — both preserved untouched.

## Environment

| Item | Value |
| --- | --- |
| Node | v24.18.0 (npm 11.x) |
| Toolchain | Vite 7.3.7, TypeScript 5.9.x, Vitest 4.1.12, Three.js 0.169.0 |
| Browser | Chromium (Playwright Core 1.64.1), headless |
| GPU (default launch) | AMD Radeon 740M (integrated, D3D11) |
| GPU (benchmarks, `--force-high-performance-gpu`) | NVIDIA GeForce RTX 3050 6GB Laptop GPU, D3D11 |

## Verification status

- `npm run typecheck` — pass
- `npm test` — 46/46 pass (7 files)
- `npm run build` — pass; `dist` JS 587.56 kB (154.82 kB gzip), CSS 22.68 kB
- Browser startup at 1440×900 / 1280×800 / 768×1024 / 390×844 — 0 console errors, 0 page errors (`artifacts/baseline/capture.json`)

## Verified defects (ranked)

1. **The universe is invisible (graphics, critical).** Prime Field's 9,048-particle spiral galaxy renders as sub-pixel dots: dust particles are 1.1–2.3 world units → ~1.2–1.6 px at the default camera distance (3400), dim palette index 4 (0.26, 0.36, 0.56) at ≤0.35 alpha. Total particle coverage is ~1% of screen area. The protagonist of the product cannot be seen. Stars render as structureless gaussian blobs with no photosphere, no limb darkening, no size-to-appearance differentiation between a 1900-mass and an 840-mass star.
2. **Product identity is generic (product, high).** Translucent rounded glass cards + backdrop blur + Inter/mono — exactly the dashboard formula the brief rejects. The simulation is framed by chrome rather than being the instrument.
3. **Slingshot discovery false-positive (physics, high).** `stepWorld`'s slingshot detector counts any particle with speed > 170 u/s moving outward within 180–900 u of a massive body. Prime Field's inner disc contains particles in stable circular orbits at 169–195 u/s; the "Gravitational slingshot" discovery therefore fires at t ≈ 0.9 s on load, polluting the event feed and devaluing the discovery system.
4. **Quality switch mutates physics state (perf/integrity, high).** `App.setQuality('performance')` truncates `world.particles.count` to 6000 — changing quality changes simulation results (violates Gate C: "changing quality does not alter physics results").
5. **No adaptive quality (perf, medium).** Manual quality menu plus a one-time FPS hint toast only; no measured frame-time adaptation, no percentiles in the telemetry panel.
6. **No onboarding (product, medium).** One hint line for 11 s on first run; seven tools, rewind semantics and save workflow are undiscoverable afterwards.
7. **Determinism hole (physics, low).** `addParticle` recycles full-field slots via `Math.random()`; long sessions that saturate the field diverge from seeded determinism.

## Measured starting points

- Frame-time distribution, physics-vs-render split, memory growth over 10 min, save/load latency, input latency: **re-measured by the benchmark harness after implementation**; the baseline build is re-benchmarked identically for comparison. See `docs/BENCHMARKS.md`.
- SwiftShader (smoke-test launch) is used only for functional checks, never for performance claims.
