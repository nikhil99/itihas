"""Make content/geo/japan-empire.json: simplified regions of the Japanese empire, for the
Meiji timeline's map animation, cut from Natural Earth 10m data (public domain).

    # download ne_10m_admin_0_countries.geojson and ne_10m_admin_1_states_provinces.geojson
    # from https://github.com/nvkelso/natural-earth-vector/tree/master/geojson into <dir>, then:
    python3 scripts/make_geo_japan.py <dir> content/geo/japan-empire.json

Partial regions (south Sakhalin, Liaodong, Kwantung) are cut with straight lines, so their
borders are approximate.
"""
import json, sys

D, OUT = sys.argv[1], sys.argv[2]
a0 = {f["properties"]["ADM0_A3"]: f for f in json.load(open(f"{D}/ne_10m_admin_0_countries.geojson"))["features"]}
a1 = {(f["properties"]["adm0_a3"], f["properties"]["name"]): f for f in json.load(open(f"{D}/ne_10m_admin_1_states_provinces.geojson"))["features"]}

def polys(feature):  # -> list of polygons (each a list of rings)
    g = feature["geometry"]
    return [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]

def area(ring):
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]))) / 2

def centroid(ring):
    xs, ys = zip(*ring)
    return sum(xs) / len(xs), sum(ys) / len(ys)

def clip(ring, a, b, c):
    """Sutherland–Hodgman: keep the part of the ring where a*x + b*y <= c."""
    inside = lambda p: a * p[0] + b * p[1] <= c
    def cross(p, q):
        t = (c - a * p[0] - b * p[1]) / (a * (q[0] - p[0]) + b * (q[1] - p[1]))
        return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]
    out = []
    for i, cur in enumerate(ring):
        prev = ring[i - 1]
        if inside(cur):
            if not inside(prev): out.append(cross(prev, cur))
            out.append(cur)
        elif inside(prev):
            out.append(cross(prev, cur))
    return out

def simplify(pts, tol):
    """Douglas–Peucker."""
    if len(pts) < 4: return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = (dx * dx + dy * dy) ** 0.5 or 1e-12
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / norm
        if d > dmax: dmax, idx = d, i
    if dmax <= tol: return [pts[0], pts[-1]]
    return simplify(pts[: idx + 1], tol)[:-1] + simplify(pts[idx:], tol)

def finish(poly_list, tol=0.012, min_area=0.0008):
    out = []
    for rings in poly_list:
        outer = rings[0]
        if len(outer) < 4 or area(outer) < min_area: continue
        r = simplify(outer[:-1] if outer[0] == outer[-1] else outer, tol)
        if len(r) < 3: continue
        r = [[round(x, 3), round(y, 3)] for x, y in r]
        out.append([r + [r[0]]])  # outer ring only: holes are irrelevant at this scale
    return out

def select(feature, keep):
    return [p for p in polys(feature) if keep(*centroid(p[0]))]

def clipped(poly_list, *halfplanes):
    res = []
    for rings in poly_list:
        r = rings[0]
        for hp in halfplanes:
            r = clip(r, *hp) if len(r) >= 3 else r
        if len(r) >= 3: res.append([r])
    return res

jp = a0["JPN"]
is_hokkaido = lambda x, y: y > 41.6
is_ryukyu = lambda x, y: y < 27.95 and x < 131.5
is_bonin = lambda x, y: y < 30 and 139.5 < x < 145
is_far = lambda x, y: x > 145 or (y < 24.5 and x > 135)
sakh = a1[("RUS", "Sakhalin")]
liaoning = a1[("CHN", "Liaoning")]

regions = {
    "japan-core": select(jp, lambda x, y: not (is_hokkaido(x, y) or is_ryukyu(x, y) or is_bonin(x, y) or is_far(x, y))),
    "hokkaido": select(jp, is_hokkaido),
    "bonin": select(jp, is_bonin),
    "ryukyu": select(jp, is_ryukyu),
    "kurils": select(sakh, lambda x, y: x >= 145.2),
    # southern half of Sakhalin island, below the 50th parallel (Treaty of Portsmouth)
    "south-sakhalin": clipped(select(sakh, lambda x, y: x < 145.2), (0, 1, 50)),
    # Taiwan and Penghu, without Kinmen and Matsu off the mainland
    "taiwan": select(a0["TWN"], lambda x, y: y < 25.5 and x > 119.2),
    # Liaodong as ceded at Shimonoseki: south of a line from the Yalu mouth (124.4E 40.0N) to Yingkou (122.2E 40.7N)
    "liaodong": clipped(polys(liaoning), (0.7, 2.2, 0.7 * 124.4 + 2.2 * 40.0), (-1, 0, -121.0)),
    # Kwantung Leased Territory: the tip of the peninsula, south of about 39.45N
    "kwantung": clipped(polys(liaoning), (0, 1, 39.45)),
    "korea": polys(a0["PRK"]) + polys(a0["KOR"]),
}

fc = {"type": "FeatureCollection", "features": []}
for rid, pl in regions.items():
    geom = finish(pl)
    assert geom, rid
    fc["features"].append({"type": "Feature", "id": rid, "properties": {}, "geometry": {"type": "MultiPolygon", "coordinates": geom}})
    print(rid, len(geom), "polygons", sum(len(p[0]) for p in geom), "points")
json.dump(fc, open(OUT, "w"), separators=(",", ":"))
print(OUT)
