const crypto = require('crypto');
const { load } = require('cheerio');
const db = require('./db');

const SCULPTURE_TERMS = [
  'sculpture', 'sculptor', '3d', 'three-dimensional', 'installation',
  'fabrication', 'ceramics', 'ceramic', 'metalwork', 'woodwork', 'casting',
  'mixed media', 'spatial', 'site-specific', 'public art', 'visual arts',
  'visual art', 'foundry', 'glass', 'fiber', 'textile', 'interdisciplinary',
  'all disciplines', 'all media', 'open to all'
];

const USER_AGENT = 'ResidencyRadar/1.0 (art residency aggregator)';

function makeId(source, name, url) {
  return crypto.createHash('sha256').update(`${source}|${name}|${url}`).digest('hex').slice(0, 16);
}

function isSculptureRelevant(text) {
  const lower = (text || '').toLowerCase();
  return SCULPTURE_TERMS.some(term => lower.includes(term)) ? 1 : 0;
}

function normalizeDeadline(raw) {
  if (!raw) return '';
  const lower = raw.toLowerCase().trim();
  if (lower.includes('rolling') || lower.includes('ongoing')) return 'rolling';
  const match = lower.match(/(\w+)\s+(\d{1,2}),?\s*(\d{4})/);
  if (match) {
    const months = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
    const m = months[match[1].toLowerCase()];
    if (m) return `${match[3]}-${m}-${match[2].padStart(2, '0')}`;
  }
  const isoMatch = lower.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];
  return raw.trim();
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

// ---------------------
// Scrapers
// ---------------------

async function scrapeACA() {
  const results = [];
  try {
    const html = await fetchPage('https://artistcommunities.org/directory/open-calls');
    const $ = load(html);

    $('.view-content .views-row, .view-content .node, .directory-listing, .views-field').each((_, el) => {
      const $el = $(el);
      const nameEl = $el.find('h2 a, h3 a, .views-field-title a, .field-content a').first();
      const name = nameEl.text().trim();
      const href = nameEl.attr('href');
      if (!name || !href) return;

      const url = href.startsWith('http') ? href : `https://artistcommunities.org${href}`;
      const location = $el.find('.views-field-field-location, .field-name-field-location, .location').text().trim();
      const deadline = $el.find('.views-field-field-deadline, .field-name-field-deadline, .deadline').text().trim();
      const desc = $el.find('.views-field-body, .field-name-body, .description, .summary').text().trim();
      const disciplines = $el.find('.views-field-field-discipline, .field-name-field-discipline').text().trim();

      results.push({
        id: makeId('aca', name, url),
        name, organization: '', source: 'aca', url, location,
        country: '', deadline: normalizeDeadline(deadline),
        disciplines, duration: '', stipend: '', fee: '',
        description: desc.slice(0, 500),
        sculpture_relevant: isSculptureRelevant(`${name} ${desc} ${disciplines}`)
      });
    });
  } catch (err) {
    console.error('ACA scrape error:', err.message);
    logScrape('aca', 'error', 0, err.message);
  }
  return results;
}

async function scrapeResArtis() {
  const results = [];
  try {
    const html = await fetchPage('https://resartis.org/open-calls/');
    const $ = load(html);

    $('article, .post, .entry, .open-call-item, .wp-block-post').each((_, el) => {
      const $el = $(el);
      const nameEl = $el.find('h2 a, h3 a, .entry-title a').first();
      const name = nameEl.text().trim();
      const href = nameEl.attr('href');
      if (!name || !href) return;

      const url = href.startsWith('http') ? href : `https://resartis.org${href}`;
      const desc = $el.find('.entry-content, .excerpt, .entry-summary, p').first().text().trim();
      const deadlineMatch = desc.match(/deadline[:\s]*([^.|\n]+)/i);

      results.push({
        id: makeId('resartis', name, url),
        name, organization: '', source: 'resartis', url,
        location: '', country: '',
        deadline: normalizeDeadline(deadlineMatch ? deadlineMatch[1] : ''),
        disciplines: '', duration: '', stipend: '', fee: '',
        description: desc.slice(0, 500),
        sculpture_relevant: isSculptureRelevant(`${name} ${desc}`)
      });
    });
  } catch (err) {
    console.error('Res Artis scrape error:', err.message);
    logScrape('resartis', 'error', 0, err.message);
  }
  return results;
}

