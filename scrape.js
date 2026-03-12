const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { load } = require('cheerio');

const DATA_PATH = path.join(__dirname, 'public', 'data', 'residencies.json');

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
  return SCULPTURE_TERMS.some(term => lower.includes(term));
}

function normalizeDeadline(raw) {
  if (!raw) return '';
  const lower = raw.toLowerCase().trim();
  if (lower.includes('rolling') || lower.includes('ongoing')) return 'rolling';
  // Month DD, YYYY
  const mdy = lower.match(/(\w+)\s+(\d{1,2}),?\s*(\d{4})/);
  if (mdy) {
    const months = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
    const m = months[mdy[1].toLowerCase()];
    if (m) return `${mdy[3]}-${m}-${mdy[2].padStart(2, '0')}`;
  }
  // DD Mon YYYY
  const dmy = lower.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (dmy) {
    const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
      january: '01', february: '02', march: '03', april: '04', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
    const m = months[dmy[2].toLowerCase()];
    if (m) return `${dmy[3]}-${m}-${dmy[1].padStart(2, '0')}`;
  }
  const isoMatch = lower.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];
  return raw.trim();
}

async function fetchPage(url, { skipSSL = false } = {}) {
  if (skipSSL) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    if (skipSSL) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  }
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
        id: makeId('aca', name, url), name, organization: '', source: 'aca', url, location,
        country: '', deadline: normalizeDeadline(deadline), disciplines, duration: '',
        stipend: '', fee: '', description: desc.slice(0, 500),
        sculptureRelevant: isSculptureRelevant(`${name} ${desc} ${disciplines}`)
      });
    });
    console.log(`  ACA: ${results.length} listings`);
  } catch (err) {
    console.error('  ACA error:', err.message);
  }
  return results;
}

async function scrapeResArtis() {
  const results = [];
  try {
    const html = await fetchPage('https://resartis.org/open-calls/', { skipSSL: true });
    const $ = load(html);
    $('article.card.card--post').each((_, el) => {
      const $el = $(el);
      const nameEl = $el.find('h2.card__title a').first();
      const name = nameEl.text().trim();
      const href = nameEl.attr('href');
      if (!name || !href) return;
      const url = href.startsWith('http') ? href : `https://resartis.org${href}`;
      const dtText = $el.find('dt').text() || '';
      const deadlineMatch = dtText.match(/Deadline:\s*(.+?)(?:\s*Country:|$)/i);
      const countryMatch = dtText.match(/Country:\s*(.+)/i);
      const deadline = deadlineMatch ? deadlineMatch[1].trim() : '';
      const country = countryMatch ? countryMatch[1].trim() : '';
      results.push({
        id: makeId('resartis', name, url), name, organization: '', source: 'resartis', url,
        location: country, country, deadline: normalizeDeadline(deadline),
        disciplines: '', duration: '', stipend: '', fee: '', description: '',
        sculptureRelevant: isSculptureRelevant(name)
      });
    });
    console.log(`  Res Artis: ${results.length} listings`);
  } catch (err) {
    console.error('  Res Artis error:', err.message);
  }
  return results;
}

async function scrapeColossal() {
  const results = [];
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'];
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
          if (!name || name.length < 5 || /^deadline/i.test(name)) return;
          let desc = '', link = '';
          let $next = $heading.parent().is('p') ? $heading.parent() : $heading;
          for (let i = 0; i < 5; i++) {
            $next = $next.next();
            if (!$next.length || $next.is('h2, h3')) break;
            desc += ' ' + $next.text().trim();
            if (!link) { const a = $next.find('a').first(); if (a.length) link = a.attr('href') || ''; }
          }
          if (!link) { const a = $heading.find('a').first(); link = a.attr('href') || ''; }
          if (!link) link = url;
          const deadlineMatch = desc.match(/deadline[:\s]*([^.|\n]+)/i);
          results.push({
            id: makeId('colossal', name, link), name, organization: '', source: 'colossal',
            url: link, location: '', country: '',
            deadline: normalizeDeadline(deadlineMatch ? deadlineMatch[1] : ''),
            disciplines: '', duration: '', stipend: '', fee: '',
            description: desc.trim().slice(0, 500),
            sculptureRelevant: isSculptureRelevant(`${name} ${desc}`)
          });
        });
        if (results.length > 0) break;
      } catch { continue; }
    }
    console.log(`  Colossal: ${results.length} listings`);
  } catch (err) {
    console.error('  Colossal error:', err.message);
  }
  return results;
}

