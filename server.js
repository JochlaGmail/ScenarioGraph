/**
 * ScenarioGraph - Server
 * Lokal:  node server.js  ->  http://localhost:3000
 * Cloud:  Render startet automatisch
 *
 * configSettings.json:
 *   useGitHub    - true = GitHub API, false = lokale Dateien
 *   requireAuth  - true = Google-Login noetig, false = voller Zugriff ohne Login
 *   defaultGraph - ID des Standardgraphen
 *   port         - lokaler Port (Render ueberschreibt mit process.env.PORT)
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ── Konfiguration laden ───────────────────────────────────────────────────────
const CONFIG_FILE = path.join(__dirname, 'configSettings.json');
let config = {
  useGitHub:    false,
  requireAuth:  false,
  gitHubUser:   '',
  gitHubRepo:   '',
  gitHubBranch: 'main',
  defaultGraph: '',
  port:         3000
};

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    config = Object.assign(config, JSON.parse(raw));
  } catch(e) {
    console.warn('  configSettings.json nicht gefunden -- nutze Standardwerte.');
  }
}

loadConfig();

const PORT         = process.env.PORT || config.port;
const ROOT         = __dirname;
const USE_GITHUB   = config.useGitHub === true;
const REQUIRE_AUTH    = config.requireAuth === true;
const ENABLE_LOGIN_LOG = config.enableLoginLog !== false; // default true
const GH_USER      = config.gitHubUser;
const GH_REPO      = config.gitHubRepo;
const GH_BRANCH    = config.gitHubBranch || 'main';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GOOGLE_CLIENT_ID = '930379479474-fmn9vu7ecnk9bmb1aiv6tr4fbfm7ucv2.apps.googleusercontent.com';

// Lokale Pfade
const GRAPHS_DIR      = path.join(ROOT, 'graphs');
const GRAPH_LIST_FILE = path.join(ROOT, 'graphList.json');
const AUTH_USERS_FILE = path.join(ROOT, 'authorizedUsers.json');
const LOGIN_LOG_FILE  = path.join(ROOT, 'loginLog.json');

// graphs/-Ordner anlegen falls nicht vorhanden
if (!USE_GITHUB && !fs.existsSync(GRAPHS_DIR)) {
  fs.mkdirSync(GRAPHS_DIR);
}

console.log('\n  ScenarioGraph startet...');
console.log('  Speicher     : ' + (USE_GITHUB ? 'GitHub API' : 'Lokal'));
console.log('  Authorisierung: ' + (REQUIRE_AUTH ? 'erforderlich' : 'deaktiviert'));
if (USE_GITHUB) {
  console.log('  Repo  : ' + GH_USER + '/' + GH_REPO + ' (' + GH_BRANCH + ')');
  if (!GITHUB_TOKEN) console.warn('  WARNUNG: GITHUB_TOKEN nicht gesetzt!');
}

// ── MIME ──────────────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.ico':  'image/x-icon',
};

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function hashId(sub) {
  return crypto.createHash('sha256').update(sub).digest('hex');
}

function jsonResponse(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    const ext  = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function validateGraph(parsed) {
  if (typeof parsed.nodes !== 'object' || typeof parsed.edges !== 'object') {
    throw new Error('Ungueltiges Graph-Format.');
  }
}

function safeGraphId(id) {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

// ── Auth-Hilfsfunktion ────────────────────────────────────────────────────────
// Prueft ob eine Aktion erlaubt ist.
// Gibt { ok: true } oder { ok: false, status, error } zurueck.
async function checkAuth(token) {
  // requireAuth: false -> immer erlaubt
  if (!REQUIRE_AUTH) return { ok: true };

  const payload = verifyGoogleToken(token);
  if (!payload) return { ok: false, status: 401, error: 'Nicht eingeloggt' };

  const hashedSub = hashId(payload.sub);
  let authorized = false;
  try {
    if (USE_GITHUB) {
      const result = await ghRead('authorizedUsers.json');
      const authData = result ? result.content : { authorizedUsers: [] };
      authorized = authData.authorizedUsers.includes(hashedSub);
    } else {
      const authData = localRead(AUTH_USERS_FILE) || { authorizedUsers: [] };
      authorized = authData.authorizedUsers.includes(hashedSub);
    }
  } catch(e) {}

  if (!authorized) return { ok: false, status: 403, error: 'Kein Schreibzugriff' };
  return { ok: true };
}

// ── GitHub API ────────────────────────────────────────────────────────────────

function ghHeaders() {
  return {
    'Accept':        'application/vnd.github+json',
    'User-Agent':    'ScenarioGraph-Server',
    'Authorization': 'Bearer ' + GITHUB_TOKEN,
  };
}

function ghApiUrl(filePath) {
  return `https://api.github.com/repos/${GH_USER}/${GH_REPO}/contents/${filePath}?ref=${GH_BRANCH}`;
}

async function ghRead(filePath) {
  const response = await fetch(ghApiUrl(filePath), { headers: ghHeaders() });
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error('GitHub Lesefehler ' + response.status);
  }
  const data = await response.json();
  const decoded = Buffer.from(data.content, 'base64').toString('utf8');
  return { content: JSON.parse(decoded), sha: data.sha };
}

async function ghWrite(filePath, content, sha, message) {
  const encoded = Buffer.from(JSON.stringify(content, null, 2)).toString('base64');
  const body = { message, content: encoded, branch: GH_BRANCH };
  if (sha) body.sha = sha;
  const response = await fetch(
    `https://api.github.com/repos/${GH_USER}/${GH_REPO}/contents/${filePath}`,
    { method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error('GitHub Schreibfehler ' + response.status + ': ' + text);
  }
}

// ── Lokale Lese/Schreib-Hilfsfunktionen ──────────────────────────────────────

function localRead(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch(e) { return null; }
}

function localWrite(filePath, content) {
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf8');
}

// ── Google Token verifizieren ─────────────────────────────────────────────────

function verifyGoogleToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Kein JWT');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.aud !== GOOGLE_CLIENT_ID) throw new Error('Falsche Client-ID');
    if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token abgelaufen');
    return payload;
  } catch(e) { return null; }
}

// ── Login ─────────────────────────────────────────────────────────────────────

async function handleLogin(token, res) {
  const payload = verifyGoogleToken(token);
  if (!payload) return jsonResponse(res, 401, { error: 'Ungültiges Token' });

  const hashedSub = hashId(payload.sub);
  const now = new Date().toISOString();

  // Login loggen (nur wenn enableLoginLog: true)
  if (ENABLE_LOGIN_LOG) {
    try {
      if (USE_GITHUB) {
        const result = await ghRead('loginLog.json');
        const log = result ? result.content : { log: [] };
        const existing = log.log.find(e => e.hashedSub === hashedSub);
        if (existing) { existing.lastLogin = now; existing.loginCount = (existing.loginCount || 1) + 1; }
        else { log.log.push({ hashedSub, firstLogin: now, lastLogin: now, loginCount: 1 }); }
        await ghWrite('loginLog.json', log, result ? result.sha : null, 'Login geloggt');
      } else {
        const log = localRead(LOGIN_LOG_FILE) || { log: [] };
        const existing = log.log.find(e => e.hashedSub === hashedSub);
        if (existing) { existing.lastLogin = now; existing.loginCount = (existing.loginCount || 1) + 1; }
        else { log.log.push({ hashedSub, firstLogin: now, lastLogin: now, loginCount: 1 }); }
        localWrite(LOGIN_LOG_FILE, log);
      }
    } catch(e) { console.error('Login-Log Fehler:', e.message); }
  }

  // Autorisierung pruefen
  let authorized = false;
  if (!REQUIRE_AUTH) {
    authorized = true;
  } else {
    try {
      if (USE_GITHUB) {
        const result = await ghRead('authorizedUsers.json');
        const authData = result ? result.content : { authorizedUsers: [] };
        authorized = authData.authorizedUsers.includes(hashedSub);
      } else {
        const authData = localRead(AUTH_USERS_FILE) || { authorizedUsers: [] };
        authorized = authData.authorizedUsers.includes(hashedSub);
      }
    } catch(e) { console.error('Auth-Check Fehler:', e.message); }
  }

  jsonResponse(res, 200, { hashedSub, authorized });
}

// ── Graph lesen ───────────────────────────────────────────────────────────────

async function handleGetGraph(graphId, res) {
  try {
    let graph;
    if (USE_GITHUB) {
      const result = await ghRead('graphs/graph_' + graphId + '.json');
      if (!result) return jsonResponse(res, 404, { error: 'Graph nicht gefunden' });
      graph = result.content;
    } else {
      graph = localRead(path.join(GRAPHS_DIR, 'graph_' + graphId + '.json'));
      if (!graph) return jsonResponse(res, 404, { error: 'Graph nicht gefunden' });
    }
    jsonResponse(res, 200, graph);
  } catch(e) { jsonResponse(res, 502, { error: e.message }); }
}

// ── Graph schreiben ───────────────────────────────────────────────────────────

async function handleSaveGraph(graphId, body, token, res) {
  const auth = await checkAuth(token);
  if (!auth.ok) return jsonResponse(res, auth.status, { error: auth.error });

  try {
    const parsed = JSON.parse(body);
    validateGraph(parsed);
    if (USE_GITHUB) {
      const filePath = 'graphs/graph_' + graphId + '.json';
      const existing = await ghRead(filePath);
      await ghWrite(filePath, parsed, existing ? existing.sha : null, 'Graph ' + graphId + ' gespeichert');
    } else {
      localWrite(path.join(GRAPHS_DIR, 'graph_' + graphId + '.json'), parsed);
    }
    jsonResponse(res, 200, { ok: true });
  } catch(e) { jsonResponse(res, 400, { error: e.message }); }
}

// ── GraphList lesen ───────────────────────────────────────────────────────────

async function handleGetGraphList(res) {
  try {
    let list;
    if (USE_GITHUB) {
      const result = await ghRead('graphList.json');
      list = result ? result.content : { graphs: [] };
    } else {
      list = localRead(GRAPH_LIST_FILE) || { graphs: [] };
    }
    jsonResponse(res, 200, list);
  } catch(e) { jsonResponse(res, 502, { error: e.message }); }
}

// ── GraphList schreiben ───────────────────────────────────────────────────────

async function handleSaveGraphList(body, token, res) {
  const auth = await checkAuth(token);
  if (!auth.ok) return jsonResponse(res, auth.status, { error: auth.error });

  try {
    const parsed = JSON.parse(body);
    if (USE_GITHUB) {
      const existing = await ghRead('graphList.json');
      await ghWrite('graphList.json', parsed, existing ? existing.sha : null, 'graphList aktualisiert');
    } else {
      localWrite(GRAPH_LIST_FILE, parsed);
    }
    jsonResponse(res, 200, { ok: true });
  } catch(e) { jsonResponse(res, 400, { error: e.message }); }
}

// ── Config lesen ──────────────────────────────────────────────────────────────

async function handleGetConfig(res) {
  jsonResponse(res, 200, {
    defaultGraph:   config.defaultGraph || '',
    googleClientId: GOOGLE_CLIENT_ID,
    requireAuth:    REQUIRE_AUTH,
  });
}

// ── Config schreiben (nur defaultGraph) ───────────────────────────────────────

async function handleSaveConfig(body, token, res) {
  const auth = await checkAuth(token);
  if (!auth.ok) return jsonResponse(res, auth.status, { error: auth.error });

  try {
    const parsed = JSON.parse(body);

    // Nur erlaubte Felder uebernehmen -- nie requireAuth oder useGitHub per API aendern
    if (typeof parsed.defaultGraph === 'string') {
      config.defaultGraph = parsed.defaultGraph;
    }

    if (USE_GITHUB) {
      const existing = await ghRead('configSettings.json');
      const currentConfig = existing ? existing.content : {};
      const updatedConfig = Object.assign(currentConfig, { defaultGraph: config.defaultGraph });
      await ghWrite('configSettings.json', updatedConfig, existing ? existing.sha : null, 'Standardgraph gesetzt');
    } else {
      // Lokal: configSettings.json direkt aktualisieren
      let currentConfig = localRead(CONFIG_FILE) || {};
      currentConfig.defaultGraph = config.defaultGraph;
      localWrite(CONFIG_FILE, currentConfig);
    }

    jsonResponse(res, 200, { ok: true, defaultGraph: config.defaultGraph });
  } catch(e) { jsonResponse(res, 400, { error: e.message }); }
}

// ── HTTP-Server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const urlObj  = new URL(req.url, 'http://localhost');
  const urlPath = urlObj.pathname;

  // GET /api/config
  if (req.method === 'GET' && urlPath === '/api/config') {
    handleGetConfig(res); return;
  }

  // POST /api/config  (nur defaultGraph aenderbar)
  if (req.method === 'POST' && urlPath === '/api/config') {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '');
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => { handleSaveConfig(body, token, res); });
    return;
  }

  // POST /api/login
  if (req.method === 'POST' && urlPath === '/api/login') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { token } = JSON.parse(body);
        handleLogin(token, res);
      } catch(e) { jsonResponse(res, 400, { error: 'Ungueltige Anfrage' }); }
    });
    return;
  }

  // GET /api/graph?id=abc123
  if (req.method === 'GET' && urlPath === '/api/graph') {
    const graphId = urlObj.searchParams.get('id');
    if (!graphId || !safeGraphId(graphId)) return jsonResponse(res, 400, { error: 'Ungueltige Graph-ID' });
    handleGetGraph(graphId, res); return;
  }

  // POST /api/graph?id=abc123
  if (req.method === 'POST' && urlPath === '/api/graph') {
    const graphId = urlObj.searchParams.get('id');
    if (!graphId || !safeGraphId(graphId)) return jsonResponse(res, 400, { error: 'Ungueltige Graph-ID' });
    const token = (req.headers['authorization'] || '').replace('Bearer ', '');
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => { handleSaveGraph(graphId, body, token, res); });
    return;
  }

  // GET /api/graphlist
  if (req.method === 'GET' && urlPath === '/api/graphlist') {
    handleGetGraphList(res); return;
  }

  // POST /api/graphlist
  if (req.method === 'POST' && urlPath === '/api/graphlist') {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '');
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => { handleSaveGraphList(body, token, res); });
    return;
  }

  // Statische Dateien
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  const fullPath = path.join(ROOT, filePath);
  if (!fullPath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  serveFile(res, fullPath);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('  Port  : ' + PORT);
  console.log('  Spielansicht : http://localhost:' + PORT);
  console.log('  Dashboard    : http://localhost:' + PORT + '/dashboard.html');
  console.log('  Editor       : http://localhost:' + PORT + '/editor.html');
  console.log('  Stoppen mit Ctrl+C\n');
});
