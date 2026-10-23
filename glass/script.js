const $ = (id) => document.getElementById(id);

const SETTINGS_KEY = "newtab-settings-v1";
const THEMES = ["catppuccin", "nord", "gruvbox", "everforest"];

const detectedTZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
})();

const validTZ = (tz) => {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

function loadSettings() {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {}
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  let tz = str(s.tz) || detectedTZ;
  if (!validTZ(tz)) tz = detectedTZ;
  return {
    tz,
    gh: str(s.gh).replace(/^@/, ""),
    token: str(s.token),
    theme: THEMES.includes(s.theme) ? s.theme : "catppuccin",
    bg: s.bg === "custom" || s.wp === "custom" ? "custom" : "glow",
    player: s.player === true,
    dim: Math.min(80, Math.max(0, Number(s.dim) || 0)),
  };
}
let settings = loadSettings();

const idb = (mode, fn) =>
  new Promise((res, rej) => {
    const o = indexedDB.open("newtab", 1);
    o.onupgradeneeded = () => o.result.createObjectStore("kv");
    o.onerror = () => rej(o.error);
    o.onsuccess = () => {
      const t = o.result.transaction("kv", mode);
      const r = fn(t.objectStore("kv"));
      t.oncomplete = () => res(r.result);
      t.onerror = () => rej(t.error);
    };
  });
const wpGet = () =>
  idb("readonly", (s) => s.get("wallpaper")).catch(() => null);
const wpSet = (b) => idb("readwrite", (s) => s.put(b, "wallpaper"));
const wpDel = () =>
  idb("readwrite", (s) => s.delete("wallpaper")).catch(() => {});

async function downscale(file, max = 1920, type = "image/jpeg") {
  if (file.type === "image/svg+xml") return file;
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, type, 0.85));
}

let wpUrl = "";
async function applyWallpaper() {
  const bg = $("bg");
  document.body.dataset.theme = settings.theme;
  document.body.dataset.wp = settings.bg;
  bg.style.setProperty("--dim", settings.dim / 100);
  if (wpUrl) URL.revokeObjectURL(wpUrl);
  wpUrl = "";
  bg.style.backgroundImage = "";
  if (settings.bg === "custom") {
    const b = await wpGet();
    if (b) {
      wpUrl = URL.createObjectURL(b);
      bg.style.backgroundImage = `url(${wpUrl})`;
    }
  }
}
applyWallpaper();

const DOCK_KEY = "newtab-dock-v1";
const MAX_DOCK = 12;
const DEFAULT_DOCK = [
  {
    id: "claude",
    name: "Claude",
    url: "https://claude.ai",
    icon: "icons/claude.png",
  },
  {
    id: "gemini",
    name: "Gemini",
    url: "https://gemini.google.com",
    icon: "icons/gemini.png",
  },
  {
    id: "github",
    name: "GitHub",
    url: "https://github.com",
    icon: "icons/github.png",
  },
  {
    id: "ostep",
    name: "OSTEP",
    url: "https://pages.cs.wisc.edu/~remzi/OSTEP/",
    icon: "icons/ostep.png",
  },
  {
    id: "nixos",
    name: "NixOS & Flakes",
    url: "https://nixos-and-flakes.thiscute.world/",
    icon: "icons/nixos.png",
  },
  { id: "x", name: "X", url: "https://x.com", icon: "icons/x.png" },
  {
    id: "youtube",
    name: "YouTube",
    url: "https://youtube.com",
    icon: "icons/youtube.png",
  },
];
const dockBlobGet = (id) =>
  idb("readonly", (s) => s.get(`dock:${id}`)).catch(() => null);
const dockBlobSet = (id, b) => idb("readwrite", (s) => s.put(b, `dock:${id}`));
const dockBlobDel = (id) =>
  idb("readwrite", (s) => s.delete(`dock:${id}`)).catch(() => {});

function loadDock() {
  try {
    const d = JSON.parse(localStorage.getItem(DOCK_KEY));
    if (
      Array.isArray(d) &&
      d.every((x) => x && typeof x.url === "string" && typeof x.id === "string")
    )
      return d.slice(0, MAX_DOCK);
  } catch {}
  return DEFAULT_DOCK.map((x) => ({ ...x }));
}
let dock = loadDock();
let dockUrls = [];

