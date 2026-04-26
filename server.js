/**
 * Entscheidungsbaum - Server
 * Lokal:  node server.js  ->  http://localhost:3000
 * Cloud:  wird von Render automatisch gestartet
 *
 * Konfiguration: configSettings.json
 *   useJsonBin: false  ->  liest/schreibt graph.json lokal
 *   useJsonBin: true   ->  liest/schreibt ueber JSONbin.io
 *                          API-Key kommt aus Umgebungsvariable JSONBIN_API_KEY
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

// ── Konfiguration laden ───────────────────────────────────────────────────────
const CONFIG_FILE = path.join(__dirname, 'configSettings.json');
let config = { useJsonBin: false, jsonBinId: '', port: 3000 };

try {
  const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
  config = Object.assign(config, JSON.parse(raw));
} catch(e) {
  console.warn('  configSettings.json nicht gefunden oder fehlerhaft -- nutze Standardwerte.');
}

// Port: Render setzt process.env.PORT, lokal kommt er aus der config
const PORT       = process.env.PORT || config.port;
const ROOT       = __dirname;
const GRAPH_FILE = path.join(ROOT, 'graph.json');
const USE_JSONBIN = config.useJsonBin === true;
const JSONBIN_ID  = config.jsonBinId || '';
const JSONBIN_KEY = process.env.JSONBIN_API_KEY || '';

// Startmeldung
console.log('\n  Entscheidungsbaum startet...');
console.log('  Modus : ' + (USE_JSONBIN ? 'JSONbin.io (Cloud)' : 'Lokal (graph.json)'));
if (USE_JSONBIN) {
  if (!JSONBIN_ID)  console.warn('  WARNUNG: jsonBinId fehlt in configSettings.json!');
  if (!JSONBIN_KEY) console.warn('  WARNUNG: Umgebungsvariable JSONBIN_API_KEY nicht gesetzt!');
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

async function readGraphJsonBin(res) {
  try {
    const response = await fetch(
      `https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`,
      { headers: { 'X-Master-Key': JSONBIN_KEY } }
    );
    if (!response.ok) throw new Error('JSONbin Lesefehler: ' + response.status);
    const data = await response.json();
    // JSONbin verpackt den Inhalt unter data.record
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data.record));
  } catch(e) {
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

async function writeGraphJsonBin(body, res) {
  try {
    const parsed = JSON.parse(body);
    validateGraph(parsed);
    const response = await fetch(
      `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': JSONBIN_KEY,
        },
        body: JSON.stringify(parsed),
      }
    );
    if (!response.ok) throw new Error('JSONbin Schreibfehler: ' + response.status);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch(e) {
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
    if (USE_JSONBIN) { readGraphJsonBin(res); } else { readGraphLocal(res); }
    return;
  }

  // POST /api/graph
  if (req.method === 'POST' && req.url === '/api/graph') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (USE_JSONBIN) { writeGraphJsonBin(body, res); } else { writeGraphLocal(body, res); }
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
  if (!USE_JSONBIN) {
    console.log('  Spielansicht : http://localhost:' + PORT + '/index.html');
    console.log('  Graph-Editor : http://localhost:' + PORT + '/editor.html');
  }
  console.log('  Stoppen mit Ctrl+C\n');
});
