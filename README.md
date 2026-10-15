# Itihas — Indian history timelines

A static website for exploring Indian history as interactive timelines.
Names, places and empires are clickable everywhere, with summaries, images,
coordinates and Marathi names pulled from Wikipedia and Wikidata.

Timelines so far: **The Maratha Empire** series, an overview plus eight detailed timelines:
Shivaji, Sambhaji, Rajaram & Tarabai, Shahu, Bajirao I, Nanasaheb, Madhavrao I,
Nana Phadnavis & Mahadji Shinde, and Bajirao II.

## Run it

```bash
python3 scripts/serve.py
```

Then open http://localhost:8095

## How it works

```
content/                 <- what you edit (curated, hand-written)
  entities.json          people / places / polities / concepts -> Wikipedia title
  timelines/<id>.json    one file per timeline: lanes, context bars, events
scripts/build_data.py    fetches Wikipedia + Wikidata, validates, writes site/data/
site/                    the website (plain HTML/CSS/JS, no build step)
  data/                  generated; don't edit by hand
```

After editing anything in `content/`, rebuild:

```bash
python3 scripts/build_data.py
```

API responses are cached in `.cache/`. Pass `--refresh` to re-fetch.
The script exits non-zero and lists problems (unknown ids, wrong Wikipedia
titles, places with no coordinates) so mistakes surface right away.

### Adding an event

```json
{
  "id": "sinhagad", "date": "1670-02-04", "lane": "military", "major": true,
  "title": "Battle of Sinhagad",
  "summary": "Tanaji Malusare scales the cliffs of Kondhana…",
  "people": ["tanaji", "shivaji"], "places": ["sinhagad"],
  "polities": ["mughal-empire"], "wiki": "Battle of Sinhagad"
}
```

- `date` can be `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. Add `"end"` for a span and `"approx": true` for "c." dates.
- Names in `summary` that match a referenced entity's title or `aliases` turn into links automatically.

### Timeline-level fields

| field | meaning |
|---|---|
| `subject` | entity whose portrait and summary head the page |
| `series`, `order` | groups timelines on the home page and drives the ← → links (`order: 0` = the series overview) |
| `range` | initial visible years |
| `focus` | `[from, to]` years to shade (defaults to the subject's lifespan) |
| `intro` | optional text replacing the Wikipedia summary in the header |
| `context` | bars in the "People & powers" section; `from`/`to` override Wikidata dates (e.g. reigns) |

Event-level `"see": "<timeline-id>"` adds an "Open the full timeline →" link to that card.
`"major": true` puts the event on the always-visible **Key events** track.

### Adding a timeline

Copy `content/timelines/shivaji.json` and register any new people or places in
`content/entities.json`. It shows up on the home page after a rebuild.

## Sources and licence

Summaries and images come from Wikipedia (CC BY-SA) and Wikidata (CC0). The event selection
and short event descriptions are curated here. Where dates are contested
(Shivaji's birth year, the Rohideshwar oath), the event text says so.

## Publishing

Live at **https://itihas.vokalglobe.com**. Every push to `main` deploys `site/` to GitHub Pages
(`.github/workflows/pages.yml`). Rebuild `site/data/` with `scripts/build_data.py` and commit it
before pushing — the workflow publishes the committed files as they are.

DNS: `itihas.vokalglobe.com` is a CNAME to `nikhil99.github.io` (DigitalOcean DNS for vokalglobe.com).
