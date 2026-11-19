/*
 * fx.js — the 3D engine for rithikkrishnat.me.
 *
 * Three passes share one WebGL2 canvas behind the page:
 *   1. a backdrop of slow, folded light;
 *   2. "the machine": a geodesic megastructure with orbital rings, whose core is a graph of
 *      the portfolio's own projects, joined wherever two of them share a technology;
 *   3. a swarm of particles that re-forms into a different shape for every section.
 *
 * Hand-written, no libraries. It hooks into the built page by selector only. The engine's
 * state is exposed as window.__fx so the control deck (deck.js) can drive it.
 * It stays off for prefers-reduced-motion and follows the "Pause motion" button.
 */

const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

/* ------------------------------------------------------------------ project data */

const TOKEN_ALIASES = { 'jetpack compose': 'Compose', 'react native': 'React Native' };

function stackTokens(raw) {
  return raw.split('·').map((t) => t.replace(/\(.*?\)/g, '').replace(/\s[\d.]+$/, '').trim()).filter(Boolean)
    .map((t) => TOKEN_ALIASES[t.toLowerCase()] || t);
}

/** Everything the page already says about each project, read from the project list. */
function readProjects() {
  return Array.from(document.querySelectorAll('.row')).map((el, id) => {
    const text = (sel) => (el.querySelector(sel)?.textContent || '').trim();
    const link = el.querySelector('.row-meta > a[href]');
    const meta = el.querySelector('.row-meta');
    const note = link ? '' : (meta?.lastElementChild && !meta.lastElementChild.matches('.badges, .row-stack') ? meta.lastElementChild.textContent.trim() : '');
    const stack = text('.row-stack');
    return {
      id, el,
      name: text('h3'),
      year: text('.year'),
      blurb: text('.row-blurb'),
      stack,
      tokens: stackTokens(stack),
      badges: Array.from(el.querySelectorAll('.badge')).map((b) => b.textContent.trim()),
      filters: (el.dataset.filters || '').split(' ').filter((f) => f && f !== 'all'),
      href: link ? link.href : '',
      note,
      fig: el.dataset.peekFig || '',
      suffix: el.dataset.peekSuffix || '',
      label: el.dataset.peekLabel || '',
      area: el.dataset.peekArea || '',
    };
  });
}

function sharedTokens(a, b) {
  const set = new Set(a.tokens.map((t) => t.toLowerCase()));
  return b.tokens.filter((t) => set.has(t.toLowerCase()));
}

/* ------------------------------------------------------------------ shapes */

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r) {
  return Math.sqrt(-2 * Math.log(1 - r() * 0.9999)) * Math.cos(6.2831853 * r());
}

/** Every generator fills out[3n] and may read/write seeds[4n] (x,y,z random, w = strand 0|1). */
const SHAPES = {
  // Rows of points running along x: reads as scan lines once the shader lifts them by fbm.
  terrain(n, out, seeds, r) {
    const rows = 96;
    for (let i = 0; i < n; i++) {
      const row = i % rows;
      out[i * 3] = (r() - 0.5) * 6.4;
      out[i * 3 + 1] = 0;
      out[i * 3 + 2] = (row / (rows - 1) - 0.5) * 4.2;
    }
  },
  sphere(n, out, seeds, r) {
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const core = r() < 0.1;
      const y = 1 - (2 * (i + 0.5)) / n;
      const rad = Math.sqrt(1 - y * y);
      const th = golden * i;
      const k = core ? 0.28 * Math.cbrt(r()) : 1 + gauss(r) * 0.012;
      out[i * 3] = Math.cos(th) * rad * k;
      out[i * 3 + 1] = y * k;
      out[i * 3 + 2] = Math.sin(th) * rad * k;
    }
  },
  // Two strands plus rungs; seeds.w records the strand so the shader can colour ML vs SDE.
  helix(n, out, seeds, r) {
    const turns = 3.2, rungs = 30;
    for (let i = 0; i < n; i++) {
      const strand = seeds[i * 4 + 3];
      let t = r(), u = strand, jitter = 0.035;
      if (r() < 0.26) {
        t = (Math.floor(r() * rungs) + 0.5) / rungs;
        u = r();
        seeds[i * 4 + 3] = u < 0.5 ? 0 : 1;
        jitter = 0.012;
      }
      const ang = t * turns * 6.2831853;
      const side = (u * 2 - 1) * 0.6;
      out[i * 3] = Math.cos(ang) * side + gauss(r) * jitter;
      out[i * 3 + 1] = (t - 0.5) * 3.4 + gauss(r) * jitter;
      out[i * 3 + 2] = Math.sin(ang) * side + gauss(r) * jitter;
    }
  },
  // A wireframe lattice: two coordinates snap to a grid, the third runs free.
  lattice(n, out, seeds, r) {
    const steps = 4, half = 0.92;
    const snap = () => (Math.round(r() * steps) / steps * 2 - 1) * half;
    for (let i = 0; i < n; i++) {
      const axis = Math.floor(r() * 3);
      const p = [snap(), snap(), snap()];
      p[axis] = (r() * 2 - 1) * half;
      out[i * 3] = p[0] + gauss(r) * 0.006;
      out[i * 3 + 1] = p[1] + gauss(r) * 0.006;
      out[i * 3 + 2] = p[2] + gauss(r) * 0.006;
    }
  },
  galaxy(n, out, seeds, r) {
    const arms = 4;
    for (let i = 0; i < n; i++) {
      const core = r() < 0.14;
      const rad = core ? Math.abs(gauss(r)) * 0.16 : 0.12 + Math.pow(r(), 0.7) * 1.75;
      const arm = Math.floor(r() * arms);
      const ang = (arm / arms) * 6.2831853 + rad * 2.4 + gauss(r) * (core ? 3 : 0.16 + 0.1 / (rad + 0.2));
      out[i * 3] = Math.cos(ang) * rad;
      out[i * 3 + 1] = gauss(r) * 0.05 * (2 - rad);
      out[i * 3 + 2] = Math.sin(ang) * rad;
    }
  },
  knot(n, out, seeds, r) {
    for (let i = 0; i < n; i++) {
      const t = r() * 6.2831853;
      const k = Math.cos(3 * t) + 2;
      const jx = gauss(r), jy = gauss(r), jz = gauss(r);
      const jl = 0.085 / Math.hypot(jx, jy, jz);
      out[i * 3] = (k * Math.cos(2 * t)) / 2.7 + jx * jl;
      out[i * 3 + 1] = (k * Math.sin(2 * t)) / 2.7 + jy * jl;
      out[i * 3 + 2] = -Math.sin(3 * t) / 2.7 + jz * jl;
    }
  },
  vortex(n, out, seeds, r) {
    for (let i = 0; i < n; i++) {
      const t = Math.pow(r(), 0.8);
      const strand = Math.floor(r() * 3);
      const rad = 0.06 + t * t * 1.05;
      const ang = t * 15 + (strand / 3) * 6.2831853 + gauss(r) * 0.07;
      out[i * 3] = Math.cos(ang) * rad + gauss(r) * 0.012;
      out[i * 3 + 1] = (t - 0.5) * 3.1;
      out[i * 3 + 2] = Math.sin(ang) * rad + gauss(r) * 0.012;
    }
  },
  // Rasterise a glyph and scatter the swarm inside it.
  glyph(n, out, seeds, r) {
    const S = 220;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `800 ${S * 0.86}px "Anybody", "Arial Black", Arial, sans-serif`;
    g.fillText('@', S / 2, S * 0.5);
    const px = g.getImageData(0, 0, S, S).data;
    const hits = [];
    for (let i = 0; i < S * S; i++) if (px[i * 4 + 3] > 128) hits.push(i);
    if (!hits.length) return SHAPES.sphere(n, out, seeds, r);
    for (let i = 0; i < n; i++) {
      const h = hits[Math.floor(r() * hits.length)];
      out[i * 3] = (((h % S) + r()) / S - 0.5) * 2.5;
      out[i * 3 + 1] = -((Math.floor(h / S) + r()) / S - 0.5) * 2.5;
      out[i * 3 + 2] = (r() - 0.5) * 0.22;
    }
  },
};

