import { Rng } from './rng';
import { addParticle } from './particles';
import { circularOrbitSpeed } from './physics';
import {
  addBody,
  defaultParams,
  emptyStats,
  PALETTE,
  PARTICLE_CAPACITY,
} from './world';
import type { Body, World } from './types';

export interface ScenarioDef {
  id: string;
  name: string;
  blurb: string;
  seed: number;
  baseCount: number;
  build: (world: World, density: number) => void;
}

/** Clears a world in place so renderer buffers stay valid across scenarios. */
export function resetWorld(world: World, seed = world.params.seed): void {
  world.bodies.length = 0;
  world.particles.count = 0;
  world.shockwaves.length = 0;
  world.params = defaultParams(seed);
  world.stats = emptyStats();
  world.time = 0;
  world.stepCount = 0;
  world.nextId = 1;
  world.rng = new Rng(seed);
  world.baseline = 0;
}

interface DiscOptions {
  cx?: number;
  cy?: number;
  count: number;
  rMin: number;
  rMax: number;
  mass: number;
  arms?: number;
  twist?: number;
  armSpread?: number;
  zSpread?: number;
  dustBias?: number;
  velocityScale?: number;
  radialBrake?: number;
  life?: number;
  angleOffset?: number;
}

/** Procedural spiral/disc matter with physically motivated circular velocities. */
export function spawnDisc(world: World, opt: DiscOptions): void {
  const rng = world.rng;
  const cx = opt.cx ?? 0;
  const cy = opt.cy ?? 0;
  const arms = opt.arms ?? 0;
  const twist = opt.twist ?? 0;
  const spread = opt.armSpread ?? 0.3;
  const dustBias = opt.dustBias ?? 0.6;
  const zSpread = opt.zSpread ?? 45;
  const velocityScale = opt.velocityScale ?? 1;
  const angleOffset = opt.angleOffset ?? 0;
  const life = opt.life ?? 1500;

  for (let i = 0; i < opt.count; i++) {
    const t = Math.pow(rng.next(), 0.85);
    const r = opt.rMin + t * (opt.rMax - opt.rMin);
    let angle: number;
    if (arms > 0) {
      const arm = i % arms;
      const armAngle = angleOffset + (arm / arms) * Math.PI * 2 + (r / opt.rMax) * twist;
      angle = armAngle + rng.normal(spread);
    } else {
      angle = rng.range(0, Math.PI * 2);
    }
    const jitter = rng.normal(r * 0.015);
    const px = cx + Math.cos(angle) * (r + jitter);
    const py = cy + Math.sin(angle) * (r + jitter);
    const v = circularOrbitSpeed(opt.mass, Math.max(r, 20)) * velocityScale * rng.range(0.96, 1.045);
    const radial = opt.radialBrake ? -v * opt.radialBrake : 0;
    const vx = -Math.sin(angle) * v + Math.cos(angle) * radial;
    const vy = Math.cos(angle) * v + Math.sin(angle) * radial;

    const roll = rng.next();
    let pal: number;
    if (roll < dustBias) pal = PALETTE.dust;
    else if (roll < dustBias + 0.16) pal = PALETTE.white;
    else if (roll < dustBias + 0.3) pal = PALETTE.cyan;
    else if (roll < dustBias + 0.4) pal = PALETTE.amber;
    else pal = PALETTE.violet;

    addParticle(world.particles, {
      x: px,
      y: py,
      z: rng.normal(zSpread),
      vx,
      vy,
      life: life * rng.range(0.7, 1.3),
      size: pal === PALETTE.dust ? rng.range(1.1, 2.3) : rng.range(1.8, 3.6),
      pal,
      seed: rng.next(),
      type: pal === PALETTE.dust ? 0 : 1,
    });
  }
  world.stats.emitted += opt.count;
}

function orbitVelocity(body: Body, centralMass: number, scale = 1): void {
  const d = Math.hypot(body.x, body.y) || 1;
  const v = circularOrbitSpeed(centralMass, d) * scale;
  body.vx = (-body.y / d) * v;
  body.vy = (body.x / d) * v;
}

