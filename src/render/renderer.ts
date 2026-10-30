import * as THREE from 'three';
import {
  ACCRETION_FRAG,
  BACKGROUND_FRAG,
  BACKGROUND_VERT,
  BLUR_FRAG,
  BODY_VERT,
  BRIGHT_FRAG,
  COMPOSITE_FRAG,
  CSS_PALETTE,
  DASH_RING_FRAG,
  FORCE_RING_FRAG,
  FULLSCREEN_VERT,
  GLOW_FRAG,
  HORIZON_FRAG,
  PALETTE_VEC3,
  PARTICLE_FRAG,
  PARTICLE_VERT,
  PHOTON_RING_FRAG,
  PLANET_FRAG,
  RING_VERT,
  SHOCK_FRAG,
  STAR_FRAG,
  STREAK_FRAG,
  STREAK_VERT,
  TRAIL_FRAG,
  TRAIL_VERT,
} from './shaders';
import type { Body, QualityLevel, Shockwave, ToolId, World } from '../core/types';
import { eventHorizon, PARTICLE_CAPACITY } from '../core/world';

// All colours in this renderer are authored directly for the display; mixing in
// automatic linear/sRGB conversions would silently dim every hand-tuned value.
THREE.ColorManagement.enabled = false;

const CAMERA_FOV = 45;
const FOV_RAD = (CAMERA_FOV * Math.PI) / 180;
const PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

export interface ToolPreview {
  visible: boolean;
  x: number;
  y: number;
  radius: number;
  tool: ToolId;
  active: boolean;
}

export interface RenderOptions {
  selectedId: number | null;
  hoveredId: number | null;
  preview: ToolPreview | null;
  time: number;
  trailLength: number;
}

interface BodyView {
  kind: Body['kind'];
  group: THREE.Group;
  glow: THREE.Mesh | null;
  core: THREE.Mesh | null;
  accretion: THREE.Mesh | null;
  horizon: THREE.Mesh | null;
  photon: THREE.Mesh | null;
  ring: THREE.Mesh | null;
  selection: THREE.Mesh | null;
  trail: THREE.Line;
  trailAttr: THREE.BufferAttribute;
  trailFadeAttr: THREE.BufferAttribute;
  lastRadius: number;
  lastInfluence: number;
  mats: THREE.ShaderMaterial[];
}

function paletteColor(hue: number): string {
  return CSS_PALETTE[Math.floor(hue) % CSS_PALETTE.length];
}

function hueVector(hue: number): THREE.Vector3 {
  const p = PALETTE_VEC3[Math.floor(hue) % PALETTE_VEC3.length];
  return new THREE.Vector3(p[0], p[1], p[2]);
}