async function scrapeColossal() {
  const results = [];
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed, so current month for "next month" post
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'];

    // Try current and previous month's opportunity posts
    const urls = [
      `https://www.thisiscolossal.com/${year}/${String(month).padStart(2, '0')}/${monthNames[month]}-${year}-opportunities-open-calls-residencies-grants/`,
      `https://www.thisiscolossal.com/${year}/${String(month).padStart(2, '0')}/${monthNames[month]}-${year}-artist-open-calls-residencies-grants/`,
      `https://www.thisiscolossal.com/${year}/${String(month + 1).padStart(2, '0')}/${monthNames[month]}-${year}-opportunities-open-calls-residencies-grants/`,
    ];

    for (const url of urls) {
      try {
        const html = await fetchPage(url);
        const $ = load(html);
        const content = $('.entry-content, .post-content, article .content').first();

        content.find('h2, h3, strong').each((_, el) => {
          const $heading = $(el);
          const name = $heading.text().trim();
          if (!name || name.length < 5) return;
          // Skip entries where the "name" is actually a deadline line
          if (/^deadline/i.test(name)) return;

          let desc = '';
          let link = '';
          let $next = $heading.parent().is('p') ? $heading.parent() : $heading;

          for (let i = 0; i < 5; i++) {
            $next = $next.next();
            if (!$next.length || $next.is('h2, h3')) break;
            desc += ' ' + $next.text().trim();
            if (!link) {
              const a = $next.find('a').first();
              if (a.length) link = a.attr('href') || '';
            }
          }

          if (!link) {
            const a = $heading.find('a').first();
            link = a.attr('href') || '';
          }
          if (!link) link = url;

          const deadlineMatch = desc.match(/deadline[:\s]*([^.|\n]+)/i);

          results.push({
            id: makeId('colossal', name, link),
            name, organization: '', source: 'colossal', url: link,
            location: '', country: '',
            deadline: normalizeDeadline(deadlineMatch ? deadlineMatch[1] : ''),
            disciplines: '', duration: '', stipend: '', fee: '',
            description: desc.trim().slice(0, 500),
            sculpture_relevant: isSculptureRelevant(`${name} ${desc}`)
          });
        });

        if (results.length > 0) break; // Got results from one URL, stop trying others
      } catch {
        continue; // Try next URL pattern
      }
    }
  } catch (err) {
    console.error('Colossal scrape error:', err.message);
    logScrape('colossal', 'error', 0, err.message);
  }
  return results;
}

async function scrapeCreativeCapital() {
  const results = [];
  try {
    for (let page = 1; page <= 5; page++) {
      const url = `https://creative-capital.org/artist-resources/artist-opportunities/${page > 1 ? `?page=${page}` : ''}`;
      try {
        const html = await fetchPage(url);
        const $ = load(html);

        $('.opportunity-card, .post, article, .entry, .resource-item, .wp-block-post').each((_, el) => {
          const $el = $(el);
          const nameEl = $el.find('h2 a, h3 a, .entry-title a, a.title').first();
          const name = nameEl.text().trim();
          const href = nameEl.attr('href');
          if (!name) return;

          const link = href ? (href.startsWith('http') ? href : `https://creative-capital.org${href}`) : url;
          const desc = $el.find('p, .excerpt, .description, .entry-content').first().text().trim();
          const type = $el.find('.type, .category, .tag').text().trim().toLowerCase();
          const deadline = $el.find('.deadline, .date').text().trim();

          if (type && !type.includes('residenc') && !type.includes('fellowship') && !type.includes('grant')) return;

          results.push({
            id: makeId('creative-capital', name, link),
            name, organization: '', source: 'creative-capital', url: link,
            location: '', country: '',
            deadline: normalizeDeadline(deadline),
            disciplines: '', duration: '', stipend: '', fee: '',
            description: desc.slice(0, 500),
            sculpture_relevant: isSculptureRelevant(`${name} ${desc}`)
          });
        });

        await new Promise(r => setTimeout(r, 2000)); // Be respectful
      } catch {
        break;
      }
    }
  } catch (err) {
    console.error('Creative Capital scrape error:', err.message);
    logScrape('creative-capital', 'error', 0, err.message);
  }
  return results;
}

