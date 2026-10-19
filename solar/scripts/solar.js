import * as THREE from "../lib/three.module.min.js";

const FPS_ACTIVE = 60; // try 45 if it still feels heavy
const FPS_IDLE = 15; // used after a minute with no input
const IDLE_AFTER = 60 * 1000;

const SYSTEM_SCALE = 0.48; // overall size of the whole system
const SIZE_K = 1.4; // planet size boost (orbits stay put)

const TEX = new URL("../tex/", import.meta.url).href;

const canvas = document.getElementById("scene");
const label = document.getElementById("label");

const PR = Math.min(devicePixelRatio, 1.5); // retina at full ratio is the biggest GPU cost
const renderer = new THREE.WebGLRenderer({ canvas, antialias: PR <= 1 });
renderer.setPixelRatio(PR);
renderer.setClearColor(0x050505);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
const CAM = new THREE.Vector3(0, 12, 34);
camera.position.copy(CAM);
camera.lookAt(0, 0, 0);

/* ---------- helpers ---------- */
const wrap = (v, half) =>
  ((((v + half) % (2 * half)) + 2 * half) % (2 * half)) - half;
function rng(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- textures: plain PNG files, decoded by the browser, no CPU work ---------- */
const loader = new THREE.TextureLoader();
function loadTex(name, done) {
  return loader.load(`${TEX}${name}.png`, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    if (done) done(t);
  });
}

const glowTex = loadTex("glow");
const nebulaTex = loadTex("nebula");
const galaxyTex = loadTex("galaxy");

/* ---------- background: nebula clouds and distant galaxies ---------- */
const DRIFT = new THREE.Vector2(-2.2, -0.6); // everything flows left+down, so the sun seems to move right+up

const nebulae = [
  { x: -60, y: 8, s: 120, c: 0x6a3cff, o: 0.13 },
  { x: 25, y: -26, s: 110, c: 0x1f8fff, o: 0.11 },
  { x: 70, y: 30, s: 130, c: 0xff4f8a, o: 0.09 },
  { x: -15, y: 36, s: 100, c: 0x16c9a8, o: 0.1 },
].map((n) => {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: nebulaTex,
      color: n.c,
      opacity: n.o,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  sprite.scale.set(n.s, n.s, 1);
  sprite.position.set(n.x, n.y, -70);
  scene.add(sprite);
  return { sprite, x0: n.x };
});

const galaxies = [
  { x: -35, y: 24, s: 28, rot: 0.5, spin: 0.012 },
  { x: 55, y: -22, s: 22, rot: -0.9, spin: -0.009 },
].map((d) => {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: galaxyTex,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      rotation: d.rot,
    }),
  );
  sprite.scale.set(d.s, d.s, 1);
  sprite.position.set(d.x, d.y, -85);
  scene.add(sprite);
  return { sprite, rot: d.rot, spin: d.spin };
});

/* ---------- the system (tilted, scaled) ---------- */
const system = new THREE.Group();
system.rotation.set(0.1, 0, 0.32);
system.scale.setScalar(SYSTEM_SCALE);
scene.add(system);

const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const hits = []; // invisible, slightly larger spheres for hover
function addHit(parent, radius, name) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 6), hitMat);
  m.userData.name = name;
  parent.add(m);
  hits.push(m);
}

/* ---------- sun: textured surface and a steady glow ---------- */
const sunMat = new THREE.MeshBasicMaterial({ color: 0xf08a2e });
const sun = new THREE.Mesh(new THREE.SphereGeometry(3, 40, 30), sunMat);
system.add(sun);
addHit(sun, 4, "sun");
loadTex("sun", (t) => {
  sunMat.map = t;
  sunMat.color.set(0xffffff);
  sunMat.needsUpdate = true;
});

for (const [size, opacity] of [
  [13, 0.9],
  [24, 0.4],
  [42, 0.16],
]) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity,
    }),
  );
  sprite.scale.set(size, size, 1);
  sun.add(sprite);
}

system.add(new THREE.PointLight(0xffffff, 2.5, 0, 0));
scene.add(new THREE.AmbientLight(0xffffff, 0.22));

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

