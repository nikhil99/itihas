// Renders a book guide from <id>.json next to the page (see README, "Books").
// The page is a shell: <body data-guide="<id>"> plus book.css, book.js and this file.
// JSON: { title, byline, lede, facts:[[big, small]], related:[[href,label]], note,
//         sections:[{ type, eyebrow, title, lede, ch, pages, wide, ... }], footer }
// Section types: timeline, cards, table, bars, compare, steps, quote, list, text.
(function () {
  const id = document.body.dataset.guide;
  const h = (s) => (s == null ? "" : String(s));
  const ref = (s) => (s.ch != null ? `<a class="ref" data-ch="${s.ch}"${s.pages ? ` data-pages="${s.pages}"` : ""}></a>` : "");
  const colors = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--muted)"];
  const col = (c) => (c == null ? "var(--c1)" : typeof c === "number" ? colors[c % colors.length] : c);

  const R = {
    timeline(s) {
      let c = col(s.color);
      return `<div class="vt">${s.items.map((e) => {
        if (!Array.isArray(e)) { c = col(e.color); return `<div class="era" style="--c:${c}">${h(e.era)}</div>`; }
        return `<div class="ev${e[3] ? " after" : ""}" style="--c:${c}"><span class="yr">${h(e[0])}</span><div><b>${h(e[1])}</b>${e[2] ? `<br><span>${h(e[2])}</span>` : ""}</div></div>`;
      }).join("")}</div>`;
    },
    cards(s) {
      return `<div class="cards">${s.items.map((k) => {
        const [key, head, body, c] = Array.isArray(k) ? (k.length === 2 ? [k[0], "", k[1]] : k) : [k.k, k.h, k.p, k.c];
        return `<div class="card" style="--c:${col(c ?? s.color)}">${key ? `<span class="k">${h(key)}</span>` : ""}${head ? `<h3>${h(head)}</h3>` : ""}<p>${h(body)}</p></div>`;
      }).join("")}</div>`;
    },
    table(s) {
      return `<div class="fig scroll"><table class="gt">${s.head ? `<thead><tr>${s.head.map((x, i) => `<th${s.colors && s.colors[i] != null ? ` style="color:${col(s.colors[i])}"` : ""}>${h(x)}</th>`).join("")}</tr></thead>` : ""}<tbody>${s.rows.map((r) => `<tr>${r.map((x, i) => (i === 0 && s.rowhead !== false ? `<th>${h(x)}</th>` : `<td>${h(x)}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>`;
    },
    bars(s) {
      return `<div class="fig"><svg class="bars" data-i="${s._i}" style="width:100%;height:auto" role="img" aria-label="${h(s.title)}"></svg>${s.note ? `<p class="src">${h(s.note)}</p>` : ""}</div>`;
    },
    compare(s) {
      return `<div class="gcmp">${s.cols.map((c, i) => `<div class="card" style="--c:${col(c.color ?? i)}"><span class="k">${h(c.k)}</span>${c.h ? `<h3>${h(c.h)}</h3>` : ""}${c.p ? `<p>${h(c.p)}</p>` : ""}${c.items ? `<ul>${c.items.map((x) => `<li>${h(x)}</li>`).join("")}</ul>` : ""}</div>`).join("")}</div>`;
    },
    steps(s) {
      return `<div class="gsteps">${s.items.map((x, i) => `<div style="--c:${col(x[3] ?? s.color)}"><span class="d">${h(x[0])}</span><b>${h(x[1])}</b><span>${h(x[2])}</span></div>`).join("")}</div>`;
    },
    quote(s) { return `<blockquote>${h(s.q)}<cite>${h(s.cite)}</cite></blockquote>`; },
    list(s) { return `<ol class="chapters">${s.items.map((x) => `<li><div><b>${h(x[0])}</b><span>${h(x[1])}</span></div></li>`).join("")}</ol>`; },
    chips(s) {
      return `${s.key ? `<div class="key">${s.key.map((k, i) => `<span><i class="sw" style="--c:${col(i)}"></i>${h(k)}</span>`).join("")}</div>` : ""}<div class="gchips">${s.items.map((x) => {
        const [t, g, tip] = Array.isArray(x) ? x : [x, 0];
        return `<span style="--c:${col(g)}"${tip ? ` title="${h(tip).replace(/"/g, "&quot;")}"` : ""}>${h(t)}</span>`;
      }).join("")}</div>`;
    },
    text() { return ""; },
  };

  function drawBars(svgEl, s) {
    const items = s.items, L = s.labelWidth || 170, W = 680, R = 64, rh = 34, top = 6;
    const max = s.max || Math.max(...items.map((x) => x[1])) * 1.08;
    const H = top + items.length * rh + 30;
    svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const X = (v) => L + (v / max) * (W - L - R);
    const ticks = s.ticks || [0, max / 2, max].map((v) => Math.round(v));
    ticks.forEach((v) => {
      Book.svg("line", { x1: X(v), x2: X(v), y1: top, y2: top + items.length * rh, stroke: "var(--rule)" }, svgEl);
      Book.svg("text", { x: X(v), y: top + items.length * rh + 18, "text-anchor": "middle", "font-size": 12, class: "mono muted" }, svgEl, v.toLocaleString("en-IN"));
    });
    items.forEach((d, i) => {
      const y = top + i * rh, bh = rh - 12, w = Math.max(3, X(d[1]) - L);
      Book.svg("text", { x: L - 10, y: y + rh / 2 + 5, "text-anchor": "end", "font-size": 13.5 }, svgEl, d[0]);
      const g = Book.svg("g", { tabindex: 0 }, svgEl);
      Book.svg("path", { d: `M${L} ${y + 6} h${w - 4} a4 4 0 0 1 4 4 v${bh - 8} a4 4 0 0 1 -4 4 h${-(w - 4)} Z`, fill: col(d[3] ?? s.color ?? 0) }, g);
      Book.svg("rect", { x: L, y, width: W - L, height: rh, fill: "transparent" }, g);
      Book.svg("text", { x: X(d[1]) + 8, y: y + rh / 2 + 5, "font-size": 12.5, class: "mono ink2" }, g, `${d[1].toLocaleString("en-IN")}${s.unit ? " " + s.unit : ""}`);
      if (d[2]) Book.hover(g, `<b>${d[0]}</b><br>${d[2]}`);
    });
  }

  async function render() {
    let g;
    try { g = await (await fetch(`${id}.json`, { cache: "no-cache" })).json(); }
    catch (e) { document.body.insertAdjacentHTML("beforeend", `<div class="wrap"><p class="note">This guide could not be loaded. Try reloading the page.</p></div>`); return; }
    document.title = `${g.title} — Books — Itihas`;
    const top = `<header class="topbar"><a href="../#/" class="brand"><span class="brand-dev">इतिहास</span> Itihas</a><span class="crumb"><a href="../#/books">Books</a> / ${h(g.title)}</span></header>`;
    const hero = `<div class="wrap"><header class="hero"><span class="eyebrow">Books on Itihas · a visual guide</span><h1>${h(g.title)}</h1><p class="byline">${h(g.byline)}</p><p class="lede">${h(g.lede)}</p>
      ${g.facts ? `<div class="facts">${g.facts.map((f) => `<div><b>${h(f[0])}</b><small>${h(f[1])}</small></div>`).join("")}</div>` : ""}
      ${g.related && g.related.length ? `<p class="related">On Itihas: ${g.related.map((r) => `<a href="../#/${r[0]}">${h(r[1])} →</a>`).join("")}</p>` : ""}
      ${g.note ? `<p class="note"><b>About this guide.</b> ${h(g.note)}</p>` : ""}</header></div>`;
    const secs = g.sections.map((s, i) => {
      s._i = i;
      const body = (R[s.type] || R.text)(s);
      const head = `<span class="eyebrow">${h(s.eyebrow)}</span>${s.title ? `<h2>${h(s.title)}</h2>` : ""}${s.lede ? `<p class="lede">${h(s.lede)}</p>` : ""}`;
      const after = s.after ? `<p class="lede">${h(s.after)}</p>` : "";
      if (s.wide) return `<div class="wide"><section><div class="intro">${head}</div>${body}${after}${ref(s)}</section></div>`;
      return `<div class="wrap"><section>${head}${body}${after}${ref(s)}</section></div>`;
    }).join("");
    const foot = `<div class="wrap"><footer>${h(g.footer)}</footer></div>`;
    document.body.insertAdjacentHTML("afterbegin", top + hero + secs + foot);
    g.sections.forEach((s, i) => { if (s.type === "bars") drawBars(document.querySelector(`svg.bars[data-i="${i}"]`), s); });
    Book.sources();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render); else render();
})();
