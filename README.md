# EVENT HORIZON

<p align="center">
  <strong>An interactive cosmic physics sandbox</strong><br />
  Bend gravity. Shape orbits. Trigger supernovas. Feed black holes.<br />
  Explore a living universe where you control the chaos.
</p>

<p align="center">
  <a href="https://event-horizon-teal.vercel.app">
    <img src="https://img.shields.io/badge/🚀_PLAY_LIVE-EVENT_HORIZON-ff6b35?style=for-the-badge&labelColor=10131d" alt="Play Event Horizon live" />
  </a>
  <a href="https://github.com/aspire488/event-horizon">
    <img src="https://img.shields.io/badge/GitHub-Source_Code-24292f?style=for-the-badge&logo=github" alt="View source code on GitHub" />
  </a>
</p>

<p align="center">
  <a href="https://event-horizon-teal.vercel.app"><strong>▶ OPEN THE LIVE SANDBOX →</strong></a>
</p>

![Event Horizon — interactive cosmic physics sandbox](artifacts/user-acceptance/session-a-first-contact-1440x900.png)

> **Event Horizon** is a hands-on cosmic playground for manipulating gravity, black holes, supernovas, and orbital systems. The in-app title currently remains **GOD MODE**.

## Explore the universe

- **Seven tools:** Observe, Gravity, Black Hole, Supernova, Repel, Paint, and Orbit.
- **Six seeded worlds:** Explore distinct cosmic setups with reproducible scenarios.
- **Dynamic events:** Shockwaves, captures, merges, stellar collapse, and a live event feed.
- **Experiment freely:** Pause, change simulation speed, undo/redo, checkpoints, snapshot rewind, and reset.
- **Save your discoveries:** Save, load, and rename local experiments; export and validate JSON imports.
- **A living visual experience:** Procedural WebGL rendering, visual effects, procedural Web Audio, quality presets, and reduced-motion controls.

## 🚀 Play online

<p align="center">
  <a href="https://event-horizon-teal.vercel.app"><strong>Launch Event Horizon →</strong></a>
</p>

No installation is needed to try the deployed version.

## Run locally

**Requirements:** Node.js 20.19+ and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite (usually `http://localhost:5173`).

Build and preview the production bundle:

```sh
npm run build
npm run preview
```

The preview server normally runs at `http://localhost:4173`.

## Controls

| Input | Action |
| --- | --- |
| `1`–`7` | Select Observe, Gravity, Black Hole, Supernova, Repel, Paint, or Orbit |
| Left click / drag | Use the selected tool; drag selected bodies to move them |
| Left drag on empty space with Observe | Pan the camera |
| Right / middle drag | Pan with any tool |
| Mouse wheel / pinch | Zoom |
| `Z` / `Y` (`Ctrl+Z` / `Ctrl+Shift+Z`) | Undo / redo |
| `Space` | Pause / resume |
| `+` / `-` | Change simulation speed |
| `F` / `Delete` / `R` | Focus selection / delete selection / reset world |
| `M` / `P` / `L` / `H` | Mute / performance display / labels / hide interface |
| `?` | Open the help overlay |

**Touch:** Tap and drag to use tools, pan with two fingers, pinch to zoom, and use the panel toggle to reach controls.

## How it's built

Event Horizon is a Vite + TypeScript single-page app with a Three.js/WebGL renderer. The physics core is separate from rendering and uses a fixed-step accumulator, semi-implicit integration, softened gravity, bounded particle storage, and deterministic scenario seeds.

```text
src/core/    physics, particles, worlds, scenarios, events, objectives, history, serialization
src/render/  Three.js renderer, shaders, camera
src/input/   mouse, pointer, and touch tool interactions
src/ui/      panels, controls, help, notifications
src/audio/   procedural Web Audio
src/app.ts   application orchestration
```

## Quality checks

Run the project's checks locally:

```sh
npm run typecheck
npm test
npm run build
npm run preview   # terminal 1
npm run smoke     # terminal 2; set CHROME_PATH if needed
```

Latest recorded release checks:

- **46/46 unit tests passed**
- **18/18 production-browser smoke checks passed locally**
- **18/18 production-browser smoke checks passed against the live deployment**
- Typecheck and production build passed; live browser verification reported no console errors or failed network requests.

Automated browser runs used headless Chromium with SwiftShader software WebGL. Their FPS readings are not a physical-GPU benchmark. Physical touch hardware, browser zoom edge cases, and WebGL context-loss recovery have not been fully verified.

## Production deployment

**Live demo:** [https://event-horizon-teal.vercel.app](https://event-horizon-teal.vercel.app)  
**Source code:** [github.com/aspire488/event-horizon](https://github.com/aspire488/event-horizon) · **Branch:** `main`

This is a static Vite app. The Vercel build uses `npm ci`, `npm run build`, and `dist` as the output directory. No backend or environment variables are required.

## License

No open-source license has been selected or included. Licensing and redistribution terms remain to be decided.
