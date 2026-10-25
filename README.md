<p align="center">
  <a href="https://event-horizon-teal.vercel.app"><img src="artifacts/readme/event-horizon-wordmark.svg" width="100%" alt="EVENT HORIZON, an interactive cosmic physics sandbox. Decorative wordmark: a black hole with an accretion disc and an orbiting body."></a>
</p>

<p align="center">
  <em>Drop a black hole into a spiral galaxy. Detonate the star beside it.<br>Then watch the debris decide what happens next.</em>
</p>

<p align="center">
  <a href="https://event-horizon-teal.vercel.app"><img src="artifacts/readme/button-enter-the-universe.svg" height="48" alt="Enter the universe: play the live demo"></a>
  &nbsp;
  <a href="https://github.com/aspire488/event-horizon"><img src="artifacts/readme/button-source-code.svg" height="48" alt="Source code on GitHub"></a>
</p>

<p align="center">
  <sub>Runs in the browser with WebGL · no install, no account, no backend · <a href="https://event-horizon-teal.vercel.app">event-horizon-teal.vercel.app</a></sub>
</p>

<br>

<p align="center">
  <a href="https://event-horizon-teal.vercel.app"><img src="artifacts/readme/footage-hungry-singularity.gif" width="100%" alt="Real footage from the production app with the interface hidden: a black hole's spiral accretion disc turns, a stream of painted dust drifts in, and a supernova's shockwave sweeps out across the field."></a>
  <br>
  <sub><b>Real footage</b>, recorded from the production build with the interface hidden. <i>The Hungry Singularity</i>: dust painted toward the disc, then a supernova beside it.</sub>
</p>

## A universe you are allowed to break

Event Horizon is a 2D gravity sandbox that runs in your browser. Every star, planet, well and grain of dust pulls on everything else, and you get the tools a universe normally keeps to itself: open a singularity, set off a supernova, throw a planet into orbit, or pour a river of matter into space and see where gravity takes it.

It is not a screensaver. The physics core runs on a fixed clock, separate from the renderer, so the same seed gives the same starting universe every time, and you can pause it, rewind it, undo what you did, save it and load it back. Discoveries are noticed as they happen: a stable orbit, matter crossing an event horizon, a cataclysmic merge, a shockwave, a gravitational slingshot.

> Inside the app the title still reads **GOD MODE**. Event Horizon is the project's public name; it is the same program.

## Seven ways to disturb a universe

| Key | Tool | What it does |
| :-: | --- | --- |
| `1` | **Observe** | Click a body to inspect it, drag to move it. Drag empty space to pan. |
| `2` | **Gravity** | Click to drop a gravity well. Drag to reposition it. |
| `3` | **Black Hole** | Click to open a singularity. Matter inside the horizon is consumed. |
| `4` | **Supernova** | Click to detonate. The expanding front accelerates everything it crosses. |
| `5` | **Repel** | Click to place a repulsor. Matter is pushed out to its influence radius. |
| `6` | **Paint** | Drag to stream matter into space. Faster strokes fire faster matter. |
| `7` | **Orbit** | Click to launch a planet on a circular orbit around the nearest mass. |

The Force Lab shows the selected tool's settings, such as a gravity well's mass, influence radius and strength, and the universe itself has two dials: the gravitational constant and trail length.

## Six worlds to start from

Every world is a reproducible starting state built from a fixed seed. Loading one clears undo history but never reloads the page.

<table>
<tr>
<td width="50%" valign="top">
<img src="artifacts/readme/still-hungry-singularity.jpg" width="100%" alt="The Hungry Singularity: a black hole wrapped in a spiral accretion disc.">
<br><b>The Hungry Singularity</b><br><sub>An accretion disc spirals into a black hole. Feed it.</sub>
</td>
<td width="50%" valign="top">
<img src="artifacts/readme/still-stellar-collapse.jpg" width="100%" alt="Stellar Collapse: a bright star inside a dense cloud of dust.">
<br><b>Stellar Collapse</b><br><sub>A dense, unstable cloud with a star about to detonate.</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="artifacts/readme/still-binary-dance.jpg" width="100%" alt="Binary Dance: an amber star and a blue-white star in mutual orbit.">
<br><b>Binary Dance</b><br><sub>Two stars of equal mass locked in a mutual orbit, wrapped in dust.</sub>
</td>
<td width="50%" valign="top">
<img src="artifacts/readme/still-total-chaos.jpg" width="100%" alt="Total Chaos: stars and singularities with their influence rings drawn around them.">
<br><b>Total Chaos</b><br><sub>Two singularities, four stars and a repulsor in open conflict.</sub>
</td>
</tr>
</table>

Also in the atlas: **Prime Field**, a live spiral galaxy with a binary companion and three planets, and **Slingshot**, where a massive star bends a high-velocity stream and you aim the pass.

<sub>All four images are unedited frames from the production app (cropped, interface hidden). The decorative wordmark at the top is the only illustration on this page.</sub>

## The observatory

<p align="center">
  <img src="artifacts/user-acceptance/session-c-singularity.png" width="100%" alt="The full interface at 1440 by 900: the tool rail on the left, the Force Lab panel on the right showing a selected gravity well's position, velocity, mass and sliders, discovery notifications, and the transport bar with pause, speed, sim time, rewind and reset.">
  <br>
  <sub>The full interface during user acceptance testing: tool rail, Force Lab with a selected gravity well, discovery feed, and the transport bar with speed, rewind and reset.</sub>
