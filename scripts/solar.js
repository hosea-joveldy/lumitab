import * as THREE from "../lib/three.module.min.js";

const FPS_ACTIVE = 60;
const FPS_IDLE = 15; // used after a minute with no input
const IDLE_AFTER = 60 * 1000;

const SYSTEM_SCALE = 0.48; // overall size of the whole system
const SIZE_K = 1.4; // planet and moon size boost (orbits stay put)

const canvas = document.getElementById("scene");
const label = document.getElementById("label");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x050505);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
const CAM = new THREE.Vector3(0, 12, 34);
camera.position.copy(CAM);
camera.lookAt(0, 0, 0);

/* ---------- small helpers ---------- */
const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const sstep = (a, b, t) => {
  t = clamp01((t - a) / (b - a));
  return t * t * (3 - 2 * t);
};
function paint(o, c1, c2, t, h) {
  o[0] = mix(c1[0], c2[0], t);
  o[1] = mix(c1[1], c2[1], t);
  o[2] = mix(c1[2], c2[2], t);
  o[3] = h;
}
function rng(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 3D value noise (sampled on the sphere, so textures have no seams or pinching) ---------- */
function makeNoise(rnd) {
  const perm = new Uint8Array(512);
  const val = new Float32Array(256);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  for (let i = 0; i < 256; i++) val[i] = rnd();

  const at = (x, y, z) =>
    val[perm[perm[perm[x & 255] + (y & 255)] + (z & 255)]];
  const lerp = (a, b, t) => a + (b - a) * t;

  const noise = (x, y, z) => {
    const xi = Math.floor(x),
      yi = Math.floor(y),
      zi = Math.floor(z);
    let xf = x - xi,
      yf = y - yi,
      zf = z - zi;
    xf = xf * xf * (3 - 2 * xf);
    yf = yf * yf * (3 - 2 * yf);
    zf = zf * zf * (3 - 2 * zf);
    return lerp(
      lerp(
        lerp(at(xi, yi, zi), at(xi + 1, yi, zi), xf),
        lerp(at(xi, yi + 1, zi), at(xi + 1, yi + 1, zi), xf),
        yf,
      ),
      lerp(
        lerp(at(xi, yi, zi + 1), at(xi + 1, yi, zi + 1), xf),
        lerp(at(xi, yi + 1, zi + 1), at(xi + 1, yi + 1, zi + 1), xf),
        yf,
      ),
      zf,
    );
  };

  const fbm = (x, y, z, oct = 4) => {
    let s = 0,
      a = 0.5,
      f = 1,
      n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * noise(x * f + i * 17.3, y * f + i * 5.1, z * f + i * 9.7);
      n += a;
      a *= 0.5;
      f *= 2.03;
    }
    return s / n;
  };
  return { noise, fbm };
}

/* ---------- texture baking ---------- */
function tex(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  return tex(c, true);
}

// shade(x, y, z, lat, noise, out): out = [r, g, b, height, alpha]
function bake(w, h, seed, shade, { bump = false, post } = {}) {
  const rnd = rng(seed);
  const N = makeNoise(rnd);
  const col = document.createElement("canvas");
  col.width = w;
  col.height = h;
  const cg = col.getContext("2d");
  const ci = cg.createImageData(w, h);
  const cd = ci.data;

  let bc = null,
    bg = null,
    bi = null,
    bd = null;
  if (bump) {
    bc = document.createElement("canvas");
    bc.width = w;
    bc.height = h;
    bg = bc.getContext("2d");
    bi = bg.createImageData(w, h);
    bd = bi.data;
  }

  const o = [0, 0, 0, 0, 255];
  let k = 0;
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI;
    const py = Math.sin(lat),
      cr = Math.cos(lat);
    for (let x = 0; x < w; x++, k += 4) {
      const lon = ((x + 0.5) / w) * Math.PI * 2;
      o[4] = 255;
      shade(cr * Math.cos(lon), py, cr * Math.sin(lon), lat, N, o);
      cd[k] = o[0];
      cd[k + 1] = o[1];
      cd[k + 2] = o[2];
      cd[k + 3] = o[4];
      if (bd) {
        const g = o[3] * 255;
        bd[k] = bd[k + 1] = bd[k + 2] = g;
        bd[k + 3] = 255;
      }
    }
  }
  cg.putImageData(ci, 0, 0);
  if (bg) bg.putImageData(bi, 0, 0);
  if (post) post(cg, bg, w, h, rnd);
  return { map: tex(col, true), bump: bc ? tex(bc, false) : null };
}

