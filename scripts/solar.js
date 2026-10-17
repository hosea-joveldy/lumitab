import * as THREE from "../lib/three.module.min.js";

const FPS_ACTIVE = 60;
const FPS_IDLE = 15; // used after a minute with no input
const IDLE_AFTER = 60 * 1000;

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

/* ---------- textures (built once) ---------- */
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function planetTex(base, bands) {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = Math.random() < 0.5 ? "#000" : "#fff";
      g.globalAlpha = Math.random() * bands * 0.35;
      g.fillRect(0, Math.random() * h, w, 3 + Math.random() * 18);
    }
    for (let i = 0; i < 30; i++) {
      const x = Math.random() * w;
      const y = h * 0.15 + Math.random() * h * 0.7;
      const r = 8 + Math.random() * 26;
      g.fillStyle = Math.random() < 0.5 ? "#000" : "#fff";
      g.globalAlpha = 0.18 + Math.random() * 0.25;
      for (const dx of [-w, 0, w]) {
        g.beginPath();
        g.ellipse(x + dx, y, r * 1.6, r, 0, 0, 7);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  });
}

const sunTex = canvasTex(512, 256, (g, w, h) => {
  g.fillStyle = "#f08a2e";
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 700; i++) {
    g.fillStyle = Math.random() < 0.5 ? "#ffd27a" : "#b8481a";
    g.globalAlpha = Math.random() * 0.25;
    g.beginPath();
    g.arc(Math.random() * w, Math.random() * h, 4 + Math.random() * 22, 0, 7);
    g.fill();
  }
});

const glowTex = canvasTex(256, 256, (g, w, h) => {
  const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grd.addColorStop(0, "rgba(255,190,110,.9)");
  grd.addColorStop(0.3, "rgba(255,140,60,.35)");
  grd.addColorStop(1, "rgba(255,120,40,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
});

/* ---------- the system (tilted, scaled) ---------- */
const system = new THREE.Group();
system.rotation.set(0.1, 0, 0.32);
system.scale.setScalar(0.7);
scene.add(system);

const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const hits = []; // invisible, slightly larger spheres for hover
function addHit(parent, radius, name) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 8), hitMat);
  m.userData.name = name;
  parent.add(m);
  hits.push(m);
}

/* sun with pulsing glow */
const sun = new THREE.Mesh(
  new THREE.SphereGeometry(2.2, 48, 48),
  new THREE.MeshBasicMaterial({ map: sunTex }),
);
system.add(sun);
addHit(sun, 3.2, "sun");

const glows = [
  [10, 0.9],
  [18, 0.4],
  [32, 0.16],
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

/* ---------- Saturn's ring: soft bands, fading edges, a gap, orbiting dust ---------- */
function makeRing(planetSize) {
  const inner = planetSize * 1.5;
  const outer = planetSize * 2.6;
  const geo = new THREE.RingGeometry(inner, outer, 128);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const dist = Math.hypot(pos.getX(i), pos.getY(i));
    uv.setXY(i, (dist - inner) / (outer - inner), 0.5);
  }
  const tex = canvasTex(256, 4, (g, w, h) => {
    for (let x = 0; x < w; x++) {
      const edge = Math.min(x, w - 1 - x) / 24;
      const band =
        0.45 + 0.55 * Math.abs(Math.sin(x * 0.21) * Math.cos(x * 0.063));
      const gap = x > w * 0.58 && x < w * 0.64 ? 0.08 : 1;
      g.fillStyle = `rgba(214,190,150,${Math.min(1, edge) * band * gap})`;
      g.fillRect(x, 0, 1, h);
    }
  });
  const ring = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;

  const n = 500;
  const dp = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = inner + Math.random() * (outer - inner);
    dp.set(
      [Math.cos(a) * r, (Math.random() - 0.5) * 0.04, Math.sin(a) * r],
      i * 3,
    );
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute("position", new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(
    dg,
    new THREE.PointsMaterial({
      color: 0xe6d2ad,
      size: 1.4,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.7,
    }),
  );
  return { ring, dust };
}

/* ---------- planets ---------- */
// r: orbit radius, s: size, v: orbit speed, spin: rotation speed (negative = backwards)
const defs = [
  {
    name: "mercury",
    r: 5,
    s: 0.35,
    base: "#a79a8a",
    bands: 0.3,
    v: 0.9,
    spin: 0.4,
    tilt: 0.0,
  },
  {
    name: "venus",
    r: 7.5,
    s: 0.6,
    base: "#dcc08e",
    bands: 0.5,
    v: 0.65,
    spin: -0.25,
    tilt: 0.1,
  },
  {
    name: "earth",
    r: 10.5,
    s: 0.65,
    base: "#3f78b5",
    bands: 0.8,
    v: 0.5,
    spin: 1.6,
    tilt: 0.4,
    moon: true,
  },
  {
    name: "mars",
    r: 13.5,
    s: 0.5,
    base: "#c0573e",
    bands: 0.5,
    v: 0.38,
    spin: 1.5,
    tilt: 0.45,
  },
  {
    name: "saturn",
    r: 18,
    s: 1.3,
    base: "#d8b47a",
    bands: 1.4,
    v: 0.2,
    spin: 3.0,
    tilt: 0.3,
    ring: true,
  },
  {
    name: "uranus",
    r: 22,
    s: 0.95,
    base: "#7fb6c4",
    bands: 0.6,
    v: 0.14,
    spin: 2.6,
    tilt: 1.2,
  },
];

const orbitMat = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.1,
  side: THREE.DoubleSide,
});