</p>

- **Time is yours.** Pause, run at 0.25× to 4×, scrub back through snapshot rewind, set checkpoints, undo and redo.
- **Five missions.** Discovery objectives (stable orbit, event horizon, cataclysmic merge, shockwave, gravitational slingshot) light up when the simulation detects them, alongside a live event feed.
- **Keep your experiments.** Up to eight local saves, with rename, JSON export and validated JSON import. Nothing leaves your browser.
- **Sound and light.** Procedural WebGL visuals and Web Audio effects, with Cinematic, Balanced and Performance quality presets.

<details>
<summary><b>Under the hood</b>: physics, rendering and project layout</summary>
<br>

The app is a Vite and TypeScript single-page application with a Three.js/WebGL renderer. The physics core is separated from rendering:

- a fixed-step accumulator at 1/60 s, so frame rate does not change the physics;
- semi-implicit integration with Newtonian gravity and Plummer softening, plus acceleration and speed clamps so close passes stay finite;
- bounded particle storage (24,000 particles at most) and deterministic scenario seeds;
- merges, black-hole capture, stellar collapse and supernova shockwaves handled in the step, reported as events.

The UI is DOM-based; `src/app.ts` coordinates simulation, rendering, history, input and persistence.

```text
src/core/    physics, particles, worlds, scenarios, events, objectives, history, serialization
src/render/  Three.js renderer, shaders, camera
src/input/   mouse, pointer, and touch tool interactions
src/ui/      panels, controls, help, notifications
src/audio/   procedural Web Audio
src/app.ts   application orchestration
```

</details>

## Run it locally

Requires Node.js 20.19 or newer and npm. Install the exact dependency tree from the lockfile:

```sh
npm ci
npm run dev
```

Open the URL Vite prints (normally `http://localhost:5173`).

Build and preview the production bundle:

```sh
npm run build
npm run preview
```

Preview runs at `http://localhost:4173`.

## Controls

| Input | Action |
| --- | --- |
| `1`–`7` | Select Observe, Gravity, Black Hole, Supernova, Repel, Paint, Orbit |
| Left click / drag | Use the selected tool; drag selected bodies to move them |
| Left drag on empty space with Observe | Pan the camera |
| Right / middle drag | Pan with any tool |
| Wheel / pinch | Zoom |
| `Z` / `Y` (`Ctrl+Z` / `Ctrl+Shift+Z`) | Undo / redo |
| `Space` | Pause / resume |
| `+` / `-` | Change simulation speed |
| `F` / `Delete` / `R` | Focus selection / delete selection / reset world |
| `M` / `P` / `L` / `H` | Mute / performance display / labels / hide interface |
| `?` | Open the help overlay |

Touch users can tap and drag tools, pan with two fingers, pinch to zoom, and use the panel toggle to reach controls.

**Accessibility and comfort.** The app follows the system `prefers-reduced-motion` setting: time-based shader animation is frozen and particle trails are shortened. Every tool and most actions have a keyboard shortcut, and `?` lists them. Sound can be muted with `M` or the volume control, and `H` hides the interface entirely. The Performance preset lowers rendering cost on weaker devices.

## Tests and verification

```sh
npm run typecheck
npm test
npm run build
npm run preview   # terminal 1
npm run smoke     # terminal 2; set CHROME_PATH if needed
```

| Check | Result |
| --- | --- |
| Unit tests (Vitest) | 46 passing |
| Production-browser smoke checks | 18 passing locally, 18 passing against the live deployment |
| User acceptance | 6 viewport sizes, 6 worlds, 7 tools, save/restore, touch emulation, a 10-minute session |
| npm advisories at release | 0 known |
| Live browser verification | no console errors or failed network requests |

<details>
<summary>What the automated checks cover, and what they don't</summary>
<br>

The smoke suite exercises the declared favicon, rendering, tools, worlds, history, save/reload, JSON export/import and malformed-import rejection. The separate user acceptance pass covered all six requested viewport sizes, all six worlds and seven tools, isolated save/restore flows, touch emulation, and a 10-minute session. The current lockfile install reported zero known npm advisories during release verification. Reports and screenshots are retained in `scripts/` and `artifacts/user-acceptance/`.

The browser checks use headless Chromium with SwiftShader software WebGL in this environment. Those FPS readings do not measure physical GPU performance. Physical touch hardware, browser zoom edge cases, and WebGL context-loss recovery have not been fully verified.

</details>

## Deploy to Vercel

This is a static Vite app. Import the repository in Vercel and use the Vite preset, `npm ci` for installation, `npm run build` as the build command, and `dist` as the output directory. No backend or environment variables are required. The project does not use client-side URL routes, so no SPA rewrite is needed.

Production deployment: [event-horizon-teal.vercel.app](https://event-horizon-teal.vercel.app).

## Contributing

Bug reports and ideas are welcome as [issues](https://github.com/aspire488/event-horizon/issues). Please open an issue before starting a pull request, and run `npm run verify` (typecheck, unit tests, build) before submitting. Because no license has been chosen yet (see below), contribution terms are still to be decided.

## License

Event Horizon is licensed under the [MIT License](LICENSE). You may use, modify, and distribute the software under its terms; retain the copyright and license notice in copies or substantial portions of the software.

<br>

<p align="center">
  <a href="https://event-horizon-teal.vercel.app"><b>Enter the universe →</b></a>
</p>
