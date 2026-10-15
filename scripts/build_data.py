#!/usr/bin/env python3
"""Build site data from curated content + Wikipedia/Wikidata.

Reads   content/entities/*.json and content/timelines/*.json
Fetches Wikipedia REST summaries (extract, image, coordinates) and
        Wikidata claims (birth/death, inception/dissolution, Marathi/Hindi names)
Writes  site/data/entities.json, site/data/timelines/<id>.json, site/data/index.json

Responses are cached in .cache/ so re-runs are fast and offline-friendly.
Use --refresh to ignore the cache.  Stdlib only.
"""
import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
OUT = ROOT / "site" / "data"
CACHE = ROOT / ".cache"
UA = "ItihasTimeline/0.1 (https://github.com/nikhil99/itihas; personal educational project)"

REFRESH = False


def load_registry():
    """Merge content/entities/*.json into one registry.

    The registry is split into topic files so that branches adding different
    timelines edit different files instead of all appending to one.
    """
    legacy = CONTENT / "entities.json"
    if legacy.exists():
        sys.exit(f"{legacy.relative_to(ROOT)} is no longer used: move its entries into a file in "
                 f"content/entities/ (e.g. content/entities/<topic>.json) and delete it.")
    registry, origin = {}, {}
    for path in sorted((CONTENT / "entities").glob("*.json")):
        try:
            data = json.loads(path.read_text())
        except json.JSONDecodeError as e:
            sys.exit(f"{path.relative_to(ROOT)}: invalid JSON: {e}")
        for eid, spec in data.items():
            if eid.startswith("_"):
                continue
            if eid in registry:
                sys.exit(f"duplicate entity id {eid!r} in {path.name} and {origin[eid]}")
            registry[eid], origin[eid] = spec, path.name
    if not registry:
        sys.exit("no entities found in content/entities/*.json")
    return registry


def fetch_json(url):
    CACHE.mkdir(exist_ok=True)
    key = CACHE / (hashlib.sha1(url.encode()).hexdigest() + ".json")
    if key.exists() and not REFRESH:
        return json.loads(key.read_text())
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read().decode())
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                data = None
                break
            if attempt == 5:
                raise
            # Wikimedia rate-limits bursts; honour Retry-After when given.
            wait = int(e.headers.get("Retry-After") or 0) or 5 * (attempt + 1)
            print(f"  HTTP {e.code}, retrying in {wait}s…", file=sys.stderr)
            time.sleep(wait)
    key.write_text(json.dumps(data))
    time.sleep(0.5)  # be polite to Wikimedia
    return data


def wiki_summary(title):
    url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title.replace(" ", "_"), safe="")
    d = fetch_json(url)
    if not d or d.get("type") == "https://mediawiki.org/wiki/HyperSwitch/errors/not_found":
        return None
    out = {
        "title": d.get("title"),
        "description": d.get("description"),
        "extract": d.get("extract"),
        "url": d.get("content_urls", {}).get("desktop", {}).get("page"),
        "qid": d.get("wikibase_item"),
        "disambiguation": d.get("type") == "disambiguation",
    }
    if d.get("thumbnail"):
        out["thumb"] = d["thumbnail"]["source"]
    if d.get("originalimage"):
        out["image"] = d["originalimage"]["source"]
    if d.get("coordinates"):
        out["coords"] = {"lat": d["coordinates"]["lat"], "lon": d["coordinates"]["lon"]}
    return out


def wd_time(claims, prop):
    """First Wikidata time value for prop as {value, precision} (value like '1630-02-19')."""
    for c in claims.get(prop, []):
        v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
        if not v or "time" not in v:
            continue
        t = v["time"]  # '+1630-02-19T00:00:00Z'
        sign = -1 if t.startswith("-") else 1
        y, m, d = t[1:].split("T")[0].split("-")
        prec = {9: "year", 10: "month", 11: "day"}.get(v.get("precision"), "year")
        year = sign * int(y)
        if prec == "year" or m == "00":
            return {"value": str(year), "precision": "year"}
        if prec == "month" or d == "00":
            return {"value": f"{year:04d}-{m}", "precision": "month"}
        return {"value": f"{year:04d}-{m}-{d}", "precision": "day"}
    return None


def wd_coords(claims):
    for c in claims.get("P625", []):
        v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
        if v:
            return {"lat": v["latitude"], "lon": v["longitude"]}
    return None


