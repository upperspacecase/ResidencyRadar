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
  const { source, sculpture, starred, show_hidden, show_expired, search } = req.query;
  let where = [];
  let params = {};

  if (!show_hidden) {
    where.push('hidden = 0');
  }
  // Hide expired deadlines by default
  if (!show_expired) {
    where.push("(deadline = 'rolling' OR deadline = '' OR deadline >= date('now'))");
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

// ---------------------
// Applications
// ---------------------

// GET /api/applications
app.get('/api/applications', (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, r.name as residency_name, r.organization, r.url as residency_url,
           r.location, r.deadline, r.disciplines, r.stipend
    FROM applications a
    JOIN residencies r ON a.residency_id = r.id
    ORDER BY a.updated_at DESC
  `).all();
  res.json(rows);
});

// POST /api/applications
app.post('/api/applications', (req, res) => {
  const { residency_id } = req.body;
  if (!residency_id) return res.status(400).json({ error: 'residency_id required' });

  const existing = db.prepare('SELECT id FROM applications WHERE residency_id = ?').get(residency_id);
  if (existing) return res.json(existing);

  const result = db.prepare(`
    INSERT INTO applications (residency_id) VALUES (?)
  `).run(residency_id);
  res.json({ id: result.lastInsertRowid });
});

// PUT /api/applications/:id
app.put('/api/applications/:id', (req, res) => {
  const { status, artist_statement, project_proposal, notes } = req.body;
  const fields = [];
  const params = { id: req.params.id };

  if (status !== undefined) { fields.push('status = @status'); params.status = status; }
  if (artist_statement !== undefined) { fields.push('artist_statement = @artist_statement'); params.artist_statement = artist_statement; }
  if (project_proposal !== undefined) { fields.push('project_proposal = @project_proposal'); params.project_proposal = project_proposal; }
  if (notes !== undefined) { fields.push('notes = @notes'); params.notes = notes; }

  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

  fields.push("updated_at = datetime('now')");
  db.prepare(`UPDATE applications SET ${fields.join(', ')} WHERE id = @id`).run(params);
  const row = db.prepare(`
    SELECT a.*, r.name as residency_name, r.organization, r.url as residency_url,
           r.location, r.deadline, r.disciplines, r.stipend
    FROM applications a
    JOIN residencies r ON a.residency_id = r.id
    WHERE a.id = ?
  `).get(req.params.id);
  res.json(row);
});

// DELETE /api/applications/:id
app.delete('/api/applications/:id', (req, res) => {
  db.prepare('DELETE FROM applications WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`ResidencyRadar running at http://localhost:${PORT}`);
});