async function scrapeCreativeCapital() {
  const results = [];
  try {
    const html = await fetchPage('https://creative-capital.org/artist-resources/artist-opportunities/');
    const $ = load(html);
    $('section.block-header-featured-opportunities .block-featured-items a.item').each((_, el) => {
      const $el = $(el);
      const name = $el.find('.item-title h3').text().trim();
      const href = $el.attr('href');
      if (!name || !href) return;
      const link = href.startsWith('http') ? href : `https://creative-capital.org${href}`;
      const info = $el.find('.item-info span.label-text').text().trim();
      const desc = $el.find('.item-desc p').text().trim();
      const deadlineMatch = info.match(/Deadline:\s*(.+)/i);
      results.push({
        id: makeId('creative-capital', name, link), name, organization: 'Creative Capital',
        source: 'creative-capital', url: link, location: '', country: '',
        deadline: normalizeDeadline(deadlineMatch ? deadlineMatch[1] : ''),
        disciplines: '', duration: '', stipend: '', fee: '',
        description: desc.slice(0, 500),
        sculptureRelevant: isSculptureRelevant(`${name} ${desc}`)
      });
    });
    $('section.block-opportunities-grid .items-holder a.item').each((_, el) => {
      const $el = $(el);
      const name = $el.find('.item-title h3.xsmall-title').text().trim();
      const href = $el.attr('href');
      if (!name || !href) return;
      const link = href.startsWith('http') ? href : `https://creative-capital.org${href}`;
      const spans = $el.find('.item-info span.label-text');
      const deadlineText = spans.first().text().trim();
      const location = spans.length > 1 ? spans.eq(1).text().trim() : '';
      const desc = $el.find('.item-desc p.p-xsmall').text().trim();
      const deadlineMatch = deadlineText.match(/Deadline:\s*(.+)/i);
      results.push({
        id: makeId('creative-capital', name, link), name, organization: '',
        source: 'creative-capital', url: link, location, country: '',
        deadline: normalizeDeadline(deadlineMatch ? deadlineMatch[1] : ''),
        disciplines: '', duration: '', stipend: '', fee: '',
        description: desc.slice(0, 500),
        sculptureRelevant: isSculptureRelevant(`${name} ${desc}`)
      });
    });
    console.log(`  Creative Capital: ${results.length} listings`);
  } catch (err) {
    console.error('  Creative Capital error:', err.message);
  }
  return results;
}

async function scrapeDirect() {
  const programs = [
    { name: 'Sculpture Space Residency', organization: 'Sculpture Space', url: 'https://www.sculpturespace.org/application', location: 'Utica, NY, USA', country: 'USA', disciplines: 'sculpture, installation' },
    { name: 'Wassaic Project Residency', organization: 'Wassaic Project', url: 'https://www.wassaicproject.org/apply', location: 'Wassaic, NY, USA', country: 'USA', disciplines: 'visual arts, sculpture, interdisciplinary' },
    { name: 'ISPC Residency', organization: 'In Situ Polyculture Commons', url: 'https://insitupolyculture.org/program/2026-residency-open-call/', location: 'Various', country: '', disciplines: 'sculpture, installation, site-specific' },
    { name: 'Anderson Ranch Artists-in-Residence', organization: 'Anderson Ranch Arts Center', url: 'https://www.andersonranch.org/programs/artists-in-residence-program/', location: 'Snowmass, CO, USA', country: 'USA', disciplines: 'sculpture, ceramics, woodwork, all media' },
    { name: 'Yaddo Residency', organization: 'Yaddo', url: 'https://www.yaddo.org/apply/', location: 'Saratoga Springs, NY, USA', country: 'USA', disciplines: 'visual arts, sculpture' },
    { name: 'WORTHLESSSTUDIOS WARP Residency', organization: 'WORTHLESSSTUDIOS', url: 'https://www.worthlessstudios.com/warp', location: 'New York, NY, USA', country: 'USA', disciplines: 'sculpture, fabrication, large-scale' },
  ];
  const results = [];
  for (const prog of programs) {
    try {
      const html = await fetchPage(prog.url);
      const $ = load(html);
      const bodyText = $('body').text();
      const deadlinePatterns = [
        /deadline[:\s]*(\w+\s+\d{1,2},?\s*\d{4})/i,
        /applications?\s+(?:due|close)[:\s]*(\w+\s+\d{1,2},?\s*\d{4})/i,
        /due[:\s]*(\w+\s+\d{1,2},?\s*\d{4})/i,
      ];
      let deadline = '';
      for (const pat of deadlinePatterns) {
        const match = bodyText.match(pat);
        if (match) { deadline = match[1]; break; }
      }
      if (!deadline && bodyText.toLowerCase().includes('rolling')) deadline = 'rolling';
      const stipendMatch = bodyText.match(/\$[\d,]+(?:\s*(?:per|\/)\s*(?:month|week|stipend))?/i);
      const desc = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
      results.push({
        id: makeId('direct', prog.name, prog.url), name: prog.name, organization: prog.organization,
        source: 'direct', url: prog.url, location: prog.location, country: prog.country,
        deadline: normalizeDeadline(deadline), disciplines: prog.disciplines, duration: '',
        stipend: stipendMatch ? stipendMatch[0] : '', fee: '', description: desc.slice(0, 500),
        sculptureRelevant: true
      });
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`  Direct error (${prog.name}):`, err.message);
      results.push({
        id: makeId('direct', prog.name, prog.url), name: prog.name, organization: prog.organization,
        source: 'direct', url: prog.url, location: prog.location, country: prog.country,
        deadline: '', disciplines: prog.disciplines, duration: '', stipend: '', fee: '',
        description: 'Could not fetch latest details — visit the site directly.',
        sculptureRelevant: true
      });
    }
  }
  console.log(`  Direct: ${results.length} listings`);
  return results;
}

// ---------------------
// Main
// ---------------------

async function main() {
  console.log('ResidencyRadar scrape starting...\n');

  const allResults = [];
  const scrapers = [scrapeACA, scrapeResArtis, scrapeColossal, scrapeCreativeCapital, scrapeDirect];

  for (const fn of scrapers) {
    const results = await fn();
    allResults.push(...results);
  }

  // Deduplicate by id
  const seen = new Map();
  for (const r of allResults) {
    seen.set(r.id, r);
  }
  const deduplicated = [...seen.values()];

  // Add metadata
  const output = {
    lastScraped: new Date().toISOString(),
    count: deduplicated.length,
    residencies: deduplicated
  };

  fs.writeFileSync(DATA_PATH, JSON.stringify(output, null, 2));
  console.log(`\nDone. ${deduplicated.length} listings written to data/residencies.json`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
