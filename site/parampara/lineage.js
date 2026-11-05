// Renders a guru–shishya tree for a page in site/parampara/. The page sets <body data-lineage="<id>">
// and this script draws <id>.json into #lineage. Needs d3 (loaded by the page from cdnjs).
//
// <id>.json: { eyebrow, title, intro, note, timelines?, kinds?, open?, select?, tree, succession? }
//   tree nodes: { name, alt?, dates?, kind, role?, note?, tl?, children? }  or  { group, children }
//   kind: guru | monastic | householder | woman | western | influence (or one defined in "kinds")
//   tl: an Itihas timeline id; the panel links to it.
//   kinds: extra or relabelled kinds, { "<kind>": { label, color: "--c3", fill?, dashed?, via? } };
//     dashed kinds draw dashed lines; via replaces "Drawn to the teaching through"; plural names them in
//     the panel's "In this tree" count.
//   lines: replaces the sentence explaining solid and dashed lines.
//   open: names whose branch (and its groups) start unfolded; the root is always open.
//   succession: { title, intro, list: [{ name, years, note? }] } drawn as a numbered list below.
(function () {
  const KINDS = {
    guru: { label: "Guru", color: "--c1", fill: true },
    monastic: { label: "Monastic disciple", color: "--c1" },
    householder: { label: "Householder disciple", color: "--c2" },
    woman: { label: "Woman disciple", color: "--c4" },
    western: { label: "Western disciple", color: "--c3" },
    influence: { label: "Influenced by the teaching", color: "--inf", dashed: true },
  };
  const DX = 30, DY = 250;
  const present = (...kids) => kids.filter((k) => k != null); // replaceChildren would print null as text
  const h = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const k in attrs || {}) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    for (const c of kids.flat()) if (c != null) n.append(c);
    return n;
  };

  async function main() {
    const id = document.body.dataset.lineage;
    const L = await (await fetch(`${id}.json`, { cache: "no-cache" })).json();
    const kinds = { ...KINDS, ...(L.kinds || {}) };
    let timelines = {};
    try { timelines = Object.fromEntries((await (await fetch("../data/index.json")).json()).map((t) => [t.id, t.title])); } catch {}

    const data = d3.hierarchy(L.tree);
    data.descendants().forEach((d, i) => { d.id = i; d._children = d.children; d.data.name ??= d.data.group; });

    const isGroup = (d) => d.data.group != null;

    // ---- page frame ----
    const used = new Set();
    (function walk(n) { if (n.kind) used.add(n.kind); (n.children || []).forEach(walk); })(L.tree);
    const legend = h("div", { class: "legend", "aria-label": "Legend" },
      Object.entries(kinds).filter(([k]) => used.has(k)).map(([, k]) => k.dashed
        ? h("span", {}, h("i", { class: "dot dashed", style: `--c:var(${k.color})` }), h("i", { class: "dash" }), k.label)
        : h("span", {}, h("i", { class: `dot${k.fill ? " fill" : ""}`, style: `--c:var(${k.color})` }), k.label)));
    const expandBtn = h("button", { type: "button" }, "Expand all");
    const resetBtn = h("button", { type: "button" }, "Reset");
    const box = h("div", { class: "tree-box" });
    const panel = h("aside", { class: "panel", "aria-live": "polite" });
    const related = (L.timelines || []).filter((t) => timelines[t]);
    const root = document.getElementById("lineage");
    root.replaceChildren(...present(
      h("header", { class: "head" },
        h("div", { class: "eyebrow" }, L.eyebrow || "Guru–shishya parampara"),
        h("h1", {}, L.title),
        h("p", { class: "lede" }, L.intro, " ", L.lines || "Solid lines mean initiation or direct discipleship; dashed lines mean influence only.", " Click a name to read about them, and click again to fold or unfold their branch."),
        related.length ? h("div", { class: "related" }, "Timelines:", related.map((t) => h("a", { href: `../#/${t}` }, timelines[t]))) : null),
      h("div", { class: "controls" }, legend, h("div", { class: "btns" }, expandBtn, resetBtn)),
      h("div", { class: "stage" }, box, panel),
      L.succession ? succession(L.succession) : null,
      L.note ? h("footer", {}, L.note) : null));
    document.title = `${L.title} — Parampara — Itihas`;

    // ---- tree ----
    const open = new Set(L.open || []);
    const svg = d3.select(box).append("svg").attr("role", "tree").attr("aria-label", L.title);
    const gLinks = svg.append("g"), gNodes = svg.append("g");
    let selected = null;

    function reset() {
      data.descendants().forEach((d) => {
        if (!d._children) return;
        const show = d.depth === 0 || open.has(d.data.name) || (isGroup(d) && d.parent && open.has(d.parent.data.name));
        d.children = show ? d._children : null;
      });
    }
    function render() {
      d3.tree().nodeSize([DX, DY]).separation((a, b) => (a.parent === b.parent ? 1 : 1.3))(data);
      let x0 = Infinity, x1 = -Infinity, y1 = 0;
      data.each((d) => { x0 = Math.min(x0, d.x); x1 = Math.max(x1, d.x); y1 = Math.max(y1, d.y); });
      const pad = 24, left = 16, w = y1 + left + 270, ht = x1 - x0 + pad * 2;
      svg.attr("width", w).attr("height", ht).attr("viewBox", [-left, x0 - pad, w, ht]);

      gLinks.selectAll("path").data(data.links(), (d) => d.target.id).join("path")
        .attr("class", (d) => "link" + (kinds[d.target.data.kind]?.dashed ? " inf" : "") + (isGroup(d.source) || isGroup(d.target) ? " grp" : ""))
        .attr("d", d3.linkHorizontal().x((d) => d.y).y((d) => d.x));

      const node = gNodes.selectAll("g.node").data(data.descendants(), (d) => d.id).join((enter) => {
        const g = enter.append("g").attr("tabindex", 0).attr("role", "treeitem");
        g.each(function (d) {
          const s = d3.select(this), k = kinds[d.data.kind] || KINDS.monastic;
          if (isGroup(d)) s.append("rect").attr("x", -5).attr("y", -5).attr("width", 10).attr("height", 10).attr("rx", 2).attr("stroke", "var(--muted)").attr("stroke-width", 1.5);
          else s.append("circle").attr("r", d.depth === 0 ? 8 : 5.5).attr("stroke", `var(${k.color})`).attr("stroke-width", 2).attr("stroke-dasharray", k.dashed ? "2 2" : null);
          s.append("text").attr("class", "name").attr("x", 11).attr("dy", d.data.dates ? "-0.1em" : "0.35em");
          if (d.data.dates) s.append("text").attr("class", "sub").attr("x", 11).attr("dy", "1.15em").text(d.data.dates);
        });
        g.on("click", (e, d) => activate(d))
          .on("keydown", (e, d) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(d); } });
        return g;
      });
      const folded = (d) => d._children && !d.children;
      node.attr("transform", (d) => `translate(${d.y},${d.x})`)
        .attr("class", (d) => "node" + (isGroup(d) ? " group" : "") + (d === selected ? " sel" : ""))
        .attr("aria-expanded", (d) => (d._children ? !!d.children : null));
      node.select("circle").attr("fill", (d) => {
        const k = kinds[d.data.kind] || KINDS.monastic;
        return k.fill || folded(d) ? `var(${k.color})` : "var(--panel)";
      });
      node.select("rect").attr("fill", (d) => (folded(d) ? "var(--muted)" : "var(--panel)"));
      node.select("text.name").text((d) => isGroup(d)
        ? `${d.data.group} (${d._children.length})${folded(d) ? " +" : ""}`
        : d.data.name + (folded(d) ? `  +${d._children.length}` : ""));
    }
    function activate(d) {
      if (isGroup(d)) d.children = d.children ? null : d._children;
      else {
        if (d === selected && d._children) d.children = d.children ? null : d._children;
        else if (d._children && !d.children) d.children = d._children;
        show(d);
      }
      render();
    }
    function show(d) {
      selected = d;
      const n = d.data, k = kinds[n.kind] || KINDS.monastic;
      const chain = d.ancestors().slice(1).filter((p) => !isGroup(p)).map((p) => p.data.name);
      const below = (d._children || []).flatMap((c) => (isGroup(c) ? c._children : [c]));
      const tally = new Map();
      below.forEach((c) => {
        const ck = kinds[c.data.kind];
        const label = ck?.plural || (c.data.kind === "influence" ? "influenced" : ck?.dashed ? ck.label.toLowerCase() : "disciples");
        tally.set(label, (tally.get(label) || 0) + 1);
      });
      const counts = [...tally].map(([label, n]) => `${n} ${n === 1 && label.endsWith("s") ? label.slice(0, -1) : label}`).join(", ");
      panel.replaceChildren(...present(
        h("div", { class: "kind", style: `color:var(${k.color})` }, k.label),
        h("h2", {}, n.name),
        n.alt ? h("div", { class: "alt" }, n.alt) : null,
        n.dates ? h("div", { class: "dates" }, n.dates) : null,
        n.role ? h("p", { class: "role" }, n.role) : null,
        n.note ? h("p", {}, n.note) : null,
        chain.length ? h("div", { class: "chain" }, k.dashed ? (k.via || "Drawn to the teaching through ") : "Lineage: ",
          chain.flatMap((c, i) => [h("b", {}, c), i < chain.length - 1 ? " ← " : null])) : null,
        counts ? h("div", { class: "chain" }, `In this tree: ${counts}`) : null,
        h("div", { class: "links" },
          n.tl && timelines[n.tl] ? h("a", { href: `../#/${n.tl}` }, `Open the ${timelines[n.tl]} timeline →`) : null,
          h("a", { href: `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(n.name)}`, target: "_blank", rel: "noopener" }, "Search Wikipedia ↗"))));
    }
    function find(name) { return data.descendants().find((n) => !isGroup(n) && n.data.name === name); }
    function reveal(d) {
      for (let p = d.parent; p; p = p.parent) if (p._children) p.children = p._children;
      show(d); render();
      const top = d.x - d3.min(data.descendants(), (n) => n.x) + 24;
      box.scrollIntoView({ behavior: "smooth", block: "center" });
      box.scrollTo({ top: top - box.clientHeight / 2, left: Math.max(0, d.y - 120), behavior: "smooth" });
    }
    function succession(s) {
      return h("section", { class: "succession" }, h("h2", {}, s.title), s.intro ? h("p", {}, s.intro) : null,
        h("ol", {}, s.list.map((p, i) => {
          const inTree = !!find(p.name);
          const li = h("li", inTree ? { class: "in-tree", tabindex: 0 } : {},
            h("span", { class: "n" }, String(i + 1).padStart(2, "0")), h("span", {}, p.name),
            h("span", { class: "yrs" }, p.years), p.note ? h("span", { class: "g" }, p.note) : null);
          if (inTree) {
            li.addEventListener("click", () => reveal(find(p.name)));
            li.addEventListener("keydown", (e) => { if (e.key === "Enter") reveal(find(p.name)); });
          }
          return li;
        })));
    }

    expandBtn.onclick = () => { data.descendants().forEach((d) => { if (d._children) d.children = d._children; }); render(); };
    resetBtn.onclick = () => { reset(); render(); };
    reset();
    show(find(L.select) || data);
    render();
  }
  main().catch((err) => {
    document.getElementById("lineage").textContent = `Could not load this lineage: ${err.message}`;
  });
})();
