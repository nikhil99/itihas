// Itihas — timeline viewer. Plain ES module, no build step.
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "html") n.innerHTML = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid);
  return n;
};
const SVGNS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  return n;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TYPE_ICON = { person: "●", place: "▲", polity: "■", concept: "◆" };
const TYPE_LABEL = { person: "Person", place: "Place", polity: "Empire / State", concept: "Concept" };

// ---------- Dates ----------
function parseDate(s) {
  // "1630", "1630-02", "1630-02-19" -> { y, m, d, precision, t (fractional year) }
  const str = String(s), bce = str.startsWith("-");
  const [yy, m, d] = (bce ? str.slice(1) : str).split("-").map(Number);
  const y = bce ? -yy : yy;
  const precision = d ? "day" : m ? "month" : "year";
  const t = y + ((m || 1) - 1) / 12 + ((d || 1) - 1) / 365 + (precision === "year" ? 0.5 : precision === "month" ? 1 / 24 : 0);
  return { y, m, d, precision, t };
}
function fmtDate(s, approx) {
  if (!s) return "";
  const p = parseDate(s);
  const yr = p.y < 0 ? `${-p.y} BCE` : `${p.y}`;
  const txt = p.precision === "day" ? `${p.d} ${MONTHS[p.m - 1]} ${yr}` : p.precision === "month" ? `${MONTHS[p.m - 1]} ${yr}` : yr;
  return (approx ? "c. " : "") + txt;
}
function fmtRange(ev) {
  if (!ev.end) return fmtDate(ev.date, ev.approx);
  const a = parseDate(ev.date), b = parseDate(ev.end);
  if (a.y === b.y && a.precision !== "year" && b.precision !== "year") {
    if (a.m === b.m && a.d && b.d) return `${a.d}–${b.d} ${MONTHS[a.m - 1]} ${a.y}`;
    return `${fmtDate(ev.date).replace(` ${a.y}`, "")} – ${fmtDate(ev.end)}`;
  }
  return `${fmtDate(ev.date, ev.approx)} – ${fmtDate(ev.end)}`;
}
const entStart = (e) => e.dates?.born?.value || e.dates?.founded?.value || e.dates?.start?.value;
const entEnd = (e) => e.dates?.died?.value || e.dates?.dissolved?.value || e.dates?.end?.value;

// ---------- Data ----------
const cache = {};
async function load(path) {
  if (!cache[path]) cache[path] = fetch(path, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(path); return r.json(); });
  return cache[path];
}
// For extras the page can live without: never let them break the main view.
async function loadOptional(path, fallback) {
  try { return await load(path); }
  catch (err) { console.warn("optional data unavailable:", path, err); delete cache[path]; return fallback; }
}

function loadExpanded() {
  try { return { ctx: false, lanes: false, events: false, ...JSON.parse(localStorage.getItem("itihas.expanded") || "{}") }; }
  catch { return { ctx: false, lanes: false, events: false }; }
}
function saveExpanded() {
  try { localStorage.setItem("itihas.expanded", JSON.stringify(state.expanded)); } catch {}
}

const state = {
  expanded: loadExpanded(),
  tl: null, entities: null, view: null, lanesOn: new Set(), selected: null, map: null, markers: {}, renderTimeline: null,
};

// ---------- Routing ----------
// #/                      home
// #/<timeline>            timeline
// #/<timeline>/e/<id>     timeline + entity drawer
// #/<timeline>/ev/<id>    timeline + selected event
function showError(err) {
  console.error(err);
  const box = el("div", { class: "load-error" }, `Something went wrong loading this page (${err.message}). Try reloading.`);
  $("#app").prepend(box);
}

async function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  // Old ids of merged or renamed timelines (index "aliases") redirect to the current one.
  if (parts.length) {
    const alias = Object.fromEntries((await loadOptional("data/index.json", [])).flatMap((t) => (t.aliases || []).map((a) => [a, t.id])));
    const fixed = parts[0] === "compare"
      ? [parts[0], ...(parts[1] ? [parts[1].split(",").map((i) => alias[i] || i).join(",")] : []), ...parts.slice(2)]
      : [alias[parts[0]] || parts[0], ...parts.slice(1)];
    if (fixed.join("/") !== parts.join("/")) {
      history.replaceState(null, "", `#/${fixed.join("/")}`);
      parts.splice(0, parts.length, ...fixed);
    }
  }
  let tlId, kind, id;
  if (parts[0] === "compare") {
    // a bare "#/compare" has no list part; a list part never contains "e"/"ev" alone
    const list = parts[1] && !["e", "ev"].includes(parts[1]) ? parts[1] : "";
    tlId = `compare/${list}`;
    [kind, id] = parts.slice(list ? 2 : 1);
  } else [tlId, kind, id] = parts;
  if (!tlId) { closeDrawer(false); return renderHome(); }
  if (state.tl?.id !== tlId) { await renderTimelinePage(tlId); window.scrollTo(0, 0); }
  if (kind === "e" && id) openEntity(id);
  else closeDrawer(false);
  if (kind === "ev" && id) selectEvent(id, { scroll: true });
}
const go = (hash) => { if (location.hash !== hash) location.hash = hash; else route(); };

// ---------- Home ----------
async function renderHome() {
  state.tl = null;
  const [index, entities, search] = await Promise.all([load("data/index.json"), load("data/entities.json"),
    loadOptional("data/search.json", { entities: [], events: [] })]);
  state.entities = entities;
  state.subjectTimeline = Object.fromEntries(index.map((t) => [t.subject, t.id]));
  document.title = "Itihas — Indian History Timelines";
  // Placeholders for planned timelines; any that now exist drop out automatically.
  const norm = (t) => t.toLowerCase().replace(/^the\s+/, "").replace(/\s+empire$/, "");
  const existing = new Set(index.map((t) => norm(t.title)));
  const upcoming = ["Delhi Sultanate", "Vijayanagara", "The Deccan Sultanates", "The Maurya Empire", "The Cholas"]
    .filter((u) => !existing.has(norm(u)));
  const card = (t) => {
    const subj = entities[t.subject];
    return el("a", { class: `tl-card${t.kind === "empire" ? " overview" : ""}`, href: `#/${t.id}` },
      subj?.thumb && el("img", { src: subj.thumb, alt: "" }),
      el("div", {}, el("h3", {}, t.title), el("p", {}, t.subtitle), el("p", {}, `${t.events} events`)));
  };
  const empires = index.filter((t) => t.kind === "empire").sort((a, b) => a.order - b.order);
  const series = [...new Set(index.filter((t) => t.kind !== "empire").map((t) => t.series || "Other"))];
  const uniqueEvents = new Set(search.events.map((e) => `${e.d}|${e.t}`)).size;

  // Header: portraits, title, search, stats
  const portraits = index.filter((t) => entities[t.subject]?.type === "person" && entities[t.subject]?.thumb).slice(0, 9);
  const searchBox = el("div", { class: "search" });
  const riverBox = el("div", { class: "river" });
  $("#app").replaceChildren(
    el("section", { class: "home" },
      el("header", { class: "home-hero" },
        el("div", { class: "portraits" }, portraits.map((t) =>
          el("a", { href: `#/${t.id}`, title: t.title }, el("img", { src: entities[t.subject].thumb, alt: t.title })))),
        el("div", { class: "hero-dev", "aria-hidden": "true" }, "इतिहास"),
        el("h1", {}, "Indian history, as timelines"),
        el("p", { class: "lead" }, "Explore people, empires and places on interactive timelines. Every name is a link; summaries and portraits come from Wikipedia."),
        searchBox,
        el("p", { class: "stats" },
          el("b", {}, index.length), " timelines · ", el("b", {}, search.entities.length), " people, places & powers · ",
          el("b", {}, uniqueEvents), " events")),
      el("section", { class: "home-block" },
        el("div", { class: "block-head" }, el("h2", {}, "All of it, at a glance"),
          el("span", { class: "block-hint" }, "Hover to see which empires coexisted · click to open · drag or ⌘/Ctrl+scroll to move and zoom")),
        riverBox),
      el("div", { class: "home-two" },
        el("section", { class: "home-block" }, onThisDay(search, index)),
        el("section", { class: "home-block" }, featuredComparisons(index, entities))),
      empires.length ? el("div", { class: "series" },
        el("h2", { class: "series-title" }, "Empires"),
        el("div", { class: "cards" }, empires.map(card))) : null,
      series.map((name) => el("div", { class: "series" },
        el("h2", { class: "series-title" }, name === "Other" ? "Other timelines"
          : index.some((t) => t.series === name && t.kind === "state") ? `${name.replace(/^The /, "")} — the great houses` : `People of ${name.replace(/^The /, "the ")}`),
        el("div", { class: "cards" }, index.filter((t) => t.kind !== "empire" && (t.series || "Other") === name).map(card)))),
      upcoming.length ? el("div", { class: "series" },
        el("h2", { class: "series-title" }, "Coming later"),
        el("div", { class: "cards" }, upcoming.map((u) => el("div", { class: "tl-card soon" }, el("div", {}, el("h3", {}, u), el("p", {}, "Not started yet")))))) : null,
    ),
  );
  setupSearch(searchBox, search, index);
  setupRiver(riverBox, index, entities);
}

