export const PARTICLE_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aPal;
  attribute float aSeed;
  attribute float aLife;

  uniform float uPixelScale;
  uniform float uTime;
  uniform vec3 uPalette[6];

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    int idx = int(aPal + 0.5);
    vColor = uPalette[idx];
    float twinkle = 0.78 + 0.22 * sin(uTime * (0.9 + aSeed * 2.6) + aSeed * 41.0);
    vAlpha = aLife * twinkle;
    float size = max(aSize, 0.6) * uPixelScale / max(-mv.z, 1.0);
    gl_PointSize = clamp(size, 1.2, 46.0);
  }
`;

export const PARTICLE_FRAG = /* glsl */ `
  precision mediump float;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float core = smoothstep(1.0, 0.0, d);
    float glow = exp(-d * d * 3.2);
    float a = (core * 0.6 + glow * 0.45) * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor * (0.85 + core * 0.7), a);
  }
`;

export const STREAK_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const STREAK_FRAG = /* glsl */ `
  precision mediump float;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    if (vAlpha < 0.003) discard;
    gl_FragColor = vec4(vColor * 0.55, vAlpha);
  }
`;

export const BACKGROUND_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.9999, 1.0);
  }
`;

export const BACKGROUND_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform vec2 uResolution;
  uniform vec2 uOffset;
  uniform float uTime;
  uniform float uIntensity;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      v += amp * noise(p);
      p = p * 2.03 + 11.7;
      amp *= 0.5;
    }
    return v;
  }

  float starLayer(vec2 p, float density, float size, float seedOffset) {
    vec2 gp = p * density;
    vec2 ip = floor(gp);
    float h = hash(ip + seedOffset);
    vec2 sp = fract(gp) - 0.5;
    float d = length(sp);
    float present = step(1.0 - 0.012, h);
    float falloff = smoothstep(size, 0.0, d);
    float twinkle = 0.65 + 0.35 * sin(uTime * (0.5 + fract(h * 31.0) * 1.8) + h * 90.0);
    return present * falloff * twinkle * (0.35 + fract(h * 17.0) * 0.9);
  }

  void main() {
    vec2 uv = vUv;
    vec2 p = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    vec2 parallax = uOffset * 0.00022;

    vec3 col = vec3(0.006, 0.009, 0.017);

    vec2 q = p * 1.5 + parallax;
    float c1 = fbm(q * 1.15 + vec2(2.4, -1.1));
    float c2 = fbm(q * 2.6 + vec2(-3.7, 2.9) + c1 * 0.7);
    float neb = smoothstep(0.42, 1.0, c1 * 0.62 + c2 * 0.52);
    float filaments = smoothstep(0.55, 0.98, c2) * 0.6;

    col += vec3(0.075, 0.040, 0.115) * neb * 0.85;
    col += vec3(0.012, 0.055, 0.075) * pow(neb, 1.8) * 1.35;
    col += vec3(0.10, 0.048, 0.019) * filaments * neb * 0.75;

    // Distant star fields at three depths.
    float s1 = starLayer(p + parallax * 0.6, 210.0, 0.22, 0.0);
    float s2 = starLayer(p + parallax * 1.2 + 9.3, 120.0, 0.3, 31.0);
    float s3 = starLayer(p + parallax * 1.8 + 4.7, 62.0, 0.4, 77.0);
    col += vec3(0.85, 0.9, 1.0) * s1 * 0.55;
    col += vec3(0.75, 0.86, 1.0) * s2 * 0.7;
    col += vec3(1.0, 0.85, 0.68) * s3 * 0.55;

    float vignette = smoothstep(1.25, 0.35, length(p * vec2(1.0, 1.05)));
    col *= mix(0.55, 1.0, vignette);
    col *= uIntensity;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const BODY_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const STAR_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform vec3 uCoreColor;
  uniform float uTime;
  uniform float uSeed;
  uniform float uIntensity;

  void main() {
    vec2 c = vUv * 2.0 - 1.0;
    float r = length(c);
    if (r > 1.0) discard;
    float pulse = 0.9 + 0.1 * sin(uTime * 1.7 + uSeed * 22.0);
    float core = exp(-r * r * 42.0) * 1.9;
    float mid = exp(-r * r * 8.0) * 0.6;
    float halo = exp(-r * r * 2.1) * 0.18;
    float a = (core + mid + halo) * pulse * uIntensity;
    vec3 col = mix(uColor, uCoreColor, clamp(core * 0.55, 0.0, 1.0));
    gl_FragColor = vec4(col, a);
  }
`;

export const PLANET_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uSeed;

  void main() {
    vec2 c = vUv * 2.0 - 1.0;
    float r = length(c);
    if (r > 1.0) discard;
    float disc = smoothstep(1.0, 0.9, r);
    float rim = smoothstep(0.55, 1.0, r);
    float light = smoothstep(0.1, 1.0, dot(normalize(c + vec2(0.0001)), normalize(vec2(-0.75, 0.66))));
    vec3 col = uColor * (0.08 + light * 0.55) + uColor * rim * 0.7;
    float bands = 0.9 + 0.1 * sin(c.y * 26.0 + uSeed * 18.0 + uTime * 0.25);
    float a = disc * (0.72 + rim * 0.28);
    gl_FragColor = vec4(col * bands, a);
  }
`;

export const GLOW_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uAlpha;
  void main() {
    vec2 c = vUv * 2.0 - 1.0;
    float r = length(c);
    if (r > 1.0) discard;
    float glow = exp(-r * r * 4.5) * 0.4 + exp(-r * r * 1.8) * 0.14;
    gl_FragColor = vec4(uColor, glow * uAlpha);
  }
`;

export const ACCRETION_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uSeed;
  uniform vec3 uColor;

  void main() {
    vec2 c = vUv * 2.0 - 1.0;
    float r = length(c);
    if (r > 1.0) discard;
    float ang = atan(c.y, c.x);
    float inner = 0.17;
    float outer = 0.86;
    float ring = smoothstep(inner, inner + 0.05, r) * smoothstep(outer, outer - 0.14, r);
    float streak = 0.45 + 0.55 * sin(ang * 6.0 + uTime * 2.1 - r * 37.0 + uSeed * 12.0);
    float streak2 = 0.4 + 0.6 * sin(ang * 11.0 - uTime * 1.3 - r * 61.0);
    float heat = smoothstep(outer, inner, r);
    float doppler = 0.55 + 0.45 * cos(ang - uTime * 0.4);
    vec3 hot = mix(vec3(1.0, 0.52, 0.22), vec3(0.72, 0.62, 1.0), smoothstep(inner, outer, r));
    float a = ring * (0.22 + heat * 0.95) * (0.4 + streak * 0.45 + streak2 * 0.25) * doppler;
    a *= 0.85;
    gl_FragColor = vec4(mix(uColor, hot, 0.7), a);
  }
`;

export const HORIZON_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uTime;
  void main() {
    vec2 c = vUv * 2.0 - 1.0;
    float r = length(c);
    if (r > 1.0) discard;
    float body = smoothstep(1.0, 0.94, r);
    float rim = smoothstep(0.72, 1.0, r) * 0.9;
    float pulse = 0.85 + 0.15 * sin(uTime * 1.2);
    gl_FragColor = vec4(uColor * rim * pulse, body * 0.96);
  }
`;

export const RING_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const FORCE_RING_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uSeed;
  uniform float uAlpha;
  uniform float uInner;

  void main() {
    vec2 c = vUv * 2.0 - 1.0;
    float r = length(c);
    if (r > 1.0) discard;
    float ang = atan(c.y, c.x);
    float line = exp(-pow((r - 0.985) * 130.0, 2.0));
    float ticks = step(0.82, fract((ang / 6.2831853) * 48.0 + uTime * 0.02)) * smoothstep(0.9, 0.965, r) * 0.4;
    float sweep = smoothstep(0.7, 1.0, sin(ang * 2.0 - uTime * 0.9 + uSeed * 8.0)) * exp(-pow((r - 0.9) * 16.0, 2.0)) * 0.25;
    float fill = exp(-pow(r / 0.55, 2.0)) * 0.06;
    float inner = exp(-pow((r - uInner) * 90.0, 2.0)) * 0.8;
    float a = (line + ticks + sweep + fill + inner) * uAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export const DASH_RING_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uAlpha;

  void main() {
    vec2 c = vUv * 2.0 - 1.0;
    float r = length(c);
    if (r > 1.0) discard;
    float ang = atan(c.y, c.x);
    float dash = step(0.45, fract((ang / 6.2831853) * 28.0 + uTime * 0.12));
    float ring = exp(-pow((r - 0.94) * 90.0, 2.0));
    float a = ring * (0.35 + dash * 0.65) * uAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export const SHOCK_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uRadius;
  uniform float uWidth;
  uniform float uSize;
  uniform float uAlpha;

  void main() {
    vec2 c = (vUv * 2.0 - 1.0) * uSize * 0.5;
    float r = length(c);
    float d = abs(r - uRadius);
    float band = exp(-pow(d / max(uWidth, 0.001), 2.0) * 2.2);
    float front = exp(-pow(d / max(uWidth * 0.22, 0.001), 2.0));
    float a = (band * 0.32 + front * 0.8) * uAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(mix(uColor, vec3(0.92, 0.95, 1.0), 0.45), a);
  }
`;

export const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const BRIGHT_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform float uThreshold;

  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    float contribution = smoothstep(uThreshold, uThreshold + 0.35, lum);
    gl_FragColor = vec4(c * contribution, 1.0);
  }