function fitDock() {
  const n = dock.length || 1;
  const small = innerWidth <= 560;
  const gap = small ? 6 : 10;
  const base = small ? 40 : 50;
  const room = innerWidth - 20 - (small ? 16 : 24);
  const icon = Math.max(
    30,
    Math.min(base, Math.floor((room - (n - 1) * gap) / n)),
  );
  document.documentElement.style.setProperty("--icon", `${icon}px`);
}

async function fillIcon(b, it) {
  const letter = () => {
    b.textContent = (it.name || "?").trim().charAt(0).toUpperCase();
  };
  if (!it.icon) return letter();
  const img = document.createElement("img");
  img.alt = "";
  img.addEventListener("error", letter);
  if (it.icon.startsWith("idb:")) {
    const blob = await dockBlobGet(it.icon.slice(4));
    if (!blob) return letter();
    const u = URL.createObjectURL(blob);
    dockUrls.push(u);
    img.src = u;
  } else {
    img.src = it.icon;
  }
  b.textContent = "";
  b.appendChild(img);
}

function renderDock() {
  const nav = $("dock");
  dockUrls.forEach((u) => URL.revokeObjectURL(u));
  dockUrls = [];
  nav.textContent = "";
  nav.hidden = !dock.length;
  for (const it of dock) {
    const a = document.createElement("a");
    a.href = it.url;
    a.title = it.name;
    const b = document.createElement("b");
    const em = document.createElement("em");
    em.textContent = it.name;
    a.append(b, em);
    nav.appendChild(a);
    fillIcon(b, it);
  }
  fitDock();
}
renderDock();
addEventListener("resize", fitDock);