/*
 * One stop per section. rot = base tilt (x, y) in radians, spin = rad/s about the shape's own
 * y axis, off = where it sits in the viewport (world units; the view is 4 units tall),
 * alpha/size tune the swarm, bg dims the backdrop behind dense text, ma is how strongly the
 * machine shows. label is what the deck calls the section.
 */
const STOPS = [
  { sel: '.hero',      label: 'Origin',       shape: 'terrain', rot: [0.5, 0.0],  spin: 0,    off: [0.25, -0.95], scale: 1.0,  alpha: 0.95, size: 1.0,  ma: 0.5 },
  { sel: '.statement', label: 'Method',       shape: 'sphere',  rot: [0.35, 0.0], spin: 0.16, off: [1.75, 0.0],   scale: 1.05, alpha: 0.7,  size: 1.0,  ma: 0.75 },
  { sel: '.fit',       label: 'Roles',        shape: 'helix',   rot: [0.0, 0.0],  spin: 0.3,  off: [0.0, 0.0],    scale: 1.1,  alpha: 0.85, size: 1.15, ma: 0.4, bg: 0.8, dual: 1, roll: 1.05 },
  { sel: '.rail',      label: 'Featured',     shape: 'lattice', rot: [0.5, 0.6],  spin: 0.1,  off: [0.0, 0.0],    scale: 1.3,  alpha: 0.8,  size: 1.1,  ma: 0.35, bg: 0.8 },
  { sel: '.index',     label: 'All projects', shape: 'galaxy',  rot: [1.05, 0.0], spin: 0.05, off: [0.3, -0.1],   scale: 1.5,  alpha: 0.62, size: 1.0,  ma: 0.3, bg: 0.5, roll: 0.25 },
  { sel: '.flow',      label: 'Design rule',  shape: 'knot',    rot: [0.3, 0.0],  spin: 0.2,  off: [1.7, 0.2],    scale: 1.0,  alpha: 0.5,  size: 1.0,  ma: 0.6, bg: 0.85 },
  { sel: '.journey',   label: 'Journey',      shape: 'vortex',  rot: [0.18, 0.0], spin: 0.45, off: [1.9, 0.0],    scale: 1.05, alpha: 0.55, size: 1.0,  ma: 0.55, bg: 0.75 },
  { sel: '.contact',   label: 'Contact',      shape: 'glyph',   rot: [0.0, 0.0],  spin: 0,    off: [1.55, 0.05],  scale: 0.95, alpha: 0.85, size: 1.0,  ma: 0.7, sway: 1 },
];

/* ------------------------------------------------------------------ the machine */

const SHELL_R = 1.55;
const CORE_R = 0.82;

/** Where each project node sits in the core: an even spread over a sphere. */
function nodePositions(count) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const rad = Math.sqrt(1 - y * y);
    out.push([Math.cos(golden * i) * rad * CORE_R, y * CORE_R, Math.sin(golden * i) * rad * CORE_R]);
  }
  return out;
}

/**
 * Line geometry, 7 floats a vertex: xyz, t (distance along the edge, drives the pulses),
 * kind (0 shell, 1 ring, 2 link between projects, 3 conduit, 4 node), and the two project
 * ids an edge joins (negative = none; then it doubles as a random phase).
 */