/* painted extras: craters and storm spots */
function stamp(g, cx, cy, r, sx, dark, light) {
  g.save();
  g.translate(cx, cy);
  g.scale(sx, 1);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
  gr.addColorStop(0, `rgba(0,0,0,${dark})`);
  gr.addColorStop(0.72, `rgba(0,0,0,${dark * 0.35})`);
  gr.addColorStop(0.86, `rgba(255,255,255,${light})`);
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, r, 0, 7);
  g.fill();
  g.restore();
}
function craters(count, rMin, rMax, dark = 0.35, light = 0.22) {
  return (cg, bg, w, h, rnd) => {
    for (let i = 0; i < count; i++) {
      const lat = Math.asin(rnd() * 2 - 1);
      const x = rnd() * w;
      const y = (0.5 - lat / Math.PI) * h;
      const r = (rMin + Math.pow(rnd(), 2.5) * (rMax - rMin)) * h; // many small, few big
      const sx = 1 / Math.max(Math.cos(lat), 0.2); // stretch toward the poles
      for (const dx of [-w, 0, w]) {
        if (x + dx + r * sx < 0 || x + dx - r * sx > w) continue;
        stamp(cg, x + dx, y, r, sx, dark, light);
        if (bg) stamp(bg, x + dx, y, r, sx, 0.55, 0.6);
      }
    }
  };
}
function blot(g, x, y, rx, ry, inner, outer) {
  g.save();
  g.translate(x, y);
  g.scale(rx, ry);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.6, inner);
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, 1, 0, 7);
  g.fill();
  g.restore();
}