const prime: ScenarioDef = {
  id: 'prime',
  name: 'Prime Field',
  blurb: 'A live spiral galaxy with a binary companion and three planets.',
  seed: 20_260_925,
  baseCount: 7600,
  build(world, density) {
    const star = addBody(world, 'star', 0, 0, {
      mass: 1900,
      radius: 34,
      label: 'SOL-01',
      hue: PALETTE.amber,
    });
    const companion = addBody(world, 'star', -1560, 520, {
      mass: 840,
      radius: 23,
      label: 'VEGA-02',
      hue: PALETTE.white,
    });
    orbitVelocity(companion, star.mass, 0.96);

    const p1 = addBody(world, 'planet', 520, 0, {
      mass: 64,
      radius: 7,
      hue: PALETTE.cyan,
      label: 'PLANET-03',
    });
    p1.vy = circularOrbitSpeed(star.mass, 520) * 0.99;
    const p2 = addBody(world, 'planet', -940, 200, {
      mass: 120,
      radius: 11,
      hue: PALETTE.white,
      label: 'PLANET-04',
    });
    const d2 = Math.hypot(p2.x, p2.y);
    p2.vx = (-p2.y / d2) * circularOrbitSpeed(star.mass, d2) * 0.98;
    p2.vy = (p2.x / d2) * circularOrbitSpeed(star.mass, d2) * 0.98;
    const p3 = addBody(world, 'planet', 180, -1230, {
      mass: 48,
      radius: 6,
      hue: PALETTE.violet,
      label: 'PLANET-05',
    });
    const d3 = Math.hypot(p3.x, p3.y);
    p3.vx = (-p3.y / d3) * circularOrbitSpeed(star.mass, d3);
    p3.vy = (p3.x / d3) * circularOrbitSpeed(star.mass, d3);

    spawnDisc(world, {
      count: Math.round(density),
      rMin: 140,
      rMax: 2350,
      mass: star.mass,
      arms: 3,
      twist: 2.6,
      armSpread: 0.24,
      velocityScale: 0.99,
    });
    spawnDisc(world, {
      count: Math.round(density * 0.16),
      cx: 900,
      cy: -1600,
      rMin: 160,
      rMax: 700,
      mass: 260,
      arms: 2,
      twist: 1.4,
      dustBias: 0.7,
      angleOffset: 1.2,
      velocityScale: 0.55,
    });
    world.baseline = world.particles.count;
  },
};

const binary: ScenarioDef = {
  id: 'binary',
  name: 'Binary Dance',
  blurb: 'Two stars of equal mass locked in a mutual orbit, wrapped in dust.',
  seed: 7_771_113,
  baseCount: 5200,
  build(world, density) {
    const separation = 620;
    const m = 1050;
    const v = Math.sqrt((3000 * m) / (2 * separation));
    const a = addBody(world, 'star', -separation / 2, 0, {
      mass: m,
      radius: 27,
      hue: PALETTE.amber,
      label: 'BIN-A',
    });
    a.vy = v;
    const b = addBody(world, 'star', separation / 2, 0, {
      mass: m,
      radius: 27,
      hue: PALETTE.cyan,
      label: 'BIN-B',
    });
    b.vy = -v;

    spawnDisc(world, {
      cx: 0,
      cy: 0,
      count: Math.round(density),
      rMin: 520,
      rMax: 2300,
      mass: m * 2,
      dustBias: 0.62,
    });
    const circumbinary = addBody(world, 'planet', 1350, 260, {
      mass: 40,
      radius: 5,
      hue: PALETTE.white,
      label: 'BIN-C',
    });
    orbitVelocity(circumbinary, m * 2);
    world.baseline = world.particles.count;
  },
};

const singularity: ScenarioDef = {
  id: 'singularity',
  name: 'The Hungry Singularity',
  blurb: 'An accretion disc spirals into a black hole. Feed it.',
  seed: 3_141_592,
  baseCount: 6400,
  build(world, density) {
    const hole = addBody(world, 'blackhole', 0, 0, {
      mass: 3600,
      radius: 19,
      label: 'SGR-A',
    });
    spawnDisc(world, {
      count: Math.round(density),
      rMin: 150,
      rMax: 1500,
      mass: hole.mass,
      arms: 2,
      twist: 4.2,
      armSpread: 0.4,
      dustBias: 0.5,
      radialBrake: 0.015,
      zSpread: 30,
    });
    const star = addBody(world, 'star', 1250, -400, {
      mass: 700,
      radius: 22,
      hue: PALETTE.amber,
      label: 'INFALL-02',
    });
    orbitVelocity(star, hole.mass, 0.72);
    const planet = addBody(world, 'planet', -760, 620, {
      mass: 70,
      radius: 8,
      hue: PALETTE.cyan,
      label: 'PLANET-03',
    });
    orbitVelocity(planet, hole.mass, 0.92);
    world.baseline = world.particles.count;
  },
};

