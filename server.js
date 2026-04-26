/**
 * Entscheidungsbaum - Server
 * Lokal:  node server.js  ->  http://localhost:3000
 * Cloud:  wird von Render automatisch gestartet
 *
 * Konfiguration: configSettings.json
 *   useGitHub: false  ->  liest/schreibt graph.json lokal
 *   useGitHub: true   ->  liest/schreibt ueber GitHub API
 *                         GitHub Personal Access Token kommt aus
 *                         Umgebungsvariable GITHUB_TOKEN (nur zum Schreiben noetig)
 *                         Bei public Repository: Lesen funktioniert auch ohne Token
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

// ── Konfiguration laden ───────────────────────────────────────────────────────
const CONFIG_FILE = path.join(__dirname, 'configSettings.json');
let config = {
  useGitHub:    false,
  gitHubUser:   '',
  gitHubRepo:   '',
  gitHubBranch: 'main',
  gitHubFile:   'graph.json',
  port:         3000
};

try {
  const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
  config = Object.assign(config, JSON.parse(raw));
} catch(e) {
  console.warn('  configSettings.json nicht gefunden oder fehlerhaft -- nutze Standardwerte.');
}

const PORT         = process.env.PORT || config.port;
const ROOT         = __dirname;
const GRAPH_FILE   = path.join(ROOT, 'graph.json');
const USE_GITHUB   = config.useGitHub === true;
const GH_USER      = config.gitHubUser;
const GH_REPO      = config.gitHubRepo;
const GH_BRANCH    = config.gitHubBranch || 'main';
const GH_FILE      = config.gitHubFile   || 'graph.json';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

// GitHub API Basis-URL fuer die Datei
const GH_API_URL = `https://api.github.com/repos/${GH_USER}/${GH_REPO}/contents/${GH_FILE}`;

// Startmeldung
console.log('\n  Entscheidungsbaum startet...');
console.log('  Modus : ' + (USE_GITHUB ? 'GitHub API (Cloud)' : 'Lokal (graph.json)'));
if (USE_GITHUB) {
  console.log('  Repo  : ' + GH_USER + '/' + GH_REPO + ' (' + GH_BRANCH + ')');
  if (!GH_USER || !GH_REPO) console.warn('  WARNUNG: gitHubUser oder gitHubRepo fehlt in configSettings.json!');
  if (!GITHUB_TOKEN)         console.warn('  WARNUNG: GITHUB_TOKEN nicht gesetzt -- Schreiben wird fehlschlagen!');
}

// ── MIME-Typen ────────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.ico':  'image/x-icon',
};

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext  = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function validateGraph(parsed) {
  if (typeof parsed.nodes !== 'object' || typeof parsed.edges !== 'object') {
    throw new Error('Ungueltiges Graph-Format: nodes oder edges fehlen.');
  }
}

function githubHeaders(withToken) {
  const headers = {
    'Accept':     'application/vnd.github+json',
    'User-Agent': 'Entscheidungsbaum-Server',
  };
  if (withToken && GITHUB_TOKEN) {
    headers['Authorization'] = 'Bearer ' + GITHUB_TOKEN;
  }
  return headers;
}

// ── Graph lesen ───────────────────────────────────────────────────────────────

function readGraphLocal(res) {
  fs.readFile(GRAPH_FILE, 'utf8', (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'graph.json nicht gefunden' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(data);
  });
}

async function readGraphGitHub(res) {
  try {
    // GitHub API gibt die Datei base64-kodiert zurueck
    const url = GH_API_URL + '?ref=' + GH_BRANCH;
    const response = await fetch(url, {
      headers: githubHeaders(true) // Token optional bei public Repos
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error('GitHub Lesefehler ' + response.status + ': ' + text);
    }
    const data = await response.json();
    // Inhalt ist base64-kodiert, dekodieren
    const decoded = Buffer.from(data.content, 'base64').toString('utf8');
    const graph = JSON.parse(decoded);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(graph));
  } catch(e) {
    console.error('  Lesefehler GitHub:', e.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

// ── Graph schreiben ───────────────────────────────────────────────────────────

function writeGraphLocal(body, res) {
  try {
    const parsed = JSON.parse(body);
    validateGraph(parsed);
    const pretty = JSON.stringify(parsed, null, 2);
    fs.writeFile(GRAPH_FILE, pretty, 'utf8', (err) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Schreibfehler: ' + err.message }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  } catch(e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function writeGraphGitHub(body, res) {
  try {
    const parsed = JSON.parse(body);
    validateGraph(parsed);

    // Schritt 1: aktuelle SHA der Datei holen (GitHub braucht sie zum Ueberschreiben)
    const getResponse = await fetch(GH_API_URL + '?ref=' + GH_BRANCH, {
      headers: githubHeaders(true)
    });
    if (!getResponse.ok) {
      const text = await getResponse.text();
      throw new Error('GitHub SHA-Abruf fehlgeschlagen ' + getResponse.status + ': ' + text);
    }
    const current = await getResponse.json();
    const sha = current.sha;

    // Schritt 2: Datei mit neuem Inhalt ueberschreiben
    const newContent = Buffer.from(JSON.stringify(parsed, null, 2)).toString('base64');
    const putResponse = await fetch(GH_API_URL, {
      method: 'PUT',
      headers: {
        ...githubHeaders(true),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Graph aktualisiert via Entscheidungsbaum-Editor',
        content: newContent,
        sha:     sha,
        branch:  GH_BRANCH,
      }),
    });

    if (!putResponse.ok) {
      const text = await putResponse.text();
      throw new Error('GitHub Schreibfehler ' + putResponse.status + ': ' + text);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch(e) {
    console.error('  Schreibfehler GitHub:', e.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

// ── HTTP-Server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET /api/graph
  if (req.method === 'GET' && req.url.startsWith('/api/graph')) {
    if (USE_GITHUB) { readGraphGitHub(res); } else { readGraphLocal(res); }
    return;
  }

  // POST /api/graph
  if (req.method === 'POST' && req.url === '/api/graph') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (USE_GITHUB) { writeGraphGitHub(body, res); } else { writeGraphLocal(body, res); }
    });
    return;
  }

  // Statische Dateien
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  serveFile(res, filePath);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('  Laeuft auf Port ' + PORT);
  if (!USE_GITHUB) {
    console.log('  Spielansicht : http://localhost:' + PORT + '/index.html');
    console.log('  Graph-Editor : http://localhost:' + PORT + '/editor.html');
  }
  console.log('  Stoppen mit Ctrl+C\n');
});