// ---------- Home: search ----------
const fold = (t) => String(t || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function setupSearch(box, search, index) {
  const tlTitle = Object.fromEntries(index.map((t) => [t.id, t.title]));
  const subjectTl = Object.fromEntries(index.map((t) => [t.subject, t.id]));
  const items = [];
  const entById = Object.fromEntries(search.entities.map((e) => [e.id, e]));
  for (const t of index) {
    const subj = entById[t.subject]; // a timeline is also found by its subject's other names, incl. Marathi
    items.push({ kind: "Timeline", label: t.title, sub: t.subtitle, href: `#/${t.id}`, boost: 0.6,
      keys: [t.title, subj?.n, ...(subj?.al || []), subj?.mr] });
  }
  for (const e of search.entities) {
    if (subjectTl[e.id]) continue; // its timeline is already listed
    items.push({ kind: TYPE_LABEL[e.t] || "Entry", label: e.n, sub: [e.d, e.mr].filter(Boolean).join(" · "), thumb: e.th,
      href: `#/${e.tl[0]}/e/${e.id}`, keys: [e.n, ...(e.al || []), e.mr], boost: 0.3 });
  }
  const seen = new Set();
  for (const ev of search.events) {
    const k = `${ev.d}|${ev.t}`;
    if (seen.has(k)) continue;
    seen.add(k);
    items.push({ kind: "Event", label: ev.t, sub: `${fmtDate(ev.d, ev.a)} · ${tlTitle[ev.tl]}`, href: `#/${ev.tl}/ev/${ev.id}`, keys: [ev.t], boost: ev.m ? 0.2 : 0 });
  }
  items.forEach((it) => (it.folded = it.keys.filter(Boolean).map(fold)));

  const input = el("input", { type: "search", class: "search-input", placeholder: "Search people, places, empires, battles…  ( / )",
    "aria-label": "Search", autocomplete: "off", role: "combobox", "aria-expanded": "false", "aria-controls": "search-results" });
  const list = el("ul", { class: "search-results", id: "search-results", role: "listbox", hidden: true });
  box.replaceChildren(input, list);
  let results = [], active = -1;

  const score = (it, q) => {
    let best = 0;
    for (const k of it.folded) {
      if (k === q) best = Math.max(best, 4);
      else if (k.startsWith(q)) best = Math.max(best, 3);
      else if (k.includes(" " + q) || k.includes("-" + q)) best = Math.max(best, 2);
      else if (k.includes(q)) best = Math.max(best, 1);
    }
    return best ? best + it.boost : 0;
  };
  const show = () => {
    list.replaceChildren(...results.map((it, i) => el("li", { role: "option", class: i === active ? "active" : null, "aria-selected": i === active ? "true" : "false",
      onmousedown: (e) => { e.preventDefault(); open(i); } },
      it.thumb ? el("img", { src: it.thumb, alt: "" }) : el("span", { class: "sr-icon" }, it.kind === "Event" ? "◆" : it.kind === "Timeline" ? "◷" : "●"),
      el("div", {}, el("div", { class: "sr-label" }, it.label), it.sub && el("div", { class: "sr-sub" }, it.sub)),
      el("span", { class: "sr-kind" }, it.kind))));
    const q = input.value.trim();
    if (q && !results.length) list.replaceChildren(el("li", { class: "sr-empty" }, `No matches for “${q}”`));
    list.hidden = !q;
    input.setAttribute("aria-expanded", String(!list.hidden));
  };
  const open = (i) => { const it = results[i]; if (!it) return; input.value = ""; results = []; show(); go(it.href); };
  input.addEventListener("input", () => {
    const q = fold(input.value.trim());
    results = q.length < 2 ? [] : items.map((it) => [score(it, q), it]).filter(([sc]) => sc > 0)
      .sort((a, b) => b[0] - a[0] || a[1].label.length - b[1].label.length).slice(0, 10).map(([, it]) => it);
    active = results.length ? 0 : -1;
    show();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(results.length - 1, active + 1); show(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); show(); }
    else if (e.key === "Enter") { e.preventDefault(); open(active); }
    else if (e.key === "Escape") { input.value = ""; results = []; show(); input.blur(); }
  });
  input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; input.setAttribute("aria-expanded", "false"); }, 120));
  input.addEventListener("focus", () => { if (input.value.trim()) show(); });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) {
    const input = $(".search-input");
    if (input) { e.preventDefault(); input.focus(); }
  }
});

// ---------- Home: on this day ----------
function onThisDay(search, index) {
  const tlTitle = Object.fromEntries(index.map((t) => [t.id, t.title]));
  const dated = [], seen = new Set();
  for (const ev of search.events) {
    // same exact date in two timelines is (in practice) the same event under another title
    if (ev.a || !/^\d{3,4}-\d{2}-\d{2}$/.test(ev.d) || seen.has(ev.d)) continue;
    seen.add(ev.d);
    dated.push(ev);
  }
  const today = new Date();
  const mdOf = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const byPriority = (a, b) => (b.m ? 1 : 0) - (a.m ? 1 : 0) || a.d.localeCompare(b.d);
  const todays = dated.filter((ev) => ev.d.slice(-5) === mdOf(today)).sort(byPriority).slice(0, 4);
  // then the next dated events in the calendar, up to six items in all
  const upcoming = [];
  for (let k = 1; k <= 45 && todays.length + upcoming.length < 6; k++) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + k);
    for (const ev of dated.filter((e) => e.d.slice(-5) === mdOf(day)).sort(byPriority)) {
      if (todays.length + upcoming.length < 6) upcoming.push({ ev, day });
    }
  }
  const row = (ev, day) => {
    const y = +ev.d.slice(0, 4);
    return el("li", {},
      el("a", { href: `#/${ev.tl}/ev/${ev.id}` },
        el("span", { class: "otd-year" }, y),
        el("span", {}, el("span", { class: "otd-title" }, ev.t),
          el("span", { class: "otd-meta" }, `${day ? `${day.getDate()} ${MONTHS[day.getMonth()]} · ` : ""}${today.getFullYear() - y} years ago · ${tlTitle[ev.tl]}`))));
  };
  return el("div", { class: "otd" },
    el("div", { class: "block-head" }, el("h2", {}, "On this day"), el("span", { class: "otd-date" }, `${today.getDate()} ${MONTHS[today.getMonth()]}`)),
    todays.length ? el("ul", { class: "otd-list" }, todays.map((ev) => row(ev))) : el("p", { class: "block-hint" }, "Nothing on today's date yet."),
    upcoming.length ? el("h3", { class: "otd-sub" }, "Coming up") : null,
    upcoming.length ? el("ul", { class: "otd-list" }, upcoming.map(({ ev, day }) => row(ev, day))) : null);
}

// ---------- Home: featured comparisons ----------
const FEATURED = [
  { ids: ["shivaji", "mughal-empire"], title: "Shivaji and the Mughals", blurb: "A rebel kingdom against the empire at its height." },
  { ids: ["maratha-empire", "mughal-empire"], title: "Marathas & Mughals", blurb: "Two empires, 144 years side by side." },
  { ids: ["yadavas-devagiri", "vijayanagara-empire", "mughal-empire"], title: "Before the Marathas", blurb: "Three powers that shaped the Deccan." },
  { ids: ["bajirao-i", "nanasaheb", "madhavrao-i"], title: "Three Peshwas", blurb: "Father, son and grandson at the head of the state." },
  { ids: ["ahilyabai-holkar", "mahadji-shinde"], title: "Ahilyabai & Mahadji", blurb: "The queen of Malwa and the master of Delhi." },
  { ids: ["shinde-gwalior", "holkar-indore", "gaekwad-baroda"], title: "Shinde, Holkar & Gaekwad", blurb: "The great houses of the confederacy." },
];
function featuredComparisons(index, ents) {
  const byId = Object.fromEntries(index.map((t) => [t.id, t]));
  const yr = (v) => (v < 0 ? `${Math.round(-v)} BCE` : Math.floor(v));
  const cards = FEATURED.filter((f) => f.ids.every((i) => byId[i])).map((f) => {
    const spans = f.ids.map((i) => byId[i].span || byId[i].range);
    const from = Math.max(...spans.map((sp) => sp[0])), to = Math.min(...spans.map((sp) => sp[1]));
    const overlap = to > from ? `All overlap ${yr(from)}–${yr(to)}` : `${yr(Math.min(...spans.map((sp) => sp[0])))}–${yr(Math.max(...spans.map((sp) => sp[1])))}`;
    return el("a", { class: "feat", href: `#/compare/${f.ids.join(",")}` },
      el("div", { class: "feat-faces" }, f.ids.map((i, k) => {
        const th = ents[byId[i].subject]?.thumb;
        return th ? el("img", { src: th, alt: "", style: `--k:${k}` }) : el("span", { class: "feat-blank", style: `--k:${k}` });
      })),
      el("div", {}, el("div", { class: "feat-title" }, f.title), el("div", { class: "feat-blurb" }, f.blurb),
        el("div", { class: "feat-meta" }, overlap)));
  });
  return el("div", {},
    el("div", { class: "block-head" }, el("h2", {}, "Compare"), el("a", { class: "block-link", href: "#/compare" }, "Build your own →")),
    el("div", { class: "feat-grid" }, cards));
}