function normalizeUrl(v) {
  v = v.trim();
  if (!v) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

function tick() {
  const d = new Date();
  const tz = settings.tz;
  $("time").textContent = d.toLocaleTimeString("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const date = d.toLocaleDateString("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const city = tz.split("/").pop().replace(/_/g, " ");
  $("date").textContent = `${date} · ${city}`;
}
tick();
setInterval(tick, 10000);

const ENGINE_KEY = "newtab-engines-v1";
const MAX_ENGINES = 8;
const DEFAULT_ENGINES = [
  { id: "google", name: "Google", url: "https://www.google.com/search?q=%s" },
  { id: "ddg", name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  {
    id: "nix",
    name: "NixPkgs",
    url: "https://search.nixos.org/packages?channel=unstable&query=%s",
  },
  {
    id: "github",
    name: "GitHub",
    url: "https://github.com/search?type=repositories&q=%s",
  },
  {
    id: "wiki",
    name: "Wikipedia",
    url: "https://en.wikipedia.org/w/index.php?search=%s",
  },
];

function loadEngines() {
  try {
    const d = JSON.parse(localStorage.getItem(ENGINE_KEY));
    if (
      Array.isArray(d) &&
      d.length &&
      d.every(
        (x) =>
          x &&
          typeof x.id === "string" &&
          typeof x.name === "string" &&
          typeof x.url === "string" &&
          x.url.includes("%s"),
      )
    )
      return d.slice(0, MAX_ENGINES);
  } catch {}
  return DEFAULT_ENGINES.map((x) => ({ ...x }));
}

let engines = loadEngines();
let engine = "";
try {
  engine = localStorage.getItem("engine") || "";
} catch {}

function movePill() {
  const b = document.querySelector("#engines button.on");
  const pill = $("pill");
  if (!b) return;
  pill.style.width = `${b.offsetWidth}px`;
  pill.style.height = `${b.offsetHeight}px`;
  pill.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`;
}

function setEngine(e, animate = true) {
  engine = e;
  document
    .querySelectorAll("#engines button")
    .forEach((b) => b.classList.toggle("on", b.dataset.e === e));
  movePill();
  const q = $("q");
  const hint = `Search ${engines.find((x) => x.id === e)?.name ?? ""}…`;
  if (animate) {
    q.classList.add("swap");
    setTimeout(() => {
      q.placeholder = hint;
      q.classList.remove("swap");
    }, 120);
  } else {
    q.placeholder = hint;
  }
  try {
    localStorage.setItem("engine", e);
  } catch {}
}

function renderEngines() {
  const box = $("engines");
  box.querySelectorAll("button").forEach((b) => b.remove());
  for (const e of engines) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.e = e.id;
    b.textContent = e.name;
    box.appendChild(b);
  }
  if (!engines.some((e) => e.id === engine)) engine = engines[0].id;
  setEngine(engine, false);
}

function saveEngines(ne) {
  engines = ne;
  try {
    localStorage.setItem(ENGINE_KEY, JSON.stringify(ne));
  } catch {}
  renderEngines();
}

renderEngines();
requestAnimationFrame(() =>
  requestAnimationFrame(() => $("pill").classList.add("ready")),
);
window.addEventListener("load", movePill);
window.addEventListener("resize", movePill);

$("engines").addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (b) {
    setEngine(b.dataset.e);
    $("q").focus();
  }
});

$("sf").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const q = $("q").value.trim();
  if (!q) return;
  const cur = engines.find((x) => x.id === engine) ?? engines[0];
  location.href = cur.url.split("%s").join(encodeURIComponent(q));
});

(() => {
  const dlg = $("settings");
  const f = {
    gh: $("set-gh"),
    token: $("set-token"),
    tz: $("set-tz"),
    theme: $("set-theme"),
    bg: $("set-bg"),
    dim: $("set-dim"),
    file: $("set-file"),
    player: $("set-player"),
  };
  let pending = null;

  let draft = [];
  const pend = new Map();
  const pendUrls = new Map();
  let prevUrls = [];
  let upTarget = null;
  const uid = () => Math.random().toString(36).slice(2, 9);
  const mk = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  };
  const rowsBox = $("dock-rows");

  async function iconSrc(it) {
    if (!it.icon) return "";
    if (!it.icon.startsWith("idb:")) return it.icon;
    const id = it.icon.slice(4);
    if (pendUrls.has(id)) return pendUrls.get(id);
    const b = await dockBlobGet(id);
    if (!b) return "";
    const u = URL.createObjectURL(b);
    prevUrls.push(u);
    return u;
  }

  function renderRows() {
    rowsBox.textContent = "";
    for (const it of draft) {
      const row = mk("div", "drow");
      row.dataset.id = it.id;

      const h = mk("span", "h", "⠿");
      h.title = "Drag to reorder";
      h.addEventListener("mousedown", () => (row.draggable = true));
      row.addEventListener("dragstart", (e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", it.id);
        row.classList.add("drag");
      });
      row.addEventListener("dragend", () => {
        row.classList.remove("drag");
        row.draggable = false;
        const byId = new Map(draft.map((x) => [x.id, x]));
        draft = [...rowsBox.children]
          .map((r) => byId.get(r.dataset.id))
          .filter(Boolean);
      });

      const ic = mk("button", "ic");
      ic.type = "button";
      ic.title = "Upload an icon";
      ic.textContent =
        (it.name || it.url || "+").trim().charAt(0).toUpperCase() || "+";
      ic.addEventListener("click", () => {
        upTarget = it.id;
        $("dock-file").click();
      });
      iconSrc(it).then((src) => {
        if (!src) return;
        const img = new Image();
        img.alt = "";
        img.onload = () => {
          ic.textContent = "";
          ic.appendChild(img);
        };
        img.src = src;
      });

      const fields = mk("div", "f");
      const n = mk("input");
      n.placeholder = "Name";
      n.value = it.name;
      n.addEventListener("input", () => (it.name = n.value));
      const u = mk("input");
      u.placeholder = "https://example.com";
      u.value = it.url;
      u.spellcheck = false;
      u.addEventListener("input", () => {
        it.url = u.value;
        u.setCustomValidity("");
      });
      fields.append(n, u);

      const acts = mk("div", "a");
      const move = (d) => {
        const i = draft.indexOf(it);
        const j2 = i + d;
        if (j2 < 0 || j2 >= draft.length) return;
        [draft[i], draft[j2]] = [draft[j2], draft[i]];
        renderRows();
      };
      const up = mk("button", null, "▲");
      const dn = mk("button", null, "▼");
      const rm = mk("button", null, "✕");
      for (const b of [up, dn, rm]) b.type = "button";
      up.title = "Move up";
      dn.title = "Move down";
      rm.title = "Remove";
      up.addEventListener("click", () => move(-1));
      dn.addEventListener("click", () => move(1));
      rm.addEventListener("click", () => {
        draft = draft.filter((x) => x !== it);
        pend.delete(it.id);
        renderRows();
      });
      acts.append(up, dn, rm);

      row.append(h, ic, fields, acts);
      rowsBox.appendChild(row);
    }
    $("dock-add").hidden = draft.length >= MAX_DOCK;
  }

  rowsBox.addEventListener("dragover", (e) => {
    const dragging = rowsBox.querySelector(".drag");
    if (!dragging) return;
    e.preventDefault();
    const after = [...rowsBox.querySelectorAll(".drow:not(.drag)")].find(
      (r) => {
        const b = r.getBoundingClientRect();
        return e.clientY < b.top + b.height / 2;
      },
    );
    if (after) rowsBox.insertBefore(dragging, after);
    else rowsBox.appendChild(dragging);
  });

  $("dock-add").addEventListener("click", () => {
    if (draft.length >= MAX_DOCK) return;
    draft.push({ id: uid(), name: "", url: "", icon: "" });
    renderRows();
    rowsBox.lastElementChild?.querySelector("input")?.focus();
  });

  $("dock-reset").addEventListener("click", () => {
    draft = DEFAULT_DOCK.map((x) => ({ ...x }));
    pend.clear();
    pendUrls.forEach((u) => URL.revokeObjectURL(u));
    pendUrls.clear();
    renderRows();
  });

  $("dock-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    const it = draft.find((x) => x.id === upTarget);
    if (!file || !it) return;
    try {
      const blob = await downscale(file, 128, "image/png");
      if (pendUrls.has(it.id)) URL.revokeObjectURL(pendUrls.get(it.id));
      pend.set(it.id, blob);
      pendUrls.set(it.id, URL.createObjectURL(blob));
      it.icon = `idb:${it.id}`;
      renderRows();
    } catch {
      $("dock-note").textContent = "Couldn’t read that image.";
    }
  });

  function collectDock() {
    const out = [];
    for (const it of draft) {
      if (!it.url.trim() && !it.name.trim()) continue;
      const url = normalizeUrl(it.url);
      if (!url) {
        const inp = rowsBox.querySelector(
          `.drow[data-id="${it.id}"] .f input:nth-child(2)`,
        );
        if (inp) {
          inp.setCustomValidity("Enter a valid http(s) address");
          inp.reportValidity();
        }
        return null;
      }
      const name =
        it.name.trim() || new URL(url).hostname.replace(/^www\./, "");
      out.push({ id: it.id, name, url, icon: it.icon || "" });
    }
    return out;
  }

  async function saveDock(nd) {
    const keep = new Set(
      nd.filter((x) => x.icon.startsWith("idb:")).map((x) => x.icon.slice(4)),
    );
    try {
      for (const [id, b] of pend) if (keep.has(id)) await dockBlobSet(id, b);
      for (const x of dock)
        if (x.icon.startsWith("idb:") && !keep.has(x.icon.slice(4)))
          await dockBlobDel(x.icon.slice(4));
      localStorage.setItem(DOCK_KEY, JSON.stringify(nd));
    } catch {}
    dock = nd;
    renderDock();
  }

  let edraft = [];
  const engBox = $("eng-rows");

  function renderEngRows() {
    engBox.textContent = "";
    for (const it of edraft) {
      const row = mk("div", "drow erow");
      row.dataset.id = it.id;
      const fields = mk("div", "f");
      const n = mk("input");
      n.placeholder = "Name";
      n.value = it.name;
      n.addEventListener("input", () => (it.name = n.value));
      const u = mk("input");
      u.placeholder = "https://example.com/search?q=%s";
      u.value = it.url;
      u.spellcheck = false;
      u.addEventListener("input", () => {
        it.url = u.value;
        u.setCustomValidity("");
      });
      fields.append(n, u);

      const acts = mk("div", "a");
      const move = (d) => {
        const i = edraft.indexOf(it);
        const k = i + d;
        if (k < 0 || k >= edraft.length) return;
        [edraft[i], edraft[k]] = [edraft[k], edraft[i]];
        renderEngRows();
      };
      const up = mk("button", null, "▲");
      const dn = mk("button", null, "▼");
      const rm = mk("button", null, "✕");
      for (const b of [up, dn, rm]) b.type = "button";
      up.title = "Move up";
      dn.title = "Move down";
      rm.title = "Remove";
      up.addEventListener("click", () => move(-1));
      dn.addEventListener("click", () => move(1));
      rm.addEventListener("click", () => {
        edraft = edraft.filter((x) => x !== it);
        renderEngRows();
      });
      acts.append(up, dn, rm);

      row.append(fields, acts);
      engBox.appendChild(row);
    }
    $("eng-add").hidden = edraft.length >= MAX_ENGINES;
  }

  $("eng-add").addEventListener("click", () => {
    if (edraft.length >= MAX_ENGINES) return;
    edraft.push({ id: uid(), name: "", url: "" });
    renderEngRows();
    engBox.lastElementChild?.querySelector("input")?.focus();
  });

  $("eng-reset").addEventListener("click", () => {
    edraft = DEFAULT_ENGINES.map((x) => ({ ...x }));
    renderEngRows();
  });

  function collectEngines() {
    const out = [];
    for (const it of edraft) {
      if (!it.url.trim() && !it.name.trim()) continue;
      let raw = it.url.trim();
      if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
      const probe = raw.includes("%s")
        ? normalizeUrl(raw.split("%s").join("x"))
        : null;
      if (!probe) {
        const inp = engBox.querySelector(
          `.drow[data-id="${it.id}"] .f input:nth-child(2)`,
        );
        if (inp) {
          inp.setCustomValidity("Use an http(s) address that contains %s");
          inp.reportValidity();
        }
        return null;
      }
      out.push({
        id: it.id,
        name: it.name.trim() || new URL(probe).hostname.replace(/^www\./, ""),
        url: raw,
      });
    }
    return out.length ? out : DEFAULT_ENGINES.map((x) => ({ ...x }));
  }

  dlg.addEventListener("close", () => {
    pendUrls.forEach((u) => URL.revokeObjectURL(u));
    pendUrls.clear();
    pend.clear();
    prevUrls.forEach((u) => URL.revokeObjectURL(u));
    prevUrls = [];
  });

  try {
    const list = $("tzlist");
    for (const z of Intl.supportedValuesOf("timeZone")) {
      const o = document.createElement("option");
      o.value = z;
      list.appendChild(o);
    }
  } catch {}

  const open = () => {
    f.gh.value = settings.gh;
    f.token.value = settings.token;
    f.tz.value = settings.tz;
    f.theme.value = settings.theme;
    f.bg.value = settings.bg;
    f.player.checked = settings.player;
    f.dim.value = settings.dim;
    f.file.value = "";
    pending = null;
    f.tz.setCustomValidity("");
    draft = dock.map((x) => ({ ...x }));
    renderRows();
    edraft = engines.map((x) => ({ ...x }));
    renderEngRows();
    dlg.showModal();
    f.gh.focus();
  };
  $("settings-btn").addEventListener("click", open);
  $("gh-open-settings").addEventListener("click", open);
  $("set-cancel").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
  f.tz.addEventListener("input", () => f.tz.setCustomValidity(""));

  f.dim.addEventListener("input", () =>
    $("bg").style.setProperty("--dim", f.dim.value / 100),
  );
  f.theme.addEventListener("change", () => {
    document.body.dataset.theme = f.theme.value;
  });
  dlg.addEventListener("close", () => {
    document.body.dataset.theme = settings.theme;
    $("bg").style.setProperty("--dim", settings.dim / 100);
  });

  f.file.addEventListener("change", async () => {
    const file = f.file.files[0];
    if (!file) return;
    try {
      pending = await downscale(file);
    } catch {
      $("file-note").textContent = "Couldn’t read that image.";
      return;
    }
    f.bg.value = "custom";
    if (Number(f.dim.value) === 0) f.dim.value = 25;
    $("file-note").textContent = `${file.name} is ready, press Save to apply.`;
  });

  $("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tz = f.tz.value.trim() || detectedTZ;
    if (!validTZ(tz)) {
      f.tz.setCustomValidity("Unknown timezone, e.g. Asia/Jakarta");
      f.tz.reportValidity();
      return;
    }
    if (f.bg.value === "custom" && !pending && !(await wpGet())) {
      $("file-note").textContent =
        "Choose an image first, or set the background to Theme glow.";
      return;
    }
    const nd = collectDock();
    if (!nd) return;
    const ne = collectEngines();
    if (!ne) return;
    try {
      if (pending) await wpSet(pending);
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          tz,
          gh: f.gh.value.trim().replace(/^@/, ""),
          token: f.token.value.trim(),
          theme: f.theme.value,
          bg: f.bg.value,
          player: f.player.checked,
          dim: Number(f.dim.value),
        }),
      );
    } catch {}
    await saveDock(nd);
    saveEngines(ne);
    settings = loadSettings();
    applyPlayer();
    dlg.close();
    tick();
    applyWallpaper();
    applyUser(true);
  });

  $("set-reset").addEventListener("click", async () => {
    try {
      localStorage.removeItem(SETTINGS_KEY);
    } catch {}
    await wpDel();
    for (const x of dock)
      if (x.icon.startsWith("idb:")) await dockBlobDel(x.icon.slice(4));
    try {
      localStorage.removeItem(DOCK_KEY);
    } catch {}
    dock = loadDock();
    renderDock();
    try {
      localStorage.removeItem(ENGINE_KEY);
    } catch {}
    engines = loadEngines();
    renderEngines();
    settings = loadSettings();
    applyPlayer();
    dlg.close();
    tick();
    applyWallpaper();
    applyUser(true);
  });
})();

const TTL = 60 * 60 * 1000;
let USER = "",
  TOKEN = "",
  KEY = "",
  runId = 0,
  prTab = "open",
  cur = null;
const nix = $("gh-nix");
const set = (id, v) => {
  $(id).textContent = v;
};

const api = (path) =>
  fetch(`https://api.github.com/${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  }).then((r) => r.json());

async function prs(state) {
  const q = `repo:NixOS/nixpkgs author:${USER} is:pr is:${state}`;
  const r = await api(
    `search/issues?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=5`,
  );
  if (typeof r.total_count !== "number") throw new Error("rate limited");
  return {
    total: r.total_count,
    items: r.items.map((i) => ({
      t: i.title,
      n: i.number,
      u: i.html_url,
      d:
        state === "merged"
          ? i.pull_request?.merged_at || i.closed_at
          : i.created_at,
    })),
  };
}

async function viaToken() {
  try {
    const r = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `query($l:String!){user(login:$l){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}}}`,
        variables: { l: USER },
      }),
    });
    if (r.status === 401) return { n: null, why: "token rejected" };
    const j = await r.json();
    const cal = j.data?.user?.contributionsCollection?.contributionCalendar;
    if (!cal) return { n: null, why: j.errors?.[0]?.message || "no data" };
    const days = cal.weeks
      .flatMap((w) => w.contributionDays)
      .map((d) => ({ d: d.date, c: d.contributionCount }));
    return { n: cal.totalContributions, days, why: "" };
  } catch {
    return { n: null, why: "request failed" };
  }
}