const planets = defs.map((d, i) => {
  const body = new THREE.Group();
  body.rotation.z = d.tilt;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(d.s, 48, 48),
    new THREE.MeshStandardMaterial({
      map: planetTex(d.base, d.bands),
      roughness: 0.95,
    }),
  );
  body.add(mesh);
  addHit(body, Math.max(d.s * 1.8, 0.9), d.name);

  let dust = null;
  if (d.ring) {
    const r = makeRing(d.s);
    dust = r.dust;
    body.add(r.ring, dust);
  }

  let moon = null;
  if (d.moon) {
    moon = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 20, 20),
      new THREE.MeshStandardMaterial({ color: 0xbdbdbd, roughness: 1 }),
    );
    system.add(moon);
  }

  const orbit = new THREE.Mesh(
    new THREE.RingGeometry(d.r - 0.025, d.r + 0.025, 160),
    orbitMat,
  );
  orbit.rotation.x = -Math.PI / 2;
  system.add(orbit);

  system.add(body);
  return { ...d, body, mesh, moon, dust, offset: i * 1.9 };
});

/* ---------- asteroid belt + Kuiper belt (static points, rotated as one object) ---------- */
function makeBelt(count, rMin, rMax, spreadY, color, size) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = rMin + Math.random() * (rMax - rMin);
    pos.set(
      [Math.cos(a) * r, (Math.random() - 0.5) * spreadY, Math.sin(a) * r],
      i * 3,
    );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(
    g,
    new THREE.PointsMaterial({ color, size, sizeAttenuation: false }),
  );
  system.add(pts);
  return pts;
}
const belt = makeBelt(700, 15.3, 16.7, 0.35, 0x9a8f80, 1.6);
const kuiper = makeBelt(1600, 26, 32, 2.4, 0x7d8896, 1.2);

/* ---------- stars: drift runs on the GPU, nothing is rewritten per frame ---------- */
const BOX = new THREE.Vector3(110, 70, 90);
const N = 2200;
const sp = new Float32Array(N * 3);
const sc = new Float32Array(N * 3);
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
  sc.set([b, b, b], i * 3);
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
starGeo.setAttribute("aColor", new THREE.BufferAttribute(sc, 3));

const starMat = new THREE.ShaderMaterial({
  uniforms: {
    uOffset: { value: new THREE.Vector2() },
    uBox: { value: new THREE.Vector2(BOX.x, BOX.y) },
    uSize: { value: 1.8 * renderer.getPixelRatio() },
  },
  vertexShader: `
    attribute vec3 aColor;
    uniform vec2 uOffset;
    uniform vec2 uBox;
    uniform float uSize;
    varying vec3 vColor;
    void main() {
      vec3 p = position;
      p.xy = mod(p.xy + uOffset + uBox, 2.0 * uBox) - uBox;
      vColor = aColor;
      gl_PointSize = uSize;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: `
    varying vec3 vColor;
    void main() { gl_FragColor = vec4(vColor, 1.0); }`,
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
  const hx = s.sx + SHOOT_V.x * age,
    hy = s.sy + SHOOT_V.y * age;
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
  const w = innerWidth,
    h = innerHeight;
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
  const dx = target.x - current.x,
    dy = target.y - current.y;
  if (Math.abs(dx) + Math.abs(dy) > 1e-4) {
    current.x += dx * k;
    current.y += dy * k;
    camera.position.set(CAM.x + current.x * 3, CAM.y - current.y * 2, CAM.z);
    camera.lookAt(0, 0, 0);
  }

  for (const p of planets) {
    const a = t * p.v + p.offset;
    p.body.position.set(Math.cos(a) * p.r, 0, Math.sin(a) * p.r);
    p.mesh.rotation.y = t * p.spin;
    if (p.dust) p.dust.rotation.y = t * 0.12;
    if (p.moon) {
      const m = t * 2.2;
      p.moon.position.set(
        p.body.position.x + Math.cos(m) * 1.3,
        0.2,
        p.body.position.z + Math.sin(m) * 1.3,
      );
    }
  }
  sun.rotation.y = t * 0.15;
  belt.rotation.y = t * 0.03;
  kuiper.rotation.y = t * 0.01;
  for (const g of glows)
    g.sprite.material.opacity =
      g.base * (0.92 + 0.08 * Math.sin(t * 1.3 + g.phase));
  for (const s of shooters) updateShooter(s, t);
  starMat.uniforms.uOffset.value.set(DRIFT.x * t, DRIFT.y * t);

  renderer.render(scene, camera); // render first so world matrices are fresh for hover
  updateHover();
}
requestAnimationFrame(frame);
