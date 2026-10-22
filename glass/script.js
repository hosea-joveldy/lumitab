const $ = (id) => document.getElementById(id);

/* ================= settings ================= */
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
    dim: Math.min(80, Math.max(0, Number(s.dim) || 0)),
  };
}
let settings = loadSettings();

/* ---- custom wallpaper: stored as a Blob in IndexedDB (localStorage is too small) ---- */
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

async function downscale(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
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

/* ================= clock ================= */
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

/* ================= search ================= */
const ENGINES = {
  google: { url: "https://www.google.com/search?q=", hint: "Search Google…" },
  ddg: { url: "https://duckduckgo.com/?q=", hint: "Search DuckDuckGo…" },
  nix: {
    url: "https://search.nixos.org/packages?channel=unstable&query=",
    hint: "Search nixpkgs (unstable)…",
  },
  github: {
    url: "https://github.com/search?type=repositories&q=",
    hint: "Search GitHub repositories…",
  },
  wiki: {
    url: "https://en.wikipedia.org/w/index.php?search=",
    hint: "Search Wikipedia…",
  },
};
let engine = "google";
try {
  const s = localStorage.getItem("engine");
  if (ENGINES[s]) engine = s;
} catch {}

function movePill(animate = true) {
  const b = document.querySelector("#engines button.on");
  const pill = $("pill");
  if (!b) return;
  pill.style.width = `${b.offsetWidth}px`;
  pill.style.height = `${b.offsetHeight}px`;
  pill.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`;
  if (!animate) return;
}

function setEngine(e, animate = true) {
  engine = e;
  document
    .querySelectorAll("#engines button")
    .forEach((b) => b.classList.toggle("on", b.dataset.e === e));
  movePill();
  const q = $("q");
  if (animate) {
    // fade the old placeholder out, swap the text, fade the new one in
    q.classList.add("swap");
    setTimeout(() => {
      q.placeholder = ENGINES[e].hint;
      q.classList.remove("swap");
    }, 120);
  } else {
    q.placeholder = ENGINES[e].hint;
  }
  try {
    localStorage.setItem("engine", e);
  } catch {}
}
setEngine(engine, false);
// enable the slide transition only after the first position is set (no slide-in on load)
requestAnimationFrame(() =>
  requestAnimationFrame(() => $("pill").classList.add("ready")),
);
// keep the pill aligned if fonts load late or the window resizes
window.addEventListener("load", () => movePill());
window.addEventListener("resize", () => movePill());

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
  if (q) location.href = ENGINES[engine].url + encodeURIComponent(q);
});

/* ================= settings modal ================= */
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
  };
  let pending = null;

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
    f.dim.value = settings.dim;
    f.file.value = "";
    pending = null;
    f.tz.setCustomValidity("");
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

  // live preview of dim and preset wallpapers; restored on close
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
          dim: Number(f.dim.value),
        }),
      );
    } catch {}
    settings = loadSettings();
    dlg.close();
    tick();
    applyWallpaper();
    applyUser(true); // live, no reload; forces a fresh fetch
  });

  $("set-reset").addEventListener("click", async () => {
    try {
      localStorage.removeItem(SETTINGS_KEY);
    } catch {}
    await wpDel();
    settings = loadSettings();
    dlg.close();
    tick();
    applyWallpaper();
    applyUser(true);
  });
})();

/* ================= GitHub + nixpkgs stats ================= */
const TTL = 60 * 60 * 1000; // refetch at most once per hour
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

// with a token: GraphQL, same numbers as your profile, including private contributions
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

// without a token: read the public profile fragment (public contributions only, unless cookies are sent)
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
        return t && s.n == null ? t : s; // report the token error if both failed
      })(),
      prs("open"),
      prs("merged"),
    ]);
    if (id !== runId) return; // settings changed while fetching
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

/* ================= icon fallback ================= */
document.querySelectorAll("#dock img").forEach((img) => {
  img.addEventListener("error", () => {
    img.replaceWith(
      document.createTextNode((img.alt || "?").trim().charAt(0).toUpperCase()),
    );
  });
});

/* ================= dock magnification (macOS style) ================= */
(() => {
  const dock = $("dock");
  const items = [...dock.querySelectorAll("a")];
  const MAX = 1.75; // peak scale under the cursor
  const RANGE = 140; // px of influence either side of the cursor

  dock.addEventListener("mousemove", (e) => {
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
    // spread icons apart so enlarged neighbours don't overlap
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
    items.forEach((a) => {
      a.style.removeProperty("--s");
      a.style.removeProperty("--tx");
    });
  });
})();