function buildMachine(projects, nodes) {
  const rand = mulberry(77);
  const lines = [];
  const seg = (p, q, kind, a, b) => {
    const len = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    lines.push(p[0], p[1], p[2], 0, kind, a, b, q[0], q[1], q[2], len, kind, a, b);
  };
  const phase = () => -1 - rand() * 40;

  // Geodesic shell: an icosahedron subdivided twice.
  const g = (1 + Math.sqrt(5)) / 2;
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const V = [[-1, g, 0], [1, g, 0], [-1, -g, 0], [1, -g, 0], [0, -1, g], [0, 1, g], [0, -1, -g], [0, 1, -g], [g, 0, -1], [g, 0, 1], [-g, 0, -1], [-g, 0, 1]].map(norm);
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let pass = 0; pass < 2; pass++) {
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? a * 4096 + b : b * 4096 + a;
      if (!cache.has(key)) { V.push(norm([V[a][0] + V[b][0], V[a][1] + V[b][1], V[a][2] + V[b][2]])); cache.set(key, V.length - 1); }
      return cache.get(key);
    };
    const next = [];
    for (const [a, b, c] of F) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    F = next;
  }
  const seen = new Set();
  const scaled = (v, r) => [v[0] * r, v[1] * r, v[2] * r];
  for (const f of F) {
    for (let k = 0; k < 3; k++) {
      const a = f[k], b = f[(k + 1) % 3];
      const key = a < b ? a * 4096 + b : b * 4096 + a;
      if (seen.has(key)) continue;
      seen.add(key);
      seg(scaled(V[a], SHELL_R), scaled(V[b], SHELL_R), 0, phase(), -1);
    }
  }

  // Orbital rings with tick marks, each on its own tilt.
  const rings = [[1.95, 0.42, 0.1], [2.25, -0.3, 0.9], [2.6, 1.15, -0.4]];
  for (const [rad, tx, tz] of rings) {
    const cx = Math.cos(tx), sx = Math.sin(tx), cz = Math.cos(tz), sz = Math.sin(tz);
    const at = (ang, r) => {
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      const y1 = -z * sx, z1 = z * cx;
      return [x * cz - y1 * sz, x * sz + y1 * cz, z1];
    };
    const n = 180, ph = phase();
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * 6.2831853, a1 = ((i + 1) / n) * 6.2831853;
      const p = at(a0, rad), q = at(a1, rad);
      lines.push(p[0], p[1], p[2], a0 * rad, 1, ph, -1, q[0], q[1], q[2], a1 * rad, 1, ph, -1);
      if (i % 6 === 0) seg(at(a0, rad), at(a0, rad + (i % 30 === 0 ? 0.09 : 0.04)), 1, phase(), -1);
    }
  }

  // The core: one link for every pair of projects that share a technology.
  for (let i = 0; i < projects.length; i++) {
    for (let j = i + 1; j < projects.length; j++) {
      if (sharedTokens(projects[i], projects[j]).length) seg(nodes[i], nodes[j], 2, i, j);
    }
    // A conduit carries each project out to the shell.
    seg(nodes[i], scaled(norm(nodes[i]), SHELL_R), 3, i, i);
  }

  const points = [];
  if (projects.length) nodes.forEach((p, i) => points.push(p[0], p[1], p[2], 0, 4, i, i));
  return { lines: new Float32Array(lines), points: new Float32Array(points) };
}

/* ------------------------------------------------------------------ shaders */

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aFrom;
layout(location = 1) in vec3 aTo;
layout(location = 2) in vec4 aSeed;

uniform float uMix;        // 0..1 morph between the two bound shapes
uniform float uTime;
uniform float uTerrain;    // how much of the fbm terrain lift applies (1 in the hero)
uniform vec4 uRot;         // tilt x, spin y, roll z, unused
uniform vec3 uPlace;       // offset x, offset y, scale
uniform float uAspect;
uniform float uSize;       // base point size in device px
uniform vec3 uPtr;         // pointer ndc x, y, strength
uniform vec4 uShock;       // click ndc x, y, age 0..1, on
uniform float uVel;        // smoothed scroll velocity, -1..1
uniform float uIntro;      // 0 = scattered, 1 = assembled
uniform float uExcite;     // 0..1, hover on a primary button
uniform float uDual;       // 0..1, colour by strand
uniform float uEnergy;     // deck setting: 0.4 calm, 1 normal, 2.4 wild
uniform float uPull;       // 0..1, pointer held down: gather instead of scatter

