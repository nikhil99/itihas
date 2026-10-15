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
  const [tlId, kind, id] = parts;
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
  const [index, entities] = await Promise.all([load("data/index.json"), load("data/entities.json")]);
  document.title = "Itihas — Indian History Timelines";
  const upcoming = ["Delhi Sultanate", "Vijayanagara", "The Deccan Sultanates", "The Maurya Empire", "The Cholas"];
  const card = (t) => {
    const subj = entities[t.subject];
    return el("a", { class: `tl-card${t.kind === "empire" ? " overview" : ""}`, href: `#/${t.id}` },
      subj?.thumb && el("img", { src: subj.thumb, alt: "" }),
      el("div", {}, el("h3", {}, t.title), el("p", {}, t.subtitle), el("p", {}, `${t.events} events`)));
  };
  const empires = index.filter((t) => t.kind === "empire").sort((a, b) => a.order - b.order);
  const series = [...new Set(index.filter((t) => t.kind !== "empire").map((t) => t.series || "Other"))];
  $("#app").replaceChildren(
    el("section", { class: "home" },
      el("h1", {}, "Indian history, as timelines"),
      el("p", { class: "lead" }, "Explore people, empires and places through interactive timelines. Every name and place is clickable, with summaries drawn from Wikipedia."),
      empires.length ? el("div", { class: "series" },
        el("h2", { class: "series-title" }, "Empires"),
        el("div", { class: "cards" }, empires.map(card))) : null,
      series.map((name) => el("div", { class: "series" },
        el("h2", { class: "series-title" }, name === "Other" ? "Other timelines"
          : index.some((t) => t.series === name && t.kind === "state") ? `${name.replace(/^The /, "")} — the great houses` : `People of ${name.replace(/^The /, "the ")}`),
        el("div", { class: "cards" }, index.filter((t) => t.kind !== "empire" && (t.series || "Other") === name).map(card)))),
      el("div", { class: "series" },
        el("h2", { class: "series-title" }, "Coming later"),
        el("div", { class: "cards" }, upcoming.map((u) => el("div", { class: "tl-card soon" }, el("div", {}, el("h3", {}, u), el("p", {}, "Not started yet")))))),
    ),
  );
}

