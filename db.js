const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'residencyradar.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS residencies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    organization TEXT DEFAULT '',
    source TEXT NOT NULL,
    url TEXT NOT NULL,
    location TEXT DEFAULT '',
    country TEXT DEFAULT '',
    deadline TEXT DEFAULT '',
    disciplines TEXT DEFAULT '',
    duration TEXT DEFAULT '',
    stipend TEXT DEFAULT '',
    fee TEXT DEFAULT '',
    description TEXT DEFAULT '',
    sculpture_relevant INTEGER DEFAULT 0,
    starred INTEGER DEFAULT 0,
    hidden INTEGER DEFAULT 0,
    scraped_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_residencies_deadline ON residencies(deadline);
  CREATE INDEX IF NOT EXISTS idx_residencies_source ON residencies(source);
  CREATE INDEX IF NOT EXISTS idx_residencies_sculpture ON residencies(sculpture_relevant);

  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    residency_id TEXT NOT NULL REFERENCES residencies(id),
    status TEXT DEFAULT 'draft',
    artist_statement TEXT DEFAULT '',
    project_proposal TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_applications_residency ON applications(residency_id);
  CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

  CREATE TABLE IF NOT EXISTS scrape_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    error TEXT DEFAULT '',
    scraped_at TEXT DEFAULT (datetime('now'))
  );
`);

module.exports = db;