out float vShade;
out float vAlpha;
out float vStrand;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
vec3 swirl(vec3 p, float t) {
  return vec3(
    noise(p.yz * 1.7 + t) - 0.5,
    noise(p.zx * 1.7 - t + 9.2) - 0.5,
    noise(p.xy * 1.7 + t + 4.7) - 0.5);
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

void main() {
  // Each particle leaves and arrives on its own schedule, so a morph reads as a migration.
  float m = clamp(uMix * 1.7 - aSeed.y * 0.7, 0.0, 1.0);
  m = m * m * (3.0 - 2.0 * m);
  float transit = sin(m * 3.14159265);
  vec3 p = mix(aFrom, aTo, m);

  // height = fbm(x, y, t) + pointer — the hero caption, kept honest.
  if (uTerrain > 0.001) {
    vec2 q = p.xz;
    float h = fbm(q * 0.62 + vec2(uTime * 0.05, -uTime * 0.03));
    h = (h - 0.45) * 1.9;
    vec2 pm = vec2(uPtr.x * 2.6 * uAspect / 1.6, -uPtr.y * 2.0 - 0.4);
    h += exp(-dot(q - pm, q - pm) * 1.6) * 0.55 * uPtr.z;
    p.y += h * uTerrain;
  }

  // Turbulence while in transit, plus a slow idle drift and the hover excitement.
  float wild = transit * 0.75 + (0.02 + uExcite * 0.16) * uEnergy * uEnergy;
  p += swirl(p * 1.3 + aSeed.xyz * 3.0, uTime * 0.25) * wild;

  // Assemble from a wide scatter on load (and again after a shatter).
  vec3 scatter = normalize(aSeed.xyz - 0.5 + 0.0001) * (3.0 + aSeed.w * 4.0 + aSeed.x * 3.0);
  float intro = clamp(uIntro * 1.5 - aSeed.z * 0.5, 0.0, 1.0);
  intro = 1.0 - pow(1.0 - intro, 4.0);
  p = mix(scatter, p, intro);

  p.xz = rot(uRot.y) * p.xz;
  p.xy = rot(uRot.z) * p.xy;
  p.yz = rot(uRot.x) * p.yz;
  p *= uPlace.z * (1.0 + transit * 0.35);
  p.xy += uPlace.xy;

  float z = 4.0 - p.z;
  vec2 ndc = p.xy * 2.0 / max(z, 0.25);
  ndc.x /= uAspect;

  // Pointer pushes the swarm aside (or gathers it while held); a click sends a ring through.
  vec2 asp = vec2(uAspect, 1.0);
  vec2 d = (ndc - uPtr.xy) * asp;
  float push = exp(-dot(d, d) * mix(14.0, 3.5, uPull)) * uPtr.z * (1.0 - uTerrain * (1.0 - uPull));
  ndc += normalize(d + 0.0001) * push * mix(0.09, -0.3, uPull) * min(1.0, length(d) * 6.0) / asp;

  vec2 ds = (ndc - uShock.xy) * asp;
  float ring = exp(-pow((length(ds) - uShock.z * 2.4) * 6.0, 2.0)) * (1.0 - uShock.z) * uShock.w;
  ndc += normalize(ds + 0.0001) * ring * 0.16 / asp;

  // Fast scrolling smears the swarm vertically.
  ndc.y += uVel * (aSeed.z - 0.5) * 0.5;

  gl_Position = vec4(ndc, 0.0, 1.0);
  float depth = clamp(4.0 / max(z, 0.25), 0.3, 3.0);
  gl_PointSize = uSize * depth * (0.55 + aSeed.x * 0.9) * (1.0 + ring * 2.0 + transit * 0.4);

  vShade = clamp(aSeed.y * 0.55 + (depth - 0.8) * 0.6 + ring + push * 2.0 + uExcite * 0.3, 0.0, 1.0);
  vAlpha = (0.3 + 0.7 * aSeed.z) * clamp(depth * 0.9, 0.25, 1.3) * intro * (1.0 + ring * 1.5);
  vStrand = mix(-1.0, aSeed.w, uDual);
}`;

const FRAG = `#version 300 es
precision mediump float;
uniform vec3 uCool;
uniform vec3 uHot;
uniform vec3 uMl;
uniform vec3 uSde;
uniform float uAlpha;
in float vShade;
in float vAlpha;
in float vStrand;
out vec4 outColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.05, length(c));
  vec3 col = mix(uCool, uHot, smoothstep(0.35, 0.95, vShade));
  if (vStrand > -0.5) col = mix(uMl, uSde, step(0.5, vStrand));
  outColor = vec4(col, a * a * vAlpha * uAlpha);
}`;

const LINE_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aMeta;   // t, kind, id a, id b
uniform vec3 uRot;
uniform vec3 uPlace;
uniform float uAspect;
uniform float uFocus;      // project id in focus, or -1
uniform float uPoint;      // node size in device px
out float vT;
out float vKind;
out float vHot;
out float vDepth;
out float vPhase;
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
void main() {
  vec3 p = aPos;
  p.xz = rot(uRot.y) * p.xz;
  p.yz = rot(uRot.x) * p.yz;
  p *= uPlace.z;
  p.xy += uPlace.xy;
  float z = 4.0 - p.z;
  vec2 ndc = p.xy * 2.0 / max(z, 0.25);
  ndc.x /= uAspect;
  gl_Position = vec4(ndc, 0.0, 1.0);
  vT = aMeta.x;
  vKind = aMeta.y;
  vHot = (uFocus > -0.5 && (abs(aMeta.z - uFocus) < 0.1 || abs(aMeta.w - uFocus) < 0.1)) ? 1.0 : 0.0;
  vDepth = clamp(1.25 - (z - 2.4) * 0.3, 0.12, 1.2);
  vPhase = abs(aMeta.z) * 7.31 + abs(aMeta.w) * 3.17;
  gl_PointSize = uPoint * (4.0 / max(z, 0.25)) * (1.0 + vHot * 0.9);
}`;

const LINE_FRAG = `#version 300 es
precision highp float;
uniform vec3 uCool;
uniform vec3 uHot;
uniform vec3 uTint;
uniform float uTime;
uniform float uAlpha;
uniform float uFocus;
uniform float uIsPoint;
in float vT;
in float vKind;
in float vHot;
in float vDepth;
in float vPhase;
out vec4 outColor;
void main() {
  vec3 col; float a;
  if (vKind < 0.5) { col = uCool; a = 0.2; }
  else if (vKind < 1.5) { col = mix(uCool, uTint, 0.6); a = 0.42; }
  else if (vKind < 2.5) { col = mix(uTint, uHot, 0.35); a = 0.3; }
  else if (vKind < 3.5) { col = uCool; a = 0.22; }
  else { col = mix(uHot, vec3(1.0), 0.35); a = 1.0; }

  // Packets of light run along every edge.
  float speed = vKind < 0.5 ? 0.16 : (vKind < 1.5 ? 0.3 : 0.5);
  float ph = fract(vT * (vKind < 1.5 ? 0.9 : 1.6) - uTime * speed + vPhase);
  float pulse = smoothstep(0.86, 1.0, ph) * step(uIsPoint, 0.5);
  col = mix(col, uHot, pulse * 0.85);
  a += pulse * 0.75;

  // With a project in focus, its links light up and the rest step back.
  if (uFocus > -0.5 && vKind > 1.5) {
    if (vHot > 0.5) { col = mix(col, uHot, 0.7); a = min(1.0, a * 2.6 + 0.35); }
    else a *= 0.3;
  }

  if (uIsPoint > 0.5) {
    float d = length(gl_PointCoord - 0.5);
    a *= smoothstep(0.26, 0.12, d) + smoothstep(0.5, 0.2, d) * 0.35;
  }
  outColor = vec4(col, a * vDepth * uAlpha);
}`;