async function scrapeDirect() {
  const programs = [
    {
      name: 'Sculpture Space Residency',
      organization: 'Sculpture Space',
      url: 'https://www.sculpturespace.org/application',
      location: 'Utica, NY, USA',
      country: 'USA',
      disciplines: 'sculpture, installation'
    },
    {
      name: 'Wassaic Project Residency',
      organization: 'Wassaic Project',
      url: 'https://www.wassaicproject.org/apply',
      location: 'Wassaic, NY, USA',
      country: 'USA',
      disciplines: 'visual arts, sculpture, interdisciplinary'
    },
    {
      name: 'ISPC Residency',
      organization: 'In Situ Polyculture Commons',
      url: 'https://insitupolyculture.org/program/2026-residency-open-call/',
      location: 'Various',
      country: '',
      disciplines: 'sculpture, installation, site-specific'
    },
    {
      name: 'Anderson Ranch Artists-in-Residence',
      organization: 'Anderson Ranch Arts Center',
      url: 'https://www.andersonranch.org/programs/artists-in-residence-program/',
      location: 'Snowmass, CO, USA',
      country: 'USA',
      disciplines: 'sculpture, ceramics, woodwork, all media'
    },
    {
      name: 'Kala Art Institute Fellowship',
      organization: 'Kala Art Institute',
      url: 'https://www.kala.org/artist-programs/fellowships/',
      location: 'Berkeley, CA, USA',
      country: 'USA',
      disciplines: 'sculpture, textiles, mixed media'
    },
    {
      name: 'Yaddo Residency',
      organization: 'Yaddo',
      url: 'https://www.yaddo.org/apply/',
      location: 'Saratoga Springs, NY, USA',
      country: 'USA',
      disciplines: 'visual arts, sculpture'
    },
    {
      name: 'Sloss Metal Arts Residency',
      organization: 'Sloss Furnaces',
      url: 'https://slossfurnaces.com/metal-arts/',
      location: 'Birmingham, AL, USA',
      country: 'USA',
      disciplines: 'sculpture, metalwork, foundry, casting'
    },
    {
      name: 'WORTHLESSSTUDIOS WARP Residency',
      organization: 'WORTHLESSSTUDIOS',
      url: 'https://www.worthlessstudios.com/warp',
      location: 'New York, NY, USA',
      country: 'USA',
      disciplines: 'sculpture, fabrication, large-scale'
    }
  ];

  const results = [];
  for (const prog of programs) {
    try {
      const html = await fetchPage(prog.url);
      const $ = load(html);
      const bodyText = $('body').text();

      // Try to extract deadline
      const deadlinePatterns = [
        /deadline[:\s]*(\w+\s+\d{1,2},?\s*\d{4})/i,
        /applications?\s+(?:due|close)[:\s]*(\w+\s+\d{1,2},?\s*\d{4})/i,
        /submit\s+by[:\s]*(\w+\s+\d{1,2},?\s*\d{4})/i,
        /due[:\s]*(\w+\s+\d{1,2},?\s*\d{4})/i,
      ];

      let deadline = '';
      for (const pat of deadlinePatterns) {
        const match = bodyText.match(pat);
        if (match) { deadline = match[1]; break; }
      }

      if (!deadline && bodyText.toLowerCase().includes('rolling')) deadline = 'rolling';

      // Try to extract stipend info
      const stipendMatch = bodyText.match(/\$[\d,]+(?:\s*(?:per|\/)\s*(?:month|week|stipend))?/i);

      const desc = $('meta[name="description"]').attr('content') ||
                   $('meta[property="og:description"]').attr('content') || '';

      results.push({
        id: makeId('direct', prog.name, prog.url),
        name: prog.name,
        organization: prog.organization,
        source: 'direct',
        url: prog.url,
        location: prog.location,
        country: prog.country,
        deadline: normalizeDeadline(deadline),
        disciplines: prog.disciplines,
        duration: '',
        stipend: stipendMatch ? stipendMatch[0] : '',
        fee: '',
        description: desc.slice(0, 500),
        sculpture_relevant: 1
      });

      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`Direct scrape error for ${prog.name}:`, err.message);
      results.push({
        id: makeId('direct', prog.name, prog.url),
        name: prog.name,
        organization: prog.organization,
        source: 'direct',
        url: prog.url,
        location: prog.location,
        country: prog.country,
        deadline: '',
        disciplines: prog.disciplines,
        duration: '', stipend: '', fee: '',
        description: 'Could not fetch latest details — visit the site directly.',
        sculpture_relevant: 1
      });
    }
  }
  return results;
}