/* ---------- surface recipes ---------- */
const R = {
  sun(x, y, z, lat, N, o) {
    const a = N.fbm(x * 5, y * 5, z * 5, 5);
    const b = N.fbm(x * 13 + 3, y * 13, z * 13, 3);
    let t = clamp01(a * 0.75 + b * 0.45 - 0.12);
    t *= 1 - sstep(0.68, 0.8, N.fbm(x * 2.2 + 9, y * 2.2, z * 2.2, 3)) * 0.55; // sunspots
    if (t < 0.5) paint(o, [196, 64, 12], [246, 138, 38], t * 2, 0);
    else paint(o, [246, 138, 38], [255, 232, 150], (t - 0.5) * 2, 0);
  },
  mercury(x, y, z, lat, N, o) {
    const f = N.fbm(x * 3, y * 3, z * 3, 5);
    const g = N.fbm(x * 9 + 4, y * 9, z * 9, 3);
    const t = clamp01(f * 1.2 - 0.1 + (g - 0.5) * 0.4);
    paint(o, [96, 90, 84], [184, 174, 160], t, t);
  },
  venus(x, y, z, lat, N, o) {
    const wx = N.fbm(x * 2, y * 2, z * 2, 3);
    const wy = N.fbm(x * 2 + 7, y * 2, z * 2, 3);
    const f = N.fbm(
      x * 2.5 + wx * 1.5,
      y * 5 + wy * 1.5,
      z * 2.5 + wy * 1.5,
      5,
    );
    paint(o, [186, 142, 78], [238, 214, 150], clamp01(f * 1.3 - 0.15), f * 0.5);
  },
  earth(x, y, z, lat, N, o) {
    const h = N.fbm(x * 1.7 + 3, y * 1.7, z * 1.7, 6);
    const ay = Math.abs(y);
    const ice = sstep(
      0.8,
      0.92,
      ay + (N.fbm(x * 7, y * 7, z * 7, 3) - 0.5) * 0.18,
    );
    let r, g, b, hh;
    if (h < 0.5) {
      const d = sstep(0.25, 0.5, h); // deep to shallow
      r = mix(8, 40, d);
      g = mix(30, 104, d);
      b = mix(78, 158, d);
      hh = 0.25 + d * 0.1;
    } else {
      const e = clamp01((h - 0.5) / 0.4);
      const dry =
        sstep(0.5, 0.72, N.fbm(x * 3 + 11, y * 3, z * 3, 3)) * (1 - ay * 0.7);
      r = mix(62, 184, dry);
      g = mix(112, 158, dry);
      b = mix(54, 104, dry);
      const m = sstep(0.45, 0.8, e); // rocky highlands
      r = mix(r, 118, m);
      g = mix(g, 108, m);
      b = mix(b, 96, m);
      const s = sstep(0.75, 0.95, e); // snow caps
      r = mix(r, 245, s);
      g = mix(g, 246, s);
      b = mix(b, 250, s);
      hh = 0.35 + e * 0.65;
    }
    o[0] = mix(r, 242, ice);
    o[1] = mix(g, 246, ice);
    o[2] = mix(b, 252, ice);
    o[3] = mix(hh, 0.45, ice);
  },
  clouds(x, y, z, lat, N, o) {
    const w1 = N.fbm(x * 2 + 5, y * 2, z * 2, 3);
    const f = N.fbm(x * 3 + w1 * 1.2, y * 5 + w1, z * 3 + w1 * 1.2, 5);
    o[0] = o[1] = o[2] = 255;
    o[4] = sstep(0.52, 0.78, f) * 235;
  },
  mars(x, y, z, lat, N, o) {
    const f = N.fbm(x * 2.5, y * 2.5, z * 2.5, 5);
    const d = N.fbm(x * 5 + 9, y * 5, z * 5, 4);
    paint(o, [150, 70, 40], [214, 128, 78], clamp01(f * 1.3 - 0.15), f);
    const dk = sstep(0.55, 0.7, d) * 0.5;
    o[0] = mix(o[0], 70, dk);
    o[1] = mix(o[1], 40, dk);
    o[2] = mix(o[2], 32, dk);
    const cap = sstep(0.86, 0.93, Math.abs(y) + (f - 0.5) * 0.1);
    o[0] = mix(o[0], 244, cap);
    o[1] = mix(o[1], 240, cap);
    o[2] = mix(o[2], 236, cap);
  },
  jupiter(x, y, z, lat, N, o) {
    const wp = N.fbm(x * 3, y * 3, z * 3, 3) - 0.5;
    const yy = y + wp * 0.1;
    const band =
      Math.sin(yy * 24 + N.fbm(x * 2, y * 9, z * 2, 3) * 3.2) * 0.5 + 0.5;
    const fine = N.fbm(x * 2 + wp * 4, y * 34, z * 2 + wp * 4, 4);
    const t = clamp01(band * 0.62 + fine * 0.55 - 0.12);
    if (t < 0.5) paint(o, [150, 92, 58], [205, 150, 100], t * 2, 0.5);
    else paint(o, [205, 150, 100], [240, 222, 188], (t - 0.5) * 2, 0.5);
  },
  saturn(x, y, z, lat, N, o) {
    const wp = N.fbm(x * 2, y * 2, z * 2, 3) - 0.5;
    const band =
      Math.sin((y + wp * 0.06) * 18 + N.fbm(x * 2, y * 7, z * 2, 3) * 2.2) *
        0.5 +
      0.5;
    const fine = N.fbm(x * 2, y * 28, z * 2, 3);
    const t = clamp01(band * 0.5 + fine * 0.5);
    if (t < 0.5) paint(o, [176, 146, 98], [222, 196, 148], t * 2, 0.5);
    else paint(o, [222, 196, 148], [242, 226, 188], (t - 0.5) * 2, 0.5);
  },
  uranus(x, y, z, lat, N, o) {
    const t = clamp01(
      0.5 + (N.fbm(x * 1.2, y * 7, z * 1.2, 3) - 0.5) * 0.5 + y * 0.05,
    );
    paint(o, [128, 196, 208], [176, 230, 236], t, 0.5);
  },
  neptune(x, y, z, lat, N, o) {
    const wp = N.fbm(x * 2, y * 2, z * 2, 3) - 0.5;
    const f = N.fbm(x * 1.5 + wp * 2, y * 8, z * 1.5 + wp * 2, 4);
    paint(o, [34, 60, 160], [78, 124, 226], clamp01(f * 1.4 - 0.2), 0.5);
  },
  moon(x, y, z, lat, N, o) {
    const f = N.fbm(x * 4, y * 4, z * 4, 4);
    const t = clamp01(f * 1.3 - 0.15);
    paint(o, [110, 108, 104], [196, 192, 184], t, t);
  },
};

/* ---------- jobs: textures bake one at a time after the first frame, so the tab opens instantly ---------- */
const jobs = [];
function pump() {
  const j = jobs.shift();
  if (!j) return;
  j[1]();
  setTimeout(pump, 40);
}

/* ---------- shared textures ---------- */
const glowTex = canvasTex(256, 256, (g, w, h) => {
  const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grd.addColorStop(0, "rgba(255,190,110,.9)");
  grd.addColorStop(0.3, "rgba(255,140,60,.35)");
  grd.addColorStop(1, "rgba(255,120,40,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
});

const dotTex = canvasTex(32, 32, (g, w, h) => {
  const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.5, "rgba(255,255,255,.6)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
});

/* ---------- the system (tilted, scaled) ---------- */
const system = new THREE.Group();
system.rotation.set(0.1, 0, 0.32);
system.scale.setScalar(SYSTEM_SCALE);
scene.add(system);

const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const hits = []; // invisible, slightly larger spheres for hover
function addHit(parent, radius, name) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 8), hitMat);
  m.userData.name = name;
  parent.add(m);
  hits.push(m);
}