/*
 * The backdrop: a slow, domain-warped field of light drawn behind everything, so the page
 * sits on moving colour instead of a flat ground. It drifts with time, slides with scroll,
 * changes hue from section to section and brightens under the pointer.
 */
const BG_VERT = `#version 300 es
layout(location = 0) in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const BG_FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uScroll;   // section position, 0..n
uniform vec3 uPtr;       // ndc x, y, strength
uniform vec3 uGround;
uniform vec3 uCool;
uniform vec3 uHot;
uniform vec3 uMl;
uniform vec3 uSde;
uniform float uIntro;
uniform float uDim;      // per-section brightness, lower behind dense text
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float grain(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.1; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 m = uPtr.xy * 0.5 * vec2(aspect, 1.0);
  float t = uTime * 0.045;

  // Two rounds of domain warping give the silky, folded look.
  vec2 s = p * 1.15 + vec2(0.0, -uScroll * 0.42);
  s += (p - m) * exp(-dot(p - m, p - m) * 3.0) * 0.35 * uPtr.z;
  vec2 q = vec2(fbm(s + t), fbm(s + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(s + 2.6 * q + vec2(1.7, 9.2) + t * 1.4), fbm(s + 2.6 * q + vec2(8.3, 2.8) - t));
  float f = fbm(s + 2.8 * r);

  // Hue wanders between the role colours as the page moves from section to section.
  vec3 tint = mix(uMl, uSde, 0.5 + 0.5 * sin(uScroll * 1.25 + 0.6));
  vec3 deep = mix(uCool, tint, 0.45);

  vec3 col = uGround * 0.4;
  col = mix(col, deep * 0.36, smoothstep(0.34, 0.9, f));
  col = mix(col, tint * 0.3, smoothstep(0.62, 1.1, length(r)) * 0.7);
  // Bright creases where the folds stack up: thin, so the field stays mostly dark.
  float crease = pow(clamp(r.x * q.y * 2.4, 0.0, 1.0), 4.0);
  col += uHot * crease * 0.42;
  float ridge = 1.0 - abs(f * 2.0 - 1.0);
  col += mix(deep, vec3(1.0), 0.25) * pow(ridge, 14.0) * 0.2;

  // Two large soft lights, one drifting, one under the pointer.
  vec2 l1 = vec2(0.42 * aspect * sin(t * 1.9), 0.22 + 0.18 * cos(t * 1.3));
  col += uHot * exp(-dot(p - l1, p - l1) * 2.6) * 0.07;
  col += tint * exp(-dot(p - m, p - m) * 5.0) * 0.1 * uPtr.z;

  // Keep the top calm for the header and the edges dark so text holds contrast.
  float vig = smoothstep(1.25, 0.25, length(p * vec2(0.8, 1.0)));
  col *= mix(0.35, 1.0, vig);
  col *= 0.78 + 0.22 * smoothstep(1.0, 0.72, uv.y);
  // Deepen the shadows so it reads as light on dark, not as a wash.
  float lum = dot(col, vec3(0.3333));
  col *= 0.35 + 0.95 * smoothstep(0.02, 0.3, lum);
  col = mix(uGround * 0.5, col, uDim);
  col = mix(uGround, col, uIntro);

  // Film grain, so the gradients never band.
  col += (grain(gl_FragCoord.xy + floor(uTime * 24.0) * 17.0) - 0.5) * 0.028;
  outColor = vec4(col, 1.0);
}`;

/* ------------------------------------------------------------------ engine */

