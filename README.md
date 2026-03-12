# ResidencyRadar

Aggregates artist residency listings from across the web into one searchable interface. Built for sculptors, but tracks all disciplines.

## Sources

- **Artist Communities Alliance** — directory of open calls
- **Colossal** — monthly curated opportunities
- **Res Artis** — international residency network
- **Creative Capital** — artist opportunities
- **Direct programs** — Sculpture Space, Wassaic, ISPC, Anderson Ranch, Kala, Yaddo, Sloss Furnaces, WORTHLESSSTUDIOS

## Setup

```bash
npm install
npm start        # starts server on localhost:3456
```

Click "Refresh Sources" in the UI to run the initial scrape, or:

```bash
npm run scrape   # run scraper directly from CLI
```

## Features

- Sculpture relevance scoring (auto-tags listings mentioning sculpture, installation, ceramics, etc.)
- Deadline color coding (green > 30 days, yellow < 30, red < 7, gray = passed)
- Star and hide listings
- Filter by source, search, sculpture-only, starred
- SQLite storage with upsert (no duplicates on re-scrape)

## Stack

Express, SQLite (better-sqlite3), Cheerio, Alpine.js, Tailwind CSS