def wikidata(qids):
    out = {}
    qids = [q for q in qids if q]
    for i in range(0, len(qids), 50):
        batch = qids[i : i + 50]
        url = (
            "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json"
            "&props=claims|labels|sitelinks&languages=en|mr|hi&sitefilter=enwiki|mrwiki|hiwiki"
            "&ids=" + "|".join(batch)
        )
        d = fetch_json(url) or {}
        for qid, ent in d.get("entities", {}).items():
            claims = ent.get("claims", {})
            labels = {k: v["value"] for k, v in ent.get("labels", {}).items()}
            sl = ent.get("sitelinks", {})
            dates = {}
            for name, prop in [("born", "P569"), ("died", "P570"), ("founded", "P571"),
                               ("dissolved", "P576"), ("start", "P580"), ("end", "P582")]:
                t = wd_time(claims, prop)
                if t:
                    dates[name] = t
            out[qid] = {
                "labels": {k: v for k, v in labels.items() if k in ("mr", "hi")},
                "mrUrl": ("https://mr.wikipedia.org/wiki/" + urllib.parse.quote(sl["mrwiki"]["title"].replace(" ", "_")))
                if "mrwiki" in sl else None,
                "dates": dates,
                "coords": wd_coords(claims),
            }
    return out


def year_of(value):
    """'1630-02-19' / '1630-02' / '1630' / '-500' -> fractional year."""
    v = str(value)
    sign = -1 if v.startswith("-") else 1
    parts = [int(x) for x in v.lstrip("-").split("-")]
    y = sign * parts[0]
    m = parts[1] if len(parts) > 1 else 6
    d = parts[2] if len(parts) > 2 else 15
    return round(y + (m - 1) / 12 + (d - 1) / 365, 3)


def span_of(tl, entities):
    """The years a timeline is 'about': a person's lifetime, an empire's period."""
    subj = entities.get(tl["subject"], {})
    dates = subj.get("dates", {})
    if subj.get("type") == "person" and not tl.get("rulers") and "born" in dates and "died" in dates:
        return [year_of(dates["born"]["value"]), year_of(dates["died"]["value"])]
    if tl.get("focus"):
        return tl["focus"]
    members = [m for row in tl.get("rulers", []) for m in row["members"]]
    if members:
        return [min(m["from"] for m in members), max(m["to"] for m in members)]
    return tl["range"]