function cssColor(name, fallback) {
  const v = getComputedStyle(root).getPropertyValue(name).trim();
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function startEngine() {
  const stops = STOPS.map((s) => ({ ...s, el: document.querySelector(s.sel) })).filter((s) => s.el);
  if (stops.length < 2) return null;

  const canvas = document.createElement('canvas');
  canvas.className = 'fx-swarm';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  document.body.prepend(canvas);
  root.classList.add('fx-gl');

  const small = Math.min(innerWidth, innerHeight) < 700 || !finePointer;
  const N = small ? 26000 : 72000;

  const projects = readProjects();
  const nodes = nodePositions(Math.max(projects.length, 1));
  let intro = 0;

  // What the deck reads and writes.
  const S = {
    stops, projects, small,
    index: 0,            // section the page is on
    pos: 0,              // continuous section position
    vel: 0,              // smoothed scroll velocity
    energy: 1,
    override: -1,        // scene pinned by the deck, or -1 to follow the scroll
    explore: false,      // system-map mode
    focus: -1,           // project id lit up in the machine
    yaw: 0.6, pitch: 0, zoom: 1,
    dragging: false,
    stopListeners: [], frameListeners: [],
    shatter() { intro = 0; },
    nodeScreen: () => null,
    stopTop(i) {
      const el = stops[i].el;
      const box = el.parentElement && el.parentElement.classList.contains('pin-spacer') ? el.parentElement : el;
      return box.getBoundingClientRect().top + window.scrollY;
    },
  };

  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  };
  const program = (vs, fs, names) => {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    for (const n of names) u[n] = gl.getUniformLocation(p, n);
    return { p, u };
  };

  const swarm = program(VERT, FRAG, ['uMix', 'uTime', 'uTerrain', 'uRot', 'uPlace', 'uAspect', 'uSize', 'uPtr', 'uShock', 'uVel',
    'uIntro', 'uExcite', 'uDual', 'uEnergy', 'uPull', 'uCool', 'uHot', 'uMl', 'uSde', 'uAlpha']);
  const line = program(LINE_VERT, LINE_FRAG, ['uRot', 'uPlace', 'uAspect', 'uFocus', 'uPoint', 'uCool', 'uHot', 'uTint', 'uTime', 'uAlpha', 'uIsPoint']);
  const bg = program(BG_VERT, BG_FRAG, ['uRes', 'uTime', 'uScroll', 'uPtr', 'uGround', 'uCool', 'uHot', 'uMl', 'uSde', 'uIntro', 'uDim']);
  const U = swarm.u, LU = line.u, BU = bg.u;

  const ground = cssColor('--ground', [0.059, 0.067, 0.102]);
  const cool = cssColor('--contour', [0.357, 0.42, 0.839]);
  const hot = cssColor('--accent', [0.957, 0.71, 0.271]);
  const ml = cssColor('--ml', [0.604, 0.659, 1]);
  const sde = cssColor('--sde', [0.369, 0.827, 0.659]);

  /* swarm buffers (default vertex array) */
  const rand = mulberry(20270501);
  const seeds = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    seeds[i * 4] = rand(); seeds[i * 4 + 1] = rand(); seeds[i * 4 + 2] = rand();
    seeds[i * 4 + 3] = rand() < 0.5 ? 0 : 1;
  }
  const build = (shape) => {
    const out = new Float32Array(N * 3);
    SHAPES[shape](N, out, seeds, mulberry(shape.length * 7919 + 13));
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, out, gl.STATIC_DRAW);
    return buf;
  };
  // The helix rewrites strand flags for its rungs, so build it first and upload seeds after.
  for (const s of stops) if (s.shape === 'helix') s.buf = build(s.shape);
  for (const s of stops) if (!s.buf) s.buf = build(s.shape);

  const seedBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf);
  gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);
  gl.enableVertexAttribArray(1);

  // The glyph needs the display font; rebuild it once fonts are in.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      const g = stops.find((s) => s.shape === 'glyph');
      if (!g) return;
      const out = new Float32Array(N * 3);
      SHAPES.glyph(N, out, seeds, mulberry(4242));
      gl.bindBuffer(gl.ARRAY_BUFFER, g.buf);
      gl.bufferData(gl.ARRAY_BUFFER, out, gl.STATIC_DRAW);
    });
  }

  /* machine buffers */
  const machine = buildMachine(projects, nodes);
  const metaVao = (data) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    gl.bindVertexArray(null);
    return vao;
  };
  const lineVao = metaVao(machine.lines);
  const pointVao = metaVao(machine.points);
  const lineCount = machine.lines.length / 7;
  const pointCount = machine.points.length / 7;

  /* backdrop buffer */
  const bgVao = gl.createVertexArray();
  gl.bindVertexArray(bgVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  gl.disable(gl.DEPTH_TEST);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.clearColor(ground[0], ground[1], ground[2], 1);

  gl.useProgram(swarm.p);
  gl.uniform3fv(U.uCool, cool); gl.uniform3fv(U.uHot, hot); gl.uniform3fv(U.uMl, ml); gl.uniform3fv(U.uSde, sde);
  gl.useProgram(line.p);
  gl.uniform3fv(LU.uCool, cool); gl.uniform3fv(LU.uHot, hot);
  gl.useProgram(bg.p);
  gl.uniform3fv(BU.uGround, ground); gl.uniform3fv(BU.uCool, cool); gl.uniform3fv(BU.uHot, hot);
  gl.uniform3fv(BU.uMl, ml); gl.uniform3fv(BU.uSde, sde);

  let W = 1, H = 1, dpr = 1, aspect = 1;
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, small ? 1.25 : 1.5);
    W = Math.max(1, Math.round(innerWidth * dpr));
    H = Math.max(1, Math.round(innerHeight * dpr));
    canvas.width = W; canvas.height = H;
    gl.viewport(0, 0, W, H);
    aspect = W / H;
  };

  // Where each section sits in the document; a stop owns the page from its top to the next top.
  let bounds = [];
  const measure = () => {
    const y = window.scrollY;
    bounds = [];
    const box = (el) => (el.parentElement && el.parentElement.classList.contains('pin-spacer') ? el.parentElement : el).getBoundingClientRect();
    for (let i = 1; i < stops.length; i++) {
      const a = box(stops[i - 1].el), b = box(stops[i].el);
      bounds.push((a.bottom + b.top) / 2 + y);
    }
  };

  let target = 0, pos = 0;
  const readScroll = () => {
    const vh = innerHeight;
    const c = window.scrollY + vh * 0.5;
    let s = 0;
    for (const b of bounds) s += Math.min(1, Math.max(0, (c - b + vh * 0.42) / (vh * 0.84)));
    target = s;
  };

  const ptr = { x: 0.3, y: -0.2, tx: 0.3, ty: -0.2, on: 0, ton: 0 };
  const shock = { x: 0, y: 0, age: 1, on: 0 };
  let excite = 0, exciteTarget = 0, pull = 0, pullTarget = 0, holdTimer = 0;
  let vel = 0, lastY = window.scrollY;

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    ptr.tx = (e.clientX / innerWidth) * 2 - 1;
    ptr.ty = 1 - (e.clientY / innerHeight) * 2;
    ptr.ton = 1;
  }, { passive: true });
  root.addEventListener('mouseleave', () => { ptr.ton = 0; });
  window.addEventListener('pointerdown', (e) => {
    if (root.classList.contains('paused')) return;
    shock.x = (e.clientX / innerWidth) * 2 - 1;
    shock.y = 1 - (e.clientY / innerHeight) * 2;
    shock.age = 0; shock.on = 1;
    // Hold the mouse down and the swarm gathers under it instead of scattering.
    if (e.pointerType === 'mouse' && e.button === 0) {
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => { pullTarget = 1; }, 260);
    }
  }, { passive: true });
  const release = () => { clearTimeout(holdTimer); pullTarget = 0; };
  window.addEventListener('pointerup', release, { passive: true });
  window.addEventListener('pointercancel', release, { passive: true });
  window.addEventListener('blur', release);
  document.querySelectorAll('.btn-solid, .magnet, [data-lens-link]').forEach((el) => {
    el.addEventListener('pointerenter', () => { exciteTarget = 1; });
    el.addEventListener('pointerleave', () => { exciteTarget = 0; });
  });

  const lerp = (a, b, t) => a + (b - a) * t;
  let time = 0, last = performance.now(), spin = 0, running = false, visible = true;
  let ex = 0;                                      // explore blend 0..1
  let M = { rx: 0, ry: 0, ox: 0, oy: 0, s: 1 };    // the machine's transform this frame

  // Same maths as LINE_VERT, so labels can sit on the project nodes.
  S.nodeScreen = (i) => {
    const n = nodes[i];
    if (!n) return null;
    let x = n[0], y = n[1], z = n[2];
    let c = Math.cos(M.ry), s = Math.sin(M.ry);
    [x, z] = [c * x + s * z, -s * x + c * z];
    c = Math.cos(M.rx); s = Math.sin(M.rx);
    [y, z] = [c * y + s * z, -s * y + c * z];
    x = x * M.s + M.ox; y = y * M.s + M.oy; z *= M.s;
    const d = Math.max(4 - z, 0.25);
    return { x: ((x * 2) / d / aspect * 0.5 + 0.5) * innerWidth, y: (1 - ((y * 2) / d * 0.5 + 0.5)) * innerHeight, depth: z };
  };

  const frame = (now) => {
    if (!running) return;
    const paused = root.classList.contains('paused');
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    if (!paused) time += dt * S.energy;
    intro = Math.min(1, intro + dt / (paused ? 0.01 : 2.6));

    readScroll();
    const goal = S.override >= 0 ? S.override : target;
    pos += (goal - pos) * (paused ? 1 : Math.min(1, dt * (S.override >= 0 ? 2.2 : 5.5)));
    const i = Math.max(0, Math.min(stops.length - 2, Math.floor(pos) || 0));
    const m = Math.min(1, Math.max(0, pos - i));
    const A = stops[i], B = stops[i + 1];
    const e = m * m * (3 - 2 * m);

    const here = Math.max(0, Math.min(stops.length - 1, Math.round(target)));
    S.pos = pos;
    if (here !== S.index) { S.index = here; for (const fn of S.stopListeners) fn(here); }

    const y = window.scrollY;
    const rawVel = paused ? 0 : Math.max(-1, Math.min(1, (y - lastY) / Math.max(dt, 0.001) / 5200));
    lastY = y;
    vel += (rawVel - vel) * Math.min(1, dt * 7);
    S.vel = vel;
    root.style.setProperty('--fx-vel', vel.toFixed(3));

    ptr.x += (ptr.tx - ptr.x) * 0.09; ptr.y += (ptr.ty - ptr.y) * 0.09;
    ptr.on += ((paused ? 0 : ptr.ton) - ptr.on) * 0.06;
    excite += ((paused ? 0 : exciteTarget) - excite) * 0.07;
    pull += ((paused ? 0 : pullTarget) - pull) * 0.08;
    if (shock.on) { shock.age += dt / 1.1; if (shock.age >= 1) { shock.age = 1; shock.on = 0; } }
    ex += ((S.explore ? 1 : 0) - ex) * Math.min(1, dt * 4);

    const narrow = aspect < 1;
    const fit = narrow ? Math.max(0.55, aspect * 0.95) : 1;
    const offX = lerp(lerp(A.off[0], B.off[0], e) * (narrow ? 0 : Math.min(1, aspect / 1.6)), 0, ex);
    const offY = lerp(lerp(A.off[1], B.off[1], e), 0, ex);
    const scale = lerp(lerp(A.scale, B.scale, e), 0.5, ex) * fit;
    let alpha = lerp(A.alpha, B.alpha, e);
    const size = lerp(A.size, B.size, e);
    spin += dt * (paused ? 0 : lerp(A.spin, B.spin, e)) * S.energy;
    const sway = lerp(A.sway || 0, B.sway || 0, e);
    const rx = lerp(A.rot[0], B.rot[0], e) - ptr.y * 0.12 * ptr.on - sway * ptr.y * 0.25;
    const ry = lerp(A.rot[1], B.rot[1], e) + spin * (1 - sway) + ptr.x * 0.18 * ptr.on + sway * (ptr.x * 0.5 + Math.sin(time * 0.6) * 0.18);
    const rz = lerp(A.roll || 0, B.roll || 0, e);
    const terrain = ((A.shape === 'terrain' ? 1 - e : 0) + (B.shape === 'terrain' ? e : 0)) * (1 - ex);
    const dual = lerp(A.dual || 0, B.dual || 0, e);
    // On phones the swarm sits directly behind body text, so only the hero keeps it loud.
    if (narrow) alpha *= lerp(0.4, 0.8, terrain);
    alpha = lerp(alpha, 0.5, ex);

    // The machine turns slowly on its own; in the map you turn it yourself.
    if (!paused && !S.dragging) S.yaw += dt * 0.05 * S.energy;
    const calm = 1 - ex;
    M = {
      rx: 0.32 + S.pitch * ex - ptr.y * 0.08 * ptr.on * calm,
      ry: S.yaw + ptr.x * 0.12 * ptr.on * calm,
      ox: offX, oy: offY,
      s: fit * lerp(1, 1.28 * S.zoom, ex),
    };
    const mAlpha = lerp(lerp(A.ma, B.ma, e) * (narrow ? 0.6 : 1), 1.15, ex) * Math.min(1, intro * 1.3);
    const tintMix = 0.5 + 0.5 * Math.sin(pos * 1.25 + 0.6);

    /* 1. backdrop */
    gl.useProgram(bg.p);
    gl.bindVertexArray(bgVao);
    gl.disable(gl.BLEND);
    gl.uniform2f(BU.uRes, W, H);
    gl.uniform1f(BU.uTime, time);
    gl.uniform1f(BU.uScroll, pos);
    gl.uniform3f(BU.uPtr, ptr.x, ptr.y, ptr.on);
    gl.uniform1f(BU.uIntro, Math.min(1, intro * 1.6));
    gl.uniform1f(BU.uDim, lerp(lerp(A.bg ?? 1, B.bg ?? 1, e), 0.55, ex));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.BLEND);

    /* 2. the machine */
    gl.useProgram(line.p);
    gl.uniform3f(LU.uRot, M.rx, M.ry, 0);
    gl.uniform3f(LU.uPlace, M.ox, M.oy, M.s);
    gl.uniform1f(LU.uAspect, aspect);
    gl.uniform1f(LU.uFocus, S.focus);
    gl.uniform1f(LU.uTime, time);
    gl.uniform1f(LU.uAlpha, mAlpha);
    gl.uniform3f(LU.uTint, lerp(ml[0], sde[0], tintMix), lerp(ml[1], sde[1], tintMix), lerp(ml[2], sde[2], tintMix));
    gl.uniform1f(LU.uIsPoint, 0);
    gl.uniform1f(LU.uPoint, 1);
    gl.bindVertexArray(lineVao);
    gl.drawArrays(gl.LINES, 0, lineCount);
    if (pointCount) {
      gl.uniform1f(LU.uIsPoint, 1);
      gl.uniform1f(LU.uPoint, lerp(5, 9, ex) * dpr);
      gl.bindVertexArray(pointVao);
      gl.drawArrays(gl.POINTS, 0, pointCount);
    }
    gl.bindVertexArray(null);

    /* 3. the swarm */
    gl.useProgram(swarm.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, A.buf);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, B.buf);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.uniform1f(U.uMix, m);
    gl.uniform1f(U.uTime, time);
    gl.uniform1f(U.uTerrain, terrain);
    gl.uniform4f(U.uRot, rx, ry, rz, 0);
    gl.uniform3f(U.uPlace, offX, offY, scale);
    gl.uniform1f(U.uAspect, aspect);
    gl.uniform1f(U.uSize, (small ? 2.3 : 2.0) * dpr * size);
    gl.uniform3f(U.uPtr, ptr.x, ptr.y, ptr.on);
    gl.uniform4f(U.uShock, shock.x, shock.y, shock.age, shock.on);
    gl.uniform1f(U.uVel, vel);
    gl.uniform1f(U.uIntro, intro);
    gl.uniform1f(U.uExcite, excite);
    gl.uniform1f(U.uDual, dual > 0.5 ? 1 : 0);
    gl.uniform1f(U.uEnergy, S.energy);
    gl.uniform1f(U.uPull, pull);
    gl.uniform1f(U.uAlpha, alpha);
    gl.drawArrays(gl.POINTS, 0, N);

    for (const fn of S.frameListeners) fn(ex, dt);
    requestAnimationFrame(frame);
  };

  const start = () => {
    if (running || !visible) return;
    running = true; last = performance.now(); lastY = window.scrollY;
    requestAnimationFrame(frame);
  };
  const stop = () => { running = false; };

  document.addEventListener('visibilitychange', () => { visible = !document.hidden; visible ? start() : stop(); });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); canvas.remove(); root.classList.remove('fx-gl'); });
  window.addEventListener('resize', () => { resize(); measure(); });
  new ResizeObserver(measure).observe(document.body);
  window.addEventListener('load', measure);
  setTimeout(measure, 1200);
  setTimeout(measure, 3500);

  resize();
  measure();
  start();
  return S;
}