async function contributions() {
  let r;
  try {
    r = await fetch(
      `https://github.com/users/${encodeURIComponent(USER)}/contributions`,
    );
  } catch (e) {
    console.warn("[newtab] contributions fetch failed:", e);
    return {
      n: null,
      why: "request blocked, check the github.com host permission",
    };
  }
  if (!r.ok) return { n: null, why: `HTTP ${r.status}` };
  const html = await r.text();
  const cells = [
    ...html.matchAll(/<(?:td|rect)\b[^>]*\bdata-date="([^"]+)"[^>]*>/g),
  ].map((t) => ({
    d: t[1],
    l: Number((t[0].match(/data-level="(\d)"/) || [])[1] || 0),
  }));
  const m = html.match(/([\d,]+)\s+contributions?\s+in\s+the\s+last\s+year/i);
  if (m) return { n: Number(m[1].replace(/,/g, "")), days: cells, why: "" };
  let sum = 0,
    n = 0;
  for (const d of html.matchAll(/(\d+)\s+contributions?\s+on\s/gi)) {
    sum += Number(d[1]);
    n++;
  }
  if (n > 30) return { n: sum, days: cells, why: "" };
  return { n: null, why: "no count found in GitHub’s page" };
}

function heat(days) {
  const el = $("heat");
  el.textContent = "";
  if (!days?.length) return;
  days = [...days].sort((a, b) => (a.d < b.d ? -1 : 1));
  const max = Math.max(1, ...days.map((d) => d.c || 0));
  const cells = [
    ...Array(new Date(`${days[0].d}T00:00:00Z`).getUTCDay()).fill(null),
    ...days,
  ];
  el.style.gridTemplateColumns = `repeat(${Math.ceil(cells.length / 7)},1fr)`;
  for (const d of cells) {
    const i = document.createElement("i");
    if (d) {
      i.dataset.l = d.l ?? (d.c ? Math.min(4, Math.ceil((d.c / max) * 4)) : 0);
      i.title =
        d.c != null
          ? `${d.c} contribution${d.c === 1 ? "" : "s"} on ${d.d}`
          : d.d;
    } else i.className = "pad";
    el.appendChild(i);
  }
}