/* ---------- sun: textured surface, pulsing glow layers, slowly turning rays ---------- */
const sunMat = new THREE.MeshBasicMaterial({ color: 0xf08a2e });
const sun = new THREE.Mesh(new THREE.SphereGeometry(3, 64, 64), sunMat);
system.add(sun);
addHit(sun, 4, "sun");
jobs.push([
  0,
  () => {
    sunMat.map = bake(512, 256, 11, R.sun).map;
    sunMat.color.set(0xffffff);
    sunMat.needsUpdate = true;
  },
]);

const glows = [
  [13, 0.9],
  [24, 0.4],
  [42, 0.16],
].map(([size, base], i) => {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: base,
    }),
  );
  sprite.scale.set(size, size, 1);
  sun.add(sprite);
  return { sprite, base, phase: i * 1.7 };
});

system.add(new THREE.PointLight(0xffffff, 2.5, 0, 0));
scene.add(new THREE.AmbientLight(0xffffff, 0.18));

/* ---------- atmosphere halo: lit on the sun side, faint on the night side ---------- */
function atmoMat([r, g, b], k, p) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(r, g, b) },
      uK: { value: k },
      uP: { value: p },
    },
    vertexShader: `
      varying vec3 vW;
      varying vec3 vWN;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vWN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uK;
      uniform float uP;
      varying vec3 vW;
      varying vec3 vWN;
      void main() {
        vec3 N = normalize(vWN);
        vec3 V = normalize(cameraPosition - vW);
        float f = pow(clamp(-dot(N, V), 0.0, 1.0), uP);
        float lit = smoothstep(-0.25, 0.55, dot(N, normalize(-vW))); // sun sits at the origin
        gl_FragColor = vec4(uColor * uK, f * mix(0.12, 1.0, lit));
      }`,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/* ---------- Saturn's ring: banded, with gaps, plus orbiting dust ---------- */
function ringTexture() {
  const N = makeNoise(rng(77));
  return canvasTex(512, 4, (g, w, h) => {
    const im = g.createImageData(w, h);
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      let d;
      if (u < 0.12)
        d = 0.18; // faint inner ring
      else if (u < 0.55)
        d = 0.85; // bright main ring
      else if (u < 0.6)
        d = 0.05; // wide gap
      else if (u < 0.97)
        d = 0.6; // outer ring
      else d = 0;
      if (u > 0.86 && u < 0.875) d *= 0.15; // thin gap
      const soft = sstep(0, 0.03, u) * sstep(1, 0.97, u);
      const n = 0.55 + 0.45 * N.fbm(u * 60, 1.3, 4.7, 4);
      const ripple = 0.8 + 0.2 * Math.sin(u * 420);
      const a = clamp01(d * n * ripple * soft);
      for (let y = 0; y < h; y++) {
        const k = (y * w + x) * 4;
        im.data[k] = mix(176, 238, n);
        im.data[k + 1] = mix(150, 216, n);
        im.data[k + 2] = mix(112, 176, n);
        im.data[k + 3] = a * 255;
      }
    }
    g.putImageData(im, 0, 0);
  });
}

function makeRing(planetSize) {
  const inner = planetSize * 1.35;
  const outer = planetSize * 2.5;
  const geo = new THREE.RingGeometry(inner, outer, 160);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const dist = Math.hypot(pos.getX(i), pos.getY(i));
    uv.setXY(i, (dist - inner) / (outer - inner), 0.5);
  }
  const ring = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      map: ringTexture(),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;

  const n = 600;
  const dp = new Float32Array(n * 3);
  const dc = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = inner + Math.random() * (outer - inner);
    dp.set(
      [Math.cos(a) * r, (Math.random() - 0.5) * 0.05, Math.sin(a) * r],
      i * 3,
    );
    const b = 0.6 + Math.random() * 0.4;
    dc.set([0.9 * b, 0.82 * b, 0.68 * b], i * 3);
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute("position", new THREE.BufferAttribute(dp, 3));
  dg.setAttribute("color", new THREE.BufferAttribute(dc, 3));
  const dust = new THREE.Points(
    dg,
    new THREE.PointsMaterial({
      map: dotTex,
      vertexColors: true,
      size: 1.8,
      sizeAttenuation: false,
      transparent: true,
      depthWrite: false,
      opacity: 0.8,
    }),
  );
  return { ring, dust };
}

