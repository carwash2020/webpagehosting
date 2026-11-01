// Triple H trusted devices (2026-11-01): the browser half, shared by the
// client portal and the Workspace. "Trust this device for 30 days" on the
// 2FA step lets a correct PASSWORD skip the code on this device for 30 days.
//
// The server half is sql/security/add_trusted_devices.sql. One system, two
// sign-in pages: portal/login.html calls it through supabase-js, and
// tools/login.html through raw fetch (auth.js), each passing its own
// `rpc(name, args)` function here. Nothing in this file can let anyone skip
// anything by itself: the token kept below is only ever sent to
// use_trusted_device(), which compares it with a bcrypt hash in a table no
// browser can read, and only for a session that already proved the password.
//
// localStorage holds { id, token, expires_at } per account id. The token is
// a random 256-bit secret the server returned once; the server keeps only its
// hash. It lives in the same storage as the Supabase session itself, so it
// adds nothing that wasn't already readable on this device.
// The one shared global: a top-level var, so it is also window.ThTrustedDevice.
var ThTrustedDevice = (function () {
  var PREFIX = 'th_trusted_device:';

  function store() {
    try { return window.localStorage; } catch (e) { return null; }
  }
  function key(userId) {
    return PREFIX + String(userId || '').toLowerCase();
  }

  // This device's record for this account, or null. An expired one is
  // dropped here so the next sign-in doesn't bother the server with it.
  function get(userId) {
    var s = store();
    if (!s || !userId) return null;
    var rec = null;
    try { rec = JSON.parse(s.getItem(key(userId)) || 'null'); } catch (e) { rec = null; }
    if (!rec || typeof rec.id !== 'string' || typeof rec.token !== 'string') return null;
    if (rec.expires_at && Date.parse(rec.expires_at) <= Date.now()) {
      clear(userId);
      return null;
    }
    return rec;
  }
  function save(userId, rec) {
    var s = store();
    if (!s || !userId) return;
    try { s.setItem(key(userId), JSON.stringify({ id: rec.id, token: rec.token, expires_at: rec.expires_at })); } catch (e) { /* storage full or blocked */ }
  }
  function clear(userId) {
    var s = store();
    if (!s || !userId) return;
    try { s.removeItem(key(userId)); } catch (e) { /* ignore */ }
  }
  // Every account's record on this device (a password reset page doesn't
  // always know whose password it just changed).
  function clearAll() {
    var s = store();
    if (!s) return;
    try {
      var doomed = [];
      for (var i = 0; i < s.length; i++) {
        var k = s.key(i);
        if (k && k.indexOf(PREFIX) === 0) doomed.push(k);
      }
      doomed.forEach(function (k) { s.removeItem(k); });
    } catch (e) { /* ignore */ }
  }

  // The account id (`sub`) of an access token. Read locally; only used to
  // pick which record to send, never to decide anything.
  function userIdFromJwt(token) {
    try {
      var payload = String(token).split('.')[1];
      return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).sub || null;
    } catch (e) {
      return null;
    }
  }

  // The Workspace's transport: rpc(name, args) over raw fetch with an
  // explicit token, the same way tools/auth.js makes every MFA call (its
  // login page works with a session it hasn't stored yet). The portal passes
  // a supabase-js client.rpc wrapper instead. Throws on any non-2xx.
  function fetchRpc(supabaseUrl, anonKey, accessToken) {
    return async function (name, args) {
      var res = await fetch(supabaseUrl + '/rest/v1/rpc/' + name, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': anonKey, 'Authorization': 'Bearer ' + accessToken },
        body: JSON.stringify(args || {}),
      });
      var data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (!res.ok) {
        var err = new Error((data && (data.message || data.error_description || data.msg)) || ('HTTP ' + res.status));
        err.status = res.status;
        throw err;
      }
      return data;
    };
  }

  // "Safari on iPhone", "Chrome on Windows". Shown in Settings so a person can
  // tell their devices apart. Only the browser and platform, nothing finer.
  function deviceLabel(ua) {
    ua = String(ua || '');
    var platform = /iPhone/.test(ua) ? 'iPhone'
      : /iPad/.test(ua) ? 'iPad'
      : /Android/.test(ua) ? 'Android'
      : /Windows/.test(ua) ? 'Windows'
      : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
      : /CrOS/.test(ua) ? 'Chromebook'
      : /Linux/.test(ua) ? 'Linux'
      : '';
    var browser = /Edg\//.test(ua) ? 'Edge'
      : /OPR\/|Opera/.test(ua) ? 'Opera'
      : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
      : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
      : /Chrome\/|CriOS/.test(ua) ? 'Chrome'
      : /Safari\//.test(ua) ? 'Safari'
      : '';
    if (browser && platform) return browser + ' on ' + platform;
    return browser || platform || 'Unknown device';
  }

  // After a correct password on an account with 2FA. True only when the
  // server accepted this device's token for the session that just signed in.
  // A token the server rejects (removed, expired, password or 2FA changed) is
  // forgotten here; a network error keeps it and simply asks for the code.
  async function tryUse(rpc, userId) {
    var rec = get(userId);
    if (!rec) return false;
    try {
      var ok = await rpc('use_trusted_device', { p_device_id: rec.id, p_token: rec.token });
      if (ok === true) return true;
      if (ok === false) clear(userId);
      return false;
    } catch (e) {
      return false;
    }
  }

  // Right after a correct code, with the switch on. Best effort: a failure
  // here never gets in the way of signing in, it just means the code is
  // asked for next time.
  async function remember(rpc, userId, surface) {
    if (!userId) return false;
    try {
      var r = await rpc('trust_this_device', {
        p_label: deviceLabel(typeof navigator !== 'undefined' ? navigator.userAgent : ''),
        p_surface: surface,
      });
      if (r && r.id && r.token) {
        save(userId, r);
        return true;
      }
    } catch (e) { /* best effort */ }
    return false;
  }

  // Settings. Throws on failure so the page can say so.
  async function list(rpc) {
    var rows = await rpc('list_my_trusted_devices', {});
    return Array.isArray(rows) ? rows : [];
  }

  // Settings → Remove. Revokes one device; if it's this one, forgets the
  // token here as well.
  async function remove(rpc, userId, deviceId) {
    var ok = await rpc('revoke_trusted_device', { p_device_id: deviceId });
    var rec = get(userId);
    if (rec && rec.id === deviceId) clear(userId);
    return ok === true;
  }

  // After a password change, or when 2FA is turned off or set up again.
  // The server already treats those devices as dead (it checks the password
  // and the authenticator on every use); this deletes them so Settings shows
  // the truth right away. Never throws.
  async function revokeAll(rpc, userId) {
    try { await rpc('revoke_all_trusted_devices', {}); } catch (e) { /* the server-side checks still hold */ }
    if (userId) clear(userId); else clearAll();
  }

  function isThisDevice(userId, deviceId) {
    var rec = get(userId);
    return !!rec && rec.id === deviceId;
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return {
    get: get, save: save, clear: clear, clearAll: clearAll,
    userIdFromJwt: userIdFromJwt, deviceLabel: deviceLabel, fetchRpc: fetchRpc,
    tryUse: tryUse, remember: remember, list: list, remove: remove, revokeAll: revokeAll,
    isThisDevice: isThisDevice, formatDate: formatDate,
  };
})();
