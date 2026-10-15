"""Family trees for timelines with ruler rows.

Parent/child/spouse links come from Wikidata (father P22, mother P25, child P40,
spouse P26) between registered people. content/families.json corrects them:
  "people"  name-only people (connectors, or rulers listed by name in a ruler row)
  "remove"  [parent, child] links that are wrong (or replaced by an adoption)
  "add"     {"parent", "child", "kind": "adopted"?, "note"?} links Wikidata lacks
  "heirs"   {id: note} heirs who never took the throne (highlighted in the tree)
  "notes"   {id: note} short notes shown on a person's card
  "include" {timeline id: [ids]} extra people to show in that timeline's tree

A ruler row gets a tree when most of its rulers are related to another ruler.
Each tree node: id, name (name-only people), parent, kind ("adopted"),
spouseOf, reigns [[from, to], …], n [succession numbers], heir, note.
"""
from collections import deque


def kin_graph(entities, wd_kin, cfg, problems):
    """-> (parents {child: {parent: kind}}, spouses {id: set}) over entity ids + cfg people."""
    qid = {e.get("qid"): eid for eid, e in entities.items() if e.get("qid")}
    parents, spouses, mothers = {}, {}, set()
    for eid, e in entities.items():
        k = wd_kin.get(e.get("qid") or "", {})
        for rel in ("father", "mother"):
            for q in k.get(rel, []):
                if q in qid:
                    parents.setdefault(eid, {})[qid[q]] = "bio"
                    if rel == "mother":
                        mothers.add(qid[q])
        for q in k.get("child", []):
            if q in qid:
                parents.setdefault(qid[q], {})[eid] = "bio"
        for q in k.get("spouse", []):
            if q in qid:
                spouses.setdefault(eid, set()).add(qid[q])
                spouses.setdefault(qid[q], set()).add(eid)
    known = set(entities) | set(cfg.get("people", {}))
    for parent, child in cfg.get("remove", []):
        parents.get(child, {}).pop(parent, None)
    for a in cfg.get("add", []):
        for k in ("parent", "child"):
            if a[k] not in known:
                problems.append(f"families.json: unknown {k} {a[k]!r}")
        parents.setdefault(a["child"], {})[a["parent"]] = a.get("kind", "bio")
        if a.get("mother"):
            mothers.add(a["parent"])
    for a, b in cfg.get("spouses", []):
        spouses.setdefault(a, set()).add(b)
        spouses.setdefault(b, set()).add(a)
    for k in ("heirs", "notes"):
        for pid in cfg.get(k, {}):
            if pid not in known:
                problems.append(f"families.json: unknown person {pid!r} in {k}")
    return parents, spouses, mothers


def family_for(tl, entities, graph, cfg):
    parents, spouses, mothers = graph
    people = cfg.get("people", {})
    # Rulers listed by name only: match a name-only person, else a person entity with that title.
    by_name = {e["title"]: eid for eid, e in entities.items() if e.get("type") == "person"}
    by_name.update({p["name"]: pid for pid, p in people.items()})
    is_person = lambda i: i in people or entities.get(i, {}).get("type") == "person"

    children = {}
    for c, ps in parents.items():
        for p in ps:
            children.setdefault(p, set()).add(c)
    def neighbours(i):
        return set(parents.get(i, {})) | children.get(i, set())

    refs = set()
    for ev in tl["events"]:
        refs |= set(ev.get("people", []))
    refs |= set(cfg.get("include", {}).get(tl["id"], []))
    heirs = cfg.get("heirs", {})

    rows, placed = [], set()
    for row in tl.get("rulers", []):
        reigns, group = {}, {}
        for m in row["members"]:
            pid = m.get("entity") if m.get("entity") and is_person(m["entity"]) else by_name.get(m.get("name"))
            if pid:
                reigns.setdefault(pid, []).append([m["from"], m["to"]])
                group.setdefault(pid, m.get("group"))
        multi = len({g for g in group.values() if g}) > 1  # dynasty labels only when there are several
        rulers = [r for r in reigns if r not in placed]
        if len(rulers) < 2:
            continue
        # Connect rulers through relatives up to 3 generations away (e.g. a grandson via
        # a prince who never reigned).
        nodes = set(rulers)
        for r in rulers:
            prev, seen, q = {r: None}, {r}, deque([(r, 0)])
            while q:
                cur, d = q.popleft()
                if d == 3:
                    continue
                for n in neighbours(cur):
                    if n in seen or not is_person(n):
                        continue
                    seen.add(n)
                    prev[n] = cur
                    if n in reigns:
                        x = n
                        while x is not None:
                            nodes.add(x)
                            x = prev[x]
                    q.append((n, d + 1))
        related = [r for r in rulers if (neighbours(r) | spouses.get(r, set())) & nodes - {r}]
        if len(related) < 2 or len(related) < 0.4 * len(rulers):
            continue
        # Close relatives the timeline talks about, and heirs who never reigned.
        for r in list(nodes):
            # (not the parents of wives: they would pull her away from her husband)
            for n in children.get(r, set()) | spouses.get(r, set()) | (set() if r in mothers else set(parents.get(r, {}))):
                if is_person(n) and (n in refs or n in heirs):
                    nodes.add(n)
        nodes -= placed
        placed |= nodes

        def tree_parent(i):
            ps = {p: k for p, k in parents.get(i, {}).items() if p in nodes}
            for want in (lambda p, k: k == "adopted", lambda p, k: p not in mothers, lambda p, k: True):
                for p, k in ps.items():
                    if want(p, k):
                        return p, k
            return None, None

        order = sorted(reigns.items(), key=lambda kv: kv[1][0][0])
        n_of = {pid: [] for pid in reigns}
        seq = sorted((r[0], pid) for pid, rs in reigns.items() for r in rs)
        for n, (_, pid) in enumerate(seq, 1):
            n_of[pid].append(n)
        out = {}
        for i in nodes:
            p, kind = tree_parent(i)
            node = {"id": i}
            if i in people:
                node["name"] = people[i]["name"]
            if p:
                node["parent"] = p
                if kind == "adopted":
                    node["kind"] = "adopted"
            if i in reigns:
                node["reigns"] = reigns[i]
                node["n"] = n_of[i]
                if multi and group.get(i):
                    g = group[i]
                    node["group"] = entities[g]["title"] if g in entities else g
            if i in heirs and i not in reigns:
                node["heir"] = heirs[i]
            note = cfg.get("notes", {}).get(i) or people.get(i, {}).get("note")
            if note:
                node["note"] = note
            out[i] = node
        # A wife/mother (or childless non-ruler) with no parent in the tree sits beside her partner.
        has_kids = {o["parent"] for o in out.values() if "parent" in o}
        for i, node in out.items():
            if "parent" in node or not (i in mothers or (i not in reigns and i not in has_kids)):
                continue
            partners = sorted((s for s in spouses.get(i, set()) if s in out and out[s].get("spouseOf") != i),
                              key=lambda s: ("parent" not in out[s], s not in reigns, s))
            if partners:
                node["spouseOf"] = partners[0]
        first = {pid: i for i, (pid, _) in enumerate(order)}
        rows.append({"label": row["label"],
                     "nodes": sorted(out.values(), key=lambda nd: (first.get(nd["id"], 999), nd["id"]))})
    return rows
