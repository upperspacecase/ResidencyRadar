# ResidencyRadar

Aggregates artist residency listings from across the web into one searchable interface. Built for sculptors, but tracks all disciplines.

## How it works

1. **GitHub Action** runs daily at 6 AM UTC, scrapes 5 sources, writes to `public/data/residencies.json`, and commits
2. **Vercel** auto-deploys the static site on each commit
3. **No server, no database** — just a JSON file and a static HTML page

## Sources

- **Artist Communities Alliance** — directory of open calls (~100 listings)
- **Res Artis** — international residency network (~300 listings)
- **Colossal** — monthly curated opportunities (~70 listings)
- **Creative Capital** — artist opportunities (~25 listings)
- **Direct programs** — Sculpture Space, Wassaic, ISPC, Anderson Ranch, Yaddo, WORTHLESSSTUDIOS

## Features

- Sculpture relevance auto-tagging
- Deadline color coding (green > 30 days, yellow < 30, red < 7, strikethrough = passed)
- Expired deadlines hidden by default
- Draft applications with artist statement, project proposal, and notes fields
- Copy buttons for each field and a "Copy All" for the entire application
- Filter by source, search text, sculpture-only
- Data refreshed daily via GitHub Actions

## Deploy to Vercel

1. Push this repo to GitHub
2. Import in [Vercel](https://vercel.com) — it auto-detects the static site config
3. Done. GitHub Actions updates the data daily.

## Run scraper manually

```bash
npm install
npm run scrape
```

## Local development

```bash
npx serve public
```

## Stack

Static HTML, Alpine.js, Tailwind CSS CDN, Cheerio (scraper only)