// ---------- Home: river of time ----------
// Every empire on one axis, packed into rows (Maratha states and people are left out to keep it
// uncluttered; they are reached from the empire timelines and the cards below). Hovering one highlights everything
// that overlapped it in time. Indian powers are drawn in warm saffron–red shades, powers of
// foreign origin (content: "origin": "foreign") in cool blue–violet ones.
const ORIGIN_HUES = { indian: [24, 44, 8, 34, 54, 0], foreign: [222, 262, 196, 285] };
function setupRiver(box, index, ents) {
  const GROUPS = [
    { label: "Empires", h: 26, pick: (t) => t.kind === "empire" },
  ];
  const items = [];
  GROUPS.forEach((g, gi) => {
    const rows = [], used = { indian: 0, foreign: 0 };
    index.filter(g.pick).map((t) => ({ t, a: (t.span || t.range)[0], b: (t.span || t.range)[1] }))
      .sort((p, q) => p.a - q.a).forEach((it) => {
        let r = rows.findIndex((end) => it.a > end + 2);
        if (r === -1) { r = rows.length; rows.push(0); }
        rows[r] = it.b;
        const o = it.t.origin === "foreign" ? "foreign" : "indian", pal = ORIGIN_HUES[o];
        const hue = pal[used[o]++ % pal.length];
        items.push({ ...it, g: gi, row: r, hue });
      });
    g.rows = rows.length;
  });
  const lo = Math.min(...items.map((i) => i.a)), hi = Math.max(...items.map((i) => i.b));
  const home = { start: Math.floor(lo - 15), end: Math.ceil(hi + 15) };
  let view = { ...home }, hover = null;
  const tip = $("#tooltip");
  const yr = (v) => (v < 0 ? `${Math.round(-v)} BCE` : Math.floor(v));

  function render() {
    const W = box.clientWidth || 800, GUT = W < 600 ? 74 : 112, PAD = 12, AX = 26;
    const span = view.end - view.start, x = (t) => GUT + ((t - view.start) / span) * (W - GUT - PAD);
    let y = AX + 6;
    const gTop = GROUPS.map((g) => { const top = y; y += g.rows * (g.h + 5) + 14; return top; });
    const H = y;
    const svgEl = svg("svg", { viewBox: `0 0 ${W} ${H}`, height: H, class: hover ? "hl" : null });
    const pxPerYear = (W - GUT - PAD) / span;
    const step = [5, 10, 25, 50, 100, 200].find((st) => st * pxPerYear >= 50) || 200;
    for (let v = Math.ceil(view.start / step) * step; v <= view.end; v += step) {
      const gx = x(v);
      if (gx < GUT) continue;
      svgEl.append(svg("line", { class: "grid", x1: gx, x2: gx, y1: AX - 4, y2: H }));
      const t = svg("text", { class: "axis-label", x: gx, y: AX - 10, "text-anchor": "middle" });
      t.textContent = v;
      svgEl.append(t);
    }
    if (hover) for (const v of [hover.a, hover.b]) svgEl.append(svg("line", { class: "river-guide", x1: x(v), x2: x(v), y1: AX - 4, y2: H }));
    for (const it of items) {
      const g = GROUPS[it.g], top = gTop[it.g] + it.row * (g.h + 5);
      const x1 = Math.max(GUT, x(it.a)), x2 = Math.min(W - PAD, x(it.b));
      if (x2 <= GUT || x1 >= W - PAD) continue;
      const co = hover && it.a < hover.b && it.b > hover.a;
      const n = svg("g", { class: `ri${co ? " co" : ""}${hover === it ? " me" : ""}`, tabindex: 0, role: "link", "aria-label": it.t.title });
      n.append(svg("rect", { x: x1, y: top, width: Math.max(3, x2 - x1), height: g.h, rx: g.h / 2.6, fill: `hsl(${it.hue} 58% 46%)` }));
      const label = fitText(shortTitle(it.t), x2 - x1 - 10, `600 ${it.g === 0 ? 12 : 11}px Inter, system-ui, sans-serif`);
      if (label.length > 2) {
        const t = svg("text", { class: "ri-text", x: x1 + 6, y: top + g.h / 2 + 4, "font-size": it.g === 0 ? 12 : 11 });
        t.textContent = label;
        n.append(t);
      }
      n.addEventListener("mouseenter", () => { hover = it; render(); });
      n.addEventListener("mousemove", (e) => {
        const others = items.filter((o) => o !== it && o.a < it.b && o.b > it.a).length;
        tip.innerHTML = `<b>${esc(it.t.title)}</b><div class="tt-date">${yr(it.a)} – ${yr(it.b)} · ${esc(it.t.subtitle || "")}</div>` +
          `<div class="tt-date">${others} other timeline${others === 1 ? "" : "s"} overlap · click to open</div>`;
        tip.classList.add("show");
        const r = tip.getBoundingClientRect();
        tip.style.left = Math.min(window.innerWidth - r.width - 8, e.clientX + 14) + "px";
        tip.style.top = Math.max(8, e.clientY - r.height - 10) + "px";
      });
      n.addEventListener("mouseleave", () => { hover = null; tip.classList.remove("show"); render(); });
      n.addEventListener("click", () => { tip.classList.remove("show"); go(`#/${it.t.id}`); });
      n.addEventListener("keydown", (e) => { if (e.key === "Enter") go(`#/${it.t.id}`); });
      svgEl.append(n);
    }
    svgEl.append(svg("rect", { class: "gutter", x: 0, y: 0, width: GUT - 4, height: H }));
    GROUPS.forEach((g, gi) => {
      const t = svg("text", { class: "section-label", x: 10, y: gTop[gi] + g.h / 2 + 4 });
      t.textContent = W < 600 ? g.label.split(" ").pop() : g.label;
      svgEl.append(t);
    });
    box.replaceChildren(svgEl, controls, legend);
  }
  const zoom = (f, frac = 0.5) => {
    const sp = Math.min(home.end - home.start + 200, Math.max(20, (view.end - view.start) * f));
    const pivot = view.start + (view.end - view.start) * frac;
    view = { start: pivot - sp * frac, end: pivot + sp * (1 - frac) };
    render();
  };
  const swatches = (o) => el("span", { class: "sw-set" }, ORIGIN_HUES[o].slice(0, 4).map((h) => el("i", { style: `background:hsl(${h} 58% 46%)` })));
  const legend = el("div", { class: "river-legend" },
    el("span", {}, swatches("indian"), "Indian powers"),
    el("span", {}, swatches("foreign"), "Powers of foreign origin (Delhi Sultanate, Mughals, British)"));
  const controls = el("div", { class: "river-controls" },
    el("button", { class: "zoom-btn", title: "Zoom in", onclick: () => zoom(0.6) }, "+"),
    el("button", { class: "zoom-btn", title: "Zoom out", onclick: () => zoom(1 / 0.6) }, "−"),
    el("button", { class: "zoom-btn wide", onclick: () => { view = { ...home }; render(); } }, "Reset"));
  let drag = null;
  box.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".river-controls")) return;
    drag = { x: e.clientX, view: { ...view }, moved: false };
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 3) drag.moved = true;
    if (!drag.moved) return;
    const per = (drag.view.end - drag.view.start) / (box.clientWidth - 120);
    view = { start: drag.view.start - dx * per, end: drag.view.end - dx * per };
    render();
  });
  window.addEventListener("pointerup", () => { if (drag?.moved) box.addEventListener("click", (e) => e.stopPropagation(), { capture: true, once: true }); drag = null; });
  box.addEventListener("wheel", (e) => {
    const r = box.getBoundingClientRect(), frac = Math.min(1, Math.max(0, (e.clientX - r.left - 112) / (r.width - 124)));
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.01), frac); }
    else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      const d = (e.deltaX / box.clientWidth) * (view.end - view.start);
      view = { start: view.start + d, end: view.end + d };
      render();
    }
  }, { passive: false });
  new ResizeObserver(() => render()).observe(box);
  render();
}

// ---------- Timeline page ----------
async function renderTimelinePage(id) {
  const [entities, index] = await Promise.all([load("data/entities.json"), load("data/index.json")]);
  const tl = id.startsWith("compare/") ? await buildCompare(id.slice(8), index, entities) : await load(`data/timelines/${id}.json`);
  if (tl.compare && tl.id !== id) history.replaceState(null, "", `#/${tl.id}`); // dropped unknown ids
  state.subjectTimeline = Object.fromEntries(index.filter((t) => t.id !== tl.id).map((t) => [t.subject, t.id]));
  state.tl = tl;
  state.entities = entities;
  state.selected = null;
  state.view = { start: tl.range[0], end: tl.range[1] };
  state.lanesOn = new Set(tl.lanes.map((l) => l.id));
  tl.events.forEach((ev) => { ev._t = parseDate(ev.date).t; ev._te = ev.end ? parseDate(ev.end).t : null; });
  document.title = `${tl.title} — Itihas`;

  const subj = entities[tl.subject];
  const hero = tl.compare ? compareHero(tl, index, entities) : el("section", { class: "hero" },
    subj.thumb ? el("img", { src: subj.thumb, alt: subj.title }) : el("div"),
    el("div", {},
      el("h1", {}, tl.title),
      subj.labels?.mr && el("div", { class: "dev" }, subj.labels.mr),
      el("p", { class: "sub" }, tl.subtitle),
      (() => { const p = linked("p", "extract", tl.intro || subj.extract, [], { skip: tl.subject }); p.append(" ", el("a", { href: `#/${tl.id}/e/${tl.subject}` }, "More →")); return p; })(),
      el("a", { class: "compare-btn", href: `#/compare/${tl.id}` }, "⇆ Compare with other timelines"),
      askAI({ subject: subj.title, type: subj.type, context: timelineContext(tl) }),
    ),
  );

  // Previous / next within the series
  const siblings = index.filter((t) => tl.series && t.series === tl.series);
  const pos = siblings.findIndex((t) => t.id === tl.id);
  const prev = siblings[pos - 1], next = siblings[pos + 1];
  const seriesNav = tl.series ? el("nav", { class: "series-nav" },
    prev ? el("a", { href: `#/${prev.id}` }, `← ${prev.title}`) : el("span"),
    el("span", { class: "series-name" }, tl.series),
    next ? el("a", { href: `#/${next.id}` }, `${next.title} →`) : el("span")) : null;

  const toolbar = el("div", { class: "tl-toolbar" },
    tl.lanes.map((l) =>
      el("button", {
        class: "lane-toggle", "aria-pressed": "true", "data-lane": l.id,
        onclick: (e) => {
          const b = e.currentTarget;
          state.lanesOn.has(l.id) ? state.lanesOn.delete(l.id) : state.lanesOn.add(l.id);
          b.setAttribute("aria-pressed", state.lanesOn.has(l.id));
          state.renderTimeline();
          document.querySelectorAll(`.card[data-lane="${l.id}"]`).forEach((c) => (c.hidden = !state.lanesOn.has(l.id)));
          updateYearHeads();
        },
      }, el("span", { class: "sw", style: `background:var(--lane-${l.id})` }), l.label)),
    el("span", { class: "spacer" }),
    el("span", { class: "tl-hint" }, "Drag to pan · pinch or ⌘/Ctrl+scroll to zoom"),
    el("button", { class: "zoom-btn", title: "Zoom in", onclick: () => zoomBy(0.6) }, "+"),
    el("button", { class: "zoom-btn", title: "Zoom out", onclick: () => zoomBy(1 / 0.6) }, "−"),
    el("button", { class: "zoom-btn wide", onclick: () => { state.view = { start: tl.range[0], end: tl.range[1] }; state.renderTimeline(); } }, "Reset"),
  );

  const tlBox = el("div", { class: "timeline" });
  const story = el("section", { class: "story" }, el("h2", {}, "The story"), buildStory());
  const mapWrap = el("section", { class: "map-wrap" }, el("h2", {}, "Places"), el("div", { id: "map" }),
    el("div", { class: "map-caption" }, "Select an event to see where it happened. Click a marker for details."));

  if (tl.compare && tl.compare.length === 0) { $("#app").replaceChildren(hero); state.renderTimeline = () => {}; return; }
  $("#app").replaceChildren(...[seriesNav, hero, toolbar].filter(Boolean), tlBox, el("div", { class: "below" }, story, mapWrap));
  state.renderTimeline = setupTimeline(tlBox);
  setupMap();
}

// ---------- Compare ----------
// Up to five timelines merged onto one axis: each keeps its own colour (lane), its rulers
// (or, for a person, their reign/lifetime) become ruler rows, its events become one event
// row, and the years where their spans coincide are shaded as overlaps.
const CMP_MAX = 5;
const CMP_LANES = ["life", "political", "forts", "cmp4", "cmp5"];
const CMP_HUES = [24, 232, 168, 333, 85];
const shortTitle = (t) => t.title.replace(/^(The |Chhatrapati |Peshwa )/, "").replace(/ Maharaj$/, "");

function timelineSpan(t, ents) {
  // People: their lifetime (who was alive at the same time). States/empires: their period.
  const subj = ents[t.subject];
  if (subj?.type === "person" && !t.rulers && entStart(subj) && entEnd(subj)) return [parseDate(entStart(subj)).t, parseDate(entEnd(subj)).t];
  if (t.focus) return t.focus;
  const ms = (t.rulers || []).flatMap((r) => r.members);
  if (ms.length) return [Math.min(...ms.map((m) => m.from)), Math.max(...ms.map((m) => m.to))];
  const e = ents[t.subject];
  if (e && entStart(e) && entEnd(e)) return [parseDate(entStart(e)).t, parseDate(entEnd(e)).t];
  return t.range;
}