def main():
    global REFRESH
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="ignore cached API responses")
    REFRESH = ap.parse_args().refresh

    registry = load_registry()
    timelines = [json.loads(p.read_text()) for p in sorted((CONTENT / "timelines").glob("*.json"))]
    problems = []

    # Every entity referenced by a timeline must be registered.
    for tl in timelines:
        refs = {tl["subject"]} | {c["entity"] for c in tl.get("context", [])}
        refs |= {m["entity"] for row in tl.get("rulers", []) for m in row["members"] if m.get("entity")}
        for ev in tl["events"]:
            for k in ("people", "places", "polities", "concepts"):
                refs |= set(ev.get(k, []))
        for r in sorted(refs - registry.keys()):
            problems.append(f"[{tl['id']}] unknown entity id: {r}")

    entities = {}
    print(f"Fetching {len(registry)} entities from Wikipedia…")
    for eid, spec in registry.items():
        if spec.get("wiki") is None:  # no Wikipedia article: curated name/description only
            entities[eid] = {"id": eid, "type": spec["type"], "title": spec["name"],
                             "description": spec.get("description"), "aliases": spec.get("aliases", [])}
            continue
        s = wiki_summary(spec["wiki"])
        if not s:
            problems.append(f"no Wikipedia page for {eid!r} ({spec['wiki']!r})")
            s = {"title": spec["wiki"]}
        elif s["disambiguation"]:
            problems.append(f"{eid!r} -> {spec['wiki']!r} is a disambiguation page")
        e = {"id": eid, "type": spec["type"], **{k: v for k, v in s.items() if k != "disambiguation"}}
        if spec.get("name"):
            e["title"] = spec["name"]
        if spec.get("aliases"):
            e["aliases"] = spec["aliases"]
        entities[eid] = e

    print("Fetching Wikidata…")
    wd = wikidata([e.get("qid") for e in entities.values()])
    for e in entities.values():
        extra = wd.get(e.get("qid") or "", {})
        e["labels"] = extra.get("labels", {})
        e["mrUrl"] = extra.get("mrUrl")
        e["dates"] = extra.get("dates", {})
        # Curated dates win over Wikidata (which is sometimes contested or wrong).
        for k, v in registry[e["id"]].get("dates", {}).items():
            e["dates"][k] = {"value": v, "precision": {4: "year", 7: "month"}.get(len(v), "day")}
        if not e.get("coords") and extra.get("coords") and e["type"] == "place":
            e["coords"] = extra["coords"]
        if registry[e["id"]].get("coords"):
            e["coords"] = registry[e["id"]]["coords"]
        if e["type"] == "place" and not e.get("coords"):
            problems.append(f"place {e['id']!r} has no coordinates (add \"coords\" to its entry in content/entities/)")

    (OUT / "timelines").mkdir(parents=True, exist_ok=True)
    index = []
    timeline_ids = {tl["id"] for tl in timelines}
    entity_timelines = {}
    for tl in timelines:
        for ev in tl["events"]:
            if ev.get("wiki"):
                s = wiki_summary(ev["wiki"])
                if s and not s["disambiguation"]:
                    ev["wikiUrl"] = s["url"]
                    if s.get("thumb"):
                        ev["thumb"] = s["thumb"]
                else:
                    problems.append(f"[{tl['id']}] event {ev['id']!r}: bad wiki title {ev['wiki']!r}")
            if ev.get("see") and ev["see"] not in timeline_ids:
                problems.append(f"[{tl['id']}] event {ev['id']!r}: 'see' points to unknown timeline {ev['see']!r}")
        ids = [ev["id"] for ev in tl["events"]]
        for dup in sorted({i for i in ids if ids.count(i) > 1}):
            problems.append(f"[{tl['id']}] duplicate event id {dup!r}")
        refs = {tl["subject"]}
        for ev in tl["events"]:
            for k in ("people", "places", "polities", "concepts"):
                refs |= set(ev.get(k, []))
        refs |= {m["entity"] for row in tl.get("rulers", []) for m in row["members"] if m.get("entity")}
        for r in refs:
            entity_timelines.setdefault(r, []).append(tl["id"])
        for row in tl.get("rulers", []):
            for m in row["members"]:
                if not (m.get("entity") or m.get("name")):
                    problems.append(f"[{tl['id']}] ruler without entity or name in row {row['label']!r}")
                if m["to"] <= m["from"]:
                    problems.append(f"[{tl['id']}] ruler {m.get('entity') or m.get('name')!r} ends before it starts")
        tl["events"].sort(key=lambda ev: ev["date"])
        (OUT / "timelines" / f"{tl['id']}.json").write_text(json.dumps(tl, ensure_ascii=False, indent=1))
        index.append({"id": tl["id"], "title": tl["title"], "subtitle": tl.get("subtitle"),
                      "subject": tl["subject"], "events": len(tl["events"]),
                      "series": tl.get("series"), "order": tl.get("order", 0), "kind": tl.get("kind"),
                      "range": tl["range"], "focus": tl.get("focus"), "span": span_of(tl, entities)})
    index.sort(key=lambda t: (t["series"] or "", t["order"]))

    (OUT / "entities.json").write_text(json.dumps(entities, ensure_ascii=False, indent=1))
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1))
    # Sorted so rebuilds are byte-identical and don't create spurious diffs/merge conflicts.
    # Compact search index for the home page: timelines, entities that appear somewhere, events.
    search = {
        "entities": [
            {"id": e["id"], "t": e["type"], "n": e.get("title"), "al": e.get("aliases", []),
             "d": e.get("description"), "mr": e.get("labels", {}).get("mr"), "th": e.get("thumb"),
             "tl": entity_timelines[e["id"]]}
            for e in entities.values() if e["id"] in entity_timelines
        ],
        "events": [
            {"tl": tl["id"], "id": ev["id"], "d": ev["date"], "a": bool(ev.get("approx")),
             "t": ev["title"], "m": bool(ev.get("major"))}
            for tl in timelines for ev in tl["events"]
        ],
    }
    (OUT / "search.json").write_text(json.dumps(search, ensure_ascii=False, separators=(",", ":")))
    (OUT / "entity-timelines.json").write_text(
        json.dumps({k: sorted(v) for k, v in sorted(entity_timelines.items())}, ensure_ascii=False))
    print(f"Wrote {len(entities)} entities, {len(timelines)} timeline(s) to {OUT.relative_to(ROOT)}/")

    if problems:
        print("\nProblems:")
        for p in problems:
            print("  -", p)
        sys.exit(1)


if __name__ == "__main__":
    main()
