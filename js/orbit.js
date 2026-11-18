(function () {
  'use strict';

  const firebaseConfig = {
    apiKey: "AIzaSyCrZmgL8mkK90qdnJ-WkHRaEMAHsgUQ3yM",
    authDomain: "orbit-5b26f.firebaseapp.com",
    databaseURL: "https://orbit-5b26f-default-rtdb.firebaseio.com",
    projectId: "orbit-5b26f",
    storageBucket: "orbit-5b26f.firebasestorage.app",
    messagingSenderId: "964534662601",
    appId: "1:964534662601:web:b067a00860f9e2f6d96418"
  };
  // Public reCAPTCHA v3 site key for Firebase App Check.
  const APP_CHECK_RECAPTCHA_SITE_KEY = '6Lc8MCQuAAAAAKPmPQAGUe973GjOzT6m7cnZaCQA';
  firebase.initializeApp(firebaseConfig);
  if (APP_CHECK_RECAPTCHA_SITE_KEY) {
    try { firebase.appCheck().activate(APP_CHECK_RECAPTCHA_SITE_KEY, true); }
    catch (e) { console.error('Orbit: Firebase App Check could not start', e); }
  }
  const auth = firebase.auth();
  const db = firebase.database();
  const TS = firebase.database.ServerValue.TIMESTAMP;
  let firebaseAdminClaim = false;
  let firebaseAdminLinked = false;
  let firebaseAdminProfile = null;
  let anonymousSignInAttempted = false;
  let adminAuthLinkRef = null;
  let adminAuthLinkListener = null;
  auth.onIdTokenChanged(async user => {
    firebaseAdminClaim = false;
    firebaseAdminLinked = false;
    firebaseAdminProfile = null;
    if (adminAuthLinkRef && adminAuthLinkListener) adminAuthLinkRef.off('value', adminAuthLinkListener);
    adminAuthLinkRef = null;
    adminAuthLinkListener = null;
    if (!user) {
      if (!anonymousSignInAttempted) {
        anonymousSignInAttempted = true;
        auth.signInAnonymously().catch(error => {
          console.warn('Orbit: anonymous sign-in unavailable; self-delete needs Firebase Anonymous sign-in enabled.', error);
          toast('Enable Anonymous sign-in in Firebase Authentication to let members delete their own new messages.', true);
        });
      }
      queueMicrotask(() => queueChange()); return;
    }
    try {
      const result = await user.getIdTokenResult();
      firebaseAdminClaim = result.claims.admin === true;
    } catch (e) { firebaseAdminClaim = false; }
    if (user.uid !== OWNER_UID) {
      adminAuthLinkRef = db.ref('adminAuthUids/' + user.uid);
      adminAuthLinkListener = snap => {
        firebaseAdminProfile = typeof snap.val() === 'string' ? snap.val() : null;
        firebaseAdminLinked = !!firebaseAdminProfile && firebaseAdminProfile === uid;
        queueChange();
      };
      adminAuthLinkRef.on('value', adminAuthLinkListener, () => {
        firebaseAdminProfile = null; firebaseAdminLinked = false; queueChange();
      });
    } else queueChange();
  });
  // The owner is identified by Firebase Authentication, never by a password hash in this file.
  const OWNER_UID = 'zdvC4quVlRSabq57SDXoukS7SAt2';
  // Set to true once Firebase Storage is enabled for the project (Console → Storage → Get started).
  // While false, uploads are stored in the Realtime Database (max ~9.5 MB per file).
  const USE_FIREBASE_STORAGE = false;
  let storage = null;
  if (USE_FIREBASE_STORAGE) try {
    storage = firebase.storage();
    storage.setMaxUploadRetryTime(15000);
    storage.setMaxOperationRetryTime(15000);
  } catch (e) { storage = null; }

  // Name-based staff tags. These nicknames are reserved for the signed-in owner.
  const STAFF_NAMES = { omere: 'OWNER', ooze34: 'OWNER', ome: 'OWNER', orbit: 'OWNER' };
  const DB_FILE_MAX = 9.5 * 1024 * 1024;     // fallback (Realtime Database) upload cap
  const STORAGE_FILE_MAX = 50 * 1024 * 1024; // Firebase Storage upload cap

  let serverOffset = 0;
  db.ref('.info/serverTimeOffset').on('value', s => { serverOffset = s.val() || 0; });
  const now = () => Date.now() + serverOffset;

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) {} }
  };
  const $ = (s, r = document) => r.querySelector(s);
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nameKey = n => n.toLowerCase().replace(/\./g, ',');
  const NAME_RE = /^[A-Za-z0-9_.-]{2,20}$/;

  function timeAgo(ts) {
    const d = Math.max(0, now() - ts) / 1000;
    if (d < 45) return 'now';
    if (d < 3600) return Math.round(d / 60) + 'm';
    if (d < 86400) return Math.round(d / 3600) + 'h';
    if (d < 604800) return Math.round(d / 86400) + 'd';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function clock(ts) {
    const d = new Date(ts), t = new Date();
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === t.toDateString()) return time;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + time;
  }
  function fmtDur(ms) {
    const s = Math.ceil(ms / 1000);
    if (s < 60) return s + 's';
    if (s < 3600) return Math.ceil(s / 60) + 'm';
    if (s < 86400) return Math.round(s / 3600) + 'h';
    return Math.round(s / 86400) + 'd';
  }
  function fmtSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }
  const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const I = {
    chat: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>'),
    posts: svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
    more: svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
    archive: svg('<path d="M3 5h18v4H3z"/><path d="M5 9v10h14V9"/><path d="M9 13h6"/>'),
    home: svg('<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>'),
    users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    shield: svg('<path d="M12 3 4.5 6v6c0 4.5 3.2 8 7.5 9 4.3-1 7.5-4.5 7.5-9V6z"/><path d="m9 12 2 2 4-4"/>'),
    smile: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/>'),
    clip: svg('<path d="m20.5 11.5-8.3 8.3a5 5 0 0 1-7-7l8.3-8.3a3.3 3.3 0 0 1 4.7 4.7l-8.3 8.3a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6"/>'),
    send: svg('<path d="M5 12h13M13 6l6 6-6 6"/>'),
    reply: svg('<path d="M10 8 4 13l6 5"/><path d="M4 13h10a6 6 0 0 1 6 6"/>'),
    edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
    trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    share: svg('<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 15V3M7 8l5-5 5 5"/>'),
    comment: svg('<path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>'),
    music: svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
    lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    crown: svg('<path d="m3 8 4 4 5-7 5 7 4-4-2 11H5z"/>'),
    dm: svg('<path d="M21 4 3 11l7 2.5L12.5 21z"/><path d="m10 13.5 4.5-4.5"/>'),
    group: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M16 11h6"/>'),
    back: svg('<path d="M15 5 8 12l7 7"/>'),
    react: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>'),
    bell: svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>'),
    bellOff: svg('<path d="M18 8a6 6 0 0 0-10.2-4.2M6 8c0 7-3 7-3 9h13M22 17c0-2-3-2-3-9M10 21h4M3 3l18 18"/>'),
    volume: svg('<path d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
    volumeOff: svg('<path d="M11 5 6 9H3v6h3l5 4zM16 9l5 6M21 9l-5 6"/>'),
    external: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>'),
    settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 2.9-.2-.1a1.7 1.7 0 0 0-1.8.3l-.1.1h-3.4l-.1-.2a1.7 1.7 0 0 0-1.8-.3l-.2.1-1.7-2.9.1-.1a1.7 1.7 0 0 0 .3-1.9l-.1-.2-2.9-1.7.1-.2a1.7 1.7 0 0 0-.3-1.8l-.1-.1V7.6l.2-.1a1.7 1.7 0 0 0 .3-1.8l-.1-.2 2.9-1.7.1.1a1.7 1.7 0 0 0 1.9.3l.2-.1h3.4l.1.2a1.7 1.7 0 0 0 1.8.3l.2-.1 1.7 2.9-.1.1a1.7 1.7 0 0 0-.3 1.9l.1.2 2.9 1.7-.1.2a1.7 1.7 0 0 0 .3 1.8l.1.1v3.4l-.2.1a1.7 1.7 0 0 0-.3 1.8z"/>')
  };

  const handlers = {};
  const on = (evt, fn) => { (handlers[evt] = handlers[evt] || []).push(fn); };
  const off = (evt, fn) => { if (handlers[evt]) handlers[evt] = handlers[evt].filter(f => f !== fn); };
  const emit = (evt, d) => (handlers[evt] || []).forEach(fn => { try { fn(d); } catch (e) { console.error(e); } });

  let uid = ls.get('orbit_uid');
  if (!uid || !/^[A-Za-z0-9_-]{8,40}$/.test(uid)) { uid = db.ref().push().key; ls.set('orbit_uid', uid); }

  const S = { users: {}, roles: {}, owners: {}, mod: {}, presence: {}, presenceSessions: {}, customTags: {}, userTags: {}, announcement: null, publicSettings: {}, chatSettings: {}, postSettings: {}, byName: {}, loaded: {} };
  const localAppearanceKey = 'orbit_appearance';
  const defaultFavicon = 'favicon.png';
  function appearanceLocal() {
    try { return JSON.parse(ls.get(localAppearanceKey) || '{}') || {}; } catch (e) { return {}; }
  }
  function appearanceColor(value) { return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : null; }
  function appearanceImage(value) {
    if (typeof value !== 'string' || value.length > 180000) return null;
    if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(value)) return value;
    try {
      const url = new URL(value, location.href);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch (e) { return null; }
  }
  function applyAppearance() {
    const personal = appearanceLocal();
    const global = S.publicSettings || {};
    const background = global.background !== undefined ? global.background : personal.background;
    const favicon = global.favicon !== undefined ? global.favicon : personal.favicon;
    const font = global.font !== undefined ? global.font : personal.font;
    const root = document.documentElement;
    const color = background === 'default' ? null : appearanceColor(background);
    if (color) root.style.setProperty('--bg', color); else root.style.removeProperty('--bg');
    document.body && document.body.classList.toggle('orbit-font-pusab', font === 'pusab');
    document.querySelectorAll('link[rel~="icon"]').forEach(link => { link.href = favicon === 'default' || !favicon ? defaultFavicon : (appearanceImage(favicon) || defaultFavicon); });
  }
  function saveAppearance(next) {
    const current = appearanceLocal();
    const value = { ...current, ...next };
    ls.set(localAppearanceKey, JSON.stringify(value));
    applyAppearance();
    emit('appearance', value);
  }
  let readyResolve;
  const ready = new Promise(r => { readyResolve = r; });
  let changeQueued = false;
  let queuedChangeTypes = new Set();
  let onlineCountCache = null;
  let onlineCountCacheAt = 0;
  function queueChange(type = 'change') {
    queuedChangeTypes.add(type);
    if (type === 'change') onlineCountCache = null;
    if (changeQueued) return;
    changeQueued = true;
    requestAnimationFrame(() => {
      changeQueued = false;
      const types = queuedChangeTypes;
      queuedChangeTypes = new Set();
      if (types.has('change')) { emit('change'); selfCheck(); }
      if (types.has('presence')) emit('presence');
    });
  }
  const childMapKeys = new Set(['users', 'roles', 'owners', 'mod', 'presence', 'presenceSessions', 'customTags', 'userTags']);
  ['users', 'roles', 'owners', 'mod', 'presence', 'presenceSessions', 'customTags', 'userTags', 'announcement', 'publicSettings', 'chatSettings', 'postSettings'].forEach(key => {
    if (childMapKeys.has(key)) {
      const ref = db.ref(key);
      const seen = new Set();
      const waitForInitialChildren = key !== 'presence' && key !== 'presenceSessions';
      let expected = null, mapReady = !waitForInitialChildren, reportedError = false;
      const error = err => {
        if (reportedError) return;
        reportedError = true;
        console.error('Orbit: cannot read /' + key, err);
        toast('Database access denied — check your Realtime Database rules', true);
      };
      const maybeReady = () => {
        if (mapReady || expected === null || seen.size < expected) return;
        mapReady = true;
        S.loaded[key] = true;
        if (['users', 'roles', 'owners', 'mod'].every(k => S.loaded[k])) readyResolve();
        if (key === 'customTags') emit('customTags', S.customTags);
        if (key === 'users' && S.announcement) renderAnnouncement(S.announcement);
        queueChange('change');
      };
      const applyChild = (id, value) => {
        const presenceMap = key === 'presence' || key === 'presenceSessions';
        const wasOnline = presenceMap ? isOnline(id) : null;
        if (key === 'users') {
          const old = S.users[id];
          if (old && old.name && S.byName[String(old.name).toLowerCase()] === id) delete S.byName[String(old.name).toLowerCase()];
          if (value && typeof value === 'object') {
            S.users[id] = value;
            if (value.name) S.byName[String(value.name).toLowerCase()] = id;
          } else delete S.users[id];
        } else if (value && typeof value === 'object') S[key][id] = value;
        else delete S[key][id];
        let presenceChanged = false;
        if (wasOnline !== null) {
          const isNowOnline = isOnline(id);
          presenceChanged = wasOnline !== isNowOnline;
          if (onlineCountCache !== null) {
            if (presenceChanged) {
              onlineCountCache += isNowOnline ? 1 : -1;
              onlineCountCacheAt = Date.now();
            }
          }
        }
        if (key === 'users' && S.announcement && S.announcement.uid === id) renderAnnouncement(S.announcement);
        if (mapReady) {
          if (key === 'customTags') emit('customTags', S.customTags);
          if (presenceMap) { if (presenceChanged) queueChange('presence'); }
          else queueChange('change');
        }
      };
      ref.on('child_added', snap => { seen.add(snap.key); applyChild(snap.key, snap.val()); maybeReady(); }, error);
      ref.on('child_changed', snap => applyChild(snap.key, snap.val()), error);
      ref.on('child_removed', snap => applyChild(snap.key, null), error);
      if (waitForInitialChildren) ref.once('value').then(snap => { expected = snap.numChildren(); maybeReady(); }, error);
      return;
    }
    db.ref(key).on('value', snap => {
      S[key] = ['announcement'].includes(key) ? snap.val() : (snap.val() || {});
      S.loaded[key] = true;
      if (['users', 'roles', 'owners', 'mod'].every(k => S.loaded[k])) readyResolve();
      if (key === 'announcement') { emit('announcement', S.announcement); renderAnnouncement(S.announcement); }
      if (key === 'publicSettings') { applyAppearance(); emit('publicSettings', S.publicSettings); }
      queueChange();
    }, err => {
      console.error('Orbit: cannot read /' + key, err);
      toast('Database access denied — check your Realtime Database rules', true);
    });
  });

  applyAppearance();
  const presenceSessionId = db.ref('presenceSessions/' + uid).push().key;
  let presenceHeartbeat = null;
  db.ref('.info/connected').on('value', s => {
    if (presenceHeartbeat) { clearInterval(presenceHeartbeat); presenceHeartbeat = null; }
    if (!s.val()) return;
    const r = db.ref('presenceSessions/' + uid + '/' + presenceSessionId);
    r.onDisconnect().remove();
    const ping = () => r.set({ ts: TS }).catch(() => {});
    ping();
    presenceHeartbeat = setInterval(ping, 30000);
  });
  setInterval(() => { onlineCountCache = null; queueChange('presence'); }, 15000);
  window.addEventListener('beforeunload', () => { if (presenceHeartbeat) clearInterval(presenceHeartbeat); });

  const me = () => S.users[uid] && S.users[uid].name ? S.users[uid] : null;
  const user = id => (S.users[id] && S.users[id].name) ? S.users[id] : null;
  const isOwner = (id = uid) => {
    const ownerRecord = S.owners[id];
    // Ignore old, client-forgeable boolean flags left by the previous public rules.
    return !!ownerRecord && typeof ownerRecord === 'object' && ownerRecord.authUid === OWNER_UID;
  };
  const isProtectedOwner = (id = uid) => {
    const profile = S.users[id];
    return isOwner(id) && !!profile && ['Orbit', 'Ome'].includes(String(profile.name || ''))
      && (id !== uid || auth.currentUser?.uid === OWNER_UID);
  };
  const staffTag = id => { const u = S.users[id]; return (isOwner(id) && u && u.name && STAFF_NAMES[u.name.toLowerCase()]) || null; };
  const isAdmin = (id = uid) => S.roles[id] === 'admin' || isOwner(id);
  const ownerUnlocked = () => isOwner() && auth.currentUser?.uid === OWNER_UID && ss.get('orbit_owner') === '1';
  const isBanned = (id = uid) => !isProtectedOwner(id) && !!(S.mod[id] && S.mod[id].banned);
  const timeoutLeft = (id = uid) => isProtectedOwner(id) ? 0 : Math.max(0, ((S.mod[id] && S.mod[id].timeoutUntil) || 0) - now());
  const isOnline = id => {
    if (!user(id)) return false;
    const time = now(), cutoff = time - 90000, ceiling = time + 30000;
    const fresh = entry => entry && Number(entry.ts) >= cutoff && Number(entry.ts) <= ceiling;
    const sessions = S.presenceSessions[id];
    if (sessions && Object.values(sessions).some(fresh)) return true;
    const legacy = S.presence[id];
    return !!fresh(legacy);
  };
  const onlineCount = () => {
    const time = Date.now();
    if (onlineCountCache !== null && time - onlineCountCacheAt < 5000) return onlineCountCache;
    onlineCountCache = Object.keys(S.users).filter(id => user(id) && isOnline(id)).length;
    onlineCountCacheAt = time;
    return onlineCountCache;
  };
  const userByName = n => S.byName[String(n).toLowerCase()] || null;

  function canModerate(target) {
    if (!isAdmin()) return false;
    if (isOwner()) { if (!ownerUnlocked()) return false; }
    else if (!(firebaseAdminLinked && firebaseAdminProfile === uid)) return false;
    if (target === uid && isAdmin() && !isOwner()) return false;
    if (target && isProtectedOwner(target) && target !== uid) return false;
    return true;
  }

  function canAct(silent) {
    if (isBanned()) { if (!silent) toast('You are banned', true); return false; }
    const left = timeoutLeft();
    if (left > 0) { if (!silent) toast('You are timed out for ' + fmtDur(left), true); return false; }
    if (!me()) { if (!silent) openProfile({ setup: true }); return false; }
    return true;
  }

  function toast(msg, err) {
    let box = $('.toasts');
    if (!box) { box = el('div', { class: 'toasts' }); document.body.append(box); }
    const t = el('div', { class: 'toast' + (err ? ' err' : '') }, msg);
    box.append(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2600);
  }

  let audioContext = null;
  let soundEffectsOn = ls.get('orbit_sound_effects') !== '0';
  let notificationsOn = ls.get('orbit_notifications') === '1';
  window.addEventListener('storage', event => {
    if (event.key === 'orbit_sound_effects') {
      soundEffectsOn = event.newValue !== '0';
      emit('soundPreference', soundEffectsOn);
    }
    if (event.key === 'orbit_notifications') {
      notificationsOn = event.newValue === '1';
      emit('notificationPreference', notificationsOn);
    }
    if (event.key === localAppearanceKey) applyAppearance();
  });
  function audio() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    if (!audioContext) audioContext = new Context();
    return audioContext;
  }
  function unlockAudio() {
    const ctx = audio();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }
  document.addEventListener('pointerdown', unlockAudio, { passive: true });
  document.addEventListener('keydown', unlockAudio);
  function playMessageSound(kind = 'receive') {
    if (!soundEffectsOn) return;
    const ctx = audio();
    if (!ctx) return;
    const play = () => {
      const t = ctx.currentTime;
      const notes = kind === 'send' ? [[740, 0, 0.07], [1046, 0.045, 0.09]] : [[880, 0, 0.11], [1318, 0.085, 0.16]];
      notes.forEach(([frequency, delay, length]) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.setValueAtTime(frequency, t + delay);
        gain.gain.setValueAtTime(0.0001, t + delay);
        gain.gain.exponentialRampToValueAtTime(0.075, t + delay + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + length);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t + delay); osc.stop(t + delay + length + 0.015);
      });
    };
    if (ctx.state === 'suspended') ctx.resume().then(play).catch(() => {});
    else play();
  }
  function requestMessageNotifications() {
    if (!('Notification' in window)) {
      toast('This browser does not support desktop notifications', true);
      return;
    }
    if (notificationsOn) {
      notificationsOn = false;
      ls.set('orbit_notifications', '0');
      emit('notificationPreference', false);
      toast('Message notifications turned off');
      return;
    }
    if (Notification.permission === 'denied') {
      toast('Notifications are blocked in your browser settings', true);
      return;
    }
    const permission = Notification.permission === 'granted' ? Promise.resolve('granted') : Notification.requestPermission();
    permission.then(result => {
      notificationsOn = result === 'granted';
      ls.set('orbit_notifications', notificationsOn ? '1' : '0');
      emit('notificationPreference', notificationsOn);
      toast(notificationsOn ? 'Message notifications enabled' : 'Notification permission was not granted', !notificationsOn);
    }).catch(() => toast('Could not enable browser notifications', true));
  }
  function messageTools() {
    const notifications = el('button', { class: 'icon-btn chat-tool', type: 'button' });
    const sounds = el('button', { class: 'icon-btn chat-tool', type: 'button' });
    const cloak = el('button', { class: 'icon-btn chat-tool', type: 'button', title: 'Open Orbit in an about:blank tab', 'aria-label': 'Open Orbit in an about:blank tab', html: I.external, onclick: openAboutBlank });
    const settings = el('button', { class: 'icon-btn chat-tool', type: 'button', title: 'Settings', 'aria-label': 'Settings', html: I.settings, onclick: openSettingsPanel });
    const refresh = () => {
      notifications.innerHTML = notificationsOn ? I.bell : I.bellOff;
      notifications.title = notificationsOn ? 'Turn message notifications off' : 'Enable message notifications';
      notifications.setAttribute('aria-label', notifications.title);
      notifications.setAttribute('aria-pressed', String(notificationsOn));
      sounds.innerHTML = soundEffectsOn ? I.volume : I.volumeOff;
      sounds.title = soundEffectsOn ? 'Turn message sounds off' : 'Turn message sounds on';
      sounds.setAttribute('aria-label', sounds.title);
      sounds.setAttribute('aria-pressed', String(soundEffectsOn));
    };
    notifications.onclick = requestMessageNotifications;
    on('notificationPreference', refresh);
    on('soundPreference', refresh);
    sounds.onclick = () => {
      soundEffectsOn = !soundEffectsOn;
      ls.set('orbit_sound_effects', soundEffectsOn ? '1' : '0');
      emit('soundPreference', soundEffectsOn);
      refresh();
      if (soundEffectsOn) playMessageSound('receive');
    };
    refresh();
    return el('div', { class: 'chat-tools' }, notifications, sounds, cloak, settings);
  }
  function openAboutBlank() {
    const tab = window.open('about:blank', '_blank');
    if (!tab) return toast('Allow pop-ups to open Orbit in a new tab', true);
    try {
      tab.opener = null;
      tab.document.title = document.title;
      tab.document.documentElement.style.cssText = 'width:100%;height:100%;margin:0;background:#000';
      tab.document.body.style.cssText = 'width:100%;height:100%;margin:0;overflow:hidden;background:#000';
      const frame = tab.document.createElement('iframe');
      frame.title = 'Orbit'; frame.src = location.href;
      frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;background:#000';
      tab.document.body.append(frame);
    } catch (e) { toast('Could not open the cloaked tab', true); }
  }
  function openSettingsPanel() {
    const personal = appearanceLocal();
    const global = S.publicSettings || {};
    const background = el('input', { class: 'input appearance-color', type: 'color', value: appearanceColor(personal.background) || appearanceColor(global.background) || '#000000' });
    const iconUrl = el('input', { class: 'input', type: 'url', placeholder: 'https://example.com/icon.png', value: typeof personal.favicon === 'string' && personal.favicon !== 'default' ? personal.favicon : typeof global.favicon === 'string' ? global.favicon : '' });
    const iconFile = el('input', { type: 'file', accept: 'image/*', class: 'hidden' });
    const iconUpload = el('button', { class: 'btn sm', type: 'button', onclick: () => iconFile.click() }, 'Choose image');
    const font = el('select', { class: 'select' }, [
      el('option', { value: 'default' }, 'Default font'),
      el('option', { value: 'pusab' }, 'Pusab')
    ]);
    font.value = ['default', 'pusab'].includes(personal.font) ? personal.font : (global.font === 'pusab' ? 'pusab' : 'default');
    const backgroundReset = el('button', { class: 'btn sm ghost', type: 'button' }, 'Default background');
    const iconReset = el('button', { class: 'btn sm ghost', type: 'button' }, 'Default favicon');
    const note = el('div', { class: 'muted appearance-note' });
    const backgroundLocked = Object.prototype.hasOwnProperty.call(global, 'background');
    const faviconLocked = Object.prototype.hasOwnProperty.call(global, 'favicon');
    const fontLocked = Object.prototype.hasOwnProperty.call(global, 'font');
    background.disabled = backgroundLocked; backgroundReset.disabled = backgroundLocked;
    iconUrl.disabled = faviconLocked; iconUpload.disabled = faviconLocked; iconReset.disabled = faviconLocked;
    font.disabled = fontLocked;
    const locks = [backgroundLocked && 'background', faviconLocked && 'favicon', fontLocked && 'font'].filter(Boolean);
    note.textContent = locks.length ? 'Some options are currently set for everyone by the site owner: ' + locks.join(', ') + '.' : 'Changes save automatically on this device.';
    const section = (title, desc, control) => el('section', { class: 'appearance-section' },
      el('div', null, el('strong', null, title), el('div', { class: 'muted', style: 'font-size:12px;margin-top:3px' }, desc)), control);
    const body = el('div', { class: 'appearance-settings' }, note,
      section('Background color', 'Choose a custom page background.', el('div', { class: 'appearance-controls' }, background, backgroundReset)),
      section('Tab icon', 'Use an image URL or choose a local image for the browser tab.', el('div', { class: 'appearance-icon-controls' }, iconUrl, iconFile, iconUpload, iconReset)),
      section('Font', 'Choose Pusab or the site’s default font.', font));
    const dialog = modal({ title: 'Settings', body, wide: true });
    background.addEventListener('input', () => saveAppearance({ background: background.value }));
    backgroundReset.onclick = () => { saveAppearance({ background: 'default' }); background.value = '#000000'; };
    font.addEventListener('change', () => saveAppearance({ font: font.value }));
    iconUrl.addEventListener('change', () => {
      const value = iconUrl.value.trim();
      if (!value) { saveAppearance({ favicon: 'default' }); return; }
      const valid = appearanceImage(value);
      if (!valid) { toast('Enter a valid http or https image URL', true); return; }
      saveAppearance({ favicon: valid });
    });
    iconReset.onclick = () => { saveAppearance({ favicon: 'default' }); iconUrl.value = ''; };
    iconFile.onchange = async () => {
      const file = iconFile.files && iconFile.files[0]; iconFile.value = '';
      if (!file) return;
      try {
        const value = await processAvatar(file);
        if (!appearanceImage(value)) throw new Error('That image is too large to use as a tab icon');
        saveAppearance({ favicon: value }); iconUrl.value = '';
      } catch (e) { toast(e.message || 'Could not use that image', true); }
    };
    setTimeout(() => background.focus(), 30);
    return dialog;
  }
  function messagePreview(message) {
    const text = String(message && message.text || '').trim();
    if (text) return text.replace(/:gd\d{1,4}:/g, '🙂').replace(/:sticker_[A-Za-z0-9_.-]{1,100}:/g, '[Sticker]').slice(0, 180);
    if (message && message.forward) return String(message.forward.text || 'Forwarded a message').slice(0, 180);
    if (message && message.attachments) return 'Sent an attachment';
    if (message && message.share) return 'Shared an item';
    return 'Sent a message';
  }
  function notifyIncoming({ id, title, body, href }) {
    if (id) {
      try {
        const recent = JSON.parse(ls.get('orbit_recent_message_notices') || '[]');
        if (recent.includes(id)) return;
        recent.push(id);
        if (recent.length > 100) recent.splice(0, recent.length - 100);
        ls.set('orbit_recent_message_notices', JSON.stringify(recent));
      } catch (e) {}
    }
    playMessageSound('receive');
    const away = document.visibilityState === 'hidden' || !document.hasFocus();
    if (away && notificationsOn && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const notice = new Notification(title, { body, icon: 'favicon.png', tag: id || 'orbit-message' });
        notice.onclick = () => {
          window.focus();
          if (href) window.location.href = href;
          notice.close();
        };
      } catch (e) { if (!document.hidden) toast(title + ': ' + body); }
    } else if (!document.hidden) toast(title + ': ' + body);
  }
  function watchLatestMessage(path, onMessage, notifyBaseline) {
    const query = db.ref(path).limitToLast(1);
    let stopped = false, callback = null;
    query.once('value').then(snapshot => {
      if (stopped) return;
      let latest = null, latestMessage = null;
      snapshot.forEach(child => { latest = child.key; latestMessage = child.val(); });
      if (latestMessage && notifyBaseline && notifyBaseline(latestMessage, latest)) onMessage(latestMessage, latest);
      callback = query.on('child_added', child => {
        if (child.key === latest) return;
        latest = child.key;
        const message = child.val();
        if (message && message.uid !== uid) onMessage(message, child.key);
      });
    }).catch(() => {});
    return () => { stopped = true; if (callback) query.off('child_added', callback); };
  }
  watchLatestMessage('messages', (message, key) => {
    const name = (user(message.uid) || {}).name || 'Someone';
    notifyIncoming({ id: 'general:' + key, title: 'General · ' + name, body: messagePreview(message), href: 'chat.html' });
  });
  watchLatestMessage('channelMessages/anonymous', (message, key) => {
    notifyIncoming({ id: 'anonymous:' + key, title: 'Anonymous Chat', body: 'Anonymous: ' + messagePreview(message), href: 'anonymous.html' });
  });
  const dmNoticeWatches = new Map();
  const startDmNoticeWatch = (cid, activityAt) => {
    if (dmNoticeWatches.has(cid)) return;
    let cancelled = false, stopWatch = () => {};
    dmNoticeWatches.set(cid, () => { cancelled = true; stopWatch(); });
    db.ref('reads/' + uid + '/' + cid).once('value').then(readSnapshot => {
      if (cancelled) return;
      const readAt = Number(readSnapshot.val()) || 0;
      stopWatch = watchLatestMessage('convMsgs/' + cid, (message, key) => {
        const name = (user(message.uid) || {}).name || 'Someone';
        notifyIncoming({ id: 'dm:' + cid + ':' + key, title: name, body: messagePreview(message), href: 'dms.html#c=' + encodeURIComponent(cid) });
      }, message => message.uid !== uid && (Number(message.ts) > readAt || (activityAt > readAt && !Number(message.ts))));
    }).catch(() => {});
  };
  // Keep notification listeners on the 50 most recently active DMs. A DM outside
  // this window re-enters it as soon as someone sends a new message.
  const dmNoticeRef = db.ref('userConvs/' + uid).orderByValue().limitToLast(50);
  dmNoticeRef.on('child_added', child => startDmNoticeWatch(child.key, Number(child.val()) || 0));
  dmNoticeRef.on('child_changed', child => startDmNoticeWatch(child.key, Number(child.val()) || 0));
  dmNoticeRef.on('child_removed', child => {
    const stop = dmNoticeWatches.get(child.key);
    if (stop) { stop(); dmNoticeWatches.delete(child.key); }
  });

  const modalStack = [];
  function modal({ title, body, foot, wide, position, dismissable = true, onClose, cls }) {
    const bd = el('div', { class: 'backdrop ' + (position || '') + ' ' + (cls || '') });
    const head = el('div', { class: 'panel-head' }, el('h3', null, title || ''));
    const bodyEl = el('div', { class: 'panel-body' });
    if (body) bodyEl.append(body);
    const panel = el('div', { class: 'panel' + (wide ? ' wide' : '') }, head, bodyEl);
    let footEl = null;
    if (foot) { footEl = el('div', { class: 'panel-foot' }); footEl.append(...[].concat(foot)); panel.append(footEl); }
    bd.append(panel);
    let closed = false;
    const api = {
      el: panel, body: bodyEl, foot: footEl, head, backdrop: bd, dismissable,
      close() {
        if (closed) return; closed = true;
        bd.remove();
        const i = modalStack.indexOf(api); if (i >= 0) modalStack.splice(i, 1);
        onClose && onClose();
      }
    };
    if (dismissable) {
      head.append(el('button', { class: 'icon-btn', 'aria-label': 'Close', html: I.x, onclick: () => api.close() }));
      bd.addEventListener('pointerdown', e => { if (e.target === bd) api.close(); });
    }
    document.body.append(bd);
    modalStack.push(api);
    return api;
  }
  function confirmBox(text, okLabel = 'Confirm', danger) {
    return new Promise(res => {
      let done = false;
      const ok = el('button', { class: 'btn ' + (danger ? 'danger' : 'primary') }, okLabel);
      const cancel = el('button', { class: 'btn ghost' }, 'Cancel');
      const m = modal({ title: 'Are you sure?', body: el('p', { style: 'margin:0;color:var(--text-2)' }, text), foot: [cancel, ok], onClose: () => { if (!done) res(false); } });
      ok.onclick = () => { done = true; m.close(); res(true); };
      cancel.onclick = () => m.close();
      ok.focus();
    });
  }
  function promptText({ title, value = '', placeholder = '', okLabel = 'Save', multiline = true, type = 'text', help = '' }) {
    return new Promise(res => {
      let done = false;
      const input = multiline
        ? el('textarea', { class: 'textarea', placeholder, rows: 5 })
        : el('input', { class: 'input', placeholder, type });
      input.value = value;
      const ok = el('button', { class: 'btn primary' }, okLabel);
      const cancel = el('button', { class: 'btn ghost' }, 'Cancel');
      const body = help ? el('div', null, el('div', { class: 'muted', style: 'font-size:13px;margin-bottom:10px' }, help), input) : input;
      const m = modal({ title, body, foot: [cancel, ok], onClose: () => { if (!done) res(null); } });
      const submit = () => { done = true; const v = input.value; m.close(); res(v); };
      ok.onclick = submit;
      cancel.onclick = () => m.close();
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } });
      setTimeout(() => input.focus(), 30);
    });
  }
  function chooseDuration(name) {
    return new Promise(res => {
      let done = false;
      const opts = [['1 min', 6e4], ['5 min', 3e5], ['10 min', 6e5], ['1 hour', 36e5], ['1 day', 864e5], ['1 week', 6048e5]];
      const chips = el('div', { class: 'chips' });
      const m = modal({ title: 'Time out ' + (name || 'user'), body: chips, onClose: () => { if (!done) res(null); } });
      opts.forEach(([label, ms]) => chips.append(el('button', { class: 'chip', onclick: () => { done = true; m.close(); res(ms); } }, label)));
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('.picker')) { closePicker(); return; }
      if ($('.emoji-suggest')) { closeEmojiSuggestions(); return; }
      if ($('.lightbox')) { $('.lightbox').remove(); return; }
      const top = modalStack[modalStack.length - 1];
      if (top && top.dismissable) top.close();
    }
  });

  const EMOJI_BASE = 'https://cdn.jsdelivr.net/gh/TypicallyOme/Website-Assets@main/features/assets/Geometry%20Dash%20Faces/';
  const EMOJI_IDS = [193,194,195,196,197,199,200,201,202,203,205,207,208,213,214,215,216,217,218,219,220,221,222,223,224,225,226,227,228,229,230,231,232,233,234,235,236,237,238,239,240,241,242,243,244,245,246,247,248,249,250,251,252,253,254,255,256,257,258,259,260,261,262,263,264,265,266,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,282,283,284,285,286,287,288,289,290,291,292,293,294,295,296,297,298,299,300,301,302,303,304,305,306,307,308,309,310,311,312,313,314,315,316,317,318,319,320,321,322,323,324,325,326,327,328,329,330,331,332,333,334,335,336,337,338,339,340,341,342,343,344,345,346,347,348,349,350,351,352,353,354,355,356,357,358,359,360,361,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63];
  const STICKER_BASE = 'https://cdn.jsdelivr.net/gh/TypicallyOme/typicallyome.github.io@main/features/assets/Stickers/';
  const STICKER_FILES = [
    '1386504063985909780.webp', '1386504461601734757.webp',
    '6UXJlAAAABklEQVQDAGUQCdmIcR4WAAAAAElFTkSuQmCC.png', '8Jrmc0AAAAASUVORK5CYII.png',
    '9Wi8lAAAABklEQVQDAHoUe6Jd3ELDAAAAAElFTkSuQmCC.png', '9f7M2TAAAABklEQVQDAJK0kLzQ6mEwAAAAAElFTkSuQmCC.png',
    'CE45661D-8E00-4C7D-B0B8-91C05973B24D.png', 'E22B0453-E94F-4525-8AB6-15F87CAD1B45.png',
    'E7334696-F3F5-47AC-8289-FC622E2E20E8.png', 'MxAi5AAAABklEQVQDABR0StXGzurAAAAAElFTkSuQmCC.png',
    'h0kGzAAAABklEQVQDAGMkTqr4TPXCAAAAAElFTkSuQmCC.png', 'image.png',
    'phQAAAAGSURBVAMAONdCew6jHaYAAAAASUVORK5CYII.png', 'wk3znwAAAAZJREFUAwCacog8794VAAAAABJRU5ErkJggg.png',
    '01631037faa11ea81f198176c824b869.gif', '1010084d8aace5af8ad9abf7a19b05e5.gif',
    '1c74d792a5e74cd267d91aed8d7c1491.gif', '1f47dc697c60890be0fa28b27309fa21.gif',
    '44a3a74ee5a5a90a84c5b33af188b8cb.gif', '492893acea6b77a38c01a5847e010d5c.gif',
    '4d646e7e0dca7942a5116e827e59ed0d.gif', '51cc28f22e434cdc530912ee0f116f22.gif',
    '6ea1c81ead9033e5e47de42369c46f0e.gif', '8e071836dc5d3f534138455fda54cc68.gif',
    '9b1888f36c3bad563087acc0fc0638ab.gif', '9f621a951e35b4be93d4563c753479d7.gif',
    'blobdance.gif', 'nitroboosterrmz1.gif'
  ];
  const EMOJI_INDEX = new Map(EMOJI_IDS.map((id, i) => [String(id), i]));
  const isEmoji = id => EMOJI_INDEX.has(String(id));
  const emojiUrl = id => EMOJI_BASE + 'imgi_' + (EMOJI_INDEX.get(String(id)) + 3) + '_particle' + id + '001.png';
  const emojiImg = (id, cls = 'emo') => `<img class="${cls}" src="${emojiUrl(id)}" alt=":gd${id}:" title=":gd${id}:" draggable="false">`;
  const isSticker = id => typeof id === 'string' && STICKER_FILES.includes(id);
  const stickerUrl = id => isSticker(id) ? STICKER_BASE + encodeURIComponent(id) : '';
  const stickerImg = (id, cls = 'sticker-emo') => isSticker(id)
    ? `<img class="${cls}" src="${stickerUrl(id)}" alt="Sticker ${STICKER_FILES.indexOf(id) + 1}" title="Sticker ${STICKER_FILES.indexOf(id) + 1}" draggable="false" loading="lazy" decoding="async">`
    : '';
  const emojiToken = (id, kind) => kind === 'sticker' ? ':sticker_' + id + ':' : ':gd' + id + ':';

  function recentEmojis() {
    try { return (JSON.parse(ls.get('orbit_recent_emo') || '[]')).filter(isEmoji); } catch (e) { return []; }
  }
  function pushRecent(id) {
    const r = [String(id), ...recentEmojis().filter(x => x !== String(id))].slice(0, 14);
    ls.set('orbit_recent_emo', JSON.stringify(r));
  }

  let pickerState = null;
  function closePicker() {
    if (!pickerState) return;
    pickerState.el.remove();
    document.removeEventListener('pointerdown', pickerState.outside, true);
    pickerState = null;
  }
  function openPicker(anchor, onPick, { keepOpen = false, title = 'Emojis', stickers = true } = {}) {
    if (pickerState && pickerState.anchor === anchor) { closePicker(); return; }
    closePicker();
    const grid = el('div', { class: 'grid' });
    const tabs = el('div', { class: 'picker-tabs', role: 'tablist', 'aria-label': 'Emoji sections' });
    const pageLabel = el('span', { class: 'picker-page-label' });
    const previousPage = el('button', { type: 'button', class: 'picker-page-button', 'aria-label': 'Previous sticker page', onclick: () => { currentPage = Math.max(0, currentPage - 1); renderPicker(); } }, '‹');
    const nextPage = el('button', { type: 'button', class: 'picker-page-button', 'aria-label': 'Next sticker page', onclick: () => { currentPage++; renderPicker(); } }, '›');
    const pager = el('div', { class: 'picker-footer' }, previousPage, pageLabel, nextPage);
    const p = el('div', { class: 'picker' }, el('div', { class: 'ph-head' }, title), tabs, grid, pager);
    let activeTab = 'orbit';
    let currentPage = 0;
    const stickerPageSize = 8;
    const selectEmoji = id => {
      pushRecent(id); onPick(String(id), 'emoji'); if (!keepOpen) closePicker();
    };
    const addEmoji = id => grid.append(el('button', {
      type: 'button', title: ':gd' + id + ':', html: emojiImg(id, ''),
      onclick: () => selectEmoji(id)
    }));
    const favoriteStickers = () => {
      try { return (JSON.parse(ls.get('orbit_favorite_stickers') || '[]')).filter(isSticker); }
      catch (e) { return []; }
    };
    const drawSticker = (id, favorites) => {
      const tile = el('div', { class: 'sticker-picker-tile' });
      const stickerLabel = 'Sticker ' + (STICKER_FILES.indexOf(id) + 1);
      const select = el('button', {
        type: 'button', class: 'sticker-picker-select', title: stickerLabel, html: stickerImg(id, ''),
        onclick: () => { onPick(String(id), 'sticker'); if (!keepOpen) closePicker(); }
      });
      const fav = favorites.has(id);
      const favorite = el('button', {
        type: 'button', class: 'sticker-picker-favorite' + (fav ? ' active' : ''),
        title: fav ? 'Remove from favorites' : 'Add to favorites',
        'aria-label': fav ? 'Remove sticker from favorites' : 'Add sticker to favorites',
        'aria-pressed': String(fav),
        onclick: event => {
          event.stopPropagation();
          const next = favoriteStickers();
          const updated = next.includes(id) ? next.filter(item => item !== id) : [id, ...next];
          ls.set('orbit_favorite_stickers', JSON.stringify(updated));
          renderPicker();
        }
      }, fav ? '★' : '☆');
      tile.append(select, favorite);
      grid.append(tile);
    };
    function renderPicker() {
      tabs.replaceChildren(); grid.replaceChildren();
      const addTab = (id, label) => {
        const button = el('button', {
          type: 'button', class: 'picker-tab' + (activeTab === id ? ' active' : ''),
          role: 'tab', 'aria-selected': String(activeTab === id),
          onclick: () => { activeTab = id; currentPage = 0; renderPicker(); }
        }, label);
        tabs.append(button);
      };
      if (stickers) addTab('favorites', 'Favorites');
      addTab('orbit', 'Orbit Emojis');
      if (stickers) addTab('stickers', 'Stickers');
      grid.classList.toggle('sticker-mode', stickers && activeTab !== 'orbit');
      if (activeTab === 'favorites') {
        const items = favoriteStickers();
        const favorites = new Set(items);
        if (!items.length) { pager.classList.add('hidden'); grid.append(el('div', { class: 'picker-empty' }, 'Star a sticker to save it here.')); }
        else drawStickerPage(items, favorites);
      } else if (activeTab === 'stickers') {
        drawStickerPage(STICKER_FILES, new Set(favoriteStickers()));
      } else {
        pager.classList.add('hidden');
        const rec = recentEmojis();
        if (rec.length) { grid.append(el('div', { class: 'sep' }, 'Recent')); rec.forEach(addEmoji); grid.append(el('div', { class: 'sep' }, 'Orbit Emojis')); }
        else grid.append(el('div', { class: 'sep' }, 'Orbit Emojis'));
        EMOJI_IDS.forEach(addEmoji);
      }
      grid.querySelectorAll('img').forEach(image => { image.loading = 'lazy'; image.decoding = 'async'; });
    }
    function drawStickerPage(items, favorites) {
      const pageCount = Math.max(1, Math.ceil(items.length / stickerPageSize));
      currentPage = Math.min(currentPage, pageCount - 1);
      const start = currentPage * stickerPageSize;
      items.slice(start, start + stickerPageSize).forEach(id => drawSticker(id, favorites));
      pageLabel.textContent = items.length ? (start + 1) + '–' + Math.min(start + stickerPageSize, items.length) + ' of ' + items.length : '0 stickers';
      previousPage.disabled = currentPage === 0;
      nextPage.disabled = currentPage >= pageCount - 1;
      pager.classList.toggle('hidden', items.length <= stickerPageSize);
    }
    renderPicker();
    document.body.append(p);
    const r = anchor.getBoundingClientRect();
    const pw = p.offsetWidth, ph = p.offsetHeight;
    let top = r.top - ph - 8;
    if (top < 8) top = Math.min(window.innerHeight - ph - 8, r.bottom + 8);
    let left = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), window.innerWidth - pw - 8);
    p.style.top = top + 'px'; p.style.left = left + 'px';
    const outside = e => { if (!p.contains(e.target) && !anchor.contains(e.target)) closePicker(); };
    document.addEventListener('pointerdown', outside, true);
    pickerState = { el: p, anchor, outside };
  }

  // Typing a colon opens suggestions from the site's built-in Geometry Dash emoji set.
  let suggestionState = null;
  let suppressSuggestionOnce = null;
  function closeEmojiSuggestions() {
    if (!suggestionState) return;
    suggestionState.el.remove();
    suggestionState = null;
  }
  function shortcodeAtCaret(field) {
    if (!field || (field.tagName !== 'TEXTAREA' && !(field.tagName === 'INPUT' && ['text', 'search'].includes(field.type)))) return null;
    const caret = field.selectionStart;
    if (caret == null) return null;
    const match = field.value.slice(0, caret).match(/(^|\s):([a-z0-9_]{0,24}):?$/i);
    if (!match) return null;
    return { start: caret - match[0].length + match[1].length, end: caret, query: match[2] || '' };
  }
  function positionEmojiSuggestions() {
    if (!suggestionState) return;
    const fieldRect = suggestionState.field.getBoundingClientRect();
    const box = suggestionState.el;
    const width = Math.min(320, window.innerWidth - 16);
    box.style.width = width + 'px';
    let left = Math.min(Math.max(8, fieldRect.left), window.innerWidth - width - 8);
    let top = fieldRect.bottom + 7;
    if (top + box.offsetHeight > window.innerHeight - 8) top = Math.max(8, fieldRect.top - box.offsetHeight - 7);
    box.style.left = left + 'px';
    box.style.top = top + 'px';
  }
  function chooseSuggestedEmoji(id) {
    if (!suggestionState) return;
    const { field, range } = suggestionState;
    const token = ':gd' + id + ':';
    field.value = field.value.slice(0, range.start) + token + field.value.slice(range.end);
    const caret = range.start + token.length;
    closeEmojiSuggestions();
    field.focus();
    try { field.setSelectionRange(caret, caret); } catch (e) {}
    suppressSuggestionOnce = { field, value: field.value, caret };
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function showEmojiSuggestions(field, range) {
    closeEmojiSuggestions();
    const query = range.query.toLowerCase();
    const ids = query.startsWith('gd')
      ? EMOJI_IDS.filter(id => ('gd' + id).startsWith(query))
      : EMOJI_IDS;
    const box = el('div', { class: 'emoji-suggest', role: 'listbox', 'aria-label': 'Orbit Emojis' });
    const help = el('div', { class: 'emoji-suggest-head' }, 'Orbit Emojis', el('span', null, 'Choose one to insert it'));
    const grid = el('div', { class: 'emoji-suggest-grid' });
    box.append(help, grid);
    const shown = ids;
    if (!shown.length) box.append(el('div', { class: 'emoji-suggest-empty' }, 'No built-in emoji matches that code.'));
    shown.forEach((id, index) => {
      const button = el('button', {
        type: 'button', class: 'emoji-suggest-item' + (index === 0 ? ' active' : ''),
        role: 'option', 'aria-selected': index === 0 ? 'true' : 'false',
        title: ':gd' + id + ':',
        onpointerdown: e => e.preventDefault(),
        onclick: () => chooseSuggestedEmoji(id)
      }, el('span', { html: emojiImg(id, '') }), el('small', null, ':gd' + id + ':'));
      grid.append(button);
    });
    document.body.append(box);
    box.querySelectorAll('img').forEach(image => { image.loading = 'lazy'; });
    suggestionState = { el: box, field, range, items: [...grid.querySelectorAll('.emoji-suggest-item')], active: 0 };
    positionEmojiSuggestions();
  }
  document.addEventListener('input', event => {
    const field = event.target;
    if (suppressSuggestionOnce && suppressSuggestionOnce.field === field && suppressSuggestionOnce.value === field.value && suppressSuggestionOnce.caret === field.selectionStart) {
      suppressSuggestionOnce = null;
      closeEmojiSuggestions();
      return;
    }
    suppressSuggestionOnce = null;
    const range = shortcodeAtCaret(field);
    if (!range) { closeEmojiSuggestions(); return; }
    showEmojiSuggestions(event.target, range);
  });
  document.addEventListener('keydown', event => {
    if (!suggestionState || event.target !== suggestionState.field) return;
    if (event.key === 'Escape') { closeEmojiSuggestions(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const items = suggestionState.items;
      if (!items.length) return;
      suggestionState.active = (suggestionState.active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((item, index) => {
        const active = index === suggestionState.active;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      });
    } else if (event.key === 'Enter' && suggestionState.items.length) {
      event.preventDefault();
      suggestionState.items[suggestionState.active].click();
    }
  });
  document.addEventListener('pointerdown', event => {
    if (suggestionState && !suggestionState.el.contains(event.target) && event.target !== suggestionState.field) closeEmojiSuggestions();
  }, true);
  window.addEventListener('resize', positionEmojiSuggestions);
  document.addEventListener('scroll', positionEmojiSuggestions, true);

  const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
  function richHTML(text) {
    const parts = String(text || '').split(URL_RE);
    let out = '';
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        const safe = esc(part);
        out += `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
        return;
      }
      let h = esc(part);
      h = h.replace(/:gd(\d{1,4}):/g, (m, id) => isEmoji(id) ? emojiImg(id) : m);
      h = h.replace(/:sticker_([A-Za-z0-9_.-]{1,100}):/g, (m, id) => isSticker(id) ? stickerImg(id) : m);
      h = h.replace(/(^|[^A-Za-z0-9_])@([A-Za-z0-9_.-]{2,20})/g, (m, pre, n) => {
        let name = n, tail = '';
        while (name.length > 2 && /[.-]$/.test(name) && !userByName(name)) { tail = name.slice(-1) + tail; name = name.slice(0, -1); }
        const id = userByName(name);
        if (!id) return m;
        return `${pre}<span class="mention${id === uid ? ' me' : ''}" data-uid="${id}">@${esc(S.users[id].name)}</span>${tail}`;
      });
      out += h;
    });
    return out;
  }
  function richEl(text, tag = 'div') {
    const e = el(tag, { class: 'rich', html: richHTML(text) });
    const raw = String(text || '');
    const stripped = raw.replace(/:gd\d{1,4}:|:sticker_[A-Za-z0-9_.-]{1,100}:/g, '').trim();
    const count = (raw.match(/:gd\d{1,4}:|:sticker_[A-Za-z0-9_.-]{1,100}:/g) || []).length;
    if (!stripped && count > 0 && count <= 3) e.classList.add('jumbo');
    return e;
  }
  function mentionsMe(text) {
    const m = me();
    if (!m || !text) return false;
    const re = new RegExp('(^|[^A-Za-z0-9_])@' + m.name.replace(/[.\-]/g, '\\$&') + '(?![A-Za-z0-9_])', 'i');
    return re.test(text);
  }
  document.addEventListener('click', e => {
    const m = e.target.closest && e.target.closest('.mention[data-uid]');
    if (m) openUserCard(m.dataset.uid);
  });

  const FRAMES = [
    ['none', 'None'], ['ring', 'Ring'], ['dashed', 'Dashed'], ['double', 'Double'], ['neon', 'Neon'],
    ['gold', 'Gold'], ['rainbow', 'Rainbow'], ['orbit', 'Orbit'], ['glitch', 'Glitch'],
    ['ice', 'Ice'], ['rose', 'Rose'], ['mint', 'Mint']
  ];
  const EFFECTS = [
    ['none', 'None'], ['glow', 'Glow'], ['shimmer', 'Shimmer'], ['rainbow', 'Rainbow'], ['neon', 'Neon'],
    ['gold', 'Gold'], ['fire', 'Fire'], ['glitch', 'Glitch'], ['pulse', 'Pulse'], ['outline', 'Outline'],
    ['ice', 'Ice'], ['rose', 'Rose'], ['mint', 'Mint']
  ];
  const okFrame = f => FRAMES.some(x => x[0] === f) ? f : 'none';
  const okEffect = f => EFFECTS.some(x => x[0] === f) ? f : 'none';
  const safeTagColor = color => /^#[0-9a-f]{6}$/i.test(String(color || '')) ? color : '#8b5cf6';
  const customTagEntries = id => Object.keys(S.userTags[id] || {})
    .filter(tagId => S.userTags[id][tagId] && S.customTags[tagId])
    .map(tagId => [tagId, S.customTags[tagId]])
    .sort((a, b) => String(a[1].name || '').localeCompare(String(b[1].name || '')));
  function customTagBadge(tag) {
    const name = String(tag && tag.name || 'Tag').slice(0, 24);
    return el('span', { class: 'badge custom-tag', style: '--tag-color:' + safeTagColor(tag && tag.color) },
      el('span', { class: 'tag-label fx-' + okEffect(tag && tag.effect) }, name));
  }
  const safeImg = src => (typeof src === 'string' && (/^data:image\//.test(src) || /^https:\/\//.test(src))) ? src : null;

  function avatarFrom(data, size = 40, onclick) {
    const d = data || {};
    const a = el('div', { class: 'av f-' + okFrame(d.frame), style: '--s:' + size + 'px' });
    const src = safeImg(d.avatar);
    if (src) a.append(el('img', { src, alt: '', loading: 'lazy', draggable: 'false' }));
    else a.append(el('div', { class: 'ph' }, (d.name || '?').charAt(0)));
    if (onclick) a.addEventListener('click', onclick);
    return a;
  }
  function avatar(id, size = 40, clickable = true) {
    return avatarFrom(S.users[id] || { name: '?' }, size, clickable ? (e) => { e.stopPropagation(); openUserCard(id); } : null);
  }
  function nameFrom(data, cls = '') {
    const d = data || {};
    return el('span', { class: 'uname fx-' + okEffect(d.effect) + ' ' + cls }, d.name || 'unknown');
  }
  function badges(id) {
    const out = [];
    const tag = staffTag(id);
    if (tag === 'OWNER') out.push(el('span', { class: 'badge owner' }, 'OWNER'));
    else if (tag === 'CO OWNER') out.push(el('span', { class: 'badge coowner' }, 'CO OWNER'));
    else if (S.roles[id] === 'admin') out.push(el('span', { class: 'badge' }, 'ADMIN'));
    customTagEntries(id).forEach(([, customTag]) => out.push(customTagBadge(customTag)));
    return out;
  }
  function nameTag(id, withBadges = true) {
    const u = user(id);
    const wrap = el('span', { class: 'nametag' });
    const n = nameFrom(u || { name: 'deleted user' });
    if (u) n.addEventListener('click', e => { e.stopPropagation(); openUserCard(id); });
    wrap.append(n);
    if (withBadges && u) wrap.append(...badges(id));
    return wrap;
  }
  function userSig(id) {
    const u = S.users[id] || {};
    const tags = customTagEntries(id).map(([tagId, tag]) => [tagId, tag.name, tag.color, tag.effect]);
    return [u.name, u.avatar && u.avatar.length + u.avatar.slice(-24), u.effect, u.frame, isOwner(id), isAdmin(id), JSON.stringify(tags)].join('|');
  }

  const EXT = {
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico', 'tif', 'tiff', 'heic', 'heif', 'apng', 'jfif'],
    audio: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba'],
    video: ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv']
  };
  function kindOf(file) {
    const t = (file.type || '').toLowerCase();
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    for (const k of ['image', 'audio', 'video']) if (t.startsWith(k + '/') || EXT[k].includes(ext)) return k;
    return null;
  }
  const ACCEPT = 'image/*,audio/*,video/*,.mp3,.mp4,' + EXT.image.map(e => '.' + e).join(',');
  const readDataURL = file => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file);
  });
  let storageWorks = null; // null = untested, true/false after first try

  function storagePut(file, onProgress) {
    return new Promise((resolve, reject) => {
      const safe = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);
      const ref = storage.ref('uploads/' + uid + '/' + Date.now() + '_' + safe);
      const task = ref.put(file, { contentType: file.type || undefined });
      let stall = setTimeout(() => task.cancel(), 15000);
      task.on('state_changed', s => {
        clearTimeout(stall); stall = setTimeout(() => task.cancel(), 20000);
        onProgress && onProgress(s.totalBytes ? s.bytesTransferred / s.totalBytes : 0);
      }, err => { clearTimeout(stall); reject(err); }, async () => {
        clearTimeout(stall);
        try { resolve(await task.snapshot.ref.getDownloadURL()); } catch (e) { reject(e); }
      });
    });
  }
  async function upload(file, onProgress) {
    const kind = kindOf(file);
    if (!kind) throw new Error('Only images, audio (mp3…) and video (mp4…) can be attached');
    const base = { kind, name: file.name.slice(0, 120), type: (file.type || '').slice(0, 60), size: file.size };
    if (storage && storageWorks !== false && file.size <= STORAGE_FILE_MAX) {
      try {
        const url = await storagePut(file, onProgress);
        storageWorks = true;
        return Object.assign(base, { url });
      } catch (e) {
        console.warn('Orbit: Firebase Storage unavailable, using database fallback.', e);
        if (storageWorks === true) throw new Error('Upload failed');
        storageWorks = false;
      }
    }
    if (file.size > DB_FILE_MAX) throw new Error('Files must be under ' + fmtSize(DB_FILE_MAX) + ' (enable Firebase Storage for bigger files)');
    onProgress && onProgress(-1);
    const data = await readDataURL(file);
    const ref = db.ref('files').push();
    await ref.set({ name: base.name, type: base.type, size: base.size, uid, ts: TS, data });
    onProgress && onProgress(1);
    return Object.assign(base, { fid: ref.key });
  }

  // Share only in-flight reads. Keeping the resolved data URL/object URL for every
  // attachment made scrolling through chat retain every image and video in RAM.
  const fileLoads = new Map();
  function loadFile(fid) {
    if (!fileLoads.has(fid)) {
      const request = db.ref('files/' + fid + '/data').once('value').then(s => {
        const d = s.val();
        if (typeof d !== 'string' || !/^data:(image|audio|video|application\/octet-stream)/.test(d)) throw new Error('missing');
        return d;
      });
      fileLoads.set(fid, request);
      const forget = () => { if (fileLoads.get(fid) === request) fileLoads.delete(fid); };
      request.then(forget, forget);
    }
    return fileLoads.get(fid);
  }
  const mediaIO = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const wrap = entry.target;
      if (entry.isIntersecting) {
        if (!wrap._loaded) wrap._load && wrap._load();
      } else if (wrap._loaded) {
        const media = wrap.querySelector('img,video,audio');
        if (media) {
          if (typeof media.pause === 'function') media.pause();
          media.removeAttribute('src');
          if (typeof media.load === 'function') media.load();
        }
        wrap.replaceChildren(document.createTextNode('Attachment unloaded while off screen'));
        wrap._loaded = false;
      }
    });
  }, { rootMargin: '350px 0px' }) : null;

  function lightbox(src) {
    const lb = el('div', { class: 'lightbox', onclick: () => lb.remove() }, el('img', { src, alt: '' }));
    document.body.append(lb);
  }
  function attachmentEl(att) {
    if (!att || !att.kind) return el('span');
    const wrap = el('div', { class: 'att ' + att.kind });
    const build = (src) => {
      wrap.classList.remove('loading'); wrap.textContent = '';
      if (att.kind === 'image') {
        wrap.append(el('img', { src, alt: att.name || '', loading: 'lazy', onclick: () => lightbox(src) }));
      } else if (att.kind === 'video') {
        wrap.append(el('video', { src, controls: true, preload: 'none', playsinline: true }));
      } else {
        wrap.append(el('div', { class: 'fn', html: I.music.replace('<svg', '<svg width="15" height="15"') + esc(att.name || 'audio') }),
          el('audio', { src, controls: true, preload: 'none' }));
      }
    };
    const external = att.url && /^https:\/\//.test(att.url) ? att.url : '';
    if (!external && !att.fid) return wrap;
    wrap.classList.add('loading');
    wrap.textContent = 'Attachment is waiting to load…';
    wrap._loaded = false;
    wrap._load = () => {
      if (wrap._loading || wrap._loaded || !wrap.isConnected) return;
      wrap._loading = true;
      const source = external ? Promise.resolve(external) : loadFile(att.fid);
      source.then(src => {
        if (wrap.isConnected && src) {
          build(src);
          wrap._loaded = true;
          if (mediaIO) { mediaIO.unobserve(wrap); mediaIO.observe(wrap); }
        } else if (wrap.isConnected) wrap.textContent = 'File unavailable';
      })
        .catch(() => { if (wrap.isConnected) wrap.textContent = 'File unavailable'; })
        .finally(() => { wrap._loading = false; });
    };
    if (mediaIO) mediaIO.observe(wrap); else wrap._load();
    return wrap;
  }
  function attachmentsEl(list) {
    const arr = Array.isArray(list) ? list : Object.values(list || {});
    if (!arr.length) return null;
    return el('div', { class: 'atts' }, arr.map(attachmentEl));
  }
  function disposeAttachments(root) {
    if (!root) return;
    const wraps = [...(root.matches && root.matches('.att') ? [root] : []), ...root.querySelectorAll('.att')];
    wraps.forEach(wrap => {
      if (mediaIO) mediaIO.unobserve(wrap);
      const media = wrap.querySelector('img,video,audio');
      if (!media) return;
      if (typeof media.pause === 'function') media.pause();
      media.removeAttribute('src');
      if (typeof media.load === 'function') media.load();
      wrap._loaded = false;
    });
  }
  function deleteFiles(list) {
    const arr = Array.isArray(list) ? list : Object.values(list || {});
    arr.forEach(a => {
      if (a && a.fid) { fileLoads.delete(a.fid); db.ref('files/' + a.fid).remove().catch(() => {}); }
      if (a && a.url && storage) { try { storage.refFromURL(a.url).delete().catch(() => {}); } catch (e) {} }
    });
  }

  function reactionsEl(reactions, path, { allowAdd = true } = {}) {
    const box = el('div', { class: 'reacts' });
    const r = reactions || {};
    const keys = Object.keys(r).filter(k => isEmoji(k) && r[k] && Object.keys(r[k]).length);
    keys.forEach(k => {
      const users = Object.keys(r[k]);
      const mine = users.includes(uid);
      const names = users.map(u => (user(u) || {}).name).filter(Boolean);
      box.append(el('button', {
        class: 'react' + (mine ? ' mine' : ''), type: 'button',
        title: names.slice(0, 12).join(', ') + (names.length > 12 ? ' +' + (names.length - 12) : ''),
        html: emojiImg(k, '') + '<span>' + users.length + '</span>',
        onclick: () => toggleReaction(path, k)
      }));
    });
    if (allowAdd && keys.length) {
      const add = el('button', { class: 'react add', type: 'button', title: 'Add reaction', html: I.plus });
      add.onclick = () => openPicker(add, id => toggleReaction(path, id), { title: 'React', stickers: false });
      box.append(add);
    }
    return keys.length ? box : null;
  }
  function toggleReaction(path, id) {
    if (!canAct()) return;
    const ref = db.ref(path + '/' + id + '/' + uid);
    ref.once('value').then(s => s.exists() ? ref.remove() : ref.set(true));
  }

  let chromeMounted = false;
  function mountChrome(active) {
    if (chromeMounted) return; chromeMounted = true;
    const link = (href, key, icon, label) => el('a', { href, class: active === key ? 'active' : '', html: icon + `<span class="lbl">${label}</span>` });
    const archiveBtn = link('archive.html', 'archive', I.archive, 'Archive');
    const groupsBtn = link('groups.html', 'groups', I.group, 'Groups');
    const dmLink = link('dms.html', 'dms', I.dm, 'DMs');
    dmLink.classList.add('has-dot');
    const dmDot = el('span', { class: 'nav-dot hidden' });
    dmLink.append(dmDot);
    const batterySvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="17" height="10" rx="2"/><path d="M22 10v4M7 10v4"/></svg>';
    const deviceTime = el('span', { class: 'nav-device-time' });
    const deviceDate = el('span', { class: 'nav-device-date' });
    const deviceBattery = el('span', { class: 'nav-device-battery' });
    const deviceInfoBtn = el('button', { type: 'button', class: 'nav-device', title: 'Time, date, and battery', 'aria-label': 'Open time and battery details' },
      el('span', { class: 'nav-device-icons', html: I.clock + batterySvg }),
      el('span', { class: 'nav-device-copy' },
        el('span', { class: 'nav-device-topline' }, deviceTime, deviceBattery), deviceDate));
    const nav = el('nav', { class: 'nav' },
      link('chat.html', 'chat', I.chat, 'Chat'),
      dmLink,
      groupsBtn,
      link('post.html', 'posts', I.posts, 'Posts'),
      archiveBtn,
      deviceInfoBtn);
    // unread DMs: a conversation is unread when its last activity is newer than my last read
    let uc = {}, rd = {}, unreadState = {}, unreadCount = 0, unreadPaintQueued = false;
    const paintDot = () => {
      unreadPaintQueued = false;
      dmDot.classList.toggle('hidden', !unreadCount);
      emit('unread', { userConvs: uc, reads: rd, count: unreadCount });
    };
    const unreadRef = db.ref('userConvs/' + uid), readRef = db.ref('reads/' + uid);
    const updateMapEntry = (target, snap, remove = false) => {
      const key = snap.key, wasUnread = !!unreadState[key];
      if (remove) delete target[snap.key]; else target[snap.key] = snap.val();
      const isUnread = (uc[key] || 0) > (rd[key] || 0);
      if (wasUnread !== isUnread) unreadCount += isUnread ? 1 : -1;
      unreadState[key] = isUnread;
      if (!unreadPaintQueued) { unreadPaintQueued = true; requestAnimationFrame(paintDot); }
    };
    unreadRef.on('child_added', s => updateMapEntry(uc, s));
    unreadRef.on('child_changed', s => updateMapEntry(uc, s));
    unreadRef.on('child_removed', s => updateMapEntry(uc, s, true));
    readRef.on('child_added', s => updateMapEntry(rd, s));
    readRef.on('child_changed', s => updateMapEntry(rd, s));
    readRef.on('child_removed', s => updateMapEntry(rd, s, true));

    const profBtn = el('button', { class: 'corner-btn right', type: 'button', 'aria-label': 'Profile', title: 'Profile' });
    profBtn.onclick = () => openProfile({});
    const adminBtn = el('button', { class: 'corner-btn left hidden', type: 'button', 'aria-label': 'Admin', title: 'Admin panel', html: I.shield + '<span class="tag">ADMIN</span>' });
    adminBtn.onclick = () => openStaffPanel('admin');

    document.body.append(nav, profBtn, adminBtn);

    let batteryManager = null;
    let batteryReady = false;
    let deviceModal = null;
    let deviceModalNodes = null;
    let deviceInterval = null;
    const formatTime = date => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
    const formatFullTime = date => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(date);
    const formatDay = date => new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
    const formatShortDay = date => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
    const batterySummary = () => {
      if (!batteryReady) return '…';
      if (!batteryManager) return '—';
      return Math.round(batteryManager.level * 100) + '%' + (batteryManager.charging ? ' ⚡' : '');
    };
    const updateDeviceInfo = () => {
      const date = new Date();
      deviceTime.textContent = formatTime(date);
      deviceDate.textContent = formatShortDay(date);
      deviceBattery.textContent = batterySummary();
      deviceInfoBtn.setAttribute('aria-label', formatTime(date) + ', ' + formatDay(date) + ', battery ' + batterySummary());
      if (!deviceModalNodes) return;
      deviceModalNodes.time.textContent = formatFullTime(date);
      deviceModalNodes.day.textContent = formatDay(date);
      if (!batteryReady) {
        deviceModalNodes.battery.textContent = 'Checking battery status…';
        deviceModalNodes.fill.style.width = '0%';
        deviceModalNodes.bar.setAttribute('aria-valuenow', '0');
      } else if (!batteryManager) {
        deviceModalNodes.battery.textContent = 'Battery information is not available in this browser.';
        deviceModalNodes.fill.style.width = '0%';
        deviceModalNodes.bar.setAttribute('aria-valuenow', '0');
      } else {
        const level = Math.round(batteryManager.level * 100);
        deviceModalNodes.battery.textContent = level + '% · ' + (batteryManager.charging ? 'Charging' : 'On battery');
        deviceModalNodes.fill.style.width = level + '%';
        deviceModalNodes.bar.setAttribute('aria-valuenow', String(level));
      }
    };
    function openDeviceInfo() {
      if (deviceModal) return;
      const time = el('div', { class: 'device-clock-time' });
      const day = el('div', { class: 'device-clock-day' });
      const battery = el('div', { class: 'device-battery-status' });
      const fill = el('div', { class: 'device-battery-fill' });
      const bar = el('div', { class: 'device-battery-bar', role: 'meter', 'aria-label': 'Battery charge', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, fill);
      deviceModalNodes = { time, day, battery, fill, bar };
      const body = el('div', { class: 'device-info-content' },
        el('div', { class: 'device-clock-card' }, time, day),
        el('div', { class: 'device-battery-card' },
          el('div', { class: 'device-battery-heading' }, el('span', { html: batterySvg }), el('span', null, 'Device battery')),
          battery, bar));
      deviceModal = modal({ title: 'Time & battery', body, cls: 'device-info-modal', onClose: () => {
        if (deviceInterval) clearInterval(deviceInterval);
        deviceInterval = null; deviceModal = null; deviceModalNodes = null;
      } });
      updateDeviceInfo();
      deviceInterval = setInterval(updateDeviceInfo, 1000);
    }
    deviceInfoBtn.onclick = openDeviceInfo;
    setInterval(updateDeviceInfo, 15000);
    if (typeof navigator.getBattery === 'function') {
      try {
        navigator.getBattery().then(battery => {
          batteryManager = battery; batteryReady = true;
          ['levelchange', 'chargingchange'].forEach(event => battery.addEventListener(event, updateDeviceInfo));
          updateDeviceInfo();
        }).catch(() => { batteryReady = true; updateDeviceInfo(); });
      } catch (e) { batteryReady = true; updateDeviceInfo(); }
    } else { batteryReady = true; updateDeviceInfo(); }

    let lastSig = '';
    const refresh = () => {
      const sig = userSig(uid) + '|' + !!me();
      if (sig !== lastSig) {
        lastSig = sig;
        profBtn.innerHTML = '';
        profBtn.append(me() ? avatarFrom(me(), 34) : el('span', { html: I.user, style: 'width:22px;height:22px;display:grid;color:var(--text-2)' }));
        const a = profBtn.querySelector('.av'); if (a) a.style.pointerEvents = 'none';
      }
      adminBtn.classList.toggle('hidden', !(isAdmin() && !isOwner()));
    };
    on('change', refresh); refresh();
  }

  function selfCheck() {
    const banned = isBanned();
    let scr = $('.banscreen');
    if (banned && !scr) {
      scr = el('div', { class: 'banscreen' }, el('div', null,
        el('h1', null, 'Banned'),
        el('p', null, 'You have been banned from Orbit by the owner.'),
        S.mod[uid] && S.mod[uid].reason ? el('p', { class: 'muted' }, 'Reason: ' + S.mod[uid].reason) : null));
      document.body.append(scr);
    } else if (!banned && scr) scr.remove();
    if (isOwner() && ss.get('orbit_owner') !== '1') { /* owner on a new session — panel will ask password */ }
  }

  async function processAvatar(file) {
    if (kindOf(file) !== 'image') throw new Error('Pick an image file');
    if (/gif/i.test(file.type) && file.size < 1048576) return readDataURL(file);
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image')); i.src = url; });
      const S2 = 256, c = document.createElement('canvas'); c.width = c.height = S2;
      const ctx = c.getContext('2d');
      const sc = Math.max(S2 / img.naturalWidth, S2 / img.naturalHeight);
      const w = img.naturalWidth * sc, h = img.naturalHeight * sc;
      ctx.drawImage(img, (S2 - w) / 2, (S2 - h) / 2, w, h);
      let out = c.toDataURL('image/webp', 0.86);
      if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/jpeg', 0.86);
      return out;
    } finally { URL.revokeObjectURL(url); }
  }

  async function saveProfile(target, data) {
    const cur = S.users[target] || {};
    const name = (data.name || '').trim();
    if (!NAME_RE.test(name)) throw new Error('Nickname: 2–20 letters, numbers, _ . or -');
    const k = nameKey(name);
    if (STAFF_NAMES[name.toLowerCase()] && (!cur.name || nameKey(cur.name) !== k) && !ownerUnlocked()) {
      throw new Error('Sign in to the owner account before using that reserved nickname');
    }
    if (!cur.name || nameKey(cur.name) !== k) {
      const res = await db.ref('names/' + k).transaction(v => (v === null || v === target || !S.users[v] || !S.users[v].name) ? target : undefined);
      if (!res.committed) throw new Error('That nickname is taken');
      if (cur.name && nameKey(cur.name) !== k) db.ref('names/' + nameKey(cur.name)).remove().catch(() => {});
    }
    const upd = {
      name, bio: (data.bio || '').slice(0, 160), effect: okEffect(data.effect), frame: okFrame(data.frame),
      avatar: safeImg(data.avatar) || null, updatedAt: TS
    };
    if (!cur.createdAt) upd.createdAt = TS;
    await db.ref('users/' + target).update(upd);
  }

  let profileOpen = null;
  function openProfile({ target = uid, setup = false } = {}) {
    if (profileOpen) { profileOpen.close(); if (target === uid && !setup) return; }
    const editingOther = target !== uid;
    if (editingOther && !ownerUnlocked()) { toast('Only the owner can edit other profiles', true); return; }
    const cur = S.users[target] || {};
    const isSetup = setup || !cur.name;
    const draft = { name: cur.name || '', bio: cur.bio || '', effect: okEffect(cur.effect), frame: okFrame(cur.frame), avatar: cur.avatar || null };

    const body = el('div');
    const avWrap = el('div');
    const nameShow = el('div');
    const fileIn = el('input', { type: 'file', accept: 'image/*', class: 'hidden' });
    const nameIn = el('input', { class: 'input', maxlength: 20, placeholder: 'nickname', value: draft.name, autocomplete: 'off', spellcheck: 'false' });
    const bioIn = el('textarea', { class: 'textarea', maxlength: 160, rows: 2, placeholder: 'A short bio (optional)', style: 'min-height:60px' });
    bioIn.value = draft.bio;
    const effectChips = el('div', { class: 'chips' });
    const frameChips = el('div', { class: 'chips' });

    const paint = () => {
      avWrap.innerHTML = ''; avWrap.append(avatarFrom(draft, 72));
      nameShow.innerHTML = ''; nameShow.append(nameFrom({ name: draft.name || 'nickname', effect: draft.effect }));
      if (!editingOther) nameShow.append(...badges(uid));
      effectChips.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.v === draft.effect));
      frameChips.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.v === draft.frame));
    };
    EFFECTS.forEach(([v, label]) => effectChips.append(el('button', { type: 'button', class: 'chip', 'data-v': v, onclick: () => { draft.effect = v; paint(); } },
      el('span', { class: 'uname fx-' + v, style: 'pointer-events:none' }, label))));
    FRAMES.forEach(([v, label]) => {
      const c = el('button', { type: 'button', class: 'chip', 'data-v': v, onclick: () => { draft.frame = v; paint(); } });
      const a = el('div', { class: 'av f-' + v, style: '--s:22px' }, el('div', { class: 'ph' }));
      c.append(a, label); frameChips.append(c);
    });

    const upBtn = el('button', { type: 'button', class: 'btn sm' }, 'Upload photo');
    const rmBtn = el('button', { type: 'button', class: 'btn sm ghost' }, 'Remove');
    upBtn.onclick = () => fileIn.click();
    rmBtn.onclick = () => { draft.avatar = null; paint(); };
    fileIn.onchange = async () => {
      const f = fileIn.files[0]; fileIn.value = '';
      if (!f) return;
      upBtn.disabled = true; upBtn.textContent = 'Processing…';
      try { draft.avatar = await processAvatar(f); paint(); } catch (e) { toast(e.message, true); }
      upBtn.disabled = false; upBtn.textContent = 'Upload photo';
    };
    nameIn.addEventListener('input', () => { draft.name = nameIn.value.trim(); paint(); });
    bioIn.addEventListener('input', () => { draft.bio = bioIn.value; });

    body.append(
      el('div', { class: 'profile-hero' }, avWrap, el('div', { class: 'meta' }, nameShow,
        el('div', { style: 'display:flex;gap:6px;margin-top:8px' }, upBtn, rmBtn), fileIn)),
      el('label', { class: 'label' }, 'Nickname'), nameIn,
      el('label', { class: 'label' }, 'Bio'), bioIn,
      el('label', { class: 'label' }, 'Nickname effect'), effectChips,
      el('label', { class: 'label' }, 'Profile frame'), frameChips
    );

    if (!editingOther && !isSetup) {
      const code = el('div', { class: 'code-box' }, el('span', null, uid),
        el('button', { class: 'btn sm', type: 'button', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(uid).then(() => toast('Login code copied')); } }, 'Copy'));
      body.append(el('label', { class: 'label' }, 'Login code'),
        el('div', { class: 'muted', style: 'font-size:12.5px;margin-bottom:6px' }, 'Orbit remembers you on this device. Use this code to sign in on another device — keep it private.'),
        code);
    }
    if (isSetup && !editingOther) {
      body.append(el('div', { style: 'margin-top:16px;font-size:13px' }, el('a', {
        href: '#', class: 'muted', onclick: async (e) => {
          e.preventDefault();
          const code = await promptText({ title: 'Sign in with a login code', placeholder: 'Paste your login code', multiline: false, okLabel: 'Sign in' });
          if (!code) return;
          const c = code.trim();
          if (!/^[A-Za-z0-9_-]{8,40}$/.test(c)) return toast('That code looks wrong', true);
          const s = await db.ref('users/' + c + '/name').once('value');
          if (!s.exists()) return toast('No profile found for that code', true);
          ls.set('orbit_uid', c); location.reload();
        }
      }, 'Already have a profile? Sign in with a login code')));
    }

    const save = el('button', { class: 'btn primary', type: 'button' }, isSetup ? 'Create profile' : 'Save');
    save.onclick = async () => {
      save.disabled = true;
      try {
        await saveProfile(target, draft);
        toast(isSetup ? 'Welcome to Orbit, ' + draft.name : 'Profile saved');
        m.close();
      } catch (e) { toast(e.message || 'Could not save', true); }
      save.disabled = false;
    };
    nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') save.click(); });

    const m = modal({
      title: editingOther ? 'Edit ' + (cur.name || 'profile') : isSetup ? 'Create your profile' : 'Your profile',
      body, foot: [save], position: editingOther ? '' : 'bottom-right',
      dismissable: !(isSetup && requireProfile && !editingOther),
      onClose: () => { profileOpen = null; }
    });
    profileOpen = m;
    paint();
    setTimeout(() => nameIn.focus(), 50);
  }

  function openUserCard(id) {
    const u = user(id);
    if (!u) return;
    const body = el('div');
    const meta = el('div', { class: 'meta' }, el('div', null, nameFrom(u), ...badges(id)),
      el('div', { class: 'muted', style: 'font-size:13px;margin-top:4px' },
        isOnline(id) ? el('span', null, el('span', { class: 'dot' }), ' online') : 'offline',
        u.createdAt ? ' · joined ' + new Date(u.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : ''));
    body.append(el('div', { class: 'profile-hero' }, avatarFrom(u, 72), meta));
    if (u.bio) body.append(el('p', { style: 'color:var(--text-2);margin:16px 0 0;white-space:pre-wrap' }, u.bio));
    const st = statusTags(id); if (st.length) body.append(el('div', { style: 'margin-top:10px' }, st));
    const foot = [];
    if (id !== uid) foot.push(el('button', { class: 'btn sm primary', html: I.dm.replace('<svg', '<svg width="15" height="15"') + 'Message', onclick: () => {
      m.close();
      if (!me()) return openProfile({ setup: true });
      location.href = 'dms.html#u=' + encodeURIComponent(id);
    } }));
    if (handlers.mention && handlers.mention.length && id !== uid) foot.push(el('button', { class: 'btn sm', onclick: () => { m.close(); emit('mention', u.name); } }, 'Mention'));
    if (id !== uid && canModerate(id)) {
      foot.push(timeoutButton(id, () => m.close()));
      if (ownerUnlocked()) foot.push(el('button', { class: 'btn sm', onclick: () => { m.close(); openProfile({ target: id }); } }, 'Edit'));
    }
    if (id === uid) foot.push(el('button', { class: 'btn sm', onclick: () => { m.close(); openProfile({}); } }, 'Edit profile'));
    const m = modal({ title: 'Profile', body, foot: foot.length ? foot : null });
  }
  function statusTags(id) {
    const out = [];
    if (isBanned(id)) out.push(el('span', { class: 'status ban' }, 'BANNED'));
    const t = timeoutLeft(id); if (t > 0) out.push(el('span', { class: 'status to' }, 'TIMED OUT · ' + fmtDur(t)));
    return out;
  }
  let announcementTimer = null;
  let visibleAnnouncementId = null;
  function renderAnnouncement(announcement) {
    if (announcementTimer) { clearTimeout(announcementTimer); announcementTimer = null; }
    const old = $('.announcement-pill');
    const startedAt = Number(announcement && announcement.sentAt);
    const durationMs = Number(announcement && announcement.durationMs);
    if (!announcement || typeof announcement.text !== 'string' || !Number.isFinite(startedAt) ||
        !Number.isFinite(durationMs) || durationMs < 1000 || durationMs > 7 * 864e5) {
      if (old) old.remove();
      visibleAnnouncementId = null;
      return;
    }
    const remaining = startedAt + durationMs - now();
    if (remaining <= 0) {
      if (old) old.remove();
      visibleAnnouncementId = null;
      return;
    }

    if (old) old.remove();
    const id = String(announcement.id || (announcement.uid || 'announcement') + '-' + startedAt);
    visibleAnnouncementId = id;
    const sender = S.users[announcement.uid] || {
      name: announcement.senderName || 'Orbit admin',
      effect: announcement.senderEffect || 'none', frame: announcement.senderFrame || 'none'
    };
    const name = el('span', { class: 'announcement-name fx-' + okEffect(sender.effect) }, sender.name || 'Orbit admin');
    const message = richEl(announcement.text);
    message.classList.add('announcement-message');
    const pill = el('div', { class: 'announcement-pill', role: 'status', 'aria-live': 'polite' },
      avatarFrom(sender, 42),
      el('div', { class: 'announcement-copy' },
        el('div', { class: 'announcement-heading' }, name, el('span', { class: 'announcement-label' }, 'Announcement')),
        message));
    document.body.append(pill);
    announcementTimer = setTimeout(() => {
      if (visibleAnnouncementId !== id) return;
      pill.classList.add('is-ending');
      setTimeout(() => { if (visibleAnnouncementId === id) { pill.remove(); visibleAnnouncementId = null; } }, 260);
    }, remaining);
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) renderAnnouncement(S.announcement);
  });

  function openMembers() {
    const list = el('div', { class: 'members-grid' });
    const more = el('button', { type: 'button', class: 'btn sm members-more' }, 'Show more members');
    const search = el('input', { class: 'input', placeholder: 'Search members', style: 'margin-bottom:12px' });
    let shown = 100;
    const render = () => {
      const q = search.value.trim().toLowerCase();
      const ids = Object.keys(S.users).filter(id => user(id) && (!q || user(id).name.toLowerCase().includes(q)))
        .sort((a, b) => (isOnline(b) - isOnline(a)) || (isOwner(b) - isOwner(a)) || (isAdmin(b) - isAdmin(a)) || user(a).name.localeCompare(user(b).name));
      list.innerHTML = '';
      if (!ids.length) list.append(el('div', { class: 'empty' }, 'No members yet'));
      ids.slice(0, shown).forEach(id => list.append(el('button', { type: 'button', class: 'member-card', onclick: () => openUserCard(id) },
        avatar(id, 44, false),
        el('div', { class: 'member-card-copy' }, nameTag(id), el('div', { class: 'sub' }, isOnline(id) ? '● online' : 'offline')))));
      more.classList.toggle('hidden', ids.length <= shown);
    };
    search.oninput = () => { shown = 100; render(); };
    more.onclick = () => { shown += 100; render(); };
    const count = () => Object.keys(S.users).filter(id => user(id)).length;
    const m = modal({ title: 'Members · ' + count() + ' · ' + onlineCount() + ' online', body: el('div', { class: 'members-content' }, search, list, more), wide: true, cls: 'members-modal', onClose: cleanup });
    const update = () => { m.head.querySelector('h3').textContent = 'Members · ' + count() + ' · ' + onlineCount() + ' online'; render(); };
    function cleanup() { off('change', update); off('presence', update); }
    on('change', update); on('presence', update);
    render();
  }

  const dmId = (a, b) => 'dm_' + [a, b].sort().join('_');
  const dm = {
    id: dmId,
    async ensure(other) {
      const cid = dmId(uid, other);
      const ref = db.ref('convs/' + cid);
      const snap = await ref.once('value');
      if (!snap.exists()) await ref.set({ type: 'dm', members: { [uid]: true, [other]: true }, createdAt: TS });
      await db.ref('userConvs/' + uid + '/' + cid).set(TS);
      return cid;
    },
    async createGroup(name, memberIds) {
      const ref = db.ref('convs').push();
      const members = { [uid]: true };
      memberIds.forEach(m => { members[m] = true; });
      const upd = {};
      upd['convs/' + ref.key] = { type: 'group', name: name.slice(0, 40), members, createdBy: uid, createdAt: TS, last: { uid, text: 'created the group', ts: TS } };
      Object.keys(members).forEach(m => { upd['userConvs/' + m + '/' + ref.key] = TS; });
      upd['reads/' + uid + '/' + ref.key] = TS;
      await db.ref().update(upd);
      return ref.key;
    },
    async send(cid, msg, { silentSound = false } = {}) {
      const meta = (await db.ref('convs/' + cid).once('value')).val();
      if (!meta || !meta.members || !meta.members[uid]) throw new Error('You are not in this conversation');
      const outgoing = { ...msg };
      if (auth.currentUser) outgoing.authUid = auth.currentUser.uid;
      const ref = db.ref('convMsgs/' + cid).push();
      const preview = (outgoing.text || (outgoing.attachments ? '📎 Attachment' : outgoing.share ? (outgoing.share.type === 'community' ? '🏘️ Shared a community' : outgoing.share.type === 'archive' ? '🗃️ Shared an Archive box' : '📝 Shared a post') : outgoing.forward ? '↪ Forwarded message' : '')).replace(/:gd\d+:/g, '🙂').replace(/:sticker_[A-Za-z0-9_.-]{1,100}:/g, '[Sticker]').slice(0, 120);
      const upd = {};
      upd['convMsgs/' + cid + '/' + ref.key] = outgoing;
      upd['convs/' + cid + '/last'] = { uid, text: preview, ts: TS };
      Object.keys(meta.members).forEach(m => { upd['userConvs/' + m + '/' + cid] = TS; });
      upd['reads/' + uid + '/' + cid] = TS;
      await db.ref().update(upd);
      if (!silentSound) playMessageSound('send');
      return ref.key;
    },
    markRead(cid) { return db.ref('reads/' + uid + '/' + cid).set(TS); },
    async listMine() {
      const s = await db.ref('userConvs/' + uid).orderByValue().limitToLast(100).once('value');
      const ids = Object.keys(s.val() || {});
      const metas = await Promise.all(ids.map(c => db.ref('convs/' + c).once('value').then(x => [c, x.val()])));
      return metas.filter(([, m]) => m && m.members && m.members[uid])
        .sort((a, b) => (((b[1].last || {}).ts) || b[1].createdAt || 0) - (((a[1].last || {}).ts) || a[1].createdAt || 0));
    },
    other(meta) { return Object.keys((meta && meta.members) || {}).find(m => m !== uid) || uid; },
    title(meta) {
      if (!meta) return 'Conversation';
      if (meta.type === 'group') return meta.name || 'Group chat';
      return (user(dm.other(meta)) || {}).name || 'Deleted user';
    }
  };

  function guard(target, ownerOnly) {
    if (isOwner() && !ownerUnlocked()) { toast('Sign in to the owner panel before using owner actions', true); return false; }
    if (ownerOnly && !ownerUnlocked()) { toast('Owner only', true); return false; }
    if (!canModerate(target)) {
      if (isAdmin() && !isOwner() && !(firebaseAdminLinked && firebaseAdminProfile === uid)) toast('Sign in with the Firebase account linked to this Orbit admin profile', true);
      else toast(isOwner(target) ? "You can't moderate the owner" : 'Not allowed', true);
      return false;
    }
    return true;
  }
  function canManageContent(ownerId) {
    if (isOwner() && !ownerUnlocked()) { toast('Sign in to the owner panel before using owner actions', true); return false; }
    if (ownerId === uid) {
      if (isAdmin() && !isOwner() && !firebaseAdminClaim && !(firebaseAdminLinked && firebaseAdminProfile === uid)) { toast('Sign in with the Firebase account linked to this Orbit admin profile', true); return false; }
      return true;
    }
    return guard(ownerId);
  }
  function staffWriteAllowed() {
    if (canManageChatSettings()) return true;
    if (isOwner() && !ownerUnlocked()) toast('Sign in to the owner Firebase account before using owner actions', true);
    else if (isAdmin() && !auth.currentUser) toast('Sign in to the Firebase account linked to this admin profile', true);
    else if (isAdmin()) toast('This Firebase account is not linked to your admin profile. Ask the owner to link its UID in the Users tab.', true);
    else toast('Not allowed', true);
    return false;
  }
  function canManageChatSettings() {
    return ownerUnlocked() || (isAdmin() && (firebaseAdminClaim || (firebaseAdminLinked && firebaseAdminProfile === uid)));
  }
  async function updateChatSettings(patch) {
    if (!canManageChatSettings()) { toast('Only an authenticated owner or admin can change chat protection', true); return false; }
    const safe = {};
    if (typeof patch.lockdown === 'boolean') safe.lockdown = patch.lockdown;
    if ([0, 2000, 5000, 10000].includes(Number(patch.slowModeMs))) safe.slowModeMs = Number(patch.slowModeMs);
    if (typeof patch.autoLock === 'boolean') safe.autoLock = patch.autoLock;
    if (patch.lockdownAt === null || patch.lockdownAt === TS) safe.lockdownAt = patch.lockdownAt;
    if (patch.lockdownBy === null || patch.lockdownBy === uid) safe.lockdownBy = patch.lockdownBy;
    if (patch.autoLocked === null || typeof patch.autoLocked === 'boolean') safe.autoLocked = patch.autoLocked;
    try { await db.ref('chatSettings').update(safe); return true; }
    catch (e) { reportDbFailure('Save chat protection', e); return false; }
  }
  function reportDbFailure(action, error) {
    console.error('Orbit: ' + action + ' failed', error);
    const denied = error && (error.code === 'PERMISSION_DENIED' || /permission.?denied|insufficient permissions/i.test(error.message || ''));
    toast(action + ' failed: ' + (denied ? 'Firebase Realtime Database rules denied this write.' : (error && error.message) || 'database error'), true);
  }
  const mod = {
    async timeout(id, ms) { if (!guard(id)) return; try { await db.ref('mod/' + id).update({ timeoutUntil: now() + ms, by: uid }); toast((user(id) || {}).name + ' timed out for ' + fmtDur(ms)); } catch (e) { reportDbFailure('Timeout', e); } },
    async untimeout(id) { if (!guard(id)) return; try { await db.ref('mod/' + id + '/timeoutUntil').set(0); toast('Timeout removed'); } catch (e) { reportDbFailure('Remove timeout', e); } },
    async ban(id) {
      if (!guard(id, true)) return;
      const reason = await promptText({ title: 'Ban ' + ((user(id) || {}).name || 'user'), placeholder: 'Reason (optional)', multiline: false, okLabel: 'Ban' });
      if (reason === null) return;
      try { await db.ref('mod/' + id).update({ banned: true, reason: reason.slice(0, 200) || null, by: uid }); toast('User banned'); } catch (e) { reportDbFailure('Ban user', e); }
    },
    async unban(id) { if (!guard(id, true)) return; try { await db.ref('mod/' + id).update({ banned: null, reason: null }); toast('User unbanned'); } catch (e) { reportDbFailure('Unban user', e); } },
    async setAdmin(id, v) {
      if (!guard(id, true)) return;
      try {
        if (v) {
          await db.ref('roles/' + id).set('admin');
          toast('Orbit admin role set. Link a Firebase Auth account to enable protected actions.');
        } else {
          const link = await db.ref('adminAuthByProfile/' + id).once('value');
          const updates = { ['roles/' + id]: null, ['adminAuthByProfile/' + id]: null };
          if (link.val()) updates['adminAuthUids/' + link.val()] = null;
          await db.ref().update(updates);
          toast('Admin role and linked account access removed');
        }
      } catch (e) { reportDbFailure(v ? 'Grant admin role' : 'Remove admin role', e); }
    },
    async deleteUser(id) {
      if (!guard(id, true)) return;
      const u = user(id);
      if (!(await confirmBox('Delete the profile of ' + (u ? u.name : 'this user') + '? Their messages and posts stay unless you remove them.', 'Delete profile', true))) return;
      const upd = {}; upd['users/' + id] = null; upd['roles/' + id] = null;
      if (u) upd['names/' + nameKey(u.name)] = null;
      try {
        const link = await db.ref('adminAuthByProfile/' + id).once('value');
        upd['adminAuthByProfile/' + id] = null;
        if (link.val()) upd['adminAuthUids/' + link.val()] = null;
        await db.ref().update(upd); toast('Profile deleted');
      } catch (e) { reportDbFailure('Delete profile', e); }
    },
    async deleteUsers(ids, onProgress) {
      if (!ownerUnlocked()) { toast('Owner only', true); return false; }
      const targets = [...new Set(ids || [])].filter(id => id && id !== uid && !isOwner(id) && user(id));
      if (!targets.length) { toast('Select at least one eligible profile', true); return false; }
      if (targets.length > 100000) { toast('Delete up to 100,000 profiles at a time', true); return false; }
      const ok = await confirmBox(
        'Delete ' + targets.length.toLocaleString() + ' Orbit profile' + (targets.length === 1 ? '' : 's') + '? This runs in batches, so some may be deleted if a later batch fails. Messages and posts remain, and Firebase Authentication accounts are not deleted.',
        'Delete selected profiles', true);
      if (!ok) return null;
      const deleted = [];
      try {
        const batchSize = 250;
        for (let start = 0; start < targets.length; start += batchSize) {
          const batch = targets.slice(start, start + batchSize);
          const links = await Promise.all(batch.map(id => db.ref('adminAuthByProfile/' + id).once('value').then(s => [id, s.val()])));
          const linkById = new Map(links);
          const updates = {};
          batch.forEach(id => {
            const profile = user(id);
            updates['users/' + id] = null;
            updates['roles/' + id] = null;
            if (profile) updates['names/' + nameKey(profile.name)] = null;
            updates['adminAuthByProfile/' + id] = null;
            const authUid = linkById.get(id);
            if (authUid) updates['adminAuthUids/' + authUid] = null;
          });
          await db.ref().update(updates);
          deleted.push(...batch);
          if (onProgress) onProgress(deleted.length, targets.length);
        }
        toast('Deleted ' + deleted.length.toLocaleString() + ' profiles');
      } catch (e) {
        if (deleted.length) toast('Deleted ' + deleted.length.toLocaleString() + ' of ' + targets.length.toLocaleString() + ' profiles before an error: ' + e.message, true);
        else reportDbFailure('Delete selected profiles', e);
      }
      return deleted;
    },
    async editMessage(id, msg, base = 'messages') {
      if (!canManageContent(msg.uid)) return;
      const t = await promptText({ title: 'Edit message', value: msg.text || '' });
      if (t === null) return;
      try { await db.ref(base + '/' + id).update({ text: t.slice(0, 4000), edited: true, editedBy: uid }); } catch (e) { reportDbFailure('Edit message', e); }
    },
    async deleteMessage(id, msg, skipConfirm, base = 'messages') {
      if (!canManageContent(msg.uid)) return;
      const publicMessagePath = base === 'messages' || base.indexOf('channelMessages/') === 0 || base.indexOf('omegleRooms/') === 0;
      if (publicMessagePath && msg.uid === uid && !msg.authUid && !canModerate(msg.uid)) {
        toast('This older message has no secure owner record. An owner or admin can remove it.', true);
        return;
      }
      if (!skipConfirm && !(await confirmBox('Delete this message?', 'Delete', true))) return;
      try { await db.ref(base + '/' + id).remove(); deleteFiles(msg.attachments); } catch (e) { reportDbFailure('Delete message', e); }
    },
    async editPost(id, post) {
      if (!canManageContent(post.uid)) return;
      const t = await promptText({ title: 'Edit post', value: post.text || '' });
      if (t === null) return;
      try { await db.ref('posts/' + id).update({ text: t.slice(0, 5000), edited: true, editedBy: uid }); } catch (e) { reportDbFailure('Edit post', e); }
    },
    async deletePost(id, post) {
      if (!canManageContent(post.uid)) return;
      if (!(await confirmBox('Delete this post and its comments?', 'Delete', true))) return;
      try {
        const commentSnapshot = await db.ref('comments/' + id).once('value');
        const updates = { ['posts/' + id]: null };
        Object.keys(commentSnapshot.val() || {}).forEach(commentId => {
          updates['comments/' + id + '/' + commentId] = null;
        });
        await db.ref().update(updates);
        deleteFiles(post.attachments);
      } catch (e) { reportDbFailure('Delete post', e); }
    },
    async deleteComment(postId, cid, c) {
      if (!canManageContent(c.uid)) return;
      if (!(await confirmBox('Delete this comment?', 'Delete', true))) return;
      try { await db.ref('comments/' + postId + '/' + cid).remove();
        await db.ref('posts/' + postId + '/commentCount').transaction(n => Math.max(0, (n || 1) - 1));
      } catch (e) { reportDbFailure('Delete comment', e); }
    }
  };
  async function linkAdminAccount(profileId) {
    if (!guard(profileId, true)) return;
    if (S.roles[profileId] !== 'admin') return toast('Make this profile an admin first', true);
    const current = await db.ref('adminAuthByProfile/' + profileId).once('value').catch(() => null);
    const oldAuthUid = current && current.val();
    const value = await promptText({
      title: 'Link Firebase account',
      value: typeof oldAuthUid === 'string' ? oldAuthUid : '',
      placeholder: 'Firebase Authentication user UID', multiline: false,
      help: 'Create this admin in Firebase Console → Authentication → Users with Email/Password, then paste its UID here.'
    });
    if (value === null) return;
    const authUid = value.trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(authUid)) return toast('Enter a valid Firebase Authentication UID', true);
    try {
      const existing = await db.ref('adminAuthUids/' + authUid).once('value');
      if (existing.val() && existing.val() !== profileId) return toast('That Firebase account is already linked to another Orbit profile', true);
      const updates = {
        ['adminAuthByProfile/' + profileId]: authUid,
        ['adminAuthUids/' + authUid]: profileId
      };
      if (oldAuthUid && oldAuthUid !== authUid) updates['adminAuthUids/' + oldAuthUid] = null;
      await db.ref().update(updates);
      toast('Firebase account linked. The admin can sign in from their Admin panel.');
    } catch (e) { reportDbFailure('Link Firebase account', e); }
  }
  function timeoutButton(id, after) {
    const t = timeoutLeft(id) > 0;
    return el('button', {
      class: 'btn sm', html: I.clock.replace('<svg', '<svg width="15" height="15"') + (t ? 'Remove timeout' : 'Timeout'),
      onclick: async () => {
        if (t) await mod.untimeout(id);
        else { const ms = await chooseDuration((user(id) || {}).name); if (ms) await mod.timeout(id, ms); }
        after && after();
      }
    });
  }

  const isEditable = t => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  document.addEventListener('keydown', e => {
    if ((e.key === '`' || e.key === '~') && !isEditable(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      openOwnerGate();
    }
  });
  let gateOpen = false;
  async function openOwnerGate() {
    if (gateOpen || $('.backdrop.staff-owner')) return;
    await ready;
    if (ownerUnlocked()) return openStaffPanel('owner');
    gateOpen = true;
    const email = el('input', { class: 'input', type: 'email', placeholder: 'Owner account email', autocomplete: 'username', required: true });
    const password = el('input', { class: 'input', type: 'password', placeholder: 'Owner account password', autocomplete: 'current-password', required: true, style: 'margin-top:10px' });
    const go = el('button', { class: 'btn primary' }, 'Sign in');
    const m = modal({ title: 'Owner panel', body: el('div', null,
      el('div', { class: 'muted', style: 'font-size:13px;margin-bottom:10px', html: I.lock.replace('<svg', '<svg width="14" height="14" style="vertical-align:-2px"') + ' Sign in with the configured owner account' }),
      email, password), foot: [go], onClose: () => { gateOpen = false; } });
    const attempt = async () => {
      if (!email.value.trim() || !password.value) { toast('Enter your owner account email and password', true); return; }
      go.disabled = true;
      go.textContent = 'Signing in…';
      try {
        await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
        const credential = await auth.signInWithEmailAndPassword(email.value.trim(), password.value);
        if (!credential.user || credential.user.uid !== OWNER_UID) {
          await auth.signOut();
          password.value = '';
          password.focus();
          toast('This Firebase account is not the configured owner account', true);
          return;
        }
        const marker = { authUid: OWNER_UID };
        await db.ref('owners/' + uid).set(marker);
        S.owners[uid] = marker;
        ss.set('orbit_owner', '1');
        m.close();
        toast('Owner panel unlocked');
        openStaffPanel('owner');
      } catch (e) {
        console.error('Orbit owner sign-in failed:', e);
        toast('Sign-in failed. Check the owner account email and password.', true);
      } finally {
        go.disabled = false;
        go.textContent = 'Sign in';
      }
    };
    go.onclick = attempt;
    [email, password].forEach(input => input.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); }));
    setTimeout(() => email.focus(), 40);
  }

  async function openAdminGate() {
    if (!isAdmin() || isOwner()) return toast('Admins only', true);
    const email = el('input', { class: 'input', type: 'email', placeholder: 'Admin Firebase account email', autocomplete: 'username', required: true });
    const password = el('input', { class: 'input', type: 'password', placeholder: 'Firebase account password', autocomplete: 'current-password', required: true, style: 'margin-top:10px' });
    const go = el('button', { class: 'btn primary' }, 'Sign in');
    const m = modal({ title: 'Admin sign in', body: el('div', null,
      el('div', { class: 'muted', style: 'font-size:13px;margin-bottom:10px' }, 'Use the Email/Password Firebase account that the owner linked to your Orbit profile.'),
      email, password), foot: [go] });
    const attempt = async () => {
      if (!email.value.trim() || !password.value) { toast('Enter your Firebase account email and password', true); return; }
      go.disabled = true; go.textContent = 'Signing in…';
      try {
        await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
        const credential = await auth.signInWithEmailAndPassword(email.value.trim(), password.value);
        const authUser = credential.user;
        const [link, token] = await Promise.all([
          db.ref('adminAuthUids/' + authUser.uid).once('value'),
          authUser.getIdTokenResult()
        ]);
        const authorized = token.claims.admin === true || link.val() === uid;
        if (!authorized) {
          await auth.signOut();
          password.value = ''; password.focus();
          toast('This Firebase account is not linked to your Orbit admin profile', true);
          return;
        }
        m.close();
        toast('Admin account signed in');
      } catch (e) {
        console.error('Orbit admin sign-in failed:', e);
        toast('Sign-in failed. Check the Firebase account email and password.', true);
      } finally { go.disabled = false; go.textContent = 'Sign in'; }
    };
    go.onclick = attempt;
    [email, password].forEach(input => input.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); }));
    setTimeout(() => email.focus(), 40);
  }

  function openStaffPanel(mode) {
    const owner = mode === 'owner';
    if (owner && !ownerUnlocked()) return openOwnerGate();
    if (!owner && !isAdmin()) return toast('Admins only', true);
    const existing = $('.backdrop.staff-' + mode); if (existing) return;

    const tabsEl = el('div', { class: 'tabs' });
    const content = el('div');
    const permissionNote = owner ? null : el('div', { class: 'staff-permission-note hidden' });
    let authUnsubscribe = null;
    const tabNames = owner ? ['Users', 'Chat', 'Posts', 'Tags', 'Announce', 'Public settings'] : ['Users', 'Chat', 'Posts', 'Tags', 'Announce'];
    let tab = 'Users';
    const detach = [];
    const cleanup = () => { detach.splice(0).forEach(fn => fn()); };

    tabNames.forEach(t => tabsEl.append(el('button', { type: 'button', 'data-t': t, onclick: () => { tab = t; showTab(); } }, t)));

    const foot = [];
    if (owner) {
      foot.push(el('button', { class: 'btn sm ghost', onclick: async () => {
        ss.del('orbit_owner');
        m.close();
        try { await auth.signOut(); toast('Owner panel locked'); }
        catch (e) { console.error('Orbit owner sign-out failed:', e); toast('Panel closed, but sign-out failed. Reload and try again.', true); }
      } }, 'Lock panel'));
    }
    const m = modal({
      title: owner ? 'Owner panel' : 'Admin panel', wide: true, cls: 'staff-' + mode,
      position: owner ? '' : 'bottom-left',
      body: el('div', null, tabsEl, permissionNote, content), foot: foot.length ? foot : null,
      onClose: () => { cleanup(); if (authUnsubscribe) authUnsubscribe(); }
    });
    m.head.querySelector('h3').prepend(el('span', { html: (owner ? I.crown : I.shield).replace('<svg', '<svg width="17" height="17" style="vertical-align:-3px;margin-right:8px"') }));
    if (!owner) {
      const refreshPermissionNote = () => {
        const allowed = firebaseAdminClaim || (firebaseAdminLinked && firebaseAdminProfile === uid);
        permissionNote.classList.toggle('hidden', allowed);
        if (allowed) { permissionNote.replaceChildren(); return; }
        const text = auth.currentUser
          ? 'This Firebase account is not linked to this Orbit admin profile. Ask the owner to link its Firebase UID.'
          : 'Admin actions need a linked Firebase sign-in. Ask the owner to create an Email/Password account and link its Firebase UID, then sign in here.';
        permissionNote.replaceChildren(el('span', null, text), el('button', { class: 'btn sm', type: 'button', style: 'margin-left:10px', onclick: openAdminGate }, auth.currentUser ? 'Switch account' : 'Sign in'));
      };
      on('change', refreshPermissionNote);
      detach.push(() => { handlers.change = (handlers.change || []).filter(fn => fn !== refreshPermissionNote); });
      authUnsubscribe = auth.onIdTokenChanged(() => setTimeout(refreshPermissionNote, 0));
      refreshPermissionNote();
    }

    function showTab() {
      cleanup();
      tabsEl.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
      content.innerHTML = '';
      if (tab === 'Users') usersTab();
      if (tab === 'Chat') chatTab();
      if (tab === 'Posts') postsTab();
      if (tab === 'Tags') tagsTab();
      if (tab === 'Announce') announcementsTab();
      if (tab === 'Public settings' && owner) publicSettingsTab();
    }

    function protectedTag() { return el('span', { class: 'sub' }, 'Protected'); }

    function usersTab() {
      const pageSize = 100;
      let page = 0;
      const search = el('input', { class: 'input', placeholder: 'Search users', style: 'margin-bottom:12px' });
      const filter = el('select', { class: 'select user-filter', 'aria-label': 'Filter users' }, [
        el('option', { value: 'all' }, 'All users'), el('option', { value: 'online' }, 'Online'),
        el('option', { value: 'offline' }, 'Offline'), el('option', { value: 'admins' }, 'Admins'),
        el('option', { value: 'members' }, 'Members'), el('option', { value: 'banned' }, 'Banned')
      ]);
      const list = el('div');
      const selectedUsers = new Set();
      const selectVisible = owner ? el('input', { type: 'checkbox', class: 'user-select', 'aria-label': 'Select all matching users' }) : null;
      const selectedCount = owner ? el('span', { class: 'sub' }, '0 selected') : null;
      const clearSelection = owner ? el('button', { class: 'btn sm', type: 'button', disabled: true }, 'Clear selection') : null;
      const deleteSelected = owner ? el('button', { class: 'btn sm danger', type: 'button', disabled: true }, 'Delete selected profiles') : null;
      const bulkBar = owner ? el('div', { class: 'bulk-users-row' },
        el('label', { class: 'bulk-users-select' }, selectVisible, 'Select all matching users'),
        selectedCount, clearSelection, deleteSelected) : null;
      const pageInfo = el('span', { class: 'sub' }, '0 users');
      const prevPage = el('button', { class: 'btn sm', type: 'button', disabled: true }, 'Previous');
      const nextPage = el('button', { class: 'btn sm', type: 'button', disabled: true }, 'Next');
      const pager = el('div', { class: 'user-list-pager' }, prevPage, pageInfo, nextPage);
      content.append(el('div', { class: 'user-filter-row' }, search, filter), ...(owner ? [bulkBar] : []), pager, list);
      let visibleEligible = [];
      let deleting = false, deleteProgress = '';
      const updateBulkBar = () => {
        if (!owner) return;
        for (const id of selectedUsers) if (!user(id) || id === uid || isOwner(id)) selectedUsers.delete(id);
        const visibleSelected = visibleEligible.filter(id => selectedUsers.has(id)).length;
        selectVisible.checked = visibleEligible.length > 0 && visibleSelected === visibleEligible.length;
        selectVisible.indeterminate = visibleSelected > 0 && visibleSelected < visibleEligible.length;
        selectedCount.textContent = deleting ? deleteProgress : selectedUsers.size.toLocaleString() + ' selected' + (selectedUsers.size > 100000 ? ' · limit 100,000' : '');
        selectVisible.disabled = deleting;
        clearSelection.disabled = deleting || selectedUsers.size === 0;
        deleteSelected.disabled = deleting || selectedUsers.size === 0 || selectedUsers.size > 100000;
        search.disabled = deleting; filter.disabled = deleting;
        prevPage.disabled = deleting || page <= 0;
        nextPage.disabled = deleting || page >= Math.max(1, Math.ceil(visibleEligible.length / pageSize)) - 1;
        list.querySelectorAll('.user-select').forEach(input => { input.disabled = deleting; });
      };
      if (owner) {
        selectVisible.onchange = () => {
          visibleEligible.forEach(id => selectVisible.checked ? selectedUsers.add(id) : selectedUsers.delete(id));
          render();
        };
        clearSelection.onclick = () => { selectedUsers.clear(); render(); };
        deleteSelected.onclick = async () => {
          deleting = true; deleteProgress = 'Starting deletion…'; updateBulkBar();
          let done = null;
          try {
            done = await mod.deleteUsers([...selectedUsers], (count, total) => {
              deleteProgress = 'Deleting ' + count.toLocaleString() + ' / ' + total.toLocaleString() + '…';
              updateBulkBar();
            });
          } catch (e) { toast('Could not finish bulk deletion: ' + e.message, true); }
          finally {
            if (Array.isArray(done)) done.forEach(id => selectedUsers.delete(id));
            deleting = false; deleteProgress = '';
            updateBulkBar();
            render();
          }
        };
      }
      prevPage.onclick = () => { if (page > 0) { page--; render(); } };
      nextPage.onclick = () => { page++; render(); };
      const render = () => {
        const q = search.value.trim().toLowerCase();
        const ids = Object.keys(S.users).filter(id => {
          if (!user(id) || (q && !user(id).name.toLowerCase().includes(q))) return false;
          if (filter.value === 'online' && !isOnline(id)) return false;
          if (filter.value === 'offline' && isOnline(id)) return false;
          if (filter.value === 'admins' && !isAdmin(id)) return false;
          if (filter.value === 'members' && isAdmin(id)) return false;
          if (filter.value === 'banned' && !isBanned(id)) return false;
          return true;
        })
          .sort((a, b) => (isOwner(b) - isOwner(a)) || (isAdmin(b) - isAdmin(a)) || user(a).name.localeCompare(user(b).name));
        visibleEligible = owner ? ids.filter(id => id !== uid && !isOwner(id)) : [];
        const pageCount = Math.max(1, Math.ceil(ids.length / pageSize));
        page = Math.min(page, pageCount - 1);
        const start = page * pageSize;
        const pageIds = ids.slice(start, start + pageSize);
        pageInfo.textContent = ids.length ? (start + 1).toLocaleString() + '–' + Math.min(start + pageSize, ids.length).toLocaleString() + ' of ' + ids.length.toLocaleString() : '0 users';
        prevPage.disabled = page <= 0;
        nextPage.disabled = page >= pageCount - 1;
        pager.classList.toggle('hidden', ids.length <= pageSize);
        list.innerHTML = '';
        if (!ids.length) list.append(el('div', { class: 'empty' }, q || filter.value !== 'all' ? 'No users match this filter' : 'No users yet'));
        pageIds.forEach(id => {
          const acts = el('div', { class: 'acts' });
          const self = id === uid;
          if (!canModerate(id) || (self && !owner)) acts.append(protectedTag());
          else if (owner) {
            acts.append(el('button', { class: 'btn sm', onclick: () => openProfile({ target: id }) }, 'Edit'));
            if (!self) {
              acts.append(el('button', { class: 'btn sm', onclick: () => mod.setAdmin(id, S.roles[id] !== 'admin') }, S.roles[id] === 'admin' ? 'Remove admin' : 'Make admin'));
            if (S.roles[id] === 'admin') acts.append(el('button', { class: 'btn sm', title: 'Link this profile to a Firebase Authentication account', onclick: () => linkAdminAccount(id) }, 'Link Firebase account'));
              acts.append(timeoutButton(id));
              acts.append(isBanned(id)
                ? el('button', { class: 'btn sm', onclick: () => mod.unban(id) }, 'Unban')
                : el('button', { class: 'btn sm danger', onclick: () => mod.ban(id) }, 'Ban'));
              acts.append(el('button', { class: 'btn sm danger', html: I.trash.replace('<svg', '<svg width="15" height="15"'), title: 'Delete profile', onclick: () => mod.deleteUser(id) }));
            }
          } else {
            acts.append(timeoutButton(id));
          }
          if (canModerate(id)) acts.append(el('button', { class: 'btn sm', onclick: () => openUserTags(id) }, 'Tags'));
          const checkbox = owner && id !== uid && !isOwner(id)
            ? el('input', { type: 'checkbox', class: 'user-select', checked: selectedUsers.has(id), 'aria-label': 'Select ' + user(id).name,
              onchange: e => { e.stopPropagation(); if (e.currentTarget.checked) selectedUsers.add(id); else selectedUsers.delete(id); updateBulkBar(); } })
            : null;
          list.append(el('div', { class: 'mrow' }, checkbox, avatar(id, 34, false),
            el('div', { class: 'grow' }, el('div', null, nameTag(id), ...statusTags(id)),
              el('div', { class: 'sub user-presence-status', 'data-user-id': id }, (isOnline(id) ? '● online' : 'offline') + (owner ? ' · ' + id : ''))),
            acts));
        });
        updateBulkBar();
      };
      search.oninput = () => { page = 0; render(); };
      filter.onchange = () => { page = 0; render(); };
      const fn = () => { if (deleting || (document.activeElement && list.contains(document.activeElement))) return; render(); };
      const presenceFn = () => {
        if (deleting) return;
        if (filter.value === 'online' || filter.value === 'offline') { render(); return; }
        list.querySelectorAll('.user-presence-status[data-user-id]').forEach(node => {
          const id = node.dataset.userId;
          node.textContent = (isOnline(id) ? '● online' : 'offline') + (owner ? ' · ' + id : '');
        });
      };
      on('change', fn); on('presence', presenceFn);
      detach.push(() => { off('change', fn); off('presence', presenceFn); });
      const tick = setInterval(() => { if (!deleting) render(); }, 15000); detach.push(() => clearInterval(tick));
      render();
    }

    function tagsTab() {
      const nameIn = el('input', { class: 'input', maxlength: 24, placeholder: 'Tag name, e.g. VIP', autocomplete: 'off' });
      const colorIn = el('input', { class: 'tag-color-input', type: 'color', value: '#8b5cf6', title: 'Tag color' });
      const effectChips = el('div', { class: 'chips' });
      const preview = el('div', { style: 'display:flex;align-items:center;gap:8px;min-height:28px;margin-top:10px' });
      const savedList = el('div');
      let createEffect = 'none';
      const paintCreatePreview = () => {
        preview.replaceChildren(el('span', { class: 'muted', style: 'font-size:12px' }, 'Preview'),
          customTagBadge({ name: nameIn.value.trim() || 'Tag', color: colorIn.value, effect: createEffect }));
      };
      EFFECTS.forEach(([value, label]) => effectChips.append(el('button', {
        type: 'button', class: 'chip' + (value === createEffect ? ' on' : ''),
        onclick: () => { createEffect = value; effectChips.querySelectorAll('.chip').forEach(b => b.classList.toggle('on', b.dataset.effect === value)); paintCreatePreview(); },
        'data-effect': value
      }, label)));
      nameIn.addEventListener('input', paintCreatePreview);
      colorIn.addEventListener('input', paintCreatePreview);

      const createTag = async () => {
        if (!staffWriteAllowed()) return;
        const name = nameIn.value.trim();
        if (!name) { toast('Enter a tag name', true); nameIn.focus(); return; }
        if (name.length > 24) { toast('Tag names can be up to 24 characters', true); return; }
        if (Object.values(S.customTags).some(tag => String(tag.name || '').toLowerCase() === name.toLowerCase())) {
          toast('A tag with that name already exists', true); return;
        }
        try {
          const ref = db.ref('customTags').push();
          await ref.set({ name, color: safeTagColor(colorIn.value), effect: okEffect(createEffect), updatedAt: TS });
          nameIn.value = '';
          paintCreatePreview();
          toast('Tag created');
        } catch (e) { reportDbFailure('Create tag', e); }
      };
      const createCard = el('div', { class: 'tag-card' },
        el('div', { class: 'muted', style: 'font-size:13px;margin-bottom:8px' }, 'Create tags and apply them to users from the Users tab. They appear beside names across the site.'),
        el('label', { class: 'label' }, 'Tag name'), nameIn,
        el('div', { class: 'tag-options tag-create-options' }, el('div', null, el('label', { class: 'label' }, 'Color'), colorIn),
          el('div', null, el('label', { class: 'label' }, 'Nickname effect'), effectChips)),
        preview,
        el('div', { style: 'display:flex;justify-content:flex-end;margin-top:12px' }, el('button', { class: 'btn sm primary', onclick: createTag }, 'Create tag')));

      const renderSaved = () => {
        savedList.innerHTML = '';
        const tags = Object.entries(S.customTags).sort((a, b) => String(a[1].name || '').localeCompare(String(b[1].name || '')));
        if (!tags.length) { savedList.append(el('div', { class: 'empty' }, 'No custom tags yet')); return; }
        tags.forEach(([id, tag]) => {
          const tagName = el('input', { class: 'input', maxlength: 24, value: tag.name || '', 'aria-label': 'Tag name' });
          const tagColor = el('input', { class: 'tag-color-input', type: 'color', value: safeTagColor(tag.color), title: 'Tag color', 'aria-label': 'Tag color' });
          const tagEffect = el('select', { class: 'select tag-effect-select', 'aria-label': 'Tag nickname effect' },
            EFFECTS.map(([value, label]) => el('option', { value, selected: okEffect(tag.effect) === value }, label)));
          const sample = el('div', { style: 'display:flex;align-items:center;gap:7px;min-height:26px' });
          const paintSample = () => sample.replaceChildren(customTagBadge({ name: tagName.value.trim() || 'Tag', color: tagColor.value, effect: tagEffect.value }));
          tagName.addEventListener('input', paintSample);
          tagColor.addEventListener('input', paintSample);
          tagEffect.addEventListener('change', paintSample);
          paintSample();
          const save = async () => {
            if (!staffWriteAllowed()) return;
            const name = tagName.value.trim();
            if (!name) { toast('Tag name cannot be empty', true); tagName.focus(); return; }
            if (Object.entries(S.customTags).some(([otherId, other]) => otherId !== id && String(other.name || '').toLowerCase() === name.toLowerCase())) {
              toast('A tag with that name already exists', true); return;
            }
            try {
              await db.ref('customTags/' + id).update({ name, color: safeTagColor(tagColor.value), effect: okEffect(tagEffect.value), updatedAt: TS });
              toast('Tag saved');
            } catch (e) { reportDbFailure('Save tag', e); }
          };
          const remove = async () => {
            if (!staffWriteAllowed()) return;
            if (!(await confirmBox('Delete the “' + String(tag.name || 'Tag') + '” tag from all users?', 'Delete tag', true))) return;
            const updates = { ['customTags/' + id]: null };
            Object.keys(S.userTags).forEach(userId => {
              if (S.userTags[userId] && S.userTags[userId][id]) updates['userTags/' + userId + '/' + id] = null;
            });
            try { await db.ref().update(updates); toast('Tag deleted'); }
            catch (e) { reportDbFailure('Delete tag', e); }
          };
          savedList.append(el('div', { class: 'tag-card' },
            el('div', { class: 'tag-saved-head' }, sample, el('span', { class: 'grow' }),
              el('button', { class: 'btn sm danger', onclick: remove }, 'Delete')),
            el('div', { class: 'tag-options tag-edit-options' }, tagName, tagColor, tagEffect),
            el('div', { style: 'display:flex;justify-content:flex-end;margin-top:10px' }, el('button', { class: 'btn sm', onclick: save }, 'Save changes'))));
        });
      };
      content.append(createCard, el('div', { class: 'tag-list-title' }, 'Existing tags'), savedList);
      const fn = () => renderSaved();
      on('customTags', fn); detach.push(() => { handlers.customTags = (handlers.customTags || []).filter(f => f !== fn); });
      renderSaved();
      paintCreatePreview();
    }

    function publicSettingsTab() {
      const background = el('input', { class: 'input appearance-color', type: 'color', value: appearanceColor(S.publicSettings.background) || '#000000', 'aria-label': 'Public background color' });
      const iconUrl = el('input', { class: 'input', type: 'url', placeholder: 'https://example.com/icon.png', value: typeof S.publicSettings.favicon === 'string' && S.publicSettings.favicon !== 'default' ? S.publicSettings.favicon : '' });
      const iconFile = el('input', { type: 'file', accept: 'image/*', class: 'hidden' });
      const iconUpload = el('button', { class: 'btn sm', type: 'button' }, 'Choose image');
      const font = el('select', { class: 'select', 'aria-label': 'Public font' }, [
        el('option', { value: 'default' }, 'Default font'), el('option', { value: 'pusab' }, 'Pusab')
      ]);
      font.value = S.publicSettings.font === 'pusab' ? 'pusab' : 'default';
      const status = el('div', { class: 'muted', style: 'font-size:12.5px' }, 'Changes apply to visitors in real time.');
      const reset = el('button', { class: 'btn sm ghost', type: 'button' }, 'Reset public settings');
      let timer = null;
      const save = async values => {
        status.textContent = 'Saving…';
        if (!staffWriteAllowed()) { status.textContent = 'Only the authenticated owner or an authenticated admin can save public settings.'; return; }
        try { await db.ref('publicSettings').update(values); status.textContent = 'Saved · visitors receive the change in real time.'; }
        catch (e) { console.error('Orbit public appearance save failed:', e); status.textContent = 'Save failed: ' + (e.message || 'permission denied'); toast('Could not save public settings: ' + (e.message || 'permission denied'), true); }
      };
      const saveBackground = () => { clearTimeout(timer); timer = setTimeout(() => save({ background: background.value }), 250); };
      background.addEventListener('input', saveBackground);
      font.addEventListener('change', () => save({ font: font.value }));
      iconUpload.onclick = () => iconFile.click();
      iconUrl.addEventListener('change', () => {
        const value = iconUrl.value.trim();
        if (!value) return save({ favicon: null });
        const valid = appearanceImage(value);
        if (!valid) { toast('Enter a valid http or https image URL', true); return; }
        save({ favicon: valid });
      });
      iconFile.onchange = async () => {
        const file = iconFile.files && iconFile.files[0]; iconFile.value = '';
        if (!file) return;
        try {
          const value = await processAvatar(file);
          if (!appearanceImage(value)) throw new Error('That image is too large for a browser tab icon');
          iconUrl.value = '';
          await save({ favicon: value });
        } catch (e) { toast(e.message || 'Could not use that image', true); }
      };
      reset.onclick = async () => {
        clearTimeout(timer);
        background.value = '#000000'; iconUrl.value = ''; font.value = 'default';
        await save({ background: null, favicon: null, font: null });
      };
      const publicSettingsBody = el('div', { class: 'public-settings-form' },
        el('div', { class: 'muted', style: 'font-size:13px' }, 'Set the site-wide defaults for background color, browser tab icon, and font. Connected visitors update immediately.'),
        el('div', { class: 'public-setting-row' }, el('div', null, el('strong', null, 'Background color'), el('div', { class: 'muted', style: 'font-size:12px;margin-top:3px' }, 'Page background for everyone.')), background),
        el('div', { class: 'public-setting-row' }, el('div', null, el('strong', null, 'Tab icon'), el('div', { class: 'muted', style: 'font-size:12px;margin-top:3px' }, 'Upload a small image or use an image URL.')), el('div', { class: 'appearance-icon-controls' }, iconUrl, iconFile, iconUpload)),
        el('div', { class: 'public-setting-row' }, el('div', null, el('strong', null, 'Font'), el('div', { class: 'muted', style: 'font-size:12px;margin-top:3px' }, 'Default font or Pusab.')), font),
        el('div', { class: 'public-setting-actions' }, status, el('span', { class: 'grow' }), reset));
      content.append(publicSettingsBody);
    }

    function announcementsTab() {
      const textIn = el('textarea', { class: 'textarea', rows: 4, maxlength: 500, placeholder: 'Write an announcement for everyone…' });
      const emojiBtn = el('button', { type: 'button', class: 'btn sm', html: I.smile.replace('<svg', '<svg width="16" height="16"'), title: 'Insert emoji', 'aria-label': 'Insert emoji' }, 'Emoji');
      const charCount = el('span', { class: 'muted', style: 'font-size:12px' }, '0 / 500');
      const durationIn = el('input', { class: 'input', type: 'number', min: 1, max: 10080, value: 5, 'aria-label': 'Announcement duration' });
      const unitIn = el('select', { class: 'select', 'aria-label': 'Duration unit' }, [
        el('option', { value: 's' }, 'seconds'), el('option', { value: 'm', selected: true }, 'minutes'),
        el('option', { value: 'h' }, 'hours'), el('option', { value: 'd' }, 'days')
      ]);
      const preview = el('div', { class: 'announcement-preview' });
      const active = el('div', { class: 'announcement-current hidden' });
      const sendBtn = el('button', { class: 'btn primary', onclick: sendAnnouncement }, 'Send to everyone');
      const updatePreview = () => {
        const sender = me() || { name: 'Your profile' };
        const name = el('span', { class: 'announcement-name fx-' + okEffect(sender.effect) }, sender.name || 'Your profile');
        const message = richEl(textIn.value.trim() || 'Your announcement will appear here.');
        message.classList.add('announcement-message');
        preview.replaceChildren(avatarFrom(sender, 38), el('div', { class: 'announcement-copy' },
          el('div', { class: 'announcement-heading' }, name, el('span', { class: 'announcement-label' }, 'Announcement')), message));
      };
      const insertEmoji = (id, kind) => {
        const token = emojiToken(id, kind);
        const start = textIn.selectionStart == null ? textIn.value.length : textIn.selectionStart;
        const end = textIn.selectionEnd == null ? start : textIn.selectionEnd;
        textIn.value = textIn.value.slice(0, start) + token + textIn.value.slice(end);
        const cursor = start + token.length;
        textIn.focus(); textIn.setSelectionRange(cursor, cursor);
        textIn.dispatchEvent(new Event('input', { bubbles: true }));
      };
      emojiBtn.onclick = () => openPicker(emojiBtn, insertEmoji, { title: 'Announcement emojis' });
      textIn.addEventListener('input', () => { charCount.textContent = textIn.value.length + ' / 500'; updatePreview(); });
      unitIn.addEventListener('change', () => {
        const max = { s: 604800, m: 10080, h: 168, d: 7 }[unitIn.value];
        durationIn.max = String(max);
        if (Number(durationIn.value) > max) durationIn.value = String(max);
      });

      const renderActive = () => {
        const a = S.announcement;
        const remaining = Number(a && a.sentAt) + Number(a && a.durationMs) - now();
        active.replaceChildren();
        if (!a || typeof a.text !== 'string' || !Number.isFinite(remaining) || remaining <= 0) {
          active.classList.add('hidden'); return;
        }
        active.classList.remove('hidden');
        const message = richEl(a.text); message.classList.add('announcement-message');
        active.append(el('div', { class: 'announcement-current-head' },
          el('span', null, 'Currently live · ends in ' + fmtDur(remaining)),
          el('button', { class: 'btn sm danger', onclick: async () => {
            try { await db.ref('announcement').remove(); toast('Announcement ended'); }
            catch (e) { reportDbFailure('End announcement', e); }
          } }, 'End announcement')),
          message);
      };
      const onAnnouncement = () => renderActive();
      on('announcement', onAnnouncement);
      detach.push(() => { handlers.announcement = (handlers.announcement || []).filter(fn => fn !== onAnnouncement); });
      const tick = setInterval(renderActive, 1000); detach.push(() => clearInterval(tick));

      async function sendAnnouncement() {
        if (!staffWriteAllowed()) return;
        const text = textIn.value.trim();
        const amount = Number(durationIn.value);
        const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
        const max = { s: 604800, m: 10080, h: 168, d: 7 }[unitIn.value];
        if (!text) { toast('Write an announcement first', true); textIn.focus(); return; }
        if (text.length > 500) { toast('Announcements can be up to 500 characters', true); return; }
        if (!Number.isInteger(amount) || amount < 1 || amount > max) {
          toast('Choose a duration between 1 and ' + max + ' ' + unitIn.options[unitIn.selectedIndex].text, true); durationIn.focus(); return;
        }
        if (!me()) { toast('Set up your profile before sending an announcement', true); return; }
        const sender = me();
        sendBtn.disabled = true;
        try {
          await db.ref('announcement').set({
            id: db.ref().push().key, uid, senderName: sender.name,
            senderEffect: okEffect(sender.effect), senderFrame: okFrame(sender.frame),
            text, durationMs: amount * units[unitIn.value], sentAt: TS
          });
          textIn.value = ''; charCount.textContent = '0 / 500'; updatePreview();
          toast('Announcement sent to everyone');
        } catch (e) { reportDbFailure('Send announcement', e); }
        finally { sendBtn.disabled = false; }
      }

      content.append(
        el('div', { class: 'muted announcement-help' }, 'Send a message to everyone. It appears in a top-center pill and disappears after the duration you set.'),
        el('label', { class: 'label' }, 'Message'),
        el('div', { class: 'announcement-editor' }, textIn,
          el('div', { class: 'announcement-editor-tools' }, emojiBtn, charCount)),
        el('label', { class: 'label' }, 'Duration'),
        el('div', { class: 'announcement-duration' }, durationIn, unitIn),
        el('label', { class: 'label' }, 'Preview'), preview,
        el('div', { class: 'announcement-send-row' }, sendBtn),
        active);
      updatePreview();
      renderActive();
    }

    function openUserTags(id) {
      const userName = (user(id) || {}).name || 'user';
      const available = Object.entries(S.customTags).sort((a, b) => String(a[1].name || '').localeCompare(String(b[1].name || '')));
      const selected = new Set(available.filter(([tagId]) => S.userTags[id] && S.userTags[id][tagId]).map(([tagId]) => tagId));
      const choices = el('div', { class: 'chips' });
      const body = el('div', null,
        el('div', { class: 'muted', style: 'font-size:13px;margin-bottom:12px' }, 'Choose the custom tags shown beside ' + userName + '’s name.'), choices);
      const drawChoices = () => {
        choices.innerHTML = '';
        if (!available.length) { choices.append(el('div', { class: 'empty' }, 'No custom tags yet. Create one in the Tags tab.')); return; }
        available.forEach(([tagId, tag]) => {
          const on = selected.has(tagId);
          choices.append(el('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false',
            onclick: () => { if (selected.has(tagId)) selected.delete(tagId); else selected.add(tagId); drawChoices(); } }, customTagBadge(tag)));
        });
      };
      const m = modal({ title: 'Tags · ' + userName, body, foot: [
        el('button', { class: 'btn sm', onclick: () => m.close() }, 'Cancel'),
        el('button', { class: 'btn sm primary', onclick: async () => {
          if (!staffWriteAllowed()) return;
          try {
            const assignments = {};
            selected.forEach(tagId => { assignments[tagId] = true; });
            if (Object.keys(assignments).length) await db.ref('userTags/' + id).set(assignments);
            else await db.ref('userTags/' + id).remove();
            m.close(); toast('User tags updated');
          } catch (e) { reportDbFailure('Update user tags', e); }
        } }, 'Save tags')
      ] });
      drawChoices();
    }

    function chatTab() {
      const list = el('div');
      const lockdownBtn = el('button', { class: 'btn sm danger', type: 'button' });
      const slowMode = el('select', { class: 'select chat-slow-mode', 'aria-label': 'Public chat slow mode' }, [
        el('option', { value: '0' }, 'Off'), el('option', { value: '2000' }, '2 seconds'),
        el('option', { value: '5000' }, '5 seconds'), el('option', { value: '10000' }, '10 seconds')
      ]);
      const autoLock = el('input', { type: 'checkbox' });
      const protectionStatus = el('div', { class: 'chat-protection-status' });
      const protectionCard = el('div', { class: 'tag-card chat-protection-card' },
        el('div', { class: 'chat-protection-head' },
          el('div', null, el('strong', null, 'Raid protection'), el('div', { class: 'sub' }, 'Lock all public chat channels during a flood. The database rules enforce lockdown.')),
          lockdownBtn),
        el('div', { class: 'chat-protection-options' },
          el('label', { class: 'chat-protection-option' }, el('span', null, 'Slow mode'), slowMode),
          el('label', { class: 'chat-protection-option chat-auto-lock' }, autoLock, el('span', null, 'Automatically lock after 10 new messages arrive within 5 seconds while an authenticated owner or admin is connected.'))),
        protectionStatus);
      const drawProtection = () => {
        const settings = S.chatSettings || {};
        const locked = settings.lockdown === true;
        const allowed = canManageChatSettings();
        lockdownBtn.textContent = locked ? 'Unlock public chat' : 'Lock public chat';
        lockdownBtn.classList.toggle('primary', !locked);
        lockdownBtn.classList.toggle('danger', locked);
        lockdownBtn.disabled = !allowed;
        slowMode.value = String([0, 2000, 5000, 10000].includes(Number(settings.slowModeMs)) ? Number(settings.slowModeMs) : 2000);
        slowMode.disabled = !allowed;
        autoLock.checked = settings.autoLock !== false;
        autoLock.disabled = !allowed;
        protectionStatus.textContent = locked
          ? (settings.autoLocked ? 'Public chat is locked automatically after a message burst.' : 'Public chat is locked by a moderator.')
          : allowed ? 'Public chat is open.' : 'Sign in with an authorized owner/admin account to change protection settings.';
      };
      lockdownBtn.onclick = async () => {
        const locking = S.chatSettings.lockdown !== true;
        const ok = await updateChatSettings({
          lockdown: locking, lockdownAt: locking ? TS : null,
          lockdownBy: locking ? uid : null, autoLocked: false
        });
        if (ok) toast(locking ? 'Public chat locked' : 'Public chat unlocked');
      };
      slowMode.onchange = () => updateChatSettings({ slowModeMs: Number(slowMode.value) });
      autoLock.onchange = () => updateChatSettings({ autoLock: autoLock.checked });
      on('change', drawProtection); detach.push(() => { handlers.change = (handlers.change || []).filter(fn => fn !== drawProtection); });
      drawProtection();
      if (owner) {
        content.append(el('div', { style: 'display:flex;justify-content:flex-end;margin-bottom:10px' },
          el('button', {
            class: 'btn sm danger', onclick: async () => {
              if (!(await confirmBox('Delete every chat message? This cannot be undone.', 'Clear chat', true))) return;
              try {
                const snapshot = await db.ref('messages').once('value');
                const ids = [];
                snapshot.forEach(child => ids.push(child.key));
                for (let start = 0; start < ids.length; start += 250) {
                  const updates = {};
                  ids.slice(start, start + 250).forEach(id => { updates['messages/' + id] = null; });
                  await db.ref().update(updates);
                }
                toast('Chat cleared');
              }
              catch (e) { reportDbFailure('Clear chat', e); }
            }
          }, 'Clear all chat')));
      }
      content.append(protectionCard, list);
      const ref = db.ref('messages').limitToLast(150);
      const cb = ref.on('value', snap => {
        const items = []; snap.forEach(c => { items.push([c.key, c.val()]); });
        items.reverse();
        list.innerHTML = '';
        if (!items.length) list.append(el('div', { class: 'empty' }, 'No messages'));
        items.forEach(([id, msg]) => {
          const allowed = canModerate(msg.uid);
          const preview = (msg.text || '').trim() || (msg.attachments ? '[attachment]' : msg.share ? '[shared post]' : '');
          list.append(el('div', { class: 'mrow' }, avatar(msg.uid, 30, false),
            el('div', { class: 'grow' }, el('div', null, nameTag(msg.uid), el('span', { class: 'sub' }, ' · ' + clock(msg.ts || 0) + (msg.edited ? ' · edited' : ''))),
              el('div', { class: 'txt', title: msg.text || '' }, richEl(preview, 'span'))),
            el('div', { class: 'acts' }, allowed ? [
              el('button', { class: 'btn sm', onclick: () => mod.editMessage(id, msg) }, 'Edit'),
              el('button', { class: 'btn sm danger', onclick: () => mod.deleteMessage(id, msg) }, 'Delete'),
              msg.uid !== uid ? timeoutButton(msg.uid) : null
            ] : protectedTag())));
        });
      });
      detach.push(() => ref.off('value', cb));
    }

    function postsTab() {
      const list = el('div');
      if (owner) {
        const pauseButton = el('button', { class: 'btn sm', type: 'button' });
        const pauseStatus = el('div', { class: 'sub', style: 'margin-top:6px' });
        const pauseCard = el('div', { class: 'tag-card', style: 'margin-bottom:10px' },
          el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:12px' },
            el('div', null, el('strong', null, 'Post publishing'), pauseStatus), pauseButton));
        const drawPostPause = () => {
          const paused = S.postSettings && S.postSettings.paused === true;
          pauseButton.textContent = paused ? 'Resume posts' : 'Pause posts';
          pauseButton.classList.toggle('danger', !paused);
          pauseButton.classList.toggle('primary', paused);
          pauseButton.disabled = !ownerUnlocked();
          pauseStatus.textContent = paused ? 'Posting is paused. Only the owner can create posts.' : 'Anyone can create posts.';
        };
        pauseButton.onclick = async () => {
          if (!ownerUnlocked()) { toast('Sign in to the owner account to change post publishing', true); return; }
          const paused = !(S.postSettings && S.postSettings.paused === true);
          try {
            await db.ref('postSettings').update({ paused, updatedAt: TS });
            toast(paused ? 'Posts paused' : 'Posts resumed');
          } catch (e) { reportDbFailure('Update post publishing', e); }
        };
        on('change', drawPostPause);
        detach.push(() => { handlers.change = (handlers.change || []).filter(fn => fn !== drawPostPause); });
        drawPostPause();
        content.append(pauseCard);

        const clearAll = el('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
          if (!ownerUnlocked()) { toast('Sign in to the owner account before clearing posts', true); return; }
          if (!(await confirmBox('Delete every post, all post comments, and their uploaded attachments? This cannot be undone.', 'Clear all posts', true))) return;
          try {
            const snapshot = await db.ref('posts').once('value');
            const attachments = [];
            snapshot.forEach(child => {
              const post = child.val() || {};
              if (post.attachments) attachments.push(...(Array.isArray(post.attachments) ? post.attachments : Object.values(post.attachments)));
            });
            await db.ref().update({ posts: null, comments: null });
            deleteFiles(attachments);
            toast('All posts and comments cleared');
          } catch (e) { reportDbFailure('Clear all posts', e); }
        } }, 'Clear all posts');
        content.append(el('div', { style: 'display:flex;justify-content:flex-end;margin-bottom:10px' }, clearAll));
      }
      content.append(list);
      const ref = db.ref('posts').limitToLast(100);
      const cb = ref.on('value', snap => {
        const items = []; snap.forEach(c => { items.push([c.key, c.val()]); });
        items.reverse();
        list.innerHTML = '';
        if (!items.length) list.append(el('div', { class: 'empty' }, 'No posts'));
        items.forEach(([id, post]) => {
          const allowed = canModerate(post.uid);
          const cbox = el('div', { class: 'hidden', style: 'margin:-4px 0 10px 44px' });
          const row = el('div', { class: 'mrow' }, avatar(post.uid, 30, false),
            el('div', { class: 'grow' }, el('div', null, nameTag(post.uid), el('span', { class: 'sub' }, ' · ' + clock(post.ts || 0) + ' · ' + (post.commentCount || 0) + ' comments')),
              el('div', { class: 'txt', title: post.text || '' }, (post.title ? post.title + ' — ' : '') + ((post.text || '').trim() || (post.title ? '' : '[media]')))),
            el('div', { class: 'acts' },
              el('button', { class: 'btn sm', onclick: () => toggleComments(id, cbox) }, 'Comments'),
              allowed ? [
                el('button', { class: 'btn sm', onclick: () => mod.editPost(id, post) }, 'Edit'),
                el('button', { class: 'btn sm danger', onclick: () => mod.deletePost(id, post) }, 'Delete')
              ] : protectedTag()));
          list.append(row, cbox);
        });
      });
      detach.push(() => ref.off('value', cb));
    }
    function toggleComments(postId, box) {
      if (!box.classList.contains('hidden')) { box.classList.add('hidden'); box._off && box._off(); return; }
      box.classList.remove('hidden');
      const ref = db.ref('comments/' + postId);
      const cb = ref.on('value', snap => {
        box.innerHTML = '';
        if (!snap.exists()) box.append(el('div', { class: 'sub', style: 'padding:6px' }, 'No comments'));
        snap.forEach(c => {
          const cm = c.val();
          box.append(el('div', { class: 'mrow' }, avatar(cm.uid, 24, false),
            el('div', { class: 'grow' }, nameTag(cm.uid), el('div', { class: 'txt' }, richEl(cm.text || ''))),
            el('div', { class: 'acts' }, canModerate(cm.uid) ? el('button', { class: 'btn sm danger', onclick: () => mod.deleteComment(postId, c.key, cm) }, 'Delete') : protectedTag())));
        });
      });
      box._off = () => ref.off('value', cb);
      detach.push(box._off);
    }
    showTab();
  }

  let requireProfile = false;
  async function init({ page, require = false } = {}) {
    requireProfile = require;
    mountChrome(page);
    await ready;
    if (require && !me()) openProfile({ setup: true });
  }

  window.Orbit = {
    db, TS, now, uid, S, I, el, esc, $, ls,
    on, off, emit, ready, init, dm, staffTag,
    me, user, isOwner, isProtectedOwner, isAdmin, ownerUnlocked, isBanned, timeoutLeft, isOnline, onlineCount, userByName, canModerate, canAct,
    authUid: () => auth.currentUser ? auth.currentUser.uid : null,
    canManageChatSettings, updateChatSettings,
    toast, modal, confirmBox, promptText, chooseDuration,
    messageTools, playMessageSound, notifyIncoming,
    EMOJI_IDS, isEmoji, emojiUrl, emojiImg, STICKER_FILES, isSticker, stickerUrl, stickerImg, emojiToken, openPicker, closePicker,
    richEl, richHTML, mentionsMe,
    avatar, avatarFrom, nameTag, nameFrom, badges, userSig,
    upload, kindOf, ACCEPT, attachmentEl, attachmentsEl, disposeAttachments, deleteFiles, fmtSize, fmtDur,
    reactionsEl, toggleReaction,
    openProfile, openUserCard, openMembers, openStaffPanel, mod, timeoutButton,
    timeAgo, clock
  };
})();
