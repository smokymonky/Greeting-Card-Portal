const crypto = require('crypto');

// ─────────────────────────────────────────────
//  Secrets come from Netlify environment variables.
//  Nothing sensitive is stored in this repo.
//  Set these in: Netlify → Site configuration →
//                Environment variables
// ─────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const SHEET_ID = process.env.SHEET_ID;
const SA_EMAIL = process.env.SA_EMAIL;
const PRIV_KEY = (process.env.SA_PRIVATE_KEY || '').replace(/\\n/g, '\n');

function missingEnv() {
  const need = { ADMIN_PASSWORD, SESSION_SECRET, SHEET_ID, SA_EMAIL, SA_PRIVATE_KEY: PRIV_KEY };
  return Object.keys(need).filter(k => !need[k]);
}

const CHUNK = 40000;

// ── Google auth ──
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signingInput = b64(header) + '.' + b64(payload);
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const sig = signer.sign(PRIV_KEY, 'base64url');
  const jwt = signingInput + '.' + sig;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Google auth failed');
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 3400000;
  return cachedToken;
}

async function sheetsGet(range) {
  const token = await getToken();
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID +
              '/values/' + encodeURIComponent(range);
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  const d = await res.json();
  return d.values || [];
}

async function sheetsSet(range, values) {
  const token = await getToken();
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID +
              '/values/' + encodeURIComponent(range) + '?valueInputOption=RAW';
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
  return res.json();
}

async function sheetsAppend(sheetName, row) {
  const token = await getToken();
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID +
              '/values/' + encodeURIComponent(sheetName) + ':append?valueInputOption=USER_ENTERED';
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] })
  });
  return res.json();
}

async function sheetsClear(range) {
  const token = await getToken();
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID +
              '/values/' + encodeURIComponent(range) + ':clear';
  await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
}

async function listSheets() {
  const token = await getToken();
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID +
              '?fields=sheets.properties.title';
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  const d = await res.json();
  return (d.sheets || []).map(s => s.properties.title);
}

async function addSheet(title) {
  const token = await getToken();
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + ':batchUpdate';
  await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] })
  });
  await sheetsSet(title + '!A1:E1', [['Full Name', 'Job Title', 'Device', 'Date', 'Time']]);
}

async function ensureConfigSheets() {
  const sheets = await listSheets();
  if (!sheets.includes('Config')) {
    const token = await getToken();
    await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + ':batchUpdate', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: 'Config' } } }] })
    });
  }
  if (!sheets.includes('ConfigImage')) {
    const token = await getToken();
    await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + ':batchUpdate', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: 'ConfigImage' } } }] })
    });
  }
  if (!sheets.includes('Events')) {
    const token = await getToken();
    await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + ':batchUpdate', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: 'Events' } } }] })
    });
    await sheetsSet('Events!A1:B3', [
      ['Event Name', 'Sheet'],
      ['Eid Alfiter', 'Sheet1'],
      ['Eid Al-Adha', 'Sheet2']
    ]);
  }
}

// ── Config read/write ──
const DEFAULTS = {
  status: 'open',
  eventName: 'Eid Al-Adha',
  eventSheet: 'Sheet2',
  pillTop: '1027',
  pillBottom: '1121',
  pillCenterX: '667',
  pillMaxW: '451',
  nameSize: '47',
  titleSize: '34',
  gap: '12',
  pageTitle: '',
  subtitle: 'Generate your personalised greeting card',
  closedTitle: 'Coming Soon',
  headline: ''
};

async function readConfig() {
  const rows = await sheetsGet('Config!A:B');
  const cfg = Object.assign({}, DEFAULTS);
  rows.forEach(r => { if (r[0]) cfg[r[0]] = r[1] !== undefined ? r[1] : ''; });
  return cfg;
}

async function writeConfig(obj) {
  const current = await readConfig();
  const merged = Object.assign(current, obj);
  const rows = Object.keys(merged).map(k => [k, String(merged[k])]);
  await sheetsClear('Config!A:B');
  await sheetsSet('Config!A1:B' + rows.length, rows);
  return merged;
}

async function readImage() {
  const rows = await sheetsGet('ConfigImage!A:A');
  return rows.map(r => r[0] || '').join('');
}

async function writeImage(b64) {
  await sheetsClear('ConfigImage!A:A');
  const chunks = [];
  for (let i = 0; i < b64.length; i += CHUNK) chunks.push([b64.slice(i, i + CHUNK)]);
  if (chunks.length === 0) return;
  await sheetsSet('ConfigImage!A1:A' + chunks.length, chunks);
}

// ── Session tokens ──
function makeToken() {
  const exp = Date.now() + 8 * 3600 * 1000;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(String(exp)).digest('hex');
  return exp + '.' + sig;
}

function checkToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const exp = Number(parts[0]);
  if (!exp || Date.now() > exp) return false;
  const expect = crypto.createHmac('sha256', SESSION_SECRET).update(String(exp)).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expect));
  } catch (e) { return false; }
}

// ── Handler ──
const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

function ok(body) { return { statusCode: 200, headers: HEADERS, body: JSON.stringify(body) }; }
function bad(code, msg) { return { statusCode: code, headers: HEADERS, body: JSON.stringify({ error: msg }) }; }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return bad(405, 'Method not allowed');

  const miss = missingEnv();
  if (miss.length) {
    return bad(500, 'Server not configured. Missing environment variables: ' + miss.join(', '));
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return bad(400, 'Bad JSON'); }

  const action = body.action;

  try {
    // ---- PUBLIC ----
    if (action === 'getPublicConfig') {
      const cfg = await readConfig();
      if (cfg.status !== 'open') {
        return ok({
          status: cfg.status,
          closedTitle: cfg.closedTitle || 'Coming Soon',
          headline: cfg.headline || ''
        });
      }
      const image = await readImage();
      return ok({
        status: 'open',
        image: image,
        eventName: cfg.eventName,
        pageTitle: cfg.pageTitle || '',
        subtitle: cfg.subtitle || '',
        pill: {
          top: Number(cfg.pillTop),
          bottom: Number(cfg.pillBottom),
          centerX: Number(cfg.pillCenterX),
          maxW: Number(cfg.pillMaxW),
          nameSize: Number(cfg.nameSize),
          titleSize: Number(cfg.titleSize),
          gap: Number(cfg.gap)
        }
      });
    }

    if (action === 'saveCard') {
      const cfg = await readConfig();
      if (cfg.status !== 'open') return bad(403, 'Portal is closed');
      const name = String(body.name || '').slice(0, 60);
      const title = String(body.title || '').slice(0, 90);
      const device = body.device === 'iPhone' ? 'iPhone' : 'Android';
      const now = new Date();
      const opts = { timeZone: 'Asia/Riyadh' };
      const date = now.toLocaleDateString('en-GB', opts);
      const time = now.toLocaleTimeString('en-GB', opts);
      await sheetsAppend(cfg.eventSheet, [name, title || '-', device, date, time]);
      return ok({ saved: true });
    }

    // ---- LOGIN ----
    if (action === 'login') {
      const pw = String(body.password || '');
      const a = Buffer.from(pw.padEnd(64).slice(0, 64));
      const b = Buffer.from(ADMIN_PASSWORD.padEnd(64).slice(0, 64));
      if (!crypto.timingSafeEqual(a, b)) {
        await new Promise(r => setTimeout(r, 700));
        return bad(401, 'Wrong password');
      }
      return ok({ token: makeToken() });
    }

    // ---- PROTECTED ----
    if (!checkToken(body.token)) return bad(401, 'Not authorised');

    if (action === 'getAdminConfig') {
      await ensureConfigSheets();
      const cfg = await readConfig();
      const image = await readImage();
      const events = await sheetsGet('Events!A:B');
      return ok({ config: cfg, image: image, events: events.slice(1) });
    }

    if (action === 'saveConfig') {
      const allowed = ['status', 'eventName', 'eventSheet', 'pillTop', 'pillBottom',
                       'pillCenterX', 'pillMaxW', 'nameSize', 'titleSize', 'gap',
                       'pageTitle', 'subtitle', 'closedTitle', 'headline'];
      const patch = {};
      allowed.forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
      const merged = await writeConfig(patch);
      return ok({ config: merged });
    }

    if (action === 'saveImage') {
      const img = String(body.image || '');
      if (!img) return bad(400, 'No image');
      await writeImage(img);
      return ok({ saved: true, size: img.length });
    }

    if (action === 'createEvent') {
      const name = String(body.name || '').trim();
      if (!name) return bad(400, 'No name');
      const sheets = await listSheets();
      let sheetName = name.replace(/[^A-Za-z0-9 \-]/g, '').slice(0, 40) || 'Event';
      let n = 2;
      let base = sheetName;
      while (sheets.includes(sheetName)) { sheetName = base + ' ' + n; n++; }
      await addSheet(sheetName);
      await sheetsAppend('Events', [name, sheetName]);
      await writeConfig({ eventName: name, eventSheet: sheetName });
      return ok({ created: true, sheet: sheetName });
    }

    if (action === 'getDashboard') {
      const events = await sheetsGet('Events!A:B');
      const list = events.slice(1).filter(r => r[0] && r[1]);
      const target = body.sheet || (list.length ? list[list.length - 1][1] : 'Sheet2');
      const rows = await sheetsGet(target + '!A:E');
      const data = rows.filter(r => r[0] && r[0] !== 'Full Name' && r[0] !== 'Name');
      return ok({ events: list, sheet: target, rows: data });
    }

    return bad(400, 'Unknown action');
  } catch (err) {
    return bad(500, err.message || 'Server error');
  }
};
