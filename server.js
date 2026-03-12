const express = require('express');
const path = require('path');
const db = require('./db');
const { runAllScrapers } = require('./scrape');

const app = express();
const PORT = process.env.PORT || 3456;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GET /api/residencies/stats (must be before :id routes)
app.get('/api/residencies/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM residencies WHERE hidden = 0').get();
  const sculptureCount = db.prepare('SELECT COUNT(*) as count FROM residencies WHERE sculpture_relevant = 1 AND hidden = 0').get();
  const sources = db.prepare('SELECT source, COUNT(*) as count FROM residencies WHERE hidden = 0 GROUP BY source').all();
  const lastScrape = db.prepare('SELECT scraped_at FROM scrape_log ORDER BY id DESC LIMIT 1').get();
  res.json({
    total: total.count,
    sculpture: sculptureCount.count,
    sources,
    lastScrape: lastScrape?.scraped_at || null
  });
});

// GET /api/residencies
app.get('/api/residencies', (req, res) => {
  const { source, sculpture, starred, show_hidden, search } = req.query;
  let where = [];
  let params = {};

  if (!show_hidden) {
    where.push('hidden = 0');
  }
  if (source) {
    where.push('source = @source');
    params.source = source;
  }
  if (sculpture === '1') {
    where.push('sculpture_relevant = 1');
  }
  if (starred === '1') {
    where.push('starred = 1');
  }
  if (search) {
    where.push("(name LIKE @search OR organization LIKE @search OR location LIKE @search OR description LIKE @search)");
    params.search = `%${search}%`;
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT *,
      CASE
        WHEN deadline = 'rolling' THEN 1
        WHEN deadline = '' THEN 2
        WHEN deadline < date('now') THEN 3
        ELSE 0
      END as deadline_status
    FROM residencies
    ${whereClause}
    ORDER BY deadline_status ASC, deadline ASC
  `;
  const rows = db.prepare(sql).all(params);
  res.json(rows);
});

// PUT /api/residencies/:id/star
app.put('/api/residencies/:id/star', (req, res) => {
  db.prepare('UPDATE residencies SET starred = CASE WHEN starred = 1 THEN 0 ELSE 1 END WHERE id = ?').run(req.params.id);
  const row = db.prepare('SELECT starred FROM residencies WHERE id = ?').get(req.params.id);
  res.json({ starred: row?.starred });
});

// PUT /api/residencies/:id/hide
app.put('/api/residencies/:id/hide', (req, res) => {
  db.prepare('UPDATE residencies SET hidden = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/scrape
let scraping = false;
app.post('/api/scrape', async (req, res) => {
  if (scraping) return res.status(409).json({ error: 'Scrape already in progress' });
  scraping = true;
  try {
    const count = await runAllScrapers();
    res.json({ ok: true, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    scraping = false;
  }
});

// GET /api/scrape-log
app.get('/api/scrape-log', (req, res) => {
  const rows = db.prepare('SELECT * FROM scrape_log ORDER BY id DESC LIMIT 50').all();
  res.json(rows);
});

app.listen(PORT, () => {
  console.log(`ResidencyRadar running at http://localhost:${PORT}`);
});