async function buildCompare(key, index, ents) {
  const ids = [...new Set(key.split(",").filter((i) => index.some((t) => t.id === i)))].slice(0, CMP_MAX);
  const tls = await Promise.all(ids.map((i) => load(`data/timelines/${i}.json`)));
  const spans = tls.map((t) => timelineSpan(t, ents));
  const rulers = [], events = [], seen = new Set(), context = [], ctxSeen = new Set();
  tls.forEach((t, i) => {
    const name = shortTitle(t), [a, b] = spans[i];
    if (t.rulers?.length) t.rulers.forEach((row) => rulers.push({ ...row, hue: CMP_HUES[i], label: t.rulers.length > 1 ? `${name}: ${row.label}` : name }));
    else {
      const inPower = t.focus && (t.focus[0] !== a || t.focus[1] !== b) ? ` In power ${Math.floor(t.focus[0])}–${Math.floor(t.focus[1])}.` : "";
      rulers.push({ label: name, hue: CMP_HUES[i], members: [{ entity: t.subject, from: a, to: b, name: t.title, note: `${t.subtitle}.${inPower}` }] });
    }
    for (const ev of t.events) {
      const k = `${ev.date}|${ev.wiki || ev.title}`; // the same event in two timelines is shown once
      if (seen.has(k)) continue;
      seen.add(k);
      events.push({ ...ev, id: `${t.id}~${ev.id}`, lane: CMP_LANES[i] });
    }
    for (const c of t.context || []) {
      const k = `${c.entity}|${c.from}|${c.to}`;
      if (!ctxSeen.has(k)) { ctxSeen.add(k); context.push(c); }
    }
  });
  const overlaps = [];
  for (let i = 0; i < tls.length; i++) for (let j = i + 1; j < tls.length; j++) {
    const from = Math.max(spans[i][0], spans[j][0]), to = Math.min(spans[i][1], spans[j][1]);
    if (to > from) overlaps.push({ from, to, label: `${shortTitle(tls[i])} & ${shortTitle(tls[j])}` });
  }
  // Shaded bands: every stretch where two or more timelines run at once, darker the more there are
  // (drawing each pair separately would stack up to ten dashed boxes).
  const edges = [...new Set(spans.flat())].sort((p, q) => p - q), bands = [];
  for (let k = 0; k + 1 < edges.length; k++) {
    const n = spans.filter(([a, b]) => a <= edges[k] && b >= edges[k + 1]).length;
    const last = bands[bands.length - 1];
    if (n < 2) continue;
    if (last && last.n === n && last.to === edges[k]) last.to = edges[k + 1];
    else bands.push({ from: edges[k], to: edges[k + 1], n });
  }
  const lo = Math.min(...spans.map((s) => s[0])), hi = Math.max(...spans.map((s) => s[1])), pad = Math.max(5, (hi - lo) * 0.04);
  return {
    id: `compare/${ids.join(",")}`, compare: tls, spans, overlaps, bands,
    title: tls.length ? tls.map(shortTitle).join(" · ") : "Compare timelines",
    lanes: tls.map((t, i) => ({ id: CMP_LANES[i], label: shortTitle(t) })),
    rulers, events: events.sort((x, y) => (x.date < y.date ? -1 : 1)), context,
    range: tls.length ? [Math.floor(lo - pad), Math.ceil(hi + pad)] : [0, 1],
  };
}

function compareHero(tl, index, ents) {
  const chosen = tl.compare.map((t) => t.id);
  const goTo = (list) => go(`#/compare/${list.filter(Boolean).join(",")}`);
  const groups = [["Empires", index.filter((t) => t.kind === "empire")],
    ...[...new Set(index.filter((t) => t.kind !== "empire").map((t) => t.series || "Other"))]
      .map((sname) => [sname, index.filter((t) => t.kind !== "empire" && (t.series || "Other") === sname)])];
  const picker = (slot) => {
    const sel = el("select", { class: "cmp-select", "aria-label": `Timeline ${slot + 1}`,
      onchange: (e) => { const next = [...chosen]; next[slot] = e.target.value; goTo(next); } },
      el("option", { value: "" }, slot < chosen.length ? "— remove —" : "＋ add a timeline…"),
      groups.map(([g, list]) => el("optgroup", { label: g }, list.map((t) => el("option", { value: t.id, disabled: chosen.includes(t.id) && chosen[slot] !== t.id }, t.title)))));
    sel.value = chosen[slot] || "";
    return el("div", { class: "cmp-slot", style: `--cmp:var(--lane-${CMP_LANES[slot]})` }, sel);
  };
  const yr = (v) => (v < 0 ? `${Math.round(-v)} BCE` : `${Math.floor(v)}`);
  const cards = tl.compare.map((t, i) => {
    const subj = ents[t.subject];
    return el("div", { class: "cmp-card", style: `--cmp:var(--lane-${CMP_LANES[i]})` },
      subj?.thumb && el("img", { src: subj.thumb, alt: "" }),
      el("div", {},
        el("a", { class: "cmp-title", href: `#/${t.id}` }, t.title),
        el("div", { class: "cmp-years" }, `${yr(tl.spans[i][0])} – ${yr(tl.spans[i][1])}`)));
  });
  const overlapText = tl.compare.length < 2 ? "Pick at least one more timeline to see where they overlap."
    : tl.overlaps.length ? tl.overlaps.map((o) => el("span", { class: "cmp-ov" }, `${o.label}: ${yr(o.from)}–${yr(o.to)} (${Math.round(o.to - o.from)} years)`))
    : "These timelines don't overlap in time.";
  return el("section", { class: "compare-hero" },
    el("h1", {}, "Compare timelines"),
    el("p", { class: "sub" }, `Put up to ${CMP_MAX} people, empires or states on one axis to see who was contemporary with whom.`),
    el("div", { class: "cmp-pickers" }, [...Array(CMP_MAX).keys()].filter((slot) => slot <= chosen.length).map(picker)),
    cards.length ? el("div", { class: "cmp-cards" }, cards) : null,
    el("div", { class: "cmp-overlaps" }, el("b", {}, "Overlaps: "), overlapText),
    tl.compare.length >= 2 ? askAI({ subject: tl.compare.map(shortTitle).join(", "), type: "compare",
      context: tl.compare.map((t, i) => `${t.title} (${yr(tl.spans[i][0])}–${yr(tl.spans[i][1])}): ${t.subtitle || ""}`).join("\n") +
        (tl.overlaps.length ? `\nOverlaps: ${tl.overlaps.map((o) => `${o.label} ${yr(o.from)}–${yr(o.to)}`).join("; ")}` : "") }) : null);
}

// ---------- Ask AI ----------
// The site is static, so questions go to Claude or ChatGPT in a new tab, prefilled with the
// question plus what this page knows (dates, description, key events) as grounding context.
const AI_TARGETS = [["Claude", "https://claude.ai/new?q="], ["ChatGPT", "https://chatgpt.com/?q="]];
const AI_SUGGEST = {
  person: (n) => [`Why is ${n} important in Indian history?`, `What were ${n}'s greatest achievements and failures?`, `How do historians view ${n} today?`],
  polity: (n) => [`Why did the ${n} rise and fall?`, `How was the ${n} governed and financed?`, `What was life like for ordinary people under the ${n}?`],
  place: (n) => [`What happened at ${n}, and why did it matter?`, `What is there to see at ${n} today?`],
  concept: (n) => [`Explain ${n} in simple terms.`, `How did ${n} work in practice?`],
  compare: () => ["How did these powers interact with each other?", "Who was stronger, and when did that change?", "What did each one inherit from the others?"],
};
const evLine = (ev) => `${fmtDate(ev.date, ev.approx)}: ${ev.title}`;

function askAI({ subject, type, context }) {
  subject = subject.replace(/\s*\(.*\)$/, ""); // "Afzal Khan (general)" → "Afzal Khan"
  const suggestions = (AI_SUGGEST[type] || AI_SUGGEST.concept)(subject);
  const input = el("input", { class: "ask-input", type: "text", placeholder: "Type a question…", "aria-label": `Question about ${subject}` });
  const send = ([, base]) => {
    const q = input.value.trim() || suggestions[0];
    let prompt = `I'm exploring Indian history on Itihas (itihas.vokalglobe.com), looking at: ${subject}.\n\nBackground from the site:\n${context}`;
    const tail = `\n\nMy question: ${q}\n\nPlease answer as a careful historian: give dates, say where sources or historians disagree, and suggest further reading.`;
    prompt = prompt.slice(0, 1800 - tail.length) + tail; // keep the URL a safe length
    window.open(base + encodeURIComponent(prompt), "_blank", "noopener");
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(AI_TARGETS[0]); });
  return el("div", { class: "ask-ai" },
    el("div", { class: "ask-head" }, el("span", { class: "ask-spark", "aria-hidden": "true" }, "✦"), `Ask AI about ${subject}`),
    el("div", { class: "ask-row" }, input,
      AI_TARGETS.map((t) => el("button", { class: "ask-btn", onclick: () => send(t) }, `${t[0]} ↗`))),
    el("div", { class: "ask-sugg" }, suggestions.map((q) =>
      el("button", { class: "chip ask-chip", onclick: () => { input.value = q; input.focus(); } }, q))));
}

function timelineContext(tl) {
  const key = tl.events.filter((ev) => (ev.importance ?? (ev.major ? 3 : 1)) >= 3).slice(0, 14);
  const rulers = (tl.rulers || []).flatMap((r) => r.members).map((m) => m.name || state.entities[m.entity]?.title).filter(Boolean);
  return [`${tl.title} — ${tl.subtitle || ""}`.trim(),
    rulers.length ? `Rulers: ${[...new Set(rulers)].slice(0, 30).join(", ")}.` : "",
    key.length ? `Key events:\n${key.map(evLine).join("\n")}` : ""].filter(Boolean).join("\n");
}