const ago = (iso) => {
  const d = (Date.now() - new Date(iso)) / 864e5;
  if (d < 1) return "today";
  if (d < 30) return `${Math.floor(d)}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: d > 365 ? "numeric" : undefined,
  });
};

function renderPRs() {
  if (!cur) return;
  document.querySelectorAll("#prtabs button").forEach((b) => {
    b.textContent = `${b.dataset.t} · ${cur.prs[b.dataset.t].total}`;
    b.classList.toggle("on", b.dataset.t === prTab);
  });
  const { total, items } = cur.prs[prTab];
  const list = $("prlist");
  list.textContent = "";
  if (!items.length) {
    const p = document.createElement("div");
    p.className = "none";
    p.textContent = `No ${prTab} pull requests.`;
    list.appendChild(p);
  }
  for (const p of items) {
    const a = document.createElement("a");
    a.href = p.u;
    a.className = `pr ${prTab}`;
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = p.t;
    t.title = p.t;
    const m = document.createElement("span");
    m.className = "m";
    m.textContent = `#${p.n} · ${ago(p.d)}`;
    a.append(t, m);
    list.appendChild(a);
  }
  const more = $("prmore");
  more.hidden = total <= items.length;
  more.textContent = `View all ${total} →`;
  more.href = `https://github.com/NixOS/nixpkgs/pulls?q=${encodeURIComponent(`is:pr author:${USER} is:${prTab}`)}`;
}
$("prtabs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) {
    prTab = b.dataset.t;
    renderPRs();
  }
});

