"""Build site/books/shivabharat-translation.html from content/translations/shivabharat/NN.md (one canto per file).

Usage: python3 scripts/build_shivabharat_translation.py content/translations/shivabharat site/books/books.json site/books/shivabharat-translation.html
"""
import html, json, re, sys

trdir, books, out = sys.argv[1:4]
L = json.load(open(books))
titles = {c["n"]: (c["title"], c["pages"]) for c in [b for b in L if b.get("id") == "shivabharat"][0]["chapters"]}
esc = html.escape


def inline(s):
    s = esc(s, quote=False)
    return re.sub(r"\*(.+?)\*", r"<em>\1</em>", s)


nav, body, total, verses = [], [], 0, 0
for n in range(1, 33):
    lines = open(f"{trdir}/{n:02d}.md").read().strip().split("\n")
    title, pages = titles[n]
    nav.append(f'<a href="#c{n}"><b>{n}</b><span>{esc(title)}</span></a>')
    parts = [f'<section class="canto" id="c{n}"><header><span class="eyebrow">Canto {n} · printed pp. {esc(pages)}</span><h2>{esc(title)}</h2></header>']
    for ln in lines[1:]:
        ln = ln.strip()
        if not ln:
            continue
        m = re.match(r"^(\d+(?:–\d+)?)\.\s+(.*)$", ln)
        if m:
            total += 1
            verses = max(verses, 0)
            last = int(m.group(1).split("–")[-1])
            parts.append(f'<p class="v" id="c{n}-{m.group(1).split("–")[0]}"><span class="vn">{m.group(1)}</span>{inline(m.group(2))}</p>')
        elif ln.startswith("*(") and ln.endswith(")*"):
            parts.append(f'<p class="gloss">{inline(ln[2:-2])}</p>')
        elif ln.startswith("*Thus ends") or ln.startswith("*Here the text"):
            parts.append(f'<p class="colophon">{inline(ln.strip("*"))}</p>')
        elif ln.startswith("*") and ln.endswith("*"):
            parts.append(f'<p class="spk">{inline(ln.strip("*"))}</p>')
        else:
            raise SystemExit(f"unrecognised line in canto {n}: {ln[:60]}")
    verses += last
    parts.append('<a class="top" href="#cantos">Back to the cantos ↑</a></section>')
    body.append("\n".join(parts))

page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Shivabharat in English — Books — Itihas</title>
<meta name="description" content="A complete English translation of Kavindra Paramananda's Shivabharat, the Sanskrit epic on Shivaji, all 32 cantos, made from S.M. Divekar's 1927 edition.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,700;1,9..144,500&family=Inter:wght@400;500;600;700&family=Noto+Sans+Devanagari:wght@500&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="book.css">
<style>
.cnav{{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px}}
.cnav a{{display:grid;grid-template-columns:2.4ch minmax(0,1fr);gap:8px;align-items:baseline;padding:8px 10px;border:1px solid var(--rule);border-radius:8px;background:var(--panel);text-decoration:none;font-size:14px;color:var(--ink2)}}
.cnav a:hover{{border-color:var(--c1)}}
.cnav b{{font-family:var(--display);color:var(--c1);font-weight:600}}
.canto{{gap:14px;scroll-margin-top:12px}}
.canto header{{display:grid;gap:6px;padding-bottom:6px;border-bottom:1px solid var(--rule)}}
.v{{display:grid;grid-template-columns:5.5ch minmax(0,1fr);gap:10px;font-size:16.5px;line-height:1.65;scroll-margin-top:12px}}
.vn{{font-family:var(--mono);font-size:12px;color:var(--muted);padding-top:4px;text-align:right}}
.spk{{font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--c1);padding-left:calc(5.5ch + 10px)}}
.spk em{{font-style:normal}}
.gloss{{font-size:14px;color:var(--ink2);padding-left:calc(5.5ch + 10px)}}
.colophon{{font-family:var(--display);font-style:italic;color:var(--ink2);font-size:15.5px;border-top:1px solid var(--rule);padding-top:12px}}
.colophon em{{font-style:normal}}
a.top{{font-size:13px;color:var(--c1);width:max-content}}
@media (max-width:520px){{.v{{grid-template-columns:4.5ch minmax(0,1fr);gap:8px}}.spk,.gloss{{padding-left:0}}}}
</style>
</head>
<body>
<header class="topbar"><a href="../#/" class="brand"><span class="brand-dev">इतिहास</span> Itihas</a><span class="crumb"><a href="../#/books">Books</a> / <a href="shivabharat.html">Shivabharat</a> / English translation</span></header>
<div class="wrap">
<header class="hero"><span class="eyebrow">Books on Itihas · full translation</span><h1>Shivabharat in English</h1>
<p class="byline"><b>Kavindra Paramananda</b> · Sanskrit, 17th century · translated from S.M. Divekar's edition (Pune, 1927)</p>
<p class="lede">The whole poem, all 32 cantos and {verses:,} verses, from Maloji's day to the summer of 1661, where the only manuscript breaks off.</p>
<p class="related">See also: <a href="shivabharat.html">The canto-by-canto guide →</a><a href="../#/shivaji">Shivaji timeline →</a></p>
<p class="note"><b>About this translation.</b> It is a plain prose rendering, made verse by verse from the Sanskrit in Divekar's 1927 edition. His Marathi translation was used to check readings and proper names. Verse numbers follow his edition; where he groups verses (for example 24–27), the English keeps them together. The poet uses Sanskrit forms for names: Shiva for Shivaji, Shah for Shahaji, Jija for Jijabai, and "copper-faced men" for the Mughals. The translation keeps these forms. Where Divekar identifies a Sanskritised place or family name, it is given in its usual Marathi form, such as Bhosle, Pune or Chakan. Like the poem itself, the translation keeps the court poet's view: Shivaji is Vishnu come to earth, and the Muslims are demons. Read it as a near-contemporary insider's account, not as neutral history. This is a new translation, and some readings of the scan are uncertain.</p>
</header>
<section id="cantos"><span class="eyebrow">The cantos</span><nav class="cnav">{"".join(nav)}</nav></section>
{chr(10).join(body)}
<footer>Translated for Itihas from Kavindra Paramananda's Shivabharat, ed. and tr. into Marathi by S.M. Divekar (Bharat Itihas Samshodhak Mandal, Pune, 1927). Printed page numbers refer to that edition.</footer>
</div>
</body>
</html>
"""
open(out, "w").write(page)
print("verses:", verses, "passages:", total)
