const clock = document.getElementById("clock");
const date = document.getElementById("date");
const greeting = document.getElementById("greeting");

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: settings.tz,
  hour: "2-digit",
  minute: "2-digit",
});
const dateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: settings.tz,
  weekday: "long",
  day: "numeric",
  month: "long",
});
const hourFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: settings.tz,
  hour: "numeric",
  hourCycle: "h23",
});

function put(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function tick() {
  const now = new Date();
  put(clock, timeFmt.format(now));

  const p = Object.fromEntries(
    dateFmt.formatToParts(now).map((x) => [x.type, x.value]),
  );
  put(date, `${p.weekday}, ${p.day} ${p.month}`); // Monday, 12 August

  const h = Number(hourFmt.format(now));
  const part =
    h >= 5 && h < 12
      ? "morning"
      : h >= 12 && h < 17
        ? "afternoon"
        : h >= 17 && h < 21
          ? "evening"
          : "night";
  put(
    greeting,
    (settings.name
      ? `good ${part}, ${settings.name}`
      : `good ${part}`
    ).toLowerCase(),
  );
}
tick();
setInterval(tick, 1000);