const collapse: ScenarioDef = {
  id: 'collapse',
  name: 'Stellar Collapse',
  blurb: 'A dense, unstable cloud with a star about to detonate.',
  seed: 555_012,
  baseCount: 7200,
  build(world, density) {
    addBody(world, 'star', 0, 0, {
      mass: 1500,
      radius: 42,
      hue: PALETTE.amber,
      label: 'CORE-01',
      life: 16,
    });
    spawnDisc(world, {
      count: Math.round(density),
      rMin: 80,
      rMax: 760,
      mass: 1500,
      arms: 0,
      dustBias: 0.5,
      velocityScale: 0.42,
      zSpread: 90,
      life: 900,
    });
    spawnDisc(world, {
      count: Math.round(density * 0.3),
      rMin: 700,
      rMax: 2100,
      mass: 1500,
      arms: 4,
      twist: 3.1,
      dustBias: 0.62,
      velocityScale: 0.8,
    });
    const orbiter = addBody(world, 'planet', 900, 0, {
      mass: 120,
      radius: 9,
      hue: PALETTE.cyan,
      label: 'PLANET-02',
    });
    orbitVelocity(orbiter, 1500);
    addBody(world, 'star', -1450, 980, {
      mass: 520,
      radius: 18,
      hue: PALETTE.white,
      label: 'WITNESS-03',
    });
    world.baseline = world.particles.count;
  },
};

const slingshot: ScenarioDef = {
  id: 'slingshot',
  name: 'Slingshot',
  blurb: 'A massive star bends a high-velocity stream. Aim the pass.',
  seed: 909_909,
  baseCount: 3000,
  build(world, density) {
    const star = addBody(world, 'star', -260, 0, {
      mass: 3200,
      radius: 36,
      hue: PALETTE.amber,
      label: 'MASS-01',
    });
    const rng = world.rng;
    for (let i = 0; i < 900; i++) {
      const y = rng.range(-520, 520);
      addParticle(world.particles, {
        x: 2100 + rng.range(-90, 90),
        y,
        z: rng.normal(30),
        vx: -rng.range(200, 240),
        vy: rng.range(-12, 12),
        life: 40 + rng.next() * 30,
        size: rng.range(1.4, 3.1),
        pal: rng.next() < 0.6 ? PALETTE.cyan : PALETTE.white,
        seed: rng.next(),
        type: 1,
      });
    }
    world.stats.emitted += 900;

    spawnDisc(world, {
      count: Math.round(density * 0.55),
      cx: star.x,
      cy: star.y,
      rMin: 160,
      rMax: 1200,
      mass: star.mass,
      arms: 2,
      twist: 1.8,
      dustBias: 0.6,
    });

    const runner = addBody(world, 'planet', 1500, -620, {
      mass: 80,
      radius: 9,
      hue: PALETTE.cyan,
      label: 'RUNNER-02',
    });
    runner.vx = -250;
    runner.vy = 105;
    addBody(world, 'blackhole', 1450, 760, {
      mass: 1400,
      radius: 12,
      label: 'SGR-B',
    });
    world.baseline = world.particles.count;
  },
};

const chaos: ScenarioDef = {
  id: 'chaos',
  name: 'Total Chaos',
  blurb: 'Two singularities, four stars and a repulsor in open conflict.',
  seed: 4_204_242,
  baseCount: 6200,
  build(world, density) {
    const h1 = addBody(world, 'blackhole', -1150, -420, { mass: 2200, radius: 15, label: 'SGR-X' });
    h1.vx = 46;
    h1.vy = 20;
    const h2 = addBody(world, 'blackhole', 1180, 520, { mass: 1800, radius: 13, label: 'SGR-Y' });
    h2.vx = -52;
    h2.vy = -14;

    addBody(world, 'star', 240, -180, { mass: 900, radius: 24, hue: PALETTE.amber, label: 'SPARK-03' }).vx = 10;
    addBody(world, 'star', -320, 680, { mass: 640, radius: 19, hue: PALETTE.white, label: 'SPARK-04' });
    addBody(world, 'star', 900, -960, { mass: 780, radius: 20, hue: PALETTE.amber, label: 'SPARK-05' });
    addBody(world, 'repulsor', 0, 160, { strength: 1.5, influence: 560, label: 'PUSH-06' });
    addBody(world, 'well', -700, 1100, { mass: 900, influence: 620, label: 'WELL-07' });

    spawnDisc(world, {
      count: Math.round(density),
      rMin: 120,
      rMax: 2600,
      mass: 2800,
      arms: 5,
      twist: -5,
      armSpread: 0.5,
      dustBias: 0.55,
      velocityScale: 0.9,
    });
    world.baseline = world.particles.count;
  },
};

export const SCENARIOS: ScenarioDef[] = [prime, binary, singularity, collapse, slingshot, chaos];

export function findScenario(id: string): ScenarioDef {
  return SCENARIOS.find((s) => s.id === id) ?? prime;
}

/** Loads a scenario into an existing world (no renderer rebinding required). */
export function loadScenario(world: World, id: string, targetParticles: number): void {
  const scenario = findScenario(id);
  resetWorld(world, scenario.seed);
  const density = Math.max(400, Math.min(PARTICLE_CAPACITY * 0.8, targetParticles)) * (scenario.baseCount / 7600);
  scenario.build(world, density);
  world.baseline = world.particles.count;
  world.params.seed = scenario.seed;
}