// ---------- Inline entity links ----------
// A name with its own timeline links straight to that timeline; anything else opens its side panel.
const entHref = (id) => state.subjectTimeline?.[id] ? `#/${state.subjectTimeline[id]}` : `#/${state.tl.id}/e/${id}`;
// Like Wikipedia: names of people, places and states become links wherever they appear.
// Entities referenced by an event match on all their names, plus the single words of a
// person's name ("Dattaji" for Dattaji Shinde) when no other referenced entity shares them.
// Other entities match on names that are unambiguous across the whole registry; a name two
// entities share goes to the one with its own timeline, else to the only state among them
// ("Bijapur" → the sultanate, not the city). Generic lower-case aliases ("navy", "chauth")
// match only when referenced, and a person's single first name globally only when unique.
const GLOBAL_STOP = new Set(["Akbar", "Nizam", "Bhau", "English", "Afghan", "Bengal", "Hyderabad", "Bhosale"]);
// Words that are titles or too common to stand for one person on their own
const TOKEN_STOP = new Set(["Raja", "Rani", "Rao", "Shah", "Khan", "Sultan", "Prince", "Princess", "Lord", "Lady", "Mir", "Sir", "King", "Queen", "Emperor",
  "Chhatrapati", "Peshwa", "Maharaj", "Maharaja", "Nawab", "Nizam", "Mughal", "Maratha", "Guru", "Swami", "Saint", "Bai", "Begum", "Muhammad", "Ali", "Ahmad",
  "Singh", "Baji", "Balaji", "Nana", "Bhau", "Appa", "Saheb", "Sahib", "Bhonsle", "Bhosale", "Holkar", "Shinde", "Scindia", "Gaekwad", "Pawar", "Patwardhan",
  "Lodi", "Tughlaq", "Tughluq", "Khalji", "Sayyid", "Ghori", "Adil", "Qutb", "Nizam", "Deva", "Raya", "Rama", "Krishna", "Hari", "Great", "First", "Second",
  "Shivaji", "Sambhaji", "Rajaram", "Shahu", "Bajirao", "Madhavrao", "Raghunathrao", "Narayanrao", "Malhar", "Tukoji", "Yashwant", "Vithoji", "Duke", "Earl", "Marquess", "Viscount", "Baron"]);
const reEsc = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nameRe = (n) => new RegExp(`(?<![\\p{L}])${reEsc(n)}(?![\\p{L}])`, "u");
const namesOf = (e) => [...new Set([...(e.aliases || []), e.title, e.title?.replace(/\s*\(.*\)$/, "")])].filter((n) => n && n.length > 2);
// (only the words before "of", so "Shivaji II of Kolhapur" never claims "Kolhapur")
const tokensOf = (e) => e.type !== "person" ? [] : [...new Set(namesOf(e).flatMap((n) => n.split(/\s+of\s+|\s*\(/)[0].replace(/,/g, " ").split(/\s+/)))]
  .filter((w) => w.length > 3 && /^\p{Lu}\p{Ll}/u.test(w) && !TOKEN_STOP.has(w));

function globalNames() {
  if (state._globalFor === state.entities && state._globalTl === state.subjectTimeline) return state._global;
  const owners = {}, firsts = {}, tokens = {};
  for (const [id, e] of Object.entries(state.entities)) {
    for (const n of namesOf(e)) (owners[n] ||= new Set()).add(id);
    for (const w of tokensOf(e)) (tokens[w] ||= new Set()).add(id);
    const first = e.type === "person" && tokensOf(e)[0];
    if (first && namesOf(e).some((n) => n.startsWith(first + " "))) (firsts[first] ||= new Set()).add(id);
  }
  const list = [];
  for (const [n, set] of Object.entries(owners)) {
    if (GLOBAL_STOP.has(n) || !/^\p{Lu}/u.test(n)) continue;
    let ids = [...set];
    if (ids.length > 1) { const tl = ids.filter((i) => state.subjectTimeline?.[i]); if (tl.length) ids = tl; }
    if (ids.length > 1) ids = ids.filter((i) => state.entities[i].type === "polity");
    if (ids.length === 1) list.push({ id: ids[0], n, re: nameRe(n) });
  }
  // a first name no other entity uses in any of its names ("Dattaji", "Daulatrao")
  for (const [w, set] of Object.entries(firsts)) {
    if (set.size === 1 && tokens[w].size === 1 && !owners[w]) list.push({ id: [...set][0], n: w, re: nameRe(w) });
  }
  state._globalFor = state.entities;
  state._globalTl = state.subjectTimeline;
  state._global = list;
  return list;
}

// `done` (a Set) can be shared between texts, so a card's title and summary link a name once.
function linkify(text, ids = [], { skip, done = new Set() } = {}) {
  if (!text) return "";
  const ents = state.entities;
  const names = [];
  const refs = ids.filter((id) => ents[id]);
  for (const id of refs) for (const n of namesOf(ents[id])) names.push({ id, n, re: nameRe(n) });
  const tokenOwners = {};
  for (const id of refs) for (const w of tokensOf(ents[id])) (tokenOwners[w] ||= []).push(id);
  for (const [w, owners] of Object.entries(tokenOwners)) if (owners.length === 1) names.push({ id: owners[0], n: w, re: nameRe(w) });
  names.push(...globalNames());
  names.sort((a, b) => b.n.length - a.n.length); // stable: an event's own references win ties
  const taken = [];
  if (skip) done.add(skip);
  for (const { id, n, re } of names) {
    if (done.has(id)) continue;
    let from = 0;
    while (true) {
      const m = re.exec(text.slice(from));
      if (!m) break;
      const s = from + m.index, e = s + n.length;
      if (!taken.some((t) => s < t.e && e > t.s)) { taken.push({ s, e, id }); done.add(id); break; }
      from = e;
    }
  }
  taken.sort((a, b) => a.s - b.s);
  let out = "", i = 0;
  for (const t of taken) {
    const ent = ents[t.id];
    const hasTl = state.subjectTimeline?.[t.id] ? " has-tl" : "";
    out += esc(text.slice(i, t.s)) +
      `<a class="ent-link t-${ent.type}${hasTl}" href="${entHref(t.id)}" data-ent="${t.id}">${esc(text.slice(t.s, t.e))}</a>`;
    i = t.e;
  }
  return out + esc(text.slice(i));
}
const linked = (tag, cls, text, ids, opts) => { const n = el(tag, { class: cls }); n.innerHTML = linkify(text, ids, opts); return n; };

// Hover previews, like Wikipedia's page previews
let previewTimer = null;
document.addEventListener("mouseover", (e) => {
  const a = e.target.closest?.("a[data-ent]");
  if (!a || !state.entities) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const ent = state.entities[a.dataset.ent];
    if (!ent) return;
    const tlId = state.subjectTimeline?.[ent.id];
    const tip = $("#tooltip");
    tip.innerHTML = `<div class="pv">${ent.thumb ? `<img src="${esc(ent.thumb)}" alt="">` : ""}<div>
      <b>${esc(ent.title)}</b>${ent.labels?.mr ? ` <span class="pv-dev">${esc(ent.labels.mr)}</span>` : ""}
      ${ent.description ? `<div class="pv-desc">${esc(ent.description)}</div>` : ""}
      ${tlId ? `<div class="pv-tl">◷ Click to open its timeline</div>` : ""}</div></div>`;
    tip.classList.add("show", "preview");
    const r = a.getBoundingClientRect(), tr = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(window.innerWidth - tr.width - 8, r.left)) + "px";
    tip.style.top = (r.bottom + tr.height + 12 < window.innerHeight ? r.bottom + 6 : r.top - tr.height - 6) + "px";
  }, 250);
});
document.addEventListener("mouseout", (e) => {
  if (!e.target.closest?.("a[data-ent]")) return;
  clearTimeout(previewTimer);
  $("#tooltip").classList.remove("show", "preview");
});
document.addEventListener("click", () => { clearTimeout(previewTimer); $("#tooltip").classList.remove("show", "preview"); });

const chip = (id) => {
  const e = state.entities[id];
  if (!e) return null;
  return el("a", { class: `chip t-${e.type}${state.subjectTimeline?.[id] ? " has-tl" : ""}`, href: entHref(id), "data-ent": id, title: e.description || "" },
    el("span", { class: "ico" }, TYPE_ICON[e.type]), e.title);
};
const evRefs = (ev) => [...(ev.people || []), ...(ev.places || []), ...(ev.polities || []), ...(ev.concepts || [])];

// ---------- Story list ----------
function buildStory() {
  const tl = state.tl, wrap = el("div");
  const laneLabel = Object.fromEntries(tl.lanes.map((l) => [l.id, l.label]));
  let lastYear = null;
  for (const ev of tl.events) {
    const y = parseDate(ev.date).y;
    if (y !== lastYear) { wrap.append(el("div", { class: "year-head", "data-year": y }, String(y))); lastYear = y; }
    const done = new Set();
    const h = linked("h3", null, ev.title, evRefs(ev), { done });
    const p = linked("p", null, ev.summary, evRefs(ev), { done });
    wrap.append(el("article", {
      class: `card${ev.major ? " major" : ""}`, id: `card-${ev.id}`, "data-lane": ev.lane, "data-year": y,
      style: `--lane:var(--lane-${ev.lane})`,
      onclick: (e) => { if (!e.target.closest("a")) go(`#/${tl.id}/ev/${ev.id}`); },
    },
      ev.thumb && el("img", { class: "thumb", src: ev.thumb, alt: "", loading: "lazy" }),
      el("div", { class: "meta" }, el("span", { class: "lane-tag" }, laneLabel[ev.lane]), el("span", {}, fmtRange(ev))),
      h,
      p,
      el("div", { class: "chips" }, evRefs(ev).map(chip)),
      el("div", { class: "card-links" },
        ev.see && el("a", { class: "see-link", href: `#/${ev.see}` }, "Open the full timeline →"),
        ev.wikiUrl && el("a", { class: "wiki-link", href: ev.wikiUrl, target: "_blank", rel: "noopener" }, "Read on Wikipedia ↗")),
    ));
  }
  return wrap;
}
function updateYearHeads() {
  document.querySelectorAll(".year-head").forEach((h) => {
    h.hidden = ![...document.querySelectorAll(`.card[data-year="${h.dataset.year}"]`)].some((c) => !c.hidden);
  });
}