/* ---------- planets ---------- */
// r: orbit radius, s: size, v: orbit speed, spin: rotation speed (negative = backwards)
// incl/node: orbit inclination, tex: [w, h], bump: bump strength, pri: bake order
const defs = [
  {
    name: "mercury",
    r: 6,
    s: 0.34,
    v: 0.95,
    spin: 0.4,
    tilt: 0.0,
    incl: 0.12,
    node: 0.5,
    color: 0xa79a8a,
    recipe: R.mercury,
    seed: 21,
    tex: [256, 128],
    bump: 1.0,
    pri: 5,
    post: craters(150, 0.012, 0.09),
  },
  {
    name: "venus",
    r: 8.5,
    s: 0.6,
    v: 0.68,
    spin: -0.25,
    tilt: 0.1,
    incl: 0.06,
    node: 2.1,
    color: 0xdcc08e,
    recipe: R.venus,
    seed: 22,
    tex: [256, 128],
    pri: 5,
    atmo: { c: [1.0, 0.82, 0.5], k: 1.3, p: 1.5 },
  },
  {
    name: "earth",
    r: 11.5,
    s: 0.65,
    v: 0.52,
    spin: 1.6,
    tilt: 0.4,
    incl: 0.0,
    node: 0,
    color: 0x3f78b5,
    recipe: R.earth,
    seed: 23,
    tex: [512, 256],
    bump: 0.5,
    pri: 1,
    clouds: true,
    atmo: { c: [0.35, 0.62, 1.0], k: 1.8, p: 1.5 },
    moons: [{ r: 1.3, s: 0.17, v: 2.2, c: 0xbdbdbd, inc: 0.09 }],
  },
  {
    name: "mars",
    r: 14.5,
    s: 0.5,
    v: 0.4,
    spin: 1.5,
    tilt: 0.45,
    incl: 0.05,
    node: 4.0,
    color: 0xc0573e,
    recipe: R.mars,
    seed: 24,
    tex: [256, 128],
    bump: 0.9,
    pri: 5,
    post: craters(90, 0.012, 0.08),
    atmo: { c: [0.95, 0.55, 0.35], k: 0.8, p: 1.8 },
    moons: [
      { r: 0.95, s: 0.06, v: 4.2, c: 0x8a7f74, inc: 0.05 },
      { r: 1.4, s: 0.045, v: 2.6, c: 0x9a8f84, inc: 0.1 },
    ],
  },
  {
    name: "jupiter",
    r: 20.5,
    s: 1.5,
    v: 0.24,
    spin: 3.4,
    tilt: 0.05,
    incl: 0.03,
    node: 1.2,
    color: 0xcfa070,
    recipe: R.jupiter,
    seed: 25,
    tex: [512, 256],
    pri: 2,
    atmo: { c: [0.9, 0.8, 0.65], k: 0.9, p: 1.6 },
    post: (cg, bg, w, h, rnd) => {
      blot(
        cg,
        w * 0.3,
        h * 0.62,
        w * 0.055,
        h * 0.05,
        "rgba(196,78,52,.95)",
        "rgba(196,78,52,0)",
      );
      for (let i = 0; i < 7; i++)
        blot(
          cg,
          rnd() * w,
          h * (0.3 + rnd() * 0.4),
          w * 0.016,
          h * 0.012,
          "rgba(250,240,220,.65)",
          "rgba(250,240,220,0)",
        );
    },
    moons: [
      { r: 2.3, s: 0.13, v: 3.2, c: 0xe0c070, inc: 0.02 },
      { r: 2.8, s: 0.11, v: 2.3, c: 0xcfc4b0, inc: 0.03 },
      { r: 3.4, s: 0.17, v: 1.6, c: 0x9a9084, inc: 0.02 },
      { r: 4.1, s: 0.15, v: 1.1, c: 0x6e655c, inc: 0.04 },
    ],
  },
  {
    name: "saturn",
    r: 26.5,
    s: 1.25,
    v: 0.17,
    spin: 3.0,
    tilt: 0.3,
    incl: 0.04,
    node: 3.0,
    color: 0xd8b47a,
    recipe: R.saturn,
    seed: 26,
    tex: [512, 256],
    pri: 2,
    ring: true,
    atmo: { c: [0.9, 0.8, 0.6], k: 0.8, p: 1.6 },
    moons: [{ r: 4.9, s: 0.15, v: 0.8, c: 0xd9a64a, inc: 0.03 }],
  },
  {
    name: "uranus",
    r: 31.5,
    s: 0.9,
    v: 0.12,
    spin: 2.6,
    tilt: 1.2,
    incl: 0.02,
    node: 5.0,
    color: 0x7fb6c4,
    recipe: R.uranus,
    seed: 27,
    tex: [256, 128],
    pri: 5,
    atmo: { c: [0.55, 0.92, 1.0], k: 1.3, p: 1.5 },
  },
  {
    name: "neptune",
    r: 36,
    s: 0.88,
    v: 0.09,
    spin: 2.4,
    tilt: 0.5,
    incl: 0.03,
    node: 0.8,
    color: 0x3f62c8,
    recipe: R.neptune,
    seed: 28,
    tex: [256, 128],
    pri: 5,
    atmo: { c: [0.3, 0.5, 1.0], k: 1.4, p: 1.5 },
    post: (cg, bg, w, h) => {
      blot(
        cg,
        w * 0.6,
        h * 0.58,
        w * 0.06,
        h * 0.04,
        "rgba(20,30,90,.8)",
        "rgba(20,30,90,0)",
      );
      blot(
        cg,
        w * 0.66,
        h * 0.55,
        w * 0.04,
        h * 0.01,
        "rgba(240,248,255,.6)",
        "rgba(240,248,255,0)",
      );
    },
  },
];