/* ------------------------------------------------------------------ DOM depth */

function startDom() {
  if (!finePointer) return;

  // The name leans toward the pointer and grows an extrusion on the far side.
  const hero = document.querySelector('.hero');
  const name = hero && hero.querySelector('.name');
  if (hero && name) {
    let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
    const tick = () => {
      x += (tx - x) * 0.1; y += (ty - y) * 0.1;
      name.style.setProperty('--fx-rx', (-y * 9).toFixed(2) + 'deg');
      name.style.setProperty('--fx-ry', (x * 12).toFixed(2) + 'deg');
      name.style.setProperty('--fx-sx', (-x * 1.5).toFixed(3));
      name.style.setProperty('--fx-sy', (-y * 1.5 + 0.45).toFixed(3));
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.002 ? requestAnimationFrame(tick) : 0;
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
    hero.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || root.classList.contains('paused')) return;
      const r = hero.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width - 0.5;
      ty = (e.clientY - r.top) / r.height - 0.5;
      kick();
    });
    hero.addEventListener('pointerleave', () => { tx = 0; ty = 0; kick(); });
    kick();
  }

  // The two role panels tilt like the featured cards do. Uses the individual `rotate`
  // property so it composes with whatever GSAP writes to `transform`.
  document.querySelectorAll('[data-fit-panel]').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      if (root.classList.contains('paused')) return;
      const r = el.getBoundingClientRect();
      const ax = (e.clientX - r.left) / r.width - 0.5;
      const ay = (e.clientY - r.top) / r.height - 0.5;
      const len = Math.hypot(ax, ay) || 1;
      el.style.rotate = `${(ay / len).toFixed(3)} ${(-ax / len).toFixed(3)} 0 ${(len * 9).toFixed(2)}deg`;
    });
    el.addEventListener('pointerleave', () => { el.style.rotate = ''; });
  });
}

/* ------------------------------------------------------------------ boot */

if (!reduced) {
  root.classList.add('fx');
  let engine = null;
  try { engine = startEngine(); } catch (err) { console.warn('[fx] engine disabled', err); root.classList.remove('fx-gl'); }
  try { startDom(); } catch (err) { console.warn('[fx] dom effects disabled', err); }
  if (engine) {
    window.__fx = engine;
    import('./deck.js').then((mod) => mod.startDeck(engine, { sharedTokens })).catch((err) => console.warn('[fx] deck disabled', err));
  }
}