function show(s) {
  cur = s;
  set("gh-commits", s.contribs.toLocaleString("en-US"));
  set(
    "gh-cap",
    s.src === "commits"
      ? `public commits, all time (profile count unavailable: ${s.why || "unknown"})`
      : "contributions in the last year",
  );
  heat(s.days);
  nix.hidden = s.prs.open.total + s.prs.merged.total === 0;
  if (!s.prs[prTab].total) prTab = s.prs.open.total ? "open" : "merged";
  renderPRs();
}

async function load(id) {
  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem(KEY));
  } catch {}
  if (cached) show(cached);
  if (cached && Date.now() - cached.at < TTL) return;
  try {
    const [year, open, merged] = await Promise.all([
      (async () => {
        const t = TOKEN ? await viaToken() : null;
        if (t && t.n != null) return t;
        const s = await contributions();
        return t && s.n == null ? t : s;
      })(),
      prs("open"),
      prs("merged"),
    ]);
    if (id !== runId) return;
    let n = year.n,
      src = "year";
    if (n == null) {
      n =
        (
          await api(
            `search/commits?q=${encodeURIComponent(`author:${USER}`)}&per_page=1`,
          )
        ).total_count ?? 0;
      src = "commits";
    }
    const stats = {
      at: src === "year" ? Date.now() : Date.now() - TTL + 2 * 60 * 1000, // retry soon if we only have the fallback
      contribs: n,
      src,
      why: year.why,
      days: year.days || [],
      prs: { open, merged },
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(stats));
    } catch {}
    show(stats);
  } catch {}
}