`;

export const BLUR_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform sampler2D tInput;
  uniform vec2 uDirection;

  void main() {
    vec3 sum = texture2D(tInput, vUv).rgb * 0.227027;
    sum += texture2D(tInput, vUv + uDirection * 1.3846).rgb * 0.316216;
    sum += texture2D(tInput, vUv - uDirection * 1.3846).rgb * 0.316216;
    sum += texture2D(tInput, vUv + uDirection * 3.2307).rgb * 0.070270;
    sum += texture2D(tInput, vUv - uDirection * 3.2307).rgb * 0.070270;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

export const COMPOSITE_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform float uBloom;
  uniform float uTime;
  uniform float uLens;
  uniform float uFlash;
  uniform vec3 uWells[6];
  uniform vec2 uResolution;

  vec2 lensWarp(vec2 uv) {
    vec2 warp = vec2(0.0);
    for (int i = 0; i < 6; i++) {
      vec3 w = uWells[i];
      if (w.z <= 0.0001) continue;
      vec2 d = uv - w.xy;
      d.x *= uResolution.x / uResolution.y;
      float r2 = dot(d, d);
      float falloff = w.z * 0.0032 / (r2 + 0.0022);
      warp += normalize(d + vec2(0.000001)) * min(falloff, 0.02);
    }
    return warp * uLens;
  }

  void main() {
    vec2 uv = vUv;
    vec2 warp = lensWarp(uv);
    vec3 col;
    col.r = texture2D(tScene, uv + warp * 1.09).r;
    col.g = texture2D(tScene, uv + warp).g;
    col.b = texture2D(tScene, uv + warp * 0.93).b;

    vec3 bloom = texture2D(tBloom, uv).rgb;
    col += bloom * uBloom;
    col += uFlash * vec3(1.0, 0.78, 0.56);

    float vig = smoothstep(1.28, 0.42, length((uv - 0.5) * vec2(1.05, 1.0)));
    col *= mix(0.62, 1.0, vig);

    col = col / (1.0 + col * 0.28);
    float grain = fract(sin(dot(uv * uResolution + uTime, vec2(12.9898, 78.233))) * 43758.5453);
    col += (grain - 0.5) * 0.012;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export const PALETTE_VEC3: [number, number, number][] = [
  [0.95, 0.97, 1.0],
  [1.0, 0.66, 0.32],
  [0.36, 0.86, 1.0],
  [0.63, 0.5, 1.0],
  [0.26, 0.36, 0.56],
  [1.0, 0.45, 0.33],
];

export const CSS_PALETTE = ['#f2f6ff', '#ffa851', '#5cdcff', '#a084ff', '#4b5f8a', '#ff7359'];