const orbitMat = new THREE.LineBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.12,
  depthWrite: false,
});
function orbitLine(r) {
  const pts = [];
  for (let i = 0; i < 256; i++) {
    const a = (i / 256) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  return new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(pts),
    orbitMat,
  );
}

const moonMats = [];
const planets = defs.map((d, i) => {
  const s = d.s * SIZE_K;
  const orbit = new THREE.Group(); // inclined orbital plane
  orbit.rotation.set(d.incl, d.node, 0);
  system.add(orbit);
  orbit.add(orbitLine(d.r));

  const body = new THREE.Group();
  body.rotation.z = d.tilt;
  orbit.add(body);

  const mat = new THREE.MeshStandardMaterial({
    color: d.color,
    roughness: 0.95,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(s, 48, 48), mat);
  body.add(mesh);
  addHit(body, Math.max(s * 1.8, 1.0), d.name);

  jobs.push([
    d.pri ?? 5,
    () => {
      const t = bake(d.tex[0], d.tex[1], d.seed, d.recipe, {
        bump: !!d.bump,
        post: d.post,
      });
      mat.map = t.map;
      if (t.bump) {
        mat.bumpMap = t.bump;
        mat.bumpScale = d.bump;
      }
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
    },
  ]);

  let clouds = null;
  if (d.clouds) {
    const cm = new THREE.MeshStandardMaterial({
      transparent: true,
      depthWrite: false,
      roughness: 1,
    });
    clouds = new THREE.Mesh(new THREE.SphereGeometry(s * 1.013, 48, 48), cm);
    body.add(clouds);
    jobs.push([
      d.pri ?? 5,
      () => {
        cm.map = bake(512, 256, 33, R.clouds).map;
        cm.needsUpdate = true;
      },
    ]);
  }

  if (d.atmo) {
    body.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(s * 1.17, 48, 48),
        atmoMat(d.atmo.c, d.atmo.k, d.atmo.p),
      ),
    );
  }

  let dust = null;
  if (d.ring) {
    const r = makeRing(s);
    dust = r.dust;
    body.add(r.ring, dust);
  }

  const pivot = new THREE.Group(); // follows the planet, holds its moons
  orbit.add(pivot);
  const moons = (d.moons || []).map((m) => {
    const mm = new THREE.MeshStandardMaterial({ color: m.c, roughness: 1 });
    moonMats.push(mm);
    const mmesh = new THREE.Mesh(
      new THREE.SphereGeometry(m.s * SIZE_K, 24, 24),
      mm,
    );
    pivot.add(mmesh);
    return {
      mesh: mmesh,
      r: m.r * SIZE_K,
      v: m.v,
      inc: m.inc,
      ph: Math.random() * 6.28,
    };
  });

  return { ...d, body, mesh, clouds, dust, pivot, moons, offset: i * 1.9 };
});

jobs.push([
  6,
  () => {
    const t = bake(128, 64, 41, R.moon, {
      bump: true,
      post: craters(40, 0.02, 0.14),
    });
    for (const m of moonMats) {
      m.map = t.map;
      m.bumpMap = t.bump;
      m.bumpScale = 1;
      m.needsUpdate = true;
    }
  },
]);