function applyUser(force) {
  USER = settings.gh;
  TOKEN = settings.token;
  KEY = `gh-stats-v5-${USER.toLowerCase()}-${TOKEN ? 1 : 0}`;
  if (force) {
    try {
      localStorage.removeItem(KEY);
    } catch {}
  }
  const id = ++runId;
  cur = null;
  nix.hidden = true;
  set("gh-commits", "—");
  $("heat").textContent = "";
  if (USER) {
    $("gh-body").hidden = false;
    $("gh-empty").hidden = true;
    set("gh-title", `github / ${USER}`);
    load(id);
  } else {
    $("gh-body").hidden = true;
    $("gh-empty").hidden = false;
    set("gh-title", "github");
  }
}
applyUser();

const ext = globalThis.browser ?? globalThis.chrome;
let port = null;
let retry = 0;
let playerGen = 0;

function showPlayer(m, err) {
  const el = $("player");
  if (!settings.player || (!err && !m?.active)) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const playing = !err && m.status === "Playing";
  el.classList.toggle("paused", !playing);
  $("disc").classList.toggle("on", playing);
  $("np-title").textContent = err
    ? "Now playing unavailable"
    : m.title || "Unknown track";
  $("np-artist").textContent = err
    ? "lumitab helper not found"
    : m.artist || m.player || "";
  el.title =
    err ||
    [m.title, m.artist, m.player && `(${m.player})`]
      .filter(Boolean)
      .join(" · ");
  const img = $("disc-art");
  const art = err ? "" : m.art || "";
  if (img.dataset.src !== art) {
    img.dataset.src = art;
    img.hidden = !art;
    if (art) img.src = art;
  }
}
$("disc-art").addEventListener("error", (e) => (e.target.hidden = true));