// ---------- Timeline page ----------
async function renderTimelinePage(id) {
  const [tl, entities, index] = await Promise.all([load(`data/timelines/${id}.json`), load("data/entities.json"), load("data/index.json")]);
  state.subjectTimeline = Object.fromEntries(index.filter((t) => t.id !== tl.id).map((t) => [t.subject, t.id]));
  state.tl = tl;
  state.entities = entities;
  state.selected = null;
  state.view = { start: tl.range[0], end: tl.range[1] };
  state.lanesOn = new Set(tl.lanes.map((l) => l.id));
  tl.events.forEach((ev) => { ev._t = parseDate(ev.date).t; ev._te = ev.end ? parseDate(ev.end).t : null; });
  document.title = `${tl.title} — Itihas`;

  const subj = entities[tl.subject];
  const hero = el("section", { class: "hero" },
    subj.thumb ? el("img", { src: subj.thumb, alt: subj.title }) : el("div"),
    el("div", {},
      el("h1", {}, tl.title),
      subj.labels?.mr && el("div", { class: "dev" }, subj.labels.mr),
      el("p", { class: "sub" }, tl.subtitle),
      (() => { const p = linked("p", "extract", tl.intro || subj.extract, [], { skip: tl.subject }); p.append(" ", el("a", { href: `#/${tl.id}/e/${tl.subject}` }, "More →")); return p; })(),
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

  $("#app").replaceChildren(...[seriesNav, hero, toolbar].filter(Boolean), tlBox, el("div", { class: "below" }, story, mapWrap));
  state.renderTimeline = setupTimeline(tlBox);
  setupMap();
}

// ---------- Inline entity links ----------
// A name with its own timeline links straight to that timeline; anything else opens its side panel.
const entHref = (id) => state.subjectTimeline?.[id] ? `#/${state.subjectTimeline[id]}` : `#/${state.tl.id}/e/${id}`;
// Like Wikipedia: names of people, places and states become links wherever they appear.
// Entities referenced by an event match on all their names; other entities match only on
// names that are unambiguous across the whole registry (so "Nizam" or "Bijapur" never
// guess wrong), and generic lower-case aliases ("navy", "chauth") only when referenced.
const GLOBAL_STOP = new Set(["Akbar", "Nizam", "Bhau", "Mughal", "Mughals", "Marathas", "Maratha state", "English", "Afghan", "Bengal", "Hyderabad", "Shindes", "Holkars", "Gwalior", "Bhosale"]);
const reEsc = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const namesOf = (e) => [...new Set([...(e.aliases || []), e.title, e.title?.replace(/\s*\(.*\)$/, "")])].filter((n) => n && n.length > 2);

function globalNames() {
  if (state._globalFor === state.entities) return state._global;
  const owners = {};
  for (const [id, e] of Object.entries(state.entities)) for (const n of namesOf(e)) (owners[n] ||= new Set()).add(id);
  const list = [];
  for (const [n, ids] of Object.entries(owners)) {
    if (ids.size !== 1 || GLOBAL_STOP.has(n) || !/^\p{Lu}/u.test(n)) continue;
    list.push({ id: [...ids][0], n, re: new RegExp(`(?<![\\p{L}])${reEsc(n)}(?![\\p{L}])`, "u") });
  }
  state._globalFor = state.entities;
  state._global = list;
  return list;
}

function linkify(text, ids = [], { skip } = {}) {
  if (!text) return "";
  const ents = state.entities;
  const names = [];
  for (const id of ids) {
    const e = ents[id];
    if (!e) continue;
    for (const n of namesOf(e)) names.push({ id, n, re: new RegExp(`(?<![\\p{L}])${reEsc(n)}(?![\\p{L}])`, "u") });
  }
  names.push(...globalNames());
  names.sort((a, b) => b.n.length - a.n.length);
  const taken = [], done = new Set(skip ? [skip] : []);
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
    const p = linked("p", null, ev.summary, evRefs(ev));
    wrap.append(el("article", {
      class: `card${ev.major ? " major" : ""}`, id: `card-${ev.id}`, "data-lane": ev.lane, "data-year": y,
      style: `--lane:var(--lane-${ev.lane})`,
      onclick: (e) => { if (!e.target.closest("a")) go(`#/${tl.id}/ev/${ev.id}`); },
    },
      ev.thumb && el("img", { class: "thumb", src: ev.thumb, alt: "", loading: "lazy" }),
      el("div", { class: "meta" }, el("span", { class: "lane-tag" }, laneLabel[ev.lane]), el("span", {}, fmtRange(ev))),
      el("h3", {}, ev.title),
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
    const { ctx: ctxOpen, lanes: lanesOpen } = state.expanded;

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
    const focus = tl.focus || (entStart(subj) && entEnd(subj) && [parseDate(entStart(subj)).t, parseDate(entEnd(subj)).t]);
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
      const toggle = () => { state.expanded[key] = !state.expanded[key]; saveExpanded(); render(); };
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
      rowLabel(row.label, rowGeom[ri].bar + R_BAR / 2 + 4, 12);
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
    s.append(head(lanesHead, lanesOpen, `All ${tl.events.length} events by category${lanesOpen ? "" : ` (+${minorCount} more)`}`, "lanes"));
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
    e.description && el("p", { class: "d-desc" }, e.description),
    dateLine && el("div", { class: "d-dates" }, dateLine),
    ownTimeline && el("a", { class: "own-tl", href: `#/${ownTimeline.id}` }, `Open the ${ownTimeline.title} timeline →`),
    lifeBar(e),
    e.extract && linked("p", "d-extract", e.extract, [], { skip: id }),
    el("div", { class: "d-links" },
      e.url && el("a", { href: e.url, target: "_blank", rel: "noopener" }, "Wikipedia (English) ↗"),
      e.mrUrl && el("a", { href: e.mrUrl, target: "_blank", rel: "noopener" }, "विकिपीडिया (मराठी) ↗"),
      e.coords && el("a", { href: "#", onclick: (ev) => { ev.preventDefault(); closeDrawer(true); highlightPlaces([id]); $("#map").scrollIntoView({ behavior: "smooth", block: "center" }); } }, "Show on map"),
    ),
    evs.length ? el("h3", {}, `In this timeline (${evs.length})`) : "",
    el("ul", { class: "d-events" }, evs.map((ev) =>
      el("li", { onclick: () => go(`#/${tl.id}/ev/${ev.id}`) }, el("span", { class: "d-ev-date" }, fmtDate(ev.date, ev.approx)), el("span", {}, ev.title)))),
    otherTimelines.length ? el("h3", {}, "Also appears in") : "",
    el("div", { class: "chips" }, otherTimelines.map((t) => el("a", { class: "chip tl-chip", href: `#/${t.id}/e/${id}` }, t.title))),
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
  const sa = parseDate(entStart(subj)).t, sb = parseDate(entEnd(subj)).t;
  return el("div", {},
    el("div", { class: "life-bar" },
      el("span", { class: "lb-subj", style: `left:${pct(sa)}%;width:${pct(sb) - pct(sa)}%`, title: subj.title }),
      el("span", { class: "lb-ent", style: `left:${pct(a)}%;width:${Math.max(1, pct(b) - pct(a))}%` })),
    el("div", { class: "life-legend" }, el("span", {}, r0), el("span", {}, `shaded: ${subj.title.replace("Chhatrapati ", "")}`), el("span", {}, r1)));
}

// ---------- Start ----------
// Last, so every module-level binding (drawer, state, …) exists before the first route runs.
window.addEventListener("hashchange", () => route().catch(showError));
route().catch(showError);