// ---------------------
// DB Operations
// ---------------------

const upsertStmt = db.prepare(`
  INSERT INTO residencies (id, name, organization, source, url, location, country, deadline,
    disciplines, duration, stipend, fee, description, sculpture_relevant, scraped_at)
  VALUES (@id, @name, @organization, @source, @url, @location, @country, @deadline,
    @disciplines, @duration, @stipend, @fee, @description, @sculpture_relevant, @scraped_at)
  ON CONFLICT(id) DO UPDATE SET
    name=@name, organization=@organization, url=@url, location=@location,
    country=@country, deadline=@deadline, disciplines=@disciplines,
    duration=@duration, stipend=@stipend, fee=@fee, description=@description,
    sculpture_relevant=@sculpture_relevant, scraped_at=@scraped_at
`);

function upsertResults(entries) {
  const now = new Date().toISOString();
  const upsertMany = db.transaction((items) => {
    for (const item of items) {
      upsertStmt.run({ ...item, scraped_at: now });
    }
  });
  upsertMany(entries);
}

function logScrape(source, status, count, error = '') {
  db.prepare('INSERT INTO scrape_log (source, status, count, error) VALUES (?, ?, ?, ?)')
    .run(source, status, count, error);
}

// ---------------------
// Main
// ---------------------

async function runAllScrapers() {
  console.log('Starting ResidencyRadar scrape...\n');
  const scrapers = [
    { name: 'aca', fn: scrapeACA },
    { name: 'resartis', fn: scrapeResArtis },
    { name: 'colossal', fn: scrapeColossal },
    { name: 'creative-capital', fn: scrapeCreativeCapital },
    { name: 'direct', fn: scrapeDirect },
  ];

  let totalCount = 0;
  for (const { name, fn } of scrapers) {
    console.log(`Scraping ${name}...`);
    try {
      const results = await fn();
      if (results.length > 0) {
        upsertResults(results);
        logScrape(name, 'ok', results.length);
        console.log(`  ✓ ${results.length} listings`);
      } else {
        logScrape(name, 'empty', 0);
        console.log(`  – 0 listings (page structure may have changed)`);
      }
      totalCount += results.length;
    } catch (err) {
      logScrape(name, 'error', 0, err.message);
      console.error(`  ✗ ${err.message}`);
    }
  }

  console.log(`\nDone. ${totalCount} total listings upserted.`);
  return totalCount;
}

// Run if called directly
if (require.main === module) {
  runAllScrapers().then(() => process.exit(0)).catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}

module.exports = { runAllScrapers };
