const USER = "hosea-joveldy";
const KEY = "gh-stats-v3";
const TTL = 60 * 60 * 1000; // refetch at most once per hour

const search = async (path, q, extra = "") => {
  const r = await fetch(
    `https://api.github.com/search/${path}?q=${encodeURIComponent(q)}&per_page=1${extra}`,
  );
  return r.json();
};

// same number as "N contributions in the last year" on your profile
async function contributions() {
  try {
    const html = await fetch(
      `https://github.com/users/${USER}/contributions`,
    ).then((r) => r.text());
    const m = html.match(/([\d,]+)\s+contributions?\s+in\s+the\s+last\s+year/i);
    return m ? Number(m[1].replace(/,/g, "")) : null;
  } catch {
    return null;
  }
}

const set = (id, v) => {
  document.getElementById(id).textContent = v;
};
function show(s) {
  set("gh-contribs", s.contribs.toLocaleString("en-US"));
  set("gh-merged", s.merged);
  set("gh-open", s.open);
  set("gh-latest", s.latest ? `latest: ${s.latest}` : "");
}

async function load() {
  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem(KEY));
  } catch {}
  if (cached) show(cached);
  if (cached && Date.now() - cached.at < TTL) return;

  try {
    const [c, m, o, year] = await Promise.all([
      search("commits", `author:${USER}`),
      search(
        "issues",
        `repo:NixOS/nixpkgs author:${USER} is:pr is:merged`,
        "&sort=created&order=desc",
      ),
      search("issues", `repo:NixOS/nixpkgs author:${USER} is:pr is:open`),
      contributions(),
    ]);
    if ([m, o].some((x) => typeof x.total_count !== "number")) return; // rate-limited or error
    const stats = {
      at: Date.now(),
      contribs: year ?? c.total_count ?? 0, // fall back to the commit search
      merged: m.total_count,
      open: o.total_count,
      latest: m.items?.[0]?.title ?? "",
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(stats));
    } catch {}
    show(stats);
  } catch {}
}
load();