// ---------- SVG timeline ----------
// Real text width (cached canvas), so labels truncate only when they actually don't fit.
const measureCtx = document.createElement("canvas").getContext("2d");
function textWidth(text, font = "600 11.5px Inter, system-ui, sans-serif") {
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}
function fitText(text, maxW, font) {
  if (textWidth(text, font) <= maxW) return text;
  for (let n = text.length - 1; n > 1; n--) {
    const t = text.slice(0, n).trimEnd() + "…";
    if (textWidth(t, font) <= maxW) return t;
  }
  return "";
}
function setupTimeline(box) {
  const tl = state.tl, ents = state.entities;
  const AXIS = 30, MAIN_H = 128, HEAD_H = 30, CTX_ROW = 20, LANE_H = 72, PAD = 14;
  let GUTTER = 168;
  const tooltip = $("#tooltip");
  const majors = tl.events.filter((e) => e.major).length;

  function render() {
    const W = box.clientWidth;
    GUTTER = W < 600 ? 104 : 168;
    const { start, end } = state.view;
    const span = end - start;
    const x = (t) => GUTTER + ((t - start) / span) * (W - GUTTER - PAD);
    const visible = (e) => state.lanesOn.has(e.lane) && (e._te ?? e._t) >= start - 1 && e._t <= end + 1;
    const lanes = tl.lanes.filter((l) => state.lanesOn.has(l.id));
    const ctxOpen = state.expanded.ctx;
    const lanesKey = tl.compare ? "cmpLanes" : "lanes";
    const lanesOpen = tl.compare ? state.expanded.cmpLanes !== false : state.expanded.lanes;

    // Vertical layout. Empire timelines lead with their rulers (one row per line of rulers,
    // e.g. Chhatrapatis and Peshwas) and fold the key-events track into a section below.
    // Other timelines lead with the key-events track.
    const R_STRIP = 18, R_BAR = 30, R_GAP = 10;
    const rulerRows = tl.rulers || [];
    let ry = AXIS + 6;
    const rowGeom = rulerRows.map((row) => {
      const hasGroups = row.members.some((m) => m.group);
      const g = { strip: hasGroups ? ry : null, bar: ry + (hasGroups ? R_STRIP + 2 : 0) };
      ry = g.bar + R_BAR + R_GAP;
      return g;
    });
    const hasRulers = rulerRows.length > 0;
    const eventsOpen = !hasRulers || state.expanded.events;
    const eventsHead = hasRulers ? ry : null;
    const mainTop = hasRulers ? eventsHead + HEAD_H : AXIS;
    const ctxHead = eventsOpen ? mainTop + MAIN_H : mainTop;
    const ctxTop = ctxHead + HEAD_H + 6;
    const lanesHead = ctxOpen ? ctxTop + tl.context.length * CTX_ROW + 6 : ctxHead + HEAD_H;
    const lanesTop = lanesHead + HEAD_H;
    const H = lanesOpen ? lanesTop + lanes.length * LANE_H + 6 : lanesTop + 2;
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, height: H });

    // Subject's lifespan shading
    const subj = ents[tl.subject];
    const focus = tl.focus || (subj && entStart(subj) && entEnd(subj) && [parseDate(entStart(subj)).t, parseDate(entEnd(subj)).t]);
    for (const o of tl.bands || []) {
      const a = Math.max(GUTTER, x(o.from)), b = Math.min(W - PAD, x(o.to));
      if (b > a) s.append(svg("rect", { class: "overlap-band", x: a, y: AXIS, width: b - a, height: H - AXIS, style: `--depth:${o.n}` }));
    }
    if (focus) {
      const a = x(focus[0]), b = x(focus[1]);
      s.append(svg("rect", { class: "subject-span", x: a, y: AXIS, width: Math.max(0, b - a), height: H - AXIS }));
    }

    // Grid + axis
    const pxPerYear = (W - GUTTER - PAD) / span;
    const step = [1, 2, 5, 10, 20, 50, 100].find((st) => st * pxPerYear >= 44) || 100;
    for (let yr = Math.ceil(start / step) * step; yr <= end; yr += step) {
      const gx = x(yr);
      if (gx < GUTTER) continue;
      s.append(svg("line", { class: `grid${yr % (step * 2) === 0 ? " major" : ""}`, x1: gx, x2: gx, y1: AXIS - 6, y2: H }));
      const t = svg("text", { class: "axis-label", x: gx, y: AXIS - 12, "text-anchor": "middle" });
      t.textContent = yr;
      s.append(t);
    }
    if (pxPerYear > 400) { // month ticks when zoomed far in
      for (let m = Math.ceil(start * 12); m <= end * 12; m++) {
        if (m % 12 === 0) continue;
        const gx = x(m / 12);
        if (gx < GUTTER) continue;
        const t = svg("text", { class: "axis-label", x: gx, y: AXIS - 12, "text-anchor": "middle", "font-size": 9 });
        t.textContent = MONTHS[((m % 12) + 12) % 12];
        s.append(t);
      }
    }

    // Importance: 3 = key event, 2 = notable, 1 = detail. Content can set "importance";
    // otherwise it is derived (major → 3; has a Wikipedia article, a linked timeline or
    // many participants → 2; else 1).
    const importance = (e) => state.selected === e.id ? 4
      : e.importance ?? (e.major ? 3 : (e.wiki || e.see || evRefs(e).length >= 5) ? 2 : 1);
    const trackW = W - GUTTER - PAD;
    const DOT_R = { 4: 7, 3: 7, 2: 5.5, 1: 4 };

    // Draw one track. How much appears depends on zoom: the lowest importance tier whose
    // events fit (about one per `spacing` px) is shown; anything closer than CLUSTER px
    // merges into a numbered cluster that zooms in when clicked. Labels go to the most
    // important events first and only where they don't collide.
    function drawTrack(evs, mid, { rows, spacing, spanBand }) {
      const g = svg("g");
      let tier = 3;
      for (const t of [1, 2]) if (evs.filter((e) => importance(e) >= t).length <= trackW / spacing) { tier = t; break; }
      const kept = evs.filter((e) => importance(e) >= tier);

      // Spans: thin bars in a band below the line, stacked so overlapping periods never
      // sit on top of each other; a small tick on the line marks where each one starts.
      const spanRows = [];
      for (const ev of kept.filter((e) => e._te).sort((a, b) => a._t - b._t)) {
        const x1 = x(ev._t), x2 = Math.max(x(ev._te), x1 + 6);
        let row = spanRows.findIndex((endX) => x1 > endX + 4);
        if (row === -1) { row = spanRows.length; spanRows.push(0); }
        spanRows[row] = x2;
        const y = mid + spanBand + row * 7;
        const n = svg("g", { class: `ev span${state.selected === ev.id ? " sel" : ""}`, "data-ev": ev.id });
        n.append(svg("line", { class: "span-tick", x1, x2: x1, y1: mid, y2: y }));
        n.append(svg("rect", { x: x1, y: y - 2.5, width: x2 - x1, height: 5, rx: 2.5, fill: `var(--lane-${ev.lane})` }));
        bindEv(n, ev); g.append(n);
      }

      // Points, grouped into clusters where they would overlap
      const CLUSTER = 16;
      const groups = [];
      for (const ev of kept.filter((e) => !e._te).sort((a, b) => a._t - b._t)) {
        const cx = x(ev._t), last = groups[groups.length - 1];
        if (last && cx - last.x1 < CLUSTER) { last.evs.push(ev); last.x1 = cx; }
        else groups.push({ evs: [ev], x0: cx, x1: cx });
      }
      for (const gr of groups) {
        gr.top = [...gr.evs].sort((a, b) => importance(b) - importance(a) || a._t - b._t)[0];
        gr.cx = gr.evs.length === 1 ? gr.x0 : (gr.x0 + gr.x1) / 2;
      }

      // Labels: one per group or span, most important first; fewer rows when zoomed far out
      const items = [...groups.map((gr) => ({ ev: gr.top, cx: gr.cx, n: gr.evs.length })),
                     ...kept.filter((e) => e._te).map((ev) => ({ ev, cx: x(ev._t), n: 1 }))];
      const useRows = span > 40 ? rows.slice(0, 2) : span > 15 ? rows.slice(0, 3) : rows;
      const taken = Object.fromEntries(useRows.map((r) => [r, []]));
      const fits = (r, a, b) => !taken[r].some(([s2, e2]) => a < e2 + 10 && b > s2 - 10);
      const placed = [];
      for (const it of items.sort((a, b) => importance(b.ev) - importance(a.ev) || a.ev._t - b.ev._t)) {
        const text = it.n > 1 ? `${it.ev.title}  +${it.n - 1}` : it.ev.title;
        const w = text.length * (importance(it.ev) >= 3 ? 6.9 : 6.3);
        let a = it.cx - w / 2, b = it.cx + w / 2;
        if (a < GUTTER + 2) { a = GUTTER + 2; b = a + w; }
        if (b > W - PAD) { b = W - PAD; a = b - w; }
        const r = useRows.find((r) => fits(r, a, b));
        if (r == null) continue;
        taken[r].push([a, b]);
        placed.push({ ...it, r, a, text });
      }
      for (const P of placed) if (Math.abs(P.r) > 26) // leader line for labels on outer rows
        g.append(svg("line", { class: "leader", x1: P.cx, x2: P.cx, y1: mid + (P.r < 0 ? -8 : 8), y2: mid + P.r + (P.r < 0 ? 4 : -12) }));

      for (const gr of groups) {
        if (gr.evs.length === 1) {
          const ev = gr.top;
          const n = svg("g", { class: `ev imp${importance(ev)}${state.selected === ev.id ? " sel" : ""}`, "data-ev": ev.id });
          n.append(svg("circle", { cx: gr.cx, cy: mid, r: DOT_R[importance(ev)], fill: `var(--lane-${ev.lane})` }));
          bindEv(n, ev); g.append(n);
          continue;
        }
        const n = svg("g", { class: `ev cluster${gr.evs.some((e) => e.id === state.selected) ? " sel" : ""}` });
        n.append(svg("circle", { cx: gr.cx, cy: mid, r: 9.5, fill: `var(--lane-${gr.top.lane})` }));
        const t = svg("text", { class: "cluster-n", x: gr.cx, y: mid + 3.5, "text-anchor": "middle" });
        t.textContent = gr.evs.length;
        n.append(t);
        const t0 = gr.evs[0]._t, t1 = gr.evs[gr.evs.length - 1]._t;
        n.addEventListener("click", (e) => {
          e.stopPropagation();
          hideTip();
          if (t1 - t0 < 1 / 365) return go(`#/${tl.id}/ev/${gr.top.id}`); // same day: can't separate by zooming
          const target = Math.max(0.75, ((t1 - t0) * trackW) / (CLUSTER * 2.5 * gr.evs.length));
          const c = (t0 + t1) / 2;
          state.view = { start: c - target / 2, end: c + target / 2 };
          render();
        });
        n.addEventListener("mousemove", (e) => showTip(e,
          `<div class="tt-date">${gr.evs.length} events · click to zoom in</div>` +
          gr.evs.map((ev) => `<div>${esc(fmtDate(ev.date, ev.approx))} — ${esc(ev.title)}</div>`).join("")));
        n.addEventListener("mouseleave", hideTip);
        g.append(n);
      }

      for (const P of placed) {
        const t = svg("text", { class: `ev-label imp${importance(P.ev)}`, x: P.a, y: mid + P.r });
        t.textContent = P.text;
        g.append(t);
      }
      return { g, shown: kept.length, total: evs.length };
    }

    // 0. Rulers: consecutive reigns as bars. Each dynasty/group gets its own hue and
    // consecutive reigns alternate between two shades of it so neighbours stay distinct.
    const HUES = [24, 232, 168, 352, 42, 280, 200];
    rulerRows.forEach((row, ri) => {
      const geo = rowGeom[ri];
      const groups = [...new Set(row.members.map((m) => m.group || row.label))];
      const hueOf = (gname) => (row.hue ?? HUES[(groups.indexOf(gname) + ri * 2) % HUES.length]);
      const counts = {};
      // dynasty strip
      if (geo.strip != null) {
        const runs = [];
        for (const m of row.members) {
          const gname = m.group || row.label, last = runs[runs.length - 1];
          if (last && last.g === gname && m.from - last.to < 3) last.to = m.to;
          else runs.push({ g: gname, from: m.from, to: m.to });
        }
        for (const r of runs) {
          const x1 = Math.max(GUTTER, x(r.from)), x2 = Math.min(W - PAD, x(r.to));
          if (x2 <= x1) continue;
          const ent = ents[r.g];
          const gEl = svg("g", { class: `dyn${ent ? " link" : ""}` });
          gEl.append(svg("rect", { x: x1, y: geo.strip, width: x2 - x1, height: R_STRIP, rx: 3, fill: `hsl(${hueOf(r.g)} 60% 50% / .14)` }));
          const label = ent?.title || r.g;
          const t = svg("text", { class: "dyn-text", x: x1 + 6, y: geo.strip + 12.5, fill: `hsl(${hueOf(r.g)} 55% 38%)` });
          t.textContent = fitText(label.toUpperCase(), x2 - x1 - 12, "700 10.5px Inter, system-ui, sans-serif");
          gEl.append(t);
          if (ent) gEl.addEventListener("click", () => go(entHref(r.g)));
          gEl.addEventListener("mousemove", (ev) => showTip(ev, `<b>${esc(label)}</b><div class="tt-date">${Math.floor(r.from)} – ${Math.floor(r.to)}</div>`));
          gEl.addEventListener("mouseleave", hideTip);
          s.append(gEl);
        }
      }
      // reign bars
      for (const m of row.members) {
        const gname = m.group || row.label;
        const k = (counts[gname] = (counts[gname] || 0) + 1);
        const x1 = Math.max(GUTTER, x(m.from)), x2 = Math.min(W - PAD, x(m.to));
        if (x2 <= GUTTER || x1 >= W - PAD) continue;
        const ent = m.entity && ents[m.entity];
        const name = m.name || ent?.title || "?";
        const gEl = svg("g", { class: `reign${ent ? " link" : ""}` });
        gEl.append(svg("rect", { x: x1 + 0.5, y: geo.bar, width: Math.max(1.5, x2 - x1 - 1), height: R_BAR, rx: 4,
          fill: `hsl(${hueOf(gname)} ${k % 2 ? 62 : 52}% ${k % 2 ? 46 : 60}%)` }));
        const room = x2 - x1 - 12, short = name.replace(/\s*\(.*\)$/, "");
        const label = textWidth(name) <= room ? name : fitText(short, room);
        if (label && label.length > 2) {
          const t = svg("text", { class: "reign-text", x: x1 + 6, y: geo.bar + R_BAR / 2 + 4 });
          t.textContent = label;
          gEl.append(t);
        }
        const yrs = `${Math.floor(m.from)} – ${Math.floor(m.to)}`;
        gEl.addEventListener("mousemove", (ev) => showTip(ev,
          `<b>${esc(name)}</b><div class="tt-date">${yrs}${ent?.description ? " · " + esc(ent.description) : ""}</div>${m.note ? `<div>${esc(m.note)}</div>` : ""}` +
          (state.subjectTimeline?.[m.entity] ? `<div class="tt-date">◷ click to open timeline</div>` : "")));
        gEl.addEventListener("mouseleave", hideTip);
        if (ent) gEl.addEventListener("click", () => { hideTip(); go(entHref(m.entity)); });
        s.append(gEl);
      }
    });

    // 1. Key events: everything, thinned by importance for the current zoom
    const mainMid = mainTop + MAIN_H / 2;
    let main = { shown: 0, total: 0 };
    if (eventsOpen) {
      s.append(svg("line", { class: "track-line", x1: GUTTER, x2: W - PAD, y1: mainMid, y2: mainMid }));
      main = drawTrack(tl.events.filter(visible), mainMid, { rows: [-14, -33, 24, -52], spacing: 64, spanBand: 40 });
      s.append(main.g);
    }

    // 2. Collapsible: people & powers
    const head = (y, open, text, key) => {
      const g = svg("g", { class: "sec-head", role: "button", tabindex: 0 });
      g.append(svg("rect", { x: 0, y, width: W, height: HEAD_H, class: "sec-head-bg" }));
      const t = svg("text", { class: "sec-head-text", x: 12, y: y + HEAD_H / 2 + 4 });
      t.textContent = `${open ? "▾" : "▸"}  ${text}`;
      g.append(t);
      const toggle = () => { state.expanded[key] = !open; saveExpanded(); render(); };
      g.addEventListener("click", toggle);
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
      return g;
    };
    if (ctxOpen) {
      tl.context.forEach((c, i) => {
        const e = ents[c.entity];
        if (!e) return;
        const from = c.from ?? (entStart(e) && parseDate(entStart(e)).t);
        const to = c.to ?? (entEnd(e) && parseDate(entEnd(e)).t) ?? tl.range[1];
        if (!from) return;
        const y = ctxTop + i * CTX_ROW;
        const x1 = Math.max(GUTTER, x(from)), x2 = Math.min(W - 2, x(to));
        if (x2 <= GUTTER) return;
        const g = svg("g", { class: "ctx-bar" });
        g.append(svg("rect", { x: x1, y, width: Math.max(2, x2 - x1), height: CTX_ROW - 5, rx: 4, fill: `var(--t-${e.type})` }));
        const t = svg("text", { class: "ctx-text", x: x1 + 6, y: y + CTX_ROW - 9 });
        t.textContent = c.label;
        if (x2 - x1 < c.label.length * 6.2 + 10) t.textContent = x2 - x1 > 40 ? c.label.slice(0, Math.floor((x2 - x1 - 14) / 6.2)) + "…" : "";
        g.append(t);
        g.addEventListener("click", () => go(entHref(c.entity)));
        const fromLbl = c.from ?? parseDate(entStart(e)).y, toLbl = c.to ?? (entEnd(e) ? parseDate(entEnd(e)).y : "");
        g.addEventListener("mousemove", (ev) => showTip(ev, `<b>${esc(c.label)}</b><div class="tt-date">${fromLbl} – ${toLbl}</div>`));
        g.addEventListener("mouseleave", hideTip);
        s.append(g);
      });
    }

    // 3. Collapsible: every event, one lane per category
    if (lanesOpen) {
      lanes.forEach((lane, li) => {
        const top = lanesTop + li * LANE_H;
        s.append(svg("line", { class: "grid", x1: 0, x2: W, y1: top, y2: top }));
        s.append(drawTrack(tl.events.filter((e) => e.lane === lane.id && visible(e)), top + LANE_H / 2, { rows: [-10, -25], spacing: 40, spanBand: 13 }).g);
      });
    }

    // Gutter + row labels drawn last so they mask anything panned under them
    s.append(svg("rect", { class: "gutter", x: 0, y: 0, width: GUTTER - 4, height: H }));
    const rowLabel = (txt, y, size) => {
      const t = svg("text", { class: "row-label", x: 12, y, "font-size": size });
      t.textContent = txt;
      s.append(t);
    };
    rulerRows.forEach((row, ri) => {
      rowLabel(fitText(row.label, GUTTER - 18, "500 12px Inter, system-ui, sans-serif"), rowGeom[ri].bar + R_BAR / 2 + 4, 12);
      if (rowGeom[ri].strip != null) {
        const t = svg("text", { class: "row-hint", x: 12, y: rowGeom[ri].strip + 12.5 });
        t.textContent = "dynasty";
        s.append(t);
      }
    });
    if (hasRulers) s.append(head(eventsHead, eventsOpen, `Key events (${tl.events.filter((e) => e.major).length})`, "events"));
    if (eventsOpen) rowLabel(main.shown < main.total ? "Key events" : "All events", mainMid - 2, 12);
    if (eventsOpen && main.total) {
      const hint = svg("text", { class: "row-hint", x: 12, y: mainMid + 14 });
      hint.textContent = main.shown < main.total ? `${main.shown} of ${main.total} · zoom for more` : `${main.total} in view`;
      s.append(hint);
    }
    const minorCount = tl.events.length - majors;
    s.append(head(ctxHead, ctxOpen, `People & powers (${tl.context.length})`, "ctx"));
    if (ctxOpen) tl.context.forEach((c, i) => {
      const full = (ents[c.entity]?.title || "").length > 22 ? c.label.split(" – ")[0].split(" (")[0] : ents[c.entity]?.title || c.label;
      rowLabel(W < 600 && full.length > 15 ? full.slice(0, 14) + "…" : full, ctxTop + i * CTX_ROW + 11, W < 600 ? 10 : 11);
    });
    s.append(head(lanesHead, lanesOpen, tl.compare ? `Events by timeline (${tl.events.length})`
      : `All ${tl.events.length} events by category${lanesOpen ? "" : ` (+${minorCount} more)`}`, lanesKey));
    if (lanesOpen) lanes.forEach((lane, li) => rowLabel(W < 600 ? lane.label.split(" ")[0] : lane.label, lanesTop + li * LANE_H + LANE_H / 2 + 4, 12));

    box.replaceChildren(s);
  }

  function bindEv(node, ev) {
    node.addEventListener("click", (e) => { e.stopPropagation(); go(`#/${tl.id}/ev/${ev.id}`); });
    node.addEventListener("mousemove", (e) => showTip(e, `<div class="tt-date">${esc(fmtRange(ev))}</div><b>${esc(ev.title)}</b>`));
    node.addEventListener("mouseleave", hideTip);
  }
  function showTip(e, html) {
    tooltip.innerHTML = html;
    tooltip.classList.add("show");
    const r = tooltip.getBoundingClientRect();
    tooltip.style.left = Math.min(window.innerWidth - r.width - 8, e.clientX + 14) + "px";
    tooltip.style.top = Math.max(8, e.clientY - r.height - 10) + "px";
  }
  function hideTip() { tooltip.classList.remove("show"); }

  // Pan (drag) and zoom (pinch / ctrl+wheel); horizontal wheel pans
  let drag = null;
  box.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".ev, .ctx-bar, .sec-head, .reign.link, .dyn.link")) return;
    drag = { x: e.clientX, start: state.view.start, end: state.view.end };
    box.setPointerCapture(e.pointerId);
    box.classList.add("dragging");
  });
  box.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const perPx = (drag.end - drag.start) / (box.clientWidth - GUTTER - PAD);
    const d = (drag.x - e.clientX) * perPx;
    state.view = { start: drag.start + d, end: drag.end + d };
    render();
  });
  const endDrag = () => { drag = null; box.classList.remove("dragging"); };
  box.addEventListener("pointerup", endDrag);
  box.addEventListener("pointercancel", endDrag);
  box.addEventListener("wheel", (e) => {
    const span = state.view.end - state.view.start;
    const frac = Math.min(1, Math.max(0, (e.clientX - box.getBoundingClientRect().left - GUTTER) / (box.clientWidth - GUTTER - PAD)));
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomBy(Math.exp(e.deltaY * 0.01), frac);
    } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      const d = (e.deltaX / box.clientWidth) * span;
      state.view = { start: state.view.start + d, end: state.view.end + d };
      render();
    }
  }, { passive: false });
  new ResizeObserver(() => render()).observe(box);
  render();
  return render;
}