/* ---------- Saturn's ring ---------- */
function makeRing(planetSize) {
  const inner = planetSize * 1.35;
  const outer = planetSize * 2.5;
  const geo = new THREE.RingGeometry(inner, outer, 96);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(
      i,
      (Math.hypot(pos.getX(i), pos.getY(i)) - inner) / (outer - inner),
      0.5,
    );
  }
  const ring = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      map: loadTex("ring"),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  return ring;
}

/* ---------- planets ---------- */
// r: orbit radius, s: size, v: orbit speed, spin: rotation speed (negative = backwards)
// incl/node: orbit inclination
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
    atmo: { c: [0.35, 0.62, 1.0], k: 1.8, p: 1.5 },
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
    ring: true,
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
    atmo: { c: [0.3, 0.5, 1.0], k: 1.4, p: 1.5 },
  },
];

// one shared unit circle, scaled per orbit
const unitCircle = (() => {
  const pts = [];
  for (let i = 0; i < 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
})();
const orbitMat = new THREE.LineBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.12,
  depthWrite: false,
});

const planets = defs.map((d, i) => {
  const s = d.s * SIZE_K;
  const orbit = new THREE.Group(); // inclined orbital plane
  orbit.rotation.set(d.incl, d.node, 0);
  system.add(orbit);

  const line = new THREE.LineLoop(unitCircle, orbitMat);
  line.scale.set(d.r, 1, d.r);
  orbit.add(line);

  const body = new THREE.Group();
  body.rotation.z = d.tilt;
  orbit.add(body);

  const mat = new THREE.MeshLambertMaterial({ color: d.color });
  const seg = s < 0.6 ? 20 : 32;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(s, seg, Math.round(seg * 0.75)),
    mat,
  );
  body.add(mesh);
  addHit(body, Math.max(s * 1.8, 1.0), d.name);

  loadTex(d.name, (t) => {
    mat.map = t;
    mat.color.set(0xffffff);
    mat.needsUpdate = true;
  });

  if (d.atmo) {
    body.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(s * 1.17, 24, 16),
        atmoMat(d.atmo.c, d.atmo.k, d.atmo.p),
      ),
    );
  }
  if (d.ring) body.add(makeRing(s));

  return { ...d, body, mesh, offset: i * 1.9 };
});

/* ---------- asteroid belt + Kuiper belt (plain points, one draw call each) ---------- */
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
      vertexColors: true,
      size,
      sizeAttenuation: false,
    }),
  );
  system.add(pts);
  return pts;
}
const belts = [
  [makeBelt(550, 16.3, 17.9, 0.4, [0.7, 0.65, 0.58], 1.8), 0.03],
  [makeBelt(800, 40, 48, 3.0, [0.55, 0.6, 0.7], 1.4), 0.01],
];

/* ---------- stars: three depth layers, drift and twinkle run on the GPU ---------- */
function makeStars({ count, box, zMin, zMax, size, speed }) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const ph = new Float32Array(count);
  const sz = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos.set(
      [
        (Math.random() * 2 - 1) * box.x,
        (Math.random() * 2 - 1) * box.y,
        zMin + Math.random() * (zMax - zMin),
      ],
      i * 3,
    );
    const b = 0.35 + Math.random() * 0.65;
    const roll = Math.random();
    const tint =
      roll < 0.15
        ? [0.7, 0.82, 1.0]
        : roll < 0.3
          ? [1.0, 0.86, 0.72]
          : [1, 1, 1];
    col.set([tint[0] * b, tint[1] * b, tint[2] * b], i * 3);
    ph[i] = Math.random();
    sz[i] = size[0] + Math.pow(Math.random(), 3) * size[1]; // mostly small, a few bright
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aPhase", new THREE.BufferAttribute(ph, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(sz, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uOffset: { value: new THREE.Vector2() },
      uBox: { value: new THREE.Vector2(box.x, box.y) },
      uScale: { value: PR },
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
        float tw = 0.78 + 0.22 * sin(uTime * (0.8 + aPhase * 1.6) + aPhase * 40.0);
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
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return { mat, speed };
}
const starLayers = [
  makeStars({
    count: 1100,
    box: { x: 110, y: 70 },
    zMin: -90,
    zMax: -20,
    size: [1.0, 1.6],
    speed: 0.5,
  }),
  makeStars({
    count: 600,
    box: { x: 90, y: 56 },
    zMin: -45,
    zMax: 0,
    size: [1.2, 2.2],
    speed: 1.0,
  }),
  makeStars({
    count: 180,
    box: { x: 55, y: 30 },
    zMin: -10,
    zMax: 14,
    size: [1.8, 3.0],
    speed: 1.9,
  }),
];