function connectPlayer(gen) {
  if (gen !== playerGen) return;
  try {
    const p = ext.runtime.connectNative("lumitab_player");
    port = p;
    p.onMessage.addListener((m) => gen === playerGen && showPlayer(m));
    p.onDisconnect.addListener(() => {
      if (gen !== playerGen) return;
      port = null;
      showPlayer(null, p.error?.message || "helper stopped");
      retry = setTimeout(() => connectPlayer(gen), 15000);
    });
  } catch (e) {
    showPlayer(null, String(e.message || e));
  }
}

function applyPlayer() {
  playerGen++;
  clearTimeout(retry);
  try {
    port?.disconnect();
  } catch {}
  port = null;
  showPlayer(null);
  if (settings.player && ext?.runtime?.connectNative) connectPlayer(playerGen);
}
applyPlayer();

(() => {
  const dock = $("dock");
  const getItems = () => [...dock.querySelectorAll("a")];
  const MAX = 1.75;
  const RANGE = 140;

  dock.addEventListener("mousemove", (e) => {
    const items = getItems();
    if (!items.length) return;
    // <a> boxes are never transformed, so they always give the resting layout
    const rects = items.map((a) => a.getBoundingClientRect());
    const base = rects[0].width;
    const scales = rects.map((r) => {
      const d = Math.min(
        Math.abs(e.clientX - (r.left + r.width / 2)) / RANGE,
        1,
      );
      return 1 + (MAX - 1) * 0.5 * (1 + Math.cos(Math.PI * d));
    });
    const extra = scales.map((s) => base * (s - 1));
    const total = extra.reduce((a, b) => a + b, 0);
    let run = 0;
    items.forEach((a, i) => {
      const tx = -total / 2 + run + extra[i] / 2;
      run += extra[i];
      a.style.setProperty("--s", scales[i].toFixed(3));
      a.style.setProperty("--tx", tx.toFixed(1));
    });
  });

  dock.addEventListener("mouseleave", () => {
    getItems().forEach((a) => {
      a.style.removeProperty("--s");
      a.style.removeProperty("--tx");
    });
  });
})();