function zoomBy(factor, frac = 0.5) {
  const { start, end } = state.view;
  const span = Math.min(200, Math.max(0.75, (end - start) * factor));
  const pivot = start + (end - start) * frac;
  state.view = { start: pivot - span * frac, end: pivot + span * (1 - frac) };
  state.renderTimeline();
}

// ---------- Map ----------
function setupMap() {
  if (state.map) { state.map.remove(); state.map = null; }
  const tl = state.tl, ents = state.entities;
  const map = L.map("map", { scrollWheelZoom: false, zoomSnap: 0.5 });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  state.map = map;
  state.markers = {};
  const counts = {};
  tl.events.forEach((ev) => (ev.places || []).forEach((p) => (counts[p] = (counts[p] || 0) + 1)));
  const pts = [];
  for (const [id, n] of Object.entries(counts)) {
    const e = ents[id];
    if (!e?.coords) continue;
    const ll = [e.coords.lat, e.coords.lon];
    pts.push(ll);
    const m = L.circleMarker(ll, { radius: 4 + Math.min(n, 6), color: "#0f766e", weight: 2, fillColor: "#14b8a6", fillOpacity: 0.55 })
      .addTo(map)
      .bindTooltip(`${e.title}${e.labels?.mr ? " · " + e.labels.mr : ""}`)
      .on("click", () => go(`#/${tl.id}/e/${id}`));
    state.markers[id] = m;
  }
  state.allBounds = L.latLngBounds(pts);
  map.fitBounds(state.allBounds, { padding: [20, 20] });
}
function highlightPlaces(ids) {
  const sel = new Set(ids);
  for (const [id, m] of Object.entries(state.markers)) {
    const on = sel.has(id);
    m.setStyle(on ? { color: "#b45309", fillColor: "#f59e0b", fillOpacity: 0.9, weight: 3 }
                  : { color: "#0f766e", fillColor: "#14b8a6", fillOpacity: sel.size ? 0.25 : 0.55, weight: 2 });
    if (on) m.bringToFront();
  }
  const pts = ids.map((id) => state.entities[id]?.coords).filter(Boolean).map((c) => [c.lat, c.lon]);
  if (!state.map) return;
  if (pts.length === 1) state.map.flyTo(pts[0], 9, { duration: 0.8 });
  else if (pts.length > 1) state.map.flyToBounds(pts, { padding: [40, 40], maxZoom: 9, duration: 0.8 });
}