export class UniverseRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private readonly canvas: HTMLCanvasElement;
  private readonly bgScene: THREE.Scene;
  private readonly bgCamera: THREE.OrthographicCamera;
  private readonly bgMat: THREE.ShaderMaterial;
  private readonly postScene: THREE.Scene;
  private readonly postCamera: THREE.OrthographicCamera;
  private readonly postQuad: THREE.Mesh;
  private readonly compositeMat: THREE.ShaderMaterial;
  private readonly brightMat: THREE.ShaderMaterial;
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly rtScene: THREE.WebGLRenderTarget;
  private readonly rtBloomA: THREE.WebGLRenderTarget;
  private readonly rtBloomB: THREE.WebGLRenderTarget;

  private readonly pointGeo: THREE.BufferGeometry;
  private readonly pointMat: THREE.ShaderMaterial;
  private readonly streakGeo: THREE.BufferGeometry;
  private readonly streakMat: THREE.ShaderMaterial;
  private readonly planeGeo = new THREE.PlaneGeometry(1, 1);
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  private readonly positions: Float32Array;
  private readonly sizes: Float32Array;
  private readonly pals: Float32Array;
  private readonly seeds: Float32Array;
  private readonly lives: Float32Array;
  private readonly streakPositions: Float32Array;
  private readonly streakColors: Float32Array;
  private readonly streakAlphas: Float32Array;

  private readonly bodyGroup = new THREE.Group();
  private readonly bodyViews = new Map<number, BodyView>();
  private readonly shockViews = new Map<number, THREE.Mesh>();
  private readonly previewGroup = new THREE.Group();
  private readonly previewRing: THREE.Mesh;
  private readonly previewGlow: THREE.Mesh;
  private readonly previewDash: THREE.Mesh;
  private readonly previewRingMat: THREE.ShaderMaterial;
  private readonly previewGlowMat: THREE.ShaderMaterial;
  private readonly previewDashMat: THREE.ShaderMaterial;
  private readonly wells: THREE.Vector3[] = [];

  private world: World | null = null;
  private quality: QualityLevel = 'balanced';
  private trailAlpha = 0.34;
  private width = 1;
  private height = 1;
  private bloomEnabled = true;
  private lensingEnabled = true;
  private contextLost = false;
  private flashUntil = 0;
  private flashPeak = 0;

  onContextLost: (() => void) | null = null;
  onContextRestored: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor(0x02030a, 1);
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.info.autoReset = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 1, 40000);
    this.camera.position.set(0, -240, 3000);
    this.camera.lookAt(0, 0, 0);

    this.bgScene = new THREE.Scene();
    this.bgCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.bgMat = new THREE.ShaderMaterial({
      vertexShader: BACKGROUND_VERT,
      fragmentShader: BACKGROUND_FRAG,
      uniforms: {
        uResolution: { value: new THREE.Vector2(1, 1) },
        uOffset: { value: new THREE.Vector2(0, 0) },
        uTime: { value: 0 },
        uIntensity: { value: 1 },
        uScale: { value: 4 },
        uGraticule: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bgMat);
    bgMesh.frustumCulled = false;
    this.bgScene.add(bgMesh);

    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        uBloom: { value: 0.9 },
        uTime: { value: 0 },
        uLens: { value: 1 },
        uFlash: { value: 0 },
        uWells: { value: this.wells },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMat);
    this.postQuad.frustumCulled = false;
    this.postScene.add(this.postQuad);

    this.brightMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BRIGHT_FRAG,
      uniforms: { tScene: { value: null }, uThreshold: { value: 0.42 } },
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: { tInput: { value: null }, uDirection: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });

    const targetOptions: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    };
    this.rtScene = new THREE.WebGLRenderTarget(1, 1, targetOptions);
    this.rtBloomA = new THREE.WebGLRenderTarget(1, 1, { ...targetOptions, depthBuffer: false });
    this.rtBloomB = new THREE.WebGLRenderTarget(1, 1, { ...targetOptions, depthBuffer: false });
    for (const w of Array.from({ length: 6 }, () => new THREE.Vector3(0, 0, 0))) this.wells.push(w);

    // --- Particles ---
    const capacity = PARTICLE_CAPACITY;
    this.positions = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.pals = new Float32Array(capacity);
    this.seeds = new Float32Array(capacity);
    this.lives = new Float32Array(capacity);
    this.streakPositions = new Float32Array(capacity * 6);
    this.streakColors = new Float32Array(capacity * 6);
    this.streakAlphas = new Float32Array(capacity * 2);

    this.pointGeo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    const sizeAttr = new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage);
    const palAttr = new THREE.BufferAttribute(this.pals, 1).setUsage(THREE.DynamicDrawUsage);
    const seedAttr = new THREE.BufferAttribute(this.seeds, 1).setUsage(THREE.DynamicDrawUsage);
    const lifeAttr = new THREE.BufferAttribute(this.lives, 1).setUsage(THREE.DynamicDrawUsage);
    this.pointGeo.setAttribute('position', posAttr);
    this.pointGeo.setAttribute('aSize', sizeAttr);
    this.pointGeo.setAttribute('aPal', palAttr);
    this.pointGeo.setAttribute('aSeed', seedAttr);
    this.pointGeo.setAttribute('aLife', lifeAttr);
    this.pointGeo.setDrawRange(0, 0);
    this.pointGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 30000);

    this.pointMat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: {
        uPixelScale: { value: 1200 },
        uTime: { value: 0 },
        uPalette: { value: PALETTE_VEC3.map((p) => new THREE.Vector3(...p)) },
        uGain: { value: 1.15 },
        uSizeMin: { value: 2.2 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const points = new THREE.Points(this.pointGeo, this.pointMat);
    points.frustumCulled = false;
    this.scene.add(points);

    this.streakGeo = new THREE.BufferGeometry();
    const sPos = new THREE.BufferAttribute(this.streakPositions, 3).setUsage(THREE.DynamicDrawUsage);
    const sColor = new THREE.BufferAttribute(this.streakColors, 3).setUsage(THREE.DynamicDrawUsage);
    const sAlpha = new THREE.BufferAttribute(this.streakAlphas, 1).setUsage(THREE.DynamicDrawUsage);
    this.streakGeo.setAttribute('position', sPos);
    this.streakGeo.setAttribute('aColor', sColor);
    this.streakGeo.setAttribute('aAlpha', sAlpha);
    this.streakGeo.setDrawRange(0, 0);
    this.streakGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 30000);
    this.streakMat = new THREE.ShaderMaterial({
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const streaks = new THREE.LineSegments(this.streakGeo, this.streakMat);
    streaks.frustumCulled = false;
    this.scene.add(streaks);

    this.scene.add(this.bodyGroup);

    // --- Tool preview ---
    this.previewRingMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: FORCE_RING_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color('#ffa851') },
        uTime: { value: 0 },
        uSeed: { value: 0.5 },
        uAlpha: { value: 0.55 },
        uInner: { value: 0.02 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.previewRing = new THREE.Mesh(this.planeGeo, this.previewRingMat);
    this.previewRing.frustumCulled = false;

    this.previewGlowMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: GLOW_FRAG,
      uniforms: { uColor: { value: new THREE.Color('#ffa851') }, uAlpha: { value: 0.6 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.previewGlow = new THREE.Mesh(this.planeGeo, this.previewGlowMat);
    this.previewGlow.frustumCulled = false;

    this.previewDashMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: DASH_RING_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color('#5cdcff') },
        uTime: { value: 0 },
        uAlpha: { value: 0.5 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.previewDash = new THREE.Mesh(this.planeGeo, this.previewDashMat);
    this.previewDash.frustumCulled = false;

    this.previewGroup.add(this.previewRing, this.previewGlow, this.previewDash);
    this.previewGroup.visible = false;
    this.scene.add(this.previewGroup);

    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
  }

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.onContextLost?.();
  };

  private handleContextRestored = (): void => {
    this.contextLost = false;
    this.onContextRestored?.();
  };

  setWorld(world: World): void {
    this.world = world;
    for (const view of this.bodyViews.values()) this.disposeView(view);
    this.bodyViews.clear();
    for (const mesh of this.shockViews.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.shockViews.clear();
  }

  /** Brief supernova illumination on top of the shockwave itself. */
  flash(amount = 0.35): void {
    this.flashPeak = Math.min(0.85, amount);
    this.flashUntil = performance.now() + 300;
  }

  setQuality(quality: QualityLevel): void {
    this.quality = quality;
    this.bloomEnabled = quality !== 'performance';
    this.lensingEnabled = quality !== 'performance';
    const dprCap = quality === 'cinematic' ? 2 : quality === 'balanced' ? 1.6 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    // Particle emissive tuning per tier: performance gets the smallest lift,
    // cinematic the richest.
    const gain = quality === 'cinematic' ? 1.3 : quality === 'balanced' ? 1.15 : 1.0;
    const sizeMin = quality === 'cinematic' ? 2.6 : quality === 'balanced' ? 2.2 : 1.8;
    (this.pointMat.uniforms.uGain.value as number) = gain;
    (this.pointMat.uniforms.uSizeMin.value as number) = sizeMin;
    this.trailAlpha = quality === 'cinematic' ? 0.38 : quality === 'balanced' ? 0.34 : 0.24;
    for (const view of this.bodyViews.values()) {
      const tMat = view.trail.material as THREE.ShaderMaterial;
      if (tMat.uniforms?.uAlpha) tMat.uniforms.uAlpha.value = this.trailAlpha;
    }
    this.resize(this.width, this.height);
  }

  getQuality(): QualityLevel {
    return this.quality;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    const buffer = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(buffer);
    this.rtScene.setSize(buffer.x, buffer.y);
    const bw = Math.max(1, Math.floor(buffer.x / 3));
    const bh = Math.max(1, Math.floor(buffer.y / 3));
    this.rtBloomA.setSize(bw, bh);
    this.rtBloomB.setSize(bw, bh);
    (this.bgMat.uniforms.uResolution.value as THREE.Vector2).set(buffer.x, buffer.y);
    (this.compositeMat.uniforms.uResolution.value as THREE.Vector2).set(buffer.x, buffer.y);
    this.updatePixelScale();
  }

  private updatePixelScale(): void {
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    const scale = (size.y * 0.5) / Math.tan((CAMERA_FOV * Math.PI) / 360);
    (this.pointMat.uniforms.uPixelScale.value as number) = scale * 2.5;
  }

  /** Rebuilds the body views for the current world (call after loading a state). */
  refreshBodies(): void {
    if (!this.world) return;
    const seen = new Set<number>();
    for (const body of this.world.bodies) {
      seen.add(body.id);
      const existing = this.bodyViews.get(body.id);
      if (existing && existing.kind !== body.kind) {
        this.disposeView(existing);
        this.bodyViews.delete(body.id);
      }
      if (!this.bodyViews.has(body.id)) this.bodyViews.set(body.id, this.createBodyView(body));
    }
    for (const [id, view] of this.bodyViews) {
      if (!seen.has(id)) {
        this.disposeView(view);
        this.bodyViews.delete(id);
      }
    }
  }

  private createBodyView(body: Body): BodyView {
    const group = new THREE.Group();
    const mats: THREE.ShaderMaterial[] = [];
    let glow: THREE.Mesh | null = null;
    let core: THREE.Mesh | null = null;
    let accretion: THREE.Mesh | null = null;
    let horizon: THREE.Mesh | null = null;
    let photon: THREE.Mesh | null = null;
    let ring: THREE.Mesh | null = null;

    const makeMat = (fragment: string, uniforms: Record<string, THREE.IUniform>, additive = true): THREE.ShaderMaterial => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: BODY_VERT,
        fragmentShader: fragment,
        uniforms,
        transparent: true,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthTest: true,
        depthWrite: false,
      });
      mats.push(mat);
      return mat;
    };

    const baseColor = hueVector(body.hue);
    const color = new THREE.Color(baseColor.x, baseColor.y, baseColor.z);

    if (body.kind === 'star') {
      const mat = makeMat(STAR_FRAG, {
        uColor: { value: color },
        uCoreColor: { value: new THREE.Color('#fff6e2') },
        uTime: { value: 0 },
        uSeed: { value: body.seed },
        uIntensity: { value: 1 },
      });
      glow = new THREE.Mesh(this.planeGeo, mat);
      glow.scale.setScalar(body.radius * 12);
      glow.frustumCulled = false;
      group.add(glow);
    } else if (body.kind === 'planet') {
      const mat = makeMat(
        PLANET_FRAG,
        { uColor: { value: color }, uTime: { value: 0 }, uSeed: { value: body.seed } },
        false,
      );
      core = new THREE.Mesh(this.planeGeo, mat);
      core.scale.setScalar(body.radius * 2);
      core.frustumCulled = false;
      group.add(core);
      const atm = makeMat(GLOW_FRAG, {
        uColor: { value: color },
        uAlpha: { value: 0.24 },
      });
      glow = new THREE.Mesh(this.planeGeo, atm);
      glow.scale.setScalar(body.radius * 7);
      glow.frustumCulled = false;
      group.add(glow);
    } else if (body.kind === 'blackhole') {
      const accMat = makeMat(ACCRETION_FRAG, {
        uColor: { value: color },
        uTime: { value: 0 },
        uSeed: { value: body.seed },
        uSpin: { value: 0 },
      });
      accretion = new THREE.Mesh(this.planeGeo, accMat);
      accretion.scale.setScalar(body.radius * 11);
      accretion.frustumCulled = false;
      accretion.renderOrder = 1;
      group.add(accretion);

      const horMat = makeMat(
        HORIZON_FRAG,
        { uColor: { value: new THREE.Color('#120b1e') }, uTime: { value: 0 } },
        false,
      );
      horizon = new THREE.Mesh(this.planeGeo, horMat);
      horizon.scale.setScalar(body.radius * 2.6);
      horizon.frustumCulled = false;
      horizon.renderOrder = 2;
      group.add(horizon);

      // Thin photon ring hugging the shadow's edge, drawn additively on top.
      const phMat = makeMat(PHOTON_RING_FRAG, {
        uColor: { value: new THREE.Color('#cfd8ff') },
        uTime: { value: 0 },
      });
      phMat.depthTest = false;
      photon = new THREE.Mesh(this.planeGeo, phMat);
      photon.scale.setScalar(body.radius * 3.1);
      photon.frustumCulled = false;
      photon.renderOrder = 4;
      group.add(photon);
    } else {
      const inner = body.influence > 0 ? Math.min(0.4, body.radius / body.influence) : 0.02;
      const mat = makeMat(FORCE_RING_FRAG, {
        uColor: { value: color },
        uTime: { value: 0 },
        uSeed: { value: body.seed },
        uAlpha: { value: body.kind === 'repulsor' ? 0.5 : 0.42 },
        uInner: { value: inner },
      });
      ring = new THREE.Mesh(this.planeGeo, mat);
      ring.scale.setScalar(Math.max(body.influence, 120) * 2);
      ring.frustumCulled = false;
      group.add(ring);
      const cMat = makeMat(GLOW_FRAG, { uColor: { value: color }, uAlpha: { value: 0.8 } });
      core = new THREE.Mesh(this.planeGeo, cMat);
      core.scale.setScalar(body.radius * 7);
      core.frustumCulled = false;
      group.add(core);
    }

    const selMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: DASH_RING_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color('#eaf2ff') },
        uTime: { value: 0 },
        uAlpha: { value: 0.85 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    mats.push(selMat);
    const selection = new THREE.Mesh(this.planeGeo, selMat);
    selection.scale.setScalar(Math.max(body.radius * 5, 70));
    selection.frustumCulled = false;
    selection.visible = false;
    group.add(selection);

    const trailGeo = new THREE.BufferGeometry();
    const trailAttr = new THREE.BufferAttribute(new Float32Array(222 * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    );
    const trailFadeAttr = new THREE.BufferAttribute(new Float32Array(222), 1).setUsage(
      THREE.DynamicDrawUsage,
    );
    trailGeo.setAttribute('position', trailAttr);
    trailGeo.setAttribute('aFade', trailFadeAttr);
    trailGeo.setDrawRange(0, 0);
    const trailMat = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(paletteColor(body.hue)) },
        uAlpha: { value: this.trailAlpha },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    mats.push(trailMat);
    const trail = new THREE.Line(trailGeo, trailMat);
    trail.frustumCulled = false;
    group.add(trail);

    this.bodyGroup.add(group);
    return {
      kind: body.kind,
      group,
      glow,
      core,
      accretion,
      horizon,
      photon,
      ring,
      selection,
      trail,
      trailAttr,
      trailFadeAttr,
      lastRadius: body.radius,
      lastInfluence: body.influence,
      mats,
    };
  }

  private disposeView(view: BodyView): void {
    this.bodyGroup.remove(view.group);
    view.group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh || (obj as THREE.Line).isLine) {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry && mesh.geometry !== this.planeGeo) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      }
    });
  }

  private syncBodies(bodyList: Body[], options: RenderOptions): void {
    const seen = new Set<number>();
    for (const body of bodyList) {
      seen.add(body.id);
      let view = this.bodyViews.get(body.id);
      if (view && view.kind !== body.kind) {
        this.disposeView(view);
        this.bodyViews.delete(body.id);
        view = undefined;
      }
      if (!view) {
        view = this.createBodyView(body);
        this.bodyViews.set(body.id, view);
      }
      view.group.position.set(body.x, body.y, 0);
      if (body.radius !== view.lastRadius || body.influence !== view.lastInfluence) {
        this.resizeBodyView(body, view);
      }

      const time = options.time;
      for (const mat of view.mats) {
        const uTime = mat.uniforms.uTime;
        if (uTime) uTime.value = time;
      }

      if (view.glow && body.kind === 'star') {
        const intensity = body.life >= 0 ? 1 + (1 - Math.min(1, body.life / Math.max(body.maxLife, 0.001))) * 0.6 : 1;
        const m = view.glow.material as THREE.ShaderMaterial;
        m.uniforms.uIntensity.value = intensity;
      }
      if (view.accretion) {
        const spin = -time * 0.08;
        view.accretion.rotation.z = spin;
        const accMat = view.accretion.material as THREE.ShaderMaterial;
        if (accMat.uniforms.uSpin) accMat.uniforms.uSpin.value = spin;
      }
      if (body.kind === 'planet' && view.core) {
        view.core.rotation.z = body.spin * 0.25;
      }

      const selected = options.selectedId === body.id;
      const hovered = options.hoveredId === body.id;
      if (view.selection) {
        view.selection.visible = selected || hovered;
        if (view.selection.visible) {
          view.selection.rotation.z = time * 0.25;
          (view.selection.material as THREE.ShaderMaterial).uniforms.uAlpha.value = selected ? 0.9 : 0.35;
          (view.selection.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
        }
      }

      this.updateBodyTrail(body, view);
    }

    for (const [id, view] of this.bodyViews) {
      if (!seen.has(id)) {
        this.disposeView(view);
        this.bodyViews.delete(id);
      }
    }
  }

  private resizeBodyView(body: Body, view: BodyView): void {
    view.lastRadius = body.radius;
    view.lastInfluence = body.influence;
    if (body.kind === 'star' && view.glow) view.glow.scale.setScalar(body.radius * 12);
    if (body.kind === 'planet' && view.core && view.glow) {
      view.core.scale.setScalar(body.radius * 2);
      view.glow.scale.setScalar(body.radius * 7);
    }
    if (body.kind === 'blackhole' && view.accretion && view.horizon) {
      view.accretion.scale.setScalar(body.radius * 11);
      view.horizon.scale.setScalar(body.radius * 2.6);
      if (view.photon) view.photon.scale.setScalar(body.radius * 3.1);
    }
    if ((body.kind === 'well' || body.kind === 'repulsor') && view.ring) {
      view.ring.scale.setScalar(Math.max(body.influence, 120) * 2);
      if (view.core) view.core.scale.setScalar(body.radius * 7);
      const mat = view.ring.material as THREE.ShaderMaterial;
      mat.uniforms.uInner.value = body.influence > 0 ? Math.min(0.4, body.radius / body.influence) : 0.02;
    }
    if (view.selection) view.selection.scale.setScalar(Math.max(body.radius * 5, 70));
  }

  private updateBodyTrail(body: Body, view: BodyView): void {
    const samples = body.trail.length / 2;
    const attr = view.trailAttr;
    const array = attr.array as Float32Array;
    const count = Math.min(samples, 220);
    const offset = samples - count;
    for (let i = 0; i < count; i++) {
      array[i * 3] = body.trail[(offset + i) * 2];
      array[i * 3 + 1] = body.trail[(offset + i) * 2 + 1];
      array[i * 3 + 2] = 0;
    }
    // Newest sample is the body itself (fade 1); the tail decays to nothing.
    const fade = view.trailFadeAttr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      fade[i] = count > 1 ? i / (count - 1) : 1;
    }
    attr.clearUpdateRanges();
    view.trailFadeAttr.clearUpdateRanges();
    const geometry = view.trail.geometry;
    if (count > 0) {
      attr.addUpdateRange(0, count * 3);
      attr.needsUpdate = true;
      view.trailFadeAttr.addUpdateRange(0, count);
      view.trailFadeAttr.needsUpdate = true;
    }
    geometry.setDrawRange(0, count);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(body.x, body.y, 0), 6000);
  }

  private syncShockwaves(waves: Shockwave[]): void {
    const seen = new Set<number>();
    for (const wave of waves) {
      seen.add(wave.id);
      let mesh = this.shockViews.get(wave.id);
      if (!mesh) {
        const mat = new THREE.ShaderMaterial({
          vertexShader: RING_VERT,
          fragmentShader: SHOCK_FRAG,
          uniforms: {
            uColor: { value: hueVector(wave.hue) },
            uRadius: { value: wave.radius },
            uWidth: { value: wave.width },
            uSize: { value: wave.radius * 2 },
            uAlpha: { value: 1 },
          },
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
        });
        mesh = new THREE.Mesh(this.planeGeo, mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = 3;
        this.scene.add(mesh);
        this.shockViews.set(wave.id, mesh);
      }
      const mat = mesh.material as THREE.ShaderMaterial;
      const size = (wave.radius + wave.width * 3) * 2;
      mesh.position.set(wave.x, wave.y, 0);
      mesh.scale.setScalar(size);
      mat.uniforms.uRadius.value = wave.radius;
      mat.uniforms.uWidth.value = wave.width;
      mat.uniforms.uSize.value = size;
      const age = 1 - Math.max(0, wave.life) / Math.max(wave.maxLife, 0.001);
      mat.uniforms.uAlpha.value = Math.max(0, 1 - age) * 0.95;
      mat.uniforms.uColor.value = hueVector(wave.hue);
    }
    for (const [id, mesh] of this.shockViews) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
        this.shockViews.delete(id);
      }
    }
  }

  private syncPreview(preview: ToolPreview | null): void {
    if (!preview || !preview.visible) {
      this.previewGroup.visible = false;
      return;
    }
    this.previewGroup.visible = true;
    this.previewGroup.position.set(preview.x, preview.y, 0);
    const color =
      preview.tool === 'gravity'
        ? '#ffa851'
        : preview.tool === 'repel'
          ? '#5cdcff'
          : preview.tool === 'blackhole'
            ? '#a084ff'
            : preview.tool === 'supernova'
              ? '#ff7359'
              : preview.tool === 'orbit'
                ? '#f2f6ff'
                : '#ffd9a0';
    (this.previewRingMat.uniforms.uColor.value as THREE.Color).set(color);
    (this.previewGlowMat.uniforms.uColor.value as THREE.Color).set(color);
    (this.previewDashMat.uniforms.uColor.value as THREE.Color).set(color);
    (this.previewRingMat.uniforms.uAlpha.value as number) = preview.active ? 0.8 : 0.4;

    const ringVisible = preview.tool !== 'paint' && preview.tool !== 'supernova';
    this.previewRing.visible = ringVisible;
    const ringScale = Math.max(preview.radius, 40) * 2;
    this.previewRing.scale.setScalar(ringScale);
    (this.previewRingMat.uniforms.uInner.value as number) = preview.tool === 'orbit' ? 0.3 : 0.03;

    this.previewDash.visible = preview.tool === 'orbit';
    this.previewDash.scale.setScalar(Math.max(preview.radius, 40) * 2.1);

    this.previewGlow.visible = preview.tool === 'supernova' || preview.tool === 'paint' || preview.tool === 'blackhole';
    const glowScale =
      preview.tool === 'supernova' ? Math.max(preview.radius, 60) * 2.4 : preview.tool === 'blackhole' ? 190 : 70;
    this.previewGlow.scale.setScalar(glowScale);
    (this.previewGlowMat.uniforms.uAlpha.value as number) = preview.tool === 'paint' ? 0.35 : 0.55;
  }

  private updateLensUniforms(): void {
    for (const v of this.wells) v.set(0, 0, 0);
    if (!this.world || !this.lensingEnabled) return;
    const candidates = this.world.bodies
      .filter((b) => b.kind === 'blackhole' || (b.kind === 'star' && b.mass > 1200))
      .sort((a, b) => b.mass - a.mass)
      .slice(0, 6);
    const temp = new THREE.Vector3();
    for (let i = 0; i < candidates.length; i++) {
      const body = candidates[i];
      temp.set(body.x, body.y, 0).project(this.camera);
      if (temp.z > 1 || temp.z < -1) continue;
      const strength =
        body.kind === 'blackhole'
          ? 0.55 + eventHorizon(body) * 0.006
          : 0.12 + body.mass * 0.00004;
      this.wells[i].set((temp.x + 1) / 2, (temp.y + 1) / 2, strength);
    }
  }

  update(world: World, options: RenderOptions): void {
    this.world = world;
    this.syncBodies(world.bodies, options);
    this.syncShockwaves(world.shockwaves);
    this.syncPreview(options.preview);

    const field = world.particles;
    const count = Math.min(field.count, this.sizes.length);
    const positions = this.positions;
    const streakPositions = this.streakPositions;
    const streakColors = this.streakColors;
    const streakAlphas = this.streakAlphas;
    const trailSeconds = 0.008 + options.trailLength * 0.05;
    const palette = PALETTE_VEC3;

    for (let i = 0; i < count; i++) {
      const o3 = i * 3;
      const x = field.x[i];
      const y = field.y[i];
      const z = field.z[i];
      positions[o3] = x;
      positions[o3 + 1] = y;
      positions[o3 + 2] = z;

      // Life envelope in absolute seconds: quick fade-in, fade-out near death.
      // (A remaining-fraction envelope made long-lived galaxy dust — life ~1500s
      // — invisible for its first minute of simulated life.)
      const life = field.life[i];
      const maxLife = field.maxLife[i];
      const age = Math.max(0, maxLife - life);
      const fadeIn = Math.min(1, age / 1.2);
      const fadeOut = Math.min(1, Math.max(life, 0) / 1.6);
      const alpha = fadeIn * fadeOut;
      this.lives[i] = alpha;
      this.sizes[i] = field.size[i];
      this.pals[i] = field.pal[i];
      this.seeds[i] = field.seed[i];

      const vx = field.vx[i];
      const vy = field.vy[i];
      const o6 = i * 6;
      streakPositions[o6] = x;
      streakPositions[o6 + 1] = y;
      streakPositions[o6 + 2] = z;
      streakPositions[o6 + 3] = x - vx * trailSeconds;
      streakPositions[o6 + 4] = y - vy * trailSeconds;
      streakPositions[o6 + 5] = z;
      const c = palette[Math.min(5, Math.max(0, Math.floor(field.pal[i])))];
      streakColors[o6] = c[0];
      streakColors[o6 + 1] = c[1];
      streakColors[o6 + 2] = c[2];
      streakColors[o6 + 3] = c[0];
      streakColors[o6 + 4] = c[1];
      streakColors[o6 + 5] = c[2];
      streakAlphas[i * 2] = alpha * 0.45;
      streakAlphas[i * 2 + 1] = 0;
    }

    this.pointGeo.setDrawRange(0, count);
    this.streakGeo.setDrawRange(0, count * 2);
    const posAttr = this.pointGeo.getAttribute('position') as THREE.BufferAttribute;
    const sizeAttr = this.pointGeo.getAttribute('aSize') as THREE.BufferAttribute;
    const palAttr = this.pointGeo.getAttribute('aPal') as THREE.BufferAttribute;
    const seedAttr = this.pointGeo.getAttribute('aSeed') as THREE.BufferAttribute;
    const lifeAttr = this.pointGeo.getAttribute('aLife') as THREE.BufferAttribute;
    for (const attr of [posAttr, sizeAttr, palAttr, seedAttr, lifeAttr]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, count * attr.itemSize);
      attr.needsUpdate = true;
    }
    for (const key of ['position', 'aColor', 'aAlpha']) {
      const attr = this.streakGeo.getAttribute(key) as THREE.BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, count * 2 * attr.itemSize);
      attr.needsUpdate = true;
    }

    (this.pointMat.uniforms.uTime.value as number) = options.time;
    this.bgMat.uniforms.uTime.value = options.time;
    this.bgMat.uniforms.uOffset.value.set(this.camera.position.x, this.camera.position.y);
    // World units per pixel at the focal plane — anchors the graticule (D9).
    const unitsPerPixel =
      (2 * Math.max(1, this.camera.position.z) * Math.tan(FOV_RAD / 2)) / this.height;
    (this.bgMat.uniforms.uScale.value as number) = unitsPerPixel;
    this.compositeMat.uniforms.uTime.value = options.time;
    this.updateLensUniforms();
  }

  render(): void {
    if (this.contextLost) return;
    this.renderer.info.reset();
    this.renderer.setRenderTarget(this.rtScene);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.bgScene, this.bgCamera);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);

    const composite = this.compositeMat.uniforms;
    if (this.bloomEnabled) {
      this.postQuad.material = this.brightMat;
      this.brightMat.uniforms.tScene.value = this.rtScene.texture;
      this.renderer.setRenderTarget(this.rtBloomA);
      this.renderer.clear(true, false, false);
      this.renderer.render(this.postScene, this.postCamera);

      this.postQuad.material = this.blurMat;
      this.blurMat.uniforms.tInput.value = this.rtBloomA.texture;
      this.blurMat.uniforms.uDirection.value.set(1 / this.rtBloomA.width, 0);
      this.renderer.setRenderTarget(this.rtBloomB);
      this.renderer.clear(true, false, false);
      this.renderer.render(this.postScene, this.postCamera);

      this.blurMat.uniforms.tInput.value = this.rtBloomB.texture;
      this.blurMat.uniforms.uDirection.value.set(0, 1 / this.rtBloomB.height);
      this.renderer.setRenderTarget(this.rtBloomA);
      this.renderer.clear(true, false, false);
      this.renderer.render(this.postScene, this.postCamera);
      composite.tBloom.value = this.rtBloomA.texture;
      composite.uBloom.value = 0.85;
    } else {
      composite.uBloom.value = 0;
    }

    composite.tScene.value = this.rtScene.texture;
    composite.uLens.value = this.lensingEnabled ? 1 : 0;
    const remaining = Math.max(0, this.flashUntil - performance.now());
    composite.uFlash.value = this.flashPeak * Math.pow(remaining / 300, 2);
    this.postQuad.material = this.compositeMat;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);
  }

  screenToWorld(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(PLANE, hit)) return null;
    return { x: hit.x, y: hit.y };
  }

  worldToScreen(x: number, y: number): { x: number; y: number; behind: boolean } {
    const v = new THREE.Vector3(x, y, 0).project(this.camera);
    return {
      x: ((v.x + 1) / 2) * this.width,
      y: ((1 - v.y) / 2) * this.height,
      behind: v.z > 1 || v.z < -1,
    };
  }

  /** Diagnostics read straight from the WebGL renderer, never invented. */
  diagnostics(): { calls: number; points: number; lines: number } {
    let lines = 0;
    for (const view of this.bodyViews.values()) lines += view.trail.geometry.drawRange.count;
    const points = this.pointGeo.drawRange.count + (this.streakGeo.drawRange.count >> 1);
    return {
      calls: this.renderer.info.render.calls,
      points,
      lines: lines + this.streakGeo.drawRange.count,
    };
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    for (const view of this.bodyViews.values()) this.disposeView(view);
    this.bodyViews.clear();
    for (const mesh of this.shockViews.values()) {
      (mesh.material as THREE.Material).dispose();
    }
    this.shockViews.clear();
    this.pointGeo.dispose();
    this.pointMat.dispose();
    this.streakGeo.dispose();
    this.streakMat.dispose();
    this.planeGeo.dispose();
    this.bgMat.dispose();
    this.compositeMat.dispose();
    this.brightMat.dispose();
    this.blurMat.dispose();
    this.rtScene.dispose();
    this.rtBloomA.dispose();
    this.rtBloomB.dispose();
    this.renderer.dispose();
  }
}