/* ---------- asteroid belt + Kuiper belt (static points with varied size and brightness) ---------- */
function makeBelt(count, rMin, rMax, spreadY, rgb, size) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = rMin + Math.random() * (rMax - rMin);
    pos.set(
      [Math.cos(a) * r, (Math.random() - 0.5) * spreadY, Math.sin(a) * r],
      i * 3,
    );
    const b = 0.45 + Math.random() * 0.55;
    col.set([rgb[0] * b, rgb[1] * b, rgb[2] * b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(
    g,
    new THREE.PointsMaterial({
      map: dotTex,
      vertexColors: true,
      size,
      sizeAttenuation: false,
      transparent: true,
      depthWrite: false,
    }),
  );
  system.add(pts);
  return pts;
}
const belts = [
  [makeBelt(900, 16.3, 17.9, 0.4, [0.66, 0.62, 0.56], 1.3), 0.03],
  [makeBelt(220, 16.3, 17.9, 0.4, [0.8, 0.74, 0.66], 2.4), 0.032],
  [makeBelt(1800, 40, 48, 3.0, [0.5, 0.56, 0.64], 1.2), 0.01],
  [makeBelt(300, 40, 48, 3.0, [0.62, 0.68, 0.76], 2.2), 0.011],
];

/* ---------- stars: drift and twinkle run on the GPU, nothing is rewritten per frame ---------- */
const BOX = new THREE.Vector3(110, 70, 90);
const N = 2600;
const sp = new Float32Array(N * 3);
const sc = new Float32Array(N * 3);
const sph = new Float32Array(N);
const ssz = new Float32Array(N);
for (let i = 0; i < N; i++) {
  sp.set(
    [
      (Math.random() * 2 - 1) * BOX.x,
      (Math.random() * 2 - 1) * BOX.y,
      -Math.random() * BOX.z + 10,
    ],
    i * 3,
  );
  const b = 0.35 + Math.random() * 0.65;
  const roll = Math.random();
  const tint =
    roll < 0.15 ? [0.7, 0.82, 1.0] : roll < 0.3 ? [1.0, 0.86, 0.72] : [1, 1, 1];
  sc.set([tint[0] * b, tint[1] * b, tint[2] * b], i * 3);
  sph[i] = Math.random();
  ssz[i] = 1.2 + Math.pow(Math.random(), 3) * 2.4; // mostly small, a few bright
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
starGeo.setAttribute("aColor", new THREE.BufferAttribute(sc, 3));
starGeo.setAttribute("aPhase", new THREE.BufferAttribute(sph, 1));
starGeo.setAttribute("aSize", new THREE.BufferAttribute(ssz, 1));

const starMat = new THREE.ShaderMaterial({
  uniforms: {
    uOffset: { value: new THREE.Vector2() },
    uBox: { value: new THREE.Vector2(BOX.x, BOX.y) },
    uScale: { value: renderer.getPixelRatio() },
    uTime: { value: 0 },
  },
  vertexShader: `
    attribute vec3 aColor;
    attribute float aPhase;
    attribute float aSize;
    uniform vec2 uOffset;
    uniform vec2 uBox;
    uniform float uScale;
    uniform float uTime;
    varying vec3 vColor;
    void main() {
      vec3 p = position;
      p.xy = mod(p.xy + uOffset + uBox, 2.0 * uBox) - uBox;
      float tw = 0.75 + 0.25 * sin(uTime * (1.0 + aPhase * 2.0) + aPhase * 40.0);
      vColor = aColor * tw;
      gl_PointSize = aSize * uScale;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: `
    varying vec3 vColor;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      gl_FragColor = vec4(vColor, smoothstep(0.5, 0.0, d));
    }`,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const stars = new THREE.Points(starGeo, starMat);
stars.frustumCulled = false;
scene.add(stars);

const DRIFT = new THREE.Vector2(-2.2, -0.6); // stars flow left+down, so the sun seems to move right+up

/* ---------- shooting stars (pool of 2, positions only written while one is flying) ---------- */
const shooters = Array.from({ length: 2 }, (_, i) => {
  const pos = new Float32Array(6);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute(
    "color",
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 1]), 3),
  );
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const line = new THREE.Line(g, mat);
  line.visible = false;
  line.frustumCulled = false;
  scene.add(line);
  return {
    line,
    mat,
    pos,
    active: false,
    nextAt: 3 + i * 3 + Math.random() * 5,
    born: 0,
    sx: 0,
    sy: 0,
    sz: -35,
  };
});
const SHOOT_V = new THREE.Vector2(-55, -22);
const SHOOT_LIFE = 0.9;

function updateShooter(s, t) {
  if (!s.active) {
    if (t < s.nextAt) return;
    s.active = true;
    s.born = t;
    s.sx = -70 + Math.random() * 80;
    s.sy = Math.random() * 20;
    s.line.visible = true;
  }
  const age = t - s.born;
  if (age > SHOOT_LIFE) {
    s.active = false;
    s.line.visible = false;
    s.nextAt = t + 4 + Math.random() * 8;
    return;
  }
  const hx = s.sx + SHOOT_V.x * age;
  const hy = s.sy + SHOOT_V.y * age;
  s.pos[0] = hx - SHOOT_V.x * 0.13; // tail
  s.pos[1] = hy - SHOOT_V.y * 0.13;
  s.pos[2] = s.sz;
  s.pos[3] = hx; // head
  s.pos[4] = hy;
  s.pos[5] = s.sz;
  s.line.geometry.attributes.position.needsUpdate = true;
  s.mat.opacity = 1 - age / SHOOT_LIFE;
}

/* ---------- input: parallax, hover labels, idle detection ---------- */
const pointer = new THREE.Vector2(); // NDC, for raycasting
const target = new THREE.Vector2(); // parallax target, -1..1
const current = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
let pointerInside = false;
let overUI = false;
let hoverName = "";
let lastInput = performance.now();

addEventListener(
  "pointermove",
  (e) => {
    lastInput = performance.now();
    pointerInside = true;
    overUI = !!(e.target.closest && e.target.closest("form"));
    pointer.set(
      (e.clientX / innerWidth) * 2 - 1,
      -(e.clientY / innerHeight) * 2 + 1,
    );
    target.copy(pointer);
    label.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 16}px)`;
  },
  { passive: true },
);
document.documentElement.addEventListener("pointerleave", () => {
  pointerInside = false;
});
for (const type of ["pointerdown", "keydown", "wheel"]) {
  addEventListener(
    type,
    () => {
      lastInput = performance.now();
    },
    { passive: true },
  );
}

function updateHover() {
  let name = "";
  if (pointerInside && !overUI) {
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(hits, false)[0];
    if (hit) name = hit.object.userData.name;
  }
  if (name === hoverName) return;
  hoverName = name;
  label.textContent = name;
  label.style.opacity = name ? "1" : "0";
}

/* ---------- layout: system on the right ---------- */
function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.setViewOffset(w, h, -w * 0.2, 0, w, h); // shifts the scene right by 20%
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

/* ---------- loop: only does work when a frame is due ---------- */
let lastDraw = 0;
function frame(ms) {
  requestAnimationFrame(frame);

  const idle = performance.now() - lastInput > IDLE_AFTER;
  const frameMs = 1000 / (idle ? FPS_IDLE : FPS_ACTIVE);
  if (ms - lastDraw < frameMs - 1) return;
  const dt = Math.min((ms - lastDraw) / 1000, 0.1);
  lastDraw = ms;
  const t = ms / 1000;

  // mouse parallax: only touch the camera while it is still catching up
  const k = 1 - Math.exp(-dt * 4);
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  if (Math.abs(dx) + Math.abs(dy) > 1e-4) {
    current.x += dx * k;
    current.y += dy * k;
    camera.position.set(CAM.x + current.x * 3, CAM.y - current.y * 2, CAM.z);
    camera.lookAt(0, 0, 0);
  }

  for (const p of planets) {
    const a = t * p.v + p.offset;
    const x = Math.cos(a) * p.r;
    const z = Math.sin(a) * p.r;
    p.body.position.set(x, 0, z);
    p.mesh.rotation.y = t * p.spin;
    if (p.clouds) p.clouds.rotation.y = t * p.spin * 1.15;
    if (p.dust) p.dust.rotation.y = t * 0.12;
    if (p.moons.length) {
      p.pivot.position.set(x, 0, z);
      for (const m of p.moons) {
        const b = t * m.v + m.ph;
        m.mesh.position.set(
          Math.cos(b) * m.r,
          Math.sin(b) * m.r * Math.sin(m.inc),
          Math.sin(b) * m.r * Math.cos(m.inc),
        );
      }
    }
  }
  sun.rotation.y = t * 0.15;
  for (const [obj, speed] of belts) obj.rotation.y = t * speed;
  for (const s of shooters) updateShooter(s, t);
  starMat.uniforms.uOffset.value.set(DRIFT.x * t, DRIFT.y * t);
  starMat.uniforms.uTime.value = t;

  renderer.render(scene, camera); // render first so world matrices are fresh for hover
  updateHover();
}
requestAnimationFrame(frame);

jobs.sort((a, b) => a[0] - b[0]);
setTimeout(pump, 80); // textures appear one by one right after the first frame
