// Shared helpers for book guides in site/books/. Plain script; defines window.Book.
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const tip = document.createElement("div");
  tip.id = "tip"; tip.setAttribute("role", "tooltip");
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(tip));
  function showTip(e, html) {
    tip.innerHTML = html; tip.classList.add("on");
    tip.style.left = Math.min(e.clientX + 14, innerWidth - 290) + "px";
    tip.style.top = (e.clientY + 14) + "px";
  }
  function hideTip() { tip.classList.remove("on"); }
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
  window.Book = { svg, hover, showTip, hideTip, filters };
})();
