const SETTINGS_KEY = "newtab-settings-v1";

const detectedTZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
})();

const settings = (() => {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {}
  const name = typeof s.name === "string" ? s.name.trim() : "";
  const gh = typeof s.gh === "string" ? s.gh.trim().replace(/^@/, "") : "";
  let tz = typeof s.tz === "string" && s.tz.trim() ? s.tz.trim() : detectedTZ;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
  } catch {
    tz = detectedTZ;
  }
  return { name, tz, gh };
})();

/* ---------- settings panel ---------- */
(() => {
  const btn = document.getElementById("settings-btn");
  const panel = document.getElementById("settings");
  const inName = document.getElementById("set-name");
  const inTz = document.getElementById("set-tz");
  const inGh = document.getElementById("set-gh");

  try {
    const list = document.getElementById("tzlist");
    for (const z of Intl.supportedValuesOf("timeZone")) {
      const o = document.createElement("option");
      o.value = z;
      list.appendChild(o);
    }
  } catch {}

  const open = (on) => {
    panel.hidden = !on;
    btn.setAttribute("aria-expanded", String(on));
    if (on) {
      inName.value = settings.name;
      inTz.value = settings.tz;
      inGh.value = settings.gh;
      inName.focus();
    }
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    open(panel.hidden);
  });
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target))
      open(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) {
      open(false);
      btn.focus();
    }
  });

  panel.addEventListener("submit", (e) => {
    e.preventDefault();
    let tz = inTz.value.trim() || detectedTZ;
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    } catch {
      inTz.setCustomValidity("unknown timezone, e.g. Asia/Jakarta");
      inTz.reportValidity();
      return;
    }
    inTz.setCustomValidity("");
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          name: inName.value.trim(),
          tz,
          gh: inGh.value.trim().replace(/^@/, ""),
        }),
      );
    } catch {}
    location.reload();
  });
  inTz.addEventListener("input", () => inTz.setCustomValidity(""));

  document.getElementById("set-reset").addEventListener("click", () => {
    try {
      localStorage.removeItem(SETTINGS_KEY);
    } catch {}
    location.reload();
  });
})();
