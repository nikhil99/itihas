// Shared helpers for book guides in site/books/. Plain script; defines window.Book.
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const tip = document.createElement("div");
  tip.id = "tip"; tip.setAttribute("role", "tooltip"); window.__bookTip = tip;
  document.addEventListener("DOMContentLoaded", () => { if (!document.getElementById("tip")) document.body.appendChild(tip); });
  function showTip(e, html) {
    const tip = document.getElementById("tip") || window.__bookTip;
    tip.innerHTML = html; tip.classList.add("on");
    tip.style.left = Math.min(e.clientX + 14, innerWidth - 290) + "px";
    tip.style.top = (e.clientY + 14) + "px";
  }
  function hideTip() { (document.getElementById("tip") || tip).classList.remove("on"); }
  function svg(tag, attrs, parent, text) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function hover(node, html) {
    node.addEventListener("mousemove", (e) => showTip(e, html));
    node.addEventListener("mouseleave", hideTip);
    node.addEventListener("focus", () => { const r = node.getBoundingClientRect(); showTip({ clientX: r.right, clientY: r.top }, html); });
    node.addEventListener("blur", hideTip);
  }
  // Pill buttons with data-f; items with data-g are shown when they match (or "all").
  function filters(group, items) {
    const btns = [...group.querySelectorAll("button")];
    btns.forEach((b) => b.addEventListener("click", () => {
      btns.forEach((x) => x.setAttribute("aria-pressed", x === b));
      items.forEach((k) => { k.hidden = !(b.dataset.f === "all" || k.dataset.g === b.dataset.f); });
    }));
  }
  // ---- References to the original book (data in books.json) ----
  // <a class="ref" data-ch="2"></a> becomes a link to chapter 2 (online books) or its page range
  // (printed books); data-pages="52–53" adds exact pages. A "Read the book" chapter list is added
  // before the footer of every book page, so readers can always go to the source.
  const bookId = location.pathname.split("/").pop().replace(/\.html$/, "");
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  async function sources() {
    let book;
    try { book = (await (await fetch("books.json", { cache: "no-cache" })).json()).find((b) => b.id === bookId); } catch { return; }
    if (!book || !book.chapters) return;
    const byN = Object.fromEntries(book.chapters.filter((c) => c.n != null).map((c) => [c.n, c]));
    document.querySelectorAll("a.ref[data-ch]").forEach((a) => {
      const c = byN[a.dataset.ch]; if (!c) return;
      const pages = a.dataset.pages || c.pages;
      if (c.url) { a.href = c.url; a.target = "_blank"; a.rel = "noopener"; }
      if (!a.textContent.trim()) a.textContent = `Ch. ${c.n}${pages ? `, pp. ${pages}` : ""}${c.url ? " · read it ↗" : ""}`;
      a.title = `Chapter ${c.n}: ${c.title}`;
    });
    const footer = document.querySelector("footer");
    if (!footer || document.getElementById("read-the-book")) return;
    const sec = document.createElement("div");
    sec.className = "wrap"; sec.id = "read-the-book";
    sec.innerHTML = `<section><span class="eyebrow">Read the book</span><h2>Go to the source</h2>
      <p class="lede">${book.source ? `The full text is free to read online. Every chapter below opens the original.` : `This guide cites the printed edition by page number.`}</p>
      ${book.edition ? `<p class="src">${esc(book.edition)}</p>` : ""}
      <ol class="sources">${book.chapters.map((c) => {
        const label = `${c.n != null ? `<span class="n">${c.n}</span>` : `<span class="n">·</span>`}<span class="t">${esc(c.title)}</span>${c.pages ? `<span class="p">pp. ${c.pages}</span>` : ""}`;
        return `<li>${c.url ? `<a href="${c.url}" target="_blank" rel="noopener">${label}<span class="go">↗</span></a>` : `<div>${label}</div>`}</li>`;
      }).join("")}</ol>
      ${book.source ? `<p><a class="ref" href="${book.source}" target="_blank" rel="noopener">Open the whole book ↗</a></p>` : ""}</section>`;
    footer.parentElement.before(sec);
  }
  document.addEventListener("DOMContentLoaded", sources);

  window.Book = { svg, hover, showTip, hideTip, filters };
})();