// ---------- Selection ----------
function selectEvent(id, { scroll } = {}) {
  const ev = state.tl.events.find((e) => e.id === id);
  if (!ev) return;
  state.selected = id;
  // make sure the event is in the visible window and lane
  if (!state.lanesOn.has(ev.lane)) $(`.lane-toggle[data-lane="${ev.lane}"]`)?.click();
  const { start, end } = state.view;
  if (ev._t < start || ev._t > end) {
    const span = end - start;
    state.view = { start: ev._t - span / 2, end: ev._t + span / 2 };
  }
  state.renderTimeline();
  document.querySelectorAll(".card.sel").forEach((c) => c.classList.remove("sel"));
  const card = document.getElementById(`card-${id}`);
  card?.classList.add("sel");
  if (scroll) setTimeout(() => card?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
  highlightPlaces(ev.places || []);
}

// ---------- Entity drawer ----------
const drawer = $("#drawer");
$(".drawer-close").addEventListener("click", () => closeDrawer(true));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawer.classList.contains("open")) closeDrawer(true); });

function closeDrawer(updateHash) {
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  if (updateHash && state.tl && /\/e\//.test(location.hash)) {
    history.replaceState(null, "", `#/${state.tl.id}`);
  }
}

async function openEntity(id) {
  const e = state.entities[id], tl = state.tl;
  if (!e) return;
  const [index, entTl] = await Promise.all([loadOptional("data/index.json", []), loadOptional("data/entity-timelines.json", {})]);
  const ownTimeline = index.find((t) => t.subject === id && t.id !== tl.id);
  const otherTimelines = (entTl[id] || []).filter((t) => t !== tl.id && t !== ownTimeline?.id)
    .map((t) => index.find((i) => i.id === t)).filter(Boolean);
  const body = $(".drawer-body", drawer);
  const evs = tl.events.filter((ev) => evRefs(ev).includes(id));
  const s = entStart(e), en = entEnd(e);
  const dateLine = e.type === "person"
    ? (s || en) && `${s ? fmtDate(s) : "?"} – ${en ? fmtDate(en) : "?"}`
    : (s || en) && `${s ? "Founded " + fmtDate(s) : ""}${s && en ? " · " : ""}${en ? "Ended " + fmtDate(en) : ""}`;

  // Related: entities that co-occur in the same events, ranked by frequency
  const co = {};
  evs.forEach((ev) => evRefs(ev).forEach((r) => { if (r !== id) co[r] = (co[r] || 0) + 1; }));
  const related = Object.entries(co).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([r]) => r);

  body.replaceChildren(...[ // optional parts may be undefined/null/false: drop them, or the DOM prints "undefined"
    e.thumb ? el("img", { class: "d-img", src: e.thumb, alt: e.title }) : "",
    el("div", { class: `d-type t-${e.type}` }, TYPE_LABEL[e.type]),
    el("h2", {}, e.title),
    e.labels?.mr && el("div", { class: "d-dev" }, e.labels.mr),
    e.description && linked("p", "d-desc", e.description, [], { skip: id }),
    dateLine && el("div", { class: "d-dates" }, dateLine),
    ownTimeline && el("a", { class: "own-tl", href: `#/${ownTimeline.id}` }, `Open the ${ownTimeline.title} timeline →`),
    otherTimelines.length ? el("div", { class: "d-tls" }, el("span", { class: "d-tls-label" }, ownTimeline ? "Also in" : "Appears in"),
      otherTimelines.map((t) => el("a", { class: "chip tl-chip", href: `#/${t.id}` }, t.title))) : null,
    lifeBar(e),
    e.extract && linked("p", "d-extract", e.extract, [], { skip: id }),
    el("div", { class: "d-links" },
      e.url && el("a", { href: e.url, target: "_blank", rel: "noopener" }, "Wikipedia (English) ↗"),
      e.mrUrl && el("a", { href: e.mrUrl, target: "_blank", rel: "noopener" }, "विकिपीडिया (मराठी) ↗"),
      e.coords && el("a", { href: "#", onclick: (ev) => { ev.preventDefault(); closeDrawer(true); highlightPlaces([id]); $("#map").scrollIntoView({ behavior: "smooth", block: "center" }); } }, "Show on map"),
    ),
    askAI({ subject: e.title, type: e.type, context: [
      `${e.title}${e.description ? ` — ${e.description}` : ""}${dateLine ? ` (${dateLine})` : ""}`,
      e.extract ? e.extract.slice(0, 600) : "",
      evs.length ? `In the timeline "${tl.title}":\n${evs.slice(0, 10).map(evLine).join("\n")}` : "",
    ].filter(Boolean).join("\n") }),
    evs.length ? el("h3", {}, `In this timeline (${evs.length})`) : "",
    el("ul", { class: "d-events" }, evs.map((ev) =>
      el("li", { onclick: () => go(`#/${tl.id}/ev/${ev.id}`) }, el("span", { class: "d-ev-date" }, fmtDate(ev.date, ev.approx)), el("span", {}, ev.title)))),
    related.length ? el("h3", {}, "Connected") : "",
    el("div", { class: "chips" }, related.map(chip)),
  ].filter(Boolean));
  body.parentElement.scrollTop = 0;
  drawer.className = `drawer open t-${e.type}`;
  drawer.setAttribute("aria-hidden", "false");
  if (e.type === "place") highlightPlaces([id]);
}

function lifeBar(e) {
  // Show a person's / polity's span against the timeline's range
  const s = entStart(e), en = entEnd(e);
  if (e.type === "person" ? !(s && en) : !s && !en) return null; // a half-known lifespan would mislead
  const [r0, r1] = state.tl.range;
  const subj = state.entities[state.tl.subject];
  const pct = (t) => Math.min(100, Math.max(0, ((t - r0) / (r1 - r0)) * 100));
  const a = s ? parseDate(s).t : r0, b = en ? parseDate(en).t : r1;
  if (b < r0 || a > r1) return null;
  const hasSubj = subj && entStart(subj) && entEnd(subj);
  const sa = hasSubj ? parseDate(entStart(subj)).t : r0, sb = hasSubj ? parseDate(entEnd(subj)).t : r0;
  return el("div", {},
    el("div", { class: "life-bar" },
      hasSubj ? el("span", { class: "lb-subj", style: `left:${pct(sa)}%;width:${pct(sb) - pct(sa)}%`, title: subj.title }) : null,
      el("span", { class: "lb-ent", style: `left:${pct(a)}%;width:${Math.max(1, pct(b) - pct(a))}%` })),
    el("div", { class: "life-legend" }, el("span", {}, r0), el("span", {}, hasSubj ? `shaded: ${subj.title.replace("Chhatrapati ", "")}` : ""), el("span", {}, r1)));
}

// ---------- Start ----------
// Last, so every module-level binding (drawer, state, …) exists before the first route runs.
window.addEventListener("hashchange", () => route().catch(showError));
route().catch(showError);
