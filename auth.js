/**
 * auth.js - Gemeinsames Authentifizierungsmodul
 *
 * Beim Start wird /api/config abgefragt.
 * requireAuth: false -> sofort authorized: true, kein Google-Login noetig.
 * requireAuth: true  -> Google Identity Services, Token im localStorage.
 *
 * Nach erfolgreichem Login wird die Seite neu geladen damit alle
 * Komponenten den neuen Auth-Status sauber initialisieren.
 */

const Auth = (() => {
  const TOKEN_KEY  = 'sg_google_token';
  const AUTH_KEY   = 'sg_authorized';
  const HASH_KEY   = 'sg_hashed_sub';
  const EXPIRY_KEY = 'sg_token_expiry';

  let _token       = null;
  let _authorized  = false;
  let _hashedSub   = null;
  let _requireAuth = false;
  let _ready       = false;
  let _onReady     = [];

  // ── localStorage ──────────────────────────────────────────────────────────

  function getStored() {
    try {
      const token  = localStorage.getItem(TOKEN_KEY);
      const expiry = parseInt(localStorage.getItem(EXPIRY_KEY) || '0', 10);
      const auth   = localStorage.getItem(AUTH_KEY) === 'true';
      const hashed = localStorage.getItem(HASH_KEY);
      if (!token || Date.now() / 1000 > expiry) return null;
      return { token, auth, hashed };
    } catch(e) { return null; }
  }

  function store(token, authorized, hashedSub, exp) {
    try {
      localStorage.setItem(TOKEN_KEY,  token);
      localStorage.setItem(AUTH_KEY,   String(authorized));
      localStorage.setItem(HASH_KEY,   hashedSub || '');
      localStorage.setItem(EXPIRY_KEY, String(exp));
    } catch(e) {}
  }

  function clear() {
    try {
      [TOKEN_KEY, AUTH_KEY, HASH_KEY, EXPIRY_KEY].forEach(k => localStorage.removeItem(k));
    } catch(e) {}
  }

  function parseExpiry(token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp || 0;
    } catch(e) { return 0; }
  }

  // ── Server-Kommunikation ──────────────────────────────────────────────────

  async function fetchConfig() {
    try {
      const r = await fetch('/api/config');
      if (!r.ok) return {};
      return await r.json();
    } catch(e) { return {}; }
  }

  async function verifyWithServer(token) {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    if (!response.ok) throw new Error('Server-Fehler beim Login');
    return await response.json(); // { hashedSub, authorized }
  }

  // ── Google Callback ───────────────────────────────────────────────────────

  async function handleCredentialResponse(response) {
    const token = response.credential;
    try {
      const result = await verifyWithServer(token);
      const exp = parseExpiry(token);
      store(token, result.authorized, result.hashedSub, exp);
      // Seite neu laden damit alle Komponenten sauber initialisieren
      window.location.reload();
    } catch(e) {
      console.error('Login fehlgeschlagen:', e);
      window.dispatchEvent(new CustomEvent('auth:error', { detail: e.message }));
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async function init() {
    const cfg = await fetchConfig();
    _requireAuth = cfg.requireAuth === true;

    if (!_requireAuth) {
      // Auth deaktiviert: sofort vollen Zugriff gewaehren
      _authorized = true;
      _ready = true;
      _onReady.forEach(fn => fn());
      window.dispatchEvent(new CustomEvent('auth:ready', {
        detail: { loggedIn: true, authorized: true, requireAuth: false }
      }));
      return;
    }

    // Auth aktiv: gespeichertes Token pruefen
    const stored = getStored();
    if (stored) {
      _token      = stored.token;
      _authorized = stored.auth;
      _hashedSub  = stored.hashed;
      _ready = true;
      _onReady.forEach(fn => fn());
      window.dispatchEvent(new CustomEvent('auth:ready', {
        detail: { loggedIn: true, authorized: _authorized, requireAuth: true }
      }));
      return;
    }

    // Kein Token -> Google-Login bereitstellen
    window.handleGoogleCredential = handleCredentialResponse;
    _ready = true;
    _onReady.forEach(fn => fn());
    window.dispatchEvent(new CustomEvent('auth:ready', {
      detail: { loggedIn: false, authorized: false, requireAuth: true }
    }));
  }

  // ── Logout ────────────────────────────────────────────────────────────────

  function logout() {
    clear();
    _token      = null;
    _authorized = false;
    _hashedSub  = null;
    if (window.google && window.google.accounts) {
      window.google.accounts.id.disableAutoSelect();
    }
    window.location.reload();
  }

  // ── Fetch-Wrapper mit Auth-Header ─────────────────────────────────────────

  async function authFetch(url, options = {}) {
    if (_token) {
      options.headers = options.headers || {};
      options.headers['Authorization'] = 'Bearer ' + _token;
    }
    return fetch(url, options);
  }

  // ── Getter ────────────────────────────────────────────────────────────────

  function getToken()     { return _token; }
  function isAuthorized() { return _authorized; }
  function isLoggedIn()   { return !_requireAuth || !!_token; }
  function getHashedSub() { return _hashedSub; }

  function onReady(fn) {
    if (_ready) fn();
    else _onReady.push(fn);
  }

  return { init, logout, getToken, isAuthorized, isLoggedIn, getHashedSub, onReady, authFetch };
})();