/* ---------- drifting rocks: a few lumpy asteroids tumble past in front of the scene ---------- */
const rockGeos = [0, 1, 2].map((n) => {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const rnd = rng(100 + n);
  const seen = new Map(); // same jitter for shared corners, so there are no cracks
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, 0.7 + rnd() * 0.5);
    const k = seen.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.85, p.getZ(i) * k);
  }
  return g;
});
const rockMats = [0x8a8178, 0x6f6962, 0x9a9087].map(
  (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true }),
);
const RX = 55,
  RY = 22;
const rocks = Array.from({ length: 9 }, (_, i) => {
  const depth = Math.random(); // 0 far, 1 near
  const mesh = new THREE.Mesh(rockGeos[i % 3], rockMats[i % 3]);
  mesh.scale.setScalar(0.18 + depth * 0.4);
  mesh.position.z = -8 + depth * 20;
  scene.add(mesh);
  const sp = 0.8 + depth * 1.2;
  return {
    mesh,
    x0: (Math.random() * 2 - 1) * RX,
    y0: (Math.random() * 2 - 1) * RY,
    vx: DRIFT.x * sp,
    vy: DRIFT.y * sp,
    r0: Math.random() * 6,
    sx: 0.2 + Math.random() * 0.6,
    sy: 0.2 + Math.random() * 0.6,
  };
});

/* ---------- shooting stars (pool of 3, positions only written while one is flying) ---------- */
const shooters = Array.from({ length: 3 }, (_, i) => {
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
    nextAt: 2 + i * 2 + Math.random() * 4,
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
    s.nextAt = t + 3 + Math.random() * 6;
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
    overUI = !!(e.target.closest && e.target.closest("form, button"));
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
let frameN = 0;
function frame(ms) {
  requestAnimationFrame(frame);

  const idle = performance.now() - lastInput > IDLE_AFTER;
  const frameMs = 1000 / (idle ? FPS_IDLE : FPS_ACTIVE);
  if (ms - lastDraw < frameMs - 1) return;
  const dt = Math.min((ms - lastDraw) / 1000, 0.1);
  lastDraw = ms;
  const t = ms / 1000;
  frameN++;

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

  // the whole system floats and sways a little
  system.position.y = Math.sin(t * 0.35) * 0.35;
  system.rotation.y = Math.sin(t * 0.07) * 0.06;

  for (const p of planets) {
    const a = t * p.v + p.offset;
    p.body.position.set(Math.cos(a) * p.r, 0, Math.sin(a) * p.r);
    p.mesh.rotation.y = t * p.spin;
  }
  sun.rotation.y = t * 0.15;
  for (const [obj, speed] of belts) obj.rotation.y = t * speed;

  for (const l of starLayers) {
    l.mat.uniforms.uOffset.value.set(
      DRIFT.x * t * l.speed,
      DRIFT.y * t * l.speed,
    );
    l.mat.uniforms.uTime.value = t;
  }
  for (const n of nebulae)
    n.sprite.position.x = wrap(n.x0 + DRIFT.x * t * 0.15, 150);
  for (const g of galaxies) g.sprite.material.rotation = g.rot + t * g.spin;
  for (const r of rocks) {
    r.mesh.position.x = wrap(r.x0 + r.vx * t, RX);
    r.mesh.position.y = wrap(r.y0 + r.vy * t, RY);
    r.mesh.rotation.x = r.r0 + t * r.sx;
    r.mesh.rotation.y = r.r0 + t * r.sy;
  }
  for (const s of shooters) updateShooter(s, t);

  renderer.render(scene, camera);
  if (frameN % 5 === 0) updateHover(); // hover doesn't need to run every frame
}
requestAnimationFrame(frame);
