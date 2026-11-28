/* ============================================================
   Inomesto — версия 1.2. GitHub Pages + Supabase.
   Что нового: на входе три способа — GitHub, Google и ссылка на почту.
   Ошибки входа показываются по-русски прямо на экране.
   ============================================================ */
(function () {
'use strict';

var CFG = window.CONFIG || {};

function isNativeApp() {
  return !!(window.Capacitor &&
    typeof window.Capacitor.isNativePlatform === 'function' &&
    window.Capacitor.isNativePlatform());
}
/* Единый лимит вложений, не выше 50 МиБ. */
var MAX = Math.min(Number(CFG.MAX_FILE_BYTES) || (50 * 1024 * 1024), 50 * 1024 * 1024);

/* --- видимые ошибки: консоль открывать не обязательно --- */
function reportError(msg) {
  var d = document.getElementById('diag');
  if (!d) return;
  d.hidden = false;
  d.textContent = 'Ошибка: ' + String(msg || 'неизвестная').slice(0, 600) + '  (нажмите, чтобы скрыть)';
  d.onclick = function () { d.hidden = true; };
}
window.addEventListener('error', function (e) { reportError(e.message || e.type); });
window.addEventListener('unhandledrejection', function (e) {
  var r = e.reason || {};
  reportError(r.message || String(r));
});

var $  = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
var esc = function (v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};
var nf = function (n) { return new Intl.NumberFormat('ru-RU').format(n || 0); };
var sizeF = function (b) { return b >= 1048576 ? (b / 1048576).toFixed(1) + ' МБ' : Math.max(1, Math.round(b / 1024)) + ' КБ'; };
var dateF = function (t) { return new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
var ini = function (n) { return esc(String(n || '?').trim().charAt(0).toUpperCase() || '?'); };

/* ================= ТЕМА ОФОРМЛЕНИЯ ================= */
var THEME_KEY = 'inomesto-theme';

function applyTheme(theme) {
  theme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
  var selector = document.getElementById('themeSelect');
  if (selector) selector.value = theme;
}

var savedTheme = 'light';
try { savedTheme = localStorage.getItem(THEME_KEY) || 'light'; } catch (_) {}
applyTheme(savedTheme);


if (!window.supabase) {
  reportError('Не загрузился клиент Supabase. Проверьте интернет или отключите блокировщик рекламы.');
  return;
}
var sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: !isNativeApp()
  }
});

var ME = null, STAGED = [], FEED = [], FAVORITE_POST_IDS = new Set(), FAVORITE_POSTS = [], FAVORITES_VIEW = false, SIGNED = {}, SIGNED_EXPIRES = {}, AVATAR_URLS = {}, AVATAR_URL_EXPIRES = {}, SPACES = [], SPACE_SEARCH_RESULTS = [], SPACE_MY_ROLES = {}, SPACE_PENDING = {}, SPACE_SEARCH_TIMER = null, CONVS = [];
var CHAT_STAGED = [], CHAT_SENDING = false;
var CHAT_LAST_MESSAGE_AT = {};
var CHAT_LOAD_INFLIGHT = {};
var CONV_LOAD_SEQ = 0;
var PENDING_PUSH_CONVERSATION_ID = null;
var PUSH_CHAT_OPENING = false;
var CHAT_RECORDER = null, CHAT_RECORD_STREAM = null, CHAT_RECORD_PARTS = [], CHAT_RECORD_TIMER = null;
var CHAT_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];


/* ================= ЛОКАЛЬНЫЙ КЕШ =================
   IndexedDB переживает закрытие приложения и перезагрузку устройства.
   Ключи разделены по user_id; при выходе удаляется только кеш текущего аккаунта.
*/
var CACHE_DB_NAME = 'inomesto-local-cache-v1';
var CACHE_DB_PROMISE = null;
function cacheDb() {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  if (CACHE_DB_PROMISE) return CACHE_DB_PROMISE;
  CACHE_DB_PROMISE = new Promise(function (resolve) {
    try {
      var request = indexedDB.open(CACHE_DB_NAME, 1);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'key' });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { resolve(null); };
      request.onblocked = function () { resolve(null); };
    } catch (_) { resolve(null); }
  });
  return CACHE_DB_PROMISE;
}
function cacheKey(kind, id) { return String(ME && ME.id || '') + '|' + kind + '|' + String(id || ''); }
async function cacheGet(kind, id) {
  var db = await cacheDb();
  if (!db || !ME) return null;
  return new Promise(function (resolve) {
    try {
      var tx = db.transaction('items', 'readonly');
      var req = tx.objectStore('items').get(cacheKey(kind, id));
      req.onsuccess = function () { resolve(req.result && req.result.value != null ? req.result.value : null); };
      req.onerror = function () { resolve(null); };
    } catch (_) { resolve(null); }
  });
}
async function cachePut(kind, id, value) {
  var db = await cacheDb();
  if (!db || !ME) return;
  return new Promise(function (resolve) {
    try {
      var tx = db.transaction('items', 'readwrite');
      tx.objectStore('items').put({ key: cacheKey(kind, id), user_id: ME.id, value: value, saved_at: Date.now() });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { resolve(); };
      tx.onabort = function () { resolve(); };
    } catch (_) { resolve(); }
  });
}
async function cacheClearUser(userId) {
  var db = await cacheDb();
  if (!db || !userId) return;
  return new Promise(function (resolve) {
    try {
      var tx = db.transaction('items', 'readwrite');
      var store = tx.objectStore('items');
      var req = store.openCursor();
      req.onsuccess = function () {
        var cursor = req.result;
        if (!cursor) return;
        if (cursor.value && cursor.value.user_id === userId) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { resolve(); };
      tx.onabort = function () { resolve(); };
    } catch (_) { resolve(); }
  });
}

function makeUuid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });
}
var CURRENT_SPACE = null, CURRENT_CONV = null, OPEN = new Set(), poll = null;
var NOTIF_PREFS = { dm_enabled: true, dm_delivery: 'in_app', space_badges: true, comment_badges: true };
var SPACE_UNREAD = {}, CONV_UNREAD = {}, LAST_DM_CHECK = null, notifPoll = null;

var isStaff = function () { return !!(ME && (ME.is_owner || ME.is_coowner)); };
function syncStaffUI() {
  Array.prototype.forEach.call(document.querySelectorAll('.staff-only'), function (el) { el.hidden = !isStaff(); });
}
var isMuted = function () {
  return !!(ME && (ME.muted_forever || (ME.muted_until && new Date(ME.muted_until) > new Date())));
};

function toast(msg) {
  var t = $('#toast');
  if (!t) return;
  t.textContent = String(msg);
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(function () { t.classList.remove('show'); }, 4200);
}
/* одна и та же ошибка выводится и всплывашкой, и полосой сверху */
function fail(msg) { toast(msg); reportError(msg); }

function notificationDefaults() {
  return { dm_enabled: true, dm_delivery: 'in_app', space_badges: true, comment_badges: true };
}

/* ================= ANDROID PUSH ================= */

var nativePushInitialized = false;

async function saveNativePushToken(token) {
  if (!ME || !token) return;

  var result = await sb.from('push_devices').upsert({
    user_id: ME.id,
    token: token,
    platform: 'android',
    updated_at: new Date().toISOString()
  }, { onConflict: 'token' });

  if (result.error) {
    fail('Не удалось сохранить токен push-уведомлений: ' + result.error.message);
  } else {

  }
}

async function registerNativePush(requestPermission) {
  var plugin = window.InomestoPushNotifications;

  if (!isNativeApp() || !plugin || !ME) return;

  try {
    var permission = await plugin.checkPermissions();

    if (permission.receive !== 'granted' && requestPermission) {
      permission = await plugin.requestPermissions();
    }

    if (permission.receive !== 'granted') {
      if (requestPermission) {
        toast('Разрешение на push-уведомления не получено');
      }
      return;
    }

    await plugin.register();

    if (requestPermission) {
      toast('Регистрация push-уведомлений запущена');
    }
  } catch (e) {
    fail('Ошибка регистрации push: ' + (e.message || e));
  }
}

async function initNativePush() {
  if (!isNativeApp() || !ME) return;

  var plugin = window.InomestoPushNotifications;

  if (!plugin) {
    reportError('Не загружен модуль Android Push Notifications. Проверьте push-plugin.js.');
    return;
  }

  if (!nativePushInitialized) {
    nativePushInitialized = true;

    await plugin.addListener('registration', function (token) {
      saveNativePushToken(token.value).catch(function (e) {
        reportError(e.message || e);
      });
    });

    await plugin.addListener('registrationError', function (error) {
      reportError('Firebase не зарегистрировал устройство: ' +
        (error.error || 'неизвестная ошибка'));
    });

    await plugin.addListener('pushNotificationActionPerformed', function (event) {
      var data = (event.notification && event.notification.data) || {};

      if (data.conversation_id) {
        openPushConversation(data.conversation_id);
      }
    });
  }

  var button = $('#enableNativePush');

  if (button) {
    button.onclick = function () {
      registerNativePush(true);
    };
  }

  // Если разрешение уже выдано, повторно регистрируем устройство
  // без нового запроса разрешения.
  await registerNativePush(false);
}

/* ================= END ANDROID PUSH ================= */

async function loadNotificationPrefs() {
  var r = await sb.from('notification_preferences').select('*').eq('user_id', ME.id).maybeSingle();
  if (r.error) {
    if (String(r.error.message || '').indexOf('notification_preferences') >= 0) toast('Для синхронизации уведомлений выполните notifications-migration.sql в Supabase');
    else fail('Настройки уведомлений не загрузились: ' + r.error.message);
    NOTIF_PREFS = notificationDefaults();
  } else if (!r.data) {
    NOTIF_PREFS = notificationDefaults();
    var ins = await sb.from('notification_preferences').insert(Object.assign({ user_id: ME.id }, NOTIF_PREFS));
    if (ins.error) fail('Не удалось создать настройки уведомлений: ' + ins.error.message);
  } else {
    NOTIF_PREFS = { dm_enabled: r.data.dm_enabled !== false, dm_delivery: r.data.dm_delivery || 'in_app',
      space_badges: r.data.space_badges !== false, comment_badges: r.data.comment_badges !== false };
  }
  renderNotificationSettings();
}
function renderNotificationSettings() {
  if ($('#notifDmEnabled')) $('#notifDmEnabled').checked = !!NOTIF_PREFS.dm_enabled;
  if ($('#notifSpaceBadges')) $('#notifSpaceBadges').checked = !!NOTIF_PREFS.space_badges;
  if ($('#notifCommentBadges')) $('#notifCommentBadges').checked = !!NOTIF_PREFS.comment_badges;
  if ($('#notifDmDelivery')) $('#notifDmDelivery').value = NOTIF_PREFS.dm_delivery || 'in_app';
}
async function saveNotificationPrefs() {
  var next = { dm_enabled: $('#notifDmEnabled').checked, dm_delivery: $('#notifDmDelivery').value,
    space_badges: $('#notifSpaceBadges').checked, comment_badges: $('#notifCommentBadges').checked };
  var r = await sb.from('notification_preferences').upsert(Object.assign({ user_id: ME.id }, next), { onConflict: 'user_id' });
  if (r.error) return fail('Не удалось сохранить настройки: ' + r.error.message);
  NOTIF_PREFS = next; toast('Настройки уведомлений сохранены');
  await refreshSpaceUnreadCounts(); renderSpaceList();
}
async function requestBrowserNotifications() {
  if (!('Notification' in window)) return toast('Этот браузер не поддерживает уведомления');
  var p = await Notification.requestPermission();
  toast(p === 'granted' ? 'Уведомления браузера разрешены' : 'Разрешение на уведомления не получено');
}
function deliverDmNotification(m) {
  if (!NOTIF_PREFS.dm_enabled) return;
  var method = NOTIF_PREFS.dm_delivery || 'in_app';
  var title = (m.profiles || {}).display_name || 'Новое сообщение';
  var body = String(m.body || 'Вам пришло сообщение').slice(0, 120);
  if ((method === 'in_app' || method === 'both') && document.visibilityState === 'visible') toast(title + ': ' + body);
  if ((method === 'browser' || method === 'both') && 'Notification' in window && Notification.permission === 'granted') {
    var n = new Notification(title, { body: body, tag: 'inomesto-dm-' + m.conversation_id });
    n.onclick = function () { window.focus(); showTab('chats'); loadConversations().then(function () { openConv(m.conversation_id); }); n.close(); };
  }
}
async function pollPersonalMessages() {
  if (!ME) return;
  if (!LAST_DM_CHECK) { LAST_DM_CHECK = new Date().toISOString(); return; }
  try {
    var since = LAST_DM_CHECK;
    var mem = await sb.from('conversation_members').select('conversation_id').eq('user_id', ME.id);
    var ids = (mem.data || []).map(function (x) { return x.conversation_id; });
    if (!ids.length) { LAST_DM_CHECK = new Date().toISOString(); return; }
    var cs = await sb.from('conversations').select('id').in('id', ids).eq('is_support', false);
    var dmIds = (cs.data || []).map(function (x) { return x.id; });
    if (!dmIds.length) { LAST_DM_CHECK = new Date().toISOString(); return; }
    var r = await sb.from('messages').select('id,conversation_id,body,sender_id,created_at,profiles(display_name)')
      .in('conversation_id', dmIds).neq('sender_id', ME.id).gt('created_at', since)
      .order('created_at', { ascending: true }).limit(30);
    LAST_DM_CHECK = new Date().toISOString();
    (r.data || []).forEach(function (m) {
      if (!CURRENT_CONV || CURRENT_CONV.id !== m.conversation_id || !$('#pane-chats').classList.contains('active') || document.visibilityState !== 'visible') deliverDmNotification(m);
    });
  } catch (e) { /* polling не должен прерывать работу сайта */ }
}
function startNotificationPolling() {
  if (notifPoll) clearInterval(notifPoll);
  LAST_DM_CHECK = new Date().toISOString();
  notifPoll = setInterval(pollPersonalMessages, 8000);
}
async function markRead(scopeType, scopeId) {
  if (!ME || !scopeId) return;
  var r = await sb.from('notification_cursors').upsert({ user_id: ME.id, scope_type: scopeType,
    scope_id: scopeId, last_seen_at: new Date().toISOString() }, { onConflict: 'user_id,scope_type,scope_id' });
  if (r.error) console.warn(r.error.message);
}
async function markSpaceRead(spaceId) {
  await Promise.all([markRead('space_posts', spaceId), markRead('space_comments', spaceId)]);
}
async function refreshSpaceUnreadCounts() {
  if (!ME) return;
  var memberships = await sb.from('space_members').select('space_id').eq('user_id', ME.id);
  var ids = (memberships.data || []).map(function (m) { return m.space_id; }).filter(Boolean);
  SPACE_UNREAD = {};
  if (!ids.length) return;
  var curs = await sb.from('notification_cursors').select('scope_type,scope_id,last_seen_at')
    .eq('user_id', ME.id).in('scope_id', ids);
  var cursorMap = {};
  (curs.data || []).forEach(function (v) { cursorMap[v.scope_type + ':' + v.scope_id] = v.last_seen_at; });
  var missing = ids.filter(function (id) { return !cursorMap['space_posts:' + id] || !cursorMap['space_comments:' + id]; });
  for (var mi = 0; mi < missing.length; mi++) await markSpaceRead(missing[mi]);
  missing.forEach(function (id) { var stamp = new Date().toISOString(); cursorMap['space_posts:' + id] = stamp; cursorMap['space_comments:' + id] = stamp; });
  var posts = await sb.from('posts').select('id,space_id,author_id,created_at,comments(id,author_id,created_at)')
    .in('space_id', ids).order('created_at', { ascending: false }).limit(1000);
  if (posts.error) return;
  (posts.data || []).forEach(function (p) {
    if (!SPACE_UNREAD[p.space_id]) SPACE_UNREAD[p.space_id] = { posts: 0, comments: 0 };
    var u = SPACE_UNREAD[p.space_id];
    if (p.author_id !== ME.id && new Date(p.created_at) > new Date(cursorMap['space_posts:' + p.space_id])) u.posts++;
    (p.comments || []).forEach(function (cm) {
      if (cm.author_id !== ME.id && new Date(cm.created_at) > new Date(cursorMap['space_comments:' + p.space_id])) u.comments++;
    });
  });
}
function showScreen(id) {
  $$('.screen').forEach(function (s) { s.classList.remove('active'); });
  var el = document.getElementById('screen-' + id);
  if (el) el.classList.add('active');
}

function animateInomestoElement(el, fromX, fromY, duration) {
  if (!el || !el.animate) return;

  if (window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  el.animate([
    {
      opacity: 0,
      transform: 'translate3d(' + fromX + 'px,' + fromY + 'px,0)'
    },
    {
      opacity: 1,
      transform: 'translate3d(0,0,0)'
    }
  ], {
    duration: duration || 250,
    easing: 'cubic-bezier(.22,1,.36,1)'
  });
}

function showTab(name, skipChatLoad) {
  if (name !== 'spaces') document.body.classList.remove('channel-open');

  if (name === 'mod' && !isStaff()) {
    toast('У вас нет доступа к панели модерации');
    name = 'feed';
  }

  var previousPane = document.querySelector('.pane.active');
  var pane = document.getElementById('pane-' + name);
  var changed = pane && pane !== previousPane;

  Array.prototype.forEach.call(document.querySelectorAll('.pane'), function (p) {
    p.classList.remove('active');
  });

  if (pane) {
    pane.classList.add('active');
    if (changed) animateInomestoElement(pane, 0, 12, 240);
  }

  $$('[data-tab]').forEach(function (b) {
    b.classList.toggle('active', b.dataset.tab === name);
  });

  window.scrollTo(0, 0);

  if (name === 'feed') { CURRENT_SPACE = null; loadFeed(); }
  if (name === 'spaces') loadSpaces();
  if (name === 'chats' && !skipChatLoad) loadConversations();
  if (name === 'me') renderMe();
  if (name === 'mod') loadModeration();
}

async function openPushConversation(id) {
  if (!id) return;
  PENDING_PUSH_CONVERSATION_ID = String(id);

  if (!ME || PUSH_CHAT_OPENING) return;

  PUSH_CHAT_OPENING = true;
  try {
    showScreen('app');
    showTab('chats', true);

    await loadConversations();

    if (!ME) return;

    var exists = CONVS.some(function (c) {
      return String(c.id) === String(id);
    });

    if (exists) {
      await openConv(id);
      PENDING_PUSH_CONVERSATION_ID = null;
    }
  } catch (e) {
    fail('Не удалось открыть чат из уведомления: ' + (e.message || e));
  } finally {
    PUSH_CHAT_OPENING = false;
  }
}

/* ================= ВХОД ================= */
var PROV = CFG.PROVIDERS || { github: true, google: true, email: true };
var PROV_RU = { github: 'GitHub', google: 'Google', email: 'почту' };

/* Supabase отдаёт текст ошибки по-английски, иногда целым JSON — переводим в понятное. */
function humanAuthError(raw) {
  var msg = String(raw || '').trim();
  try { var j = JSON.parse(msg); msg = j.msg || j.error_description || j.error || msg; } catch (e) {}
  if (/unsupported provider/i.test(msg)) {
    return 'Этот способ входа не включён в Supabase. Откройте Authentication → Providers, включите провайдера и вставьте Client ID и Secret.';
  }
  if (/redirect|not allowed|invalid.*url|url.*invalid/i.test(msg)) {
    return 'Адрес сайта не разрешён в Supabase. Authentication → URL Configuration: добавьте его в Site URL и в Redirect URLs.';
  }
  if (/rate limit|too many/i.test(msg)) {
    return 'Слишком много попыток. Подождите минуту и повторите.';
  }
  return 'Вход не сработал: ' + msg;
}

/* ================= АДРЕС ВОЗВРАТА ================= */
/* Куда Supabase вернёт после входа. Если SITE_URL в config.js пуст — берём адрес страницы. */
function siteUrl() {
  var u = String(CFG.SITE_URL || '').trim();
  if (u) return u;
  return location.origin + location.pathname;
}

var NATIVE_REDIRECT_URL = 'com.inomesto.app://auth/callback';
var NATIVE_HANDOFF_URL = 'com.inomesto.app://auth/handoff';
var NATIVE_WEB_CALLBACK_URL = siteUrl().replace(/\/+$/, '') + '/auth-callback.html';
var nativeAuthHandled = false;

var nativeHandoffHandled = false;

async function handleNativeHandoffUrl(url) {
  if (!isNativeApp() || !url || url.indexOf(NATIVE_HANDOFF_URL) !== 0 || nativeHandoffHandled) return;
  nativeHandoffHandled = true;
  try {
    var parsed = new URL(url);
    var code = parsed.searchParams.get('code');
    if (!code || code.length > 200) throw new Error('В ссылке отсутствует код передачи входа.');

    var redemption = await sb.functions.invoke('redeem-app-handoff', { body: { code: code } });
    if (redemption.error) throw redemption.error;
    if (!redemption.data || !redemption.data.email || !redemption.data.token_hash) {
      throw new Error('Код истёк или уже был использован. Вернитесь на сайт и создайте новую ссылку.');
    }

    var verified = await sb.auth.verifyOtp({
      email: redemption.data.email,
      token_hash: redemption.data.token_hash,
      type: 'magiclink'
    });
    if (verified.error) throw verified.error;

    try { await window.NativeAuthBridge.Browser.close(); } catch (_) {}
  } catch (e) {
    nativeHandoffHandled = false;
    fail('Не удалось перенести вход в приложение: ' + (e.message || e));
  }
}

async function handleNativeAuthUrl(url) {
  if (!isNativeApp() || !url) return;
  if (url.indexOf(NATIVE_HANDOFF_URL) === 0) {
    await handleNativeHandoffUrl(url);
    return;
  }
  if (url.indexOf(NATIVE_REDIRECT_URL) !== 0 || nativeAuthHandled) return;

  nativeAuthHandled = true;

  try {
    var parsed = new URL(url);
    var error = parsed.searchParams.get('error_description') ||
                parsed.searchParams.get('error');

    if (error) throw new Error(error);

    var code = parsed.searchParams.get('code');

    if (code) {
      var result = await sb.auth.exchangeCodeForSession(code);
      if (result.error) throw result.error;
    } else {
      var h = new URLSearchParams(String(parsed.hash || '').replace(/^#/, ''));
      var at = h.get('access_token');
      var rt = h.get('refresh_token');

      if (!at || !rt) {
        throw new Error('Не найден код авторизации в ссылке возврата.');
      }

      var sessionResult = await sb.auth.setSession({
        access_token: at,
        refresh_token: rt
      });

      if (sessionResult.error) throw sessionResult.error;
    }

    try {
      await window.NativeAuthBridge.Browser.close();
    } catch (_) {}
  } catch (e) {
    nativeAuthHandled = false;
    fail('Не удалось завершить вход: ' + (e.message || e));
  }
}

async function setupNativeAuth() {
  if (!isNativeApp() || !window.NativeAuthBridge) return;

  await window.NativeAuthBridge.App.addListener('appUrlOpen', function (event) {
    handleNativeAuthUrl(event.url);
  });

  var launch = await window.NativeAuthBridge.App.getLaunchUrl();
  if (launch && launch.url) {
    await handleNativeAuthUrl(launch.url);
  }
}

function hashParams() {
  return new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
}

/* Supabase возвращает токен в адресе после #. Обычно клиент читает его сам,
   но если не прочитал — ставим сессию вручную, чтобы вход не терялся. */
async function adoptHashSession() {
  var h = hashParams();
  var at = h.get('access_token'), rt = h.get('refresh_token');
  if (!at || !rt) return false;
  var r = await sb.auth.setSession({ access_token: at, refresh_token: rt });
  history.replaceState({}, '', location.pathname + location.search);
  if (r.error) { fail('Вход получен, но не применился: ' + r.error.message); return false; }
  return true;
}

async function signIn(provider) {
  if (PROV[provider] === false) {
    return fail('Вход через ' + (PROV_RU[provider] || provider) + ' выключен в файле config.js');
  }

  if (isNativeApp() && window.NativeAuthBridge) {
    try {
      var result = await sb.auth.signInWithOAuth({
        provider: provider,
        options: {
          redirectTo: NATIVE_WEB_CALLBACK_URL,
          skipBrowserRedirect: true
        }
      });

      if (result.error) throw result.error;
      if (!result.data || !result.data.url) {
        throw new Error('Supabase не вернул ссылку для входа.');
      }

      await window.NativeAuthBridge.Browser.open({ url: result.data.url });
    } catch (e) {
      fail(humanAuthError(e.message || e));
    }
    return;
  }

  var back = siteUrl();
  sb.auth.signInWithOAuth({ provider: provider, options: { redirectTo: back } })
    .then(function (r) { if (r.error) fail(humanAuthError(r.error.message)); });
}

if ($('#signInGitHub')) $('#signInGitHub').onclick = function () { signIn('github'); };
if ($('#signInGoogle')) $('#signInGoogle').onclick = function () { signIn('google'); };

async function signInWithUsername() {
  var username = ($('#loginUsername').value || '').trim().toLowerCase();
  var password = $('#loginPassword').value || '';
  if (!username || !password) return toast('Введите username и пароль');
  var button = $('#signInUsername');
  button.disabled = true;
  button.textContent = 'Входим…';
  try {
    var result = await sb.functions.invoke('username-login', { body: { username: username, password: password } });
    if (result.error || !result.data || !result.data.access_token || !result.data.refresh_token) {
      throw new Error((result.data && result.data.error) || (result.error && result.error.message) || 'Неверный username или пароль');
    }
    var session = await sb.auth.setSession({
      access_token: result.data.access_token,
      refresh_token: result.data.refresh_token
    });
    if (session.error) throw session.error;
  } catch (e) {
    fail(e.message || 'Не удалось войти');
  } finally {
    button.disabled = false;
    button.textContent = 'Войти';
  }
}
if ($('#signInUsername')) $('#signInUsername').onclick = signInWithUsername;

if ($('#signInEmail')) $('#signInEmail').onclick = async function () {
  try {
    var em = ($('#emailInput').value || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return toast('Введите адрес почты');
    var r = await sb.auth.signInWithOtp({
      email: em,
      options: { emailRedirectTo: siteUrl(), shouldCreateUser: true }
    });
    if (r.error) return fail(humanAuthError(r.error.message));
    $('#authHint').textContent = 'Ссылка отправлена на ' + em + '. Откройте письмо и нажмите кнопку — вход произойдёт сам.';
    toast('Письмо отправлено');
  } catch (e) { fail(e.message || e); }
};

if ($('#signOut')) $('#signOut').onclick = async function () { var userId = ME && ME.id; $('#signOut').disabled = true; try { if (userId) {
  await sb.from('push_devices').delete().eq('user_id', userId);
  await cacheClearUser(userId);
} var out = await sb.auth.signOut(); if (out.error) throw out.error; location.reload(); } catch (e) { $('#signOut').disabled = false; fail('Не удалось выйти из аккаунта: ' + (e.message || e)); } };

if ($('#saveAccountPassword')) $('#saveAccountPassword').onclick = async function () {
  var password = $('#accountPassword').value || '';
  var again = $('#accountPasswordAgain').value || '';
  if (password.length < 8) return toast('Пароль должен содержать минимум 8 символов');
  if (password !== again) return toast('Пароли не совпадают');
  try {
    var changed = await sb.auth.updateUser({ password: password });
    if (changed.error) throw changed.error;
    var saved = await sb.from('profiles').update({ password_login_enabled: true }).eq('id', ME.id);
    if (saved.error) throw saved.error;
    ME.password_login_enabled = true;
    $('#accountPassword').value = '';
    $('#accountPasswordAgain').value = '';
    toast('Пароль Inomesto сохранён');
  } catch (e) { fail('Не удалось изменить пароль: ' + (e.message || e)); }
};

/* Передача текущей веб-сессии в Android через короткоживущий одноразовый код. */
if ($('#openNativeApp')) $('#openNativeApp').onclick = async function () {
  var button = $('#openNativeApp');
  button.disabled = true;
  button.textContent = 'Готовим вход…';
  try {
    var current = await sb.auth.getSession();
    if (!current.data || !current.data.session) throw new Error('Сначала войдите на сайт.');
    var handoff = await sb.functions.invoke('create-app-handoff', { body: {} });
    if (handoff.error) throw handoff.error;
    if (!handoff.data || !handoff.data.code) throw new Error('Сервер не вернул код передачи входа.');
    window.location.href = 'com.inomesto.app://auth/handoff?code=' + encodeURIComponent(handoff.data.code);
  } catch (e) {
    button.disabled = false;
    button.textContent = 'Открыть приложение';
    fail('Не удалось открыть приложение: ' + (e.message || e));
  }
};

/* Прячем кнопки способов, которые выключены в config.js */
if (PROV.github === false && $('#signInGitHub')) $('#signInGitHub').hidden = true;
if (PROV.google === false && $('#signInGoogle')) $('#signInGoogle').hidden = true;
if (PROV.email  === false && $('#signInEmail'))  $('#signInEmail').hidden = true;

/* Supabase умеет присылать ошибку прямо в адресе страницы — покажем её по-русски. */
function checkUrlErrors() {
  var q = new URLSearchParams(location.search || '');
  var h = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
  var msg = q.get('error_description') || h.get('error_description') ||
            q.get('msg') || h.get('msg') || q.get('error_code') || h.get('error_code') ||
            q.get('error') || h.get('error');
  if (!msg) return false;
  fail(humanAuthError(decodeURIComponent(String(msg).replace(/\+/g, ' '))));
  history.replaceState({}, '', location.pathname);
  return true;
}

async function boot() {
  checkUrlErrors();
  var s = await sb.auth.getSession();
  if (!s.data.session) {
    if (await adoptHashSession()) s = await sb.auth.getSession();
  }
  if (!s.data.session) {
    if (!isNativeApp() && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      reportError('Сайт открыт на localhost. Значит в Supabase → Authentication → URL Configuration в поле Site URL до сих пор стоит http://localhost:3000. Замените его на адрес сайта и добавьте тот же адрес в Redirect URLs.');
    }
    showScreen('auth');
    return;
  }
  await afterLogin(s.data.session.user);
}

/* Если вход случился уже после загрузки страницы — дорисовываем интерфейс. */
sb.auth.onAuthStateChange(function (event, session) {
  if (event === 'SIGNED_IN' && session && (!ME || ME.id !== session.user.id)) {
    afterLogin(session.user).catch(function (e) { fail(e.message || e); });
  }
});

async function afterLogin(user) {
  var r = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (r.error) {
    fail('Не читается таблица profiles: ' + r.error.message + '. Выполнен ли SQL-скрипт из supabase-schema.sql?');
    showScreen('auth'); return;
  }
  ME = r.data;
  if (!ME) {
    var md = user.user_metadata || {};
    var email = user.email || '';
    var ins = await sb.from('profiles').insert({
      id: user.id,
      display_name: md.full_name || md.name || md.user_name || md.preferred_username || email.split('@')[0],
      username: null,
      avatar_url: md.avatar_url || null
    }).select().maybeSingle();
    if (ins.error) { fail('Профиль не создался: ' + ins.error.message); showScreen('auth'); return; }
    ME = ins.data;
  }
  if (!ME.username || !ME.password_login_enabled) {
    showScreen('onboarding');
    $('#obName').value = ME.display_name || '';
    $('#obUser').value = ME.username || '';
    $('#obUser').readOnly = !!ME.username;
    $('#obBio').value = ME.bio || '';
    $('#obPassword').value = '';
    $('#obPasswordAgain').value = '';
    var hint = (user.user_metadata && (user.user_metadata.user_name || user.user_metadata.preferred_username)) || '';
    if (!ME.username) $('#obUser').value = String(hint).toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 24);
    $('#onboardingTitle').textContent = ME.username ? 'Создайте пароль Inomesto' : 'Завершите регистрацию';
    $('#onboardingDescription').textContent = ME.username
      ? 'Ваш профиль сохранён. Придумайте пароль, чтобы входить в приложение по username.'
      : 'После входа через Google или GitHub придумайте username и пароль для Inomesto.';
    return;
  }
  await loadNotificationPrefs();
  await loadFavoritePostIds();
  await initNativePush();
  showScreen('app');
  startNotificationPolling();
  syncStaffUI();
  renderIdentity();
  var inviteAccepted = await checkInvite();
  if (PENDING_PUSH_CONVERSATION_ID) {
    await openPushConversation(PENDING_PUSH_CONVERSATION_ID);
  } else if (!inviteAccepted) {
    showTab('feed');
  }
}

function renderIdentity() {
  var b = $('#muteBanner');
  if (!b) return;
  if (isMuted()) {
    b.hidden = false;
    b.textContent = ME.muted_forever
      ? 'Вам запрещено писать и подавать жалобы. Уже начатые личные чаты по-прежнему работают.'
      : 'Мут до ' + dateF(ME.muted_until) + '. Уже начатые личные чаты по-прежнему работают.';
  } else { b.hidden = true; }
}

$('#saveOnboarding').onclick = async function () {
  try {
    var name = $('#obName').value.trim();
    var uname = $('#obUser').value.trim().toLowerCase().replace(/[^a-z0-9_.]/g, '');
    var password = $('#obPassword').value || '';
    var passwordAgain = $('#obPasswordAgain').value || '';
    if (!name) return toast('Введите имя');
    if (uname.length < 3) return toast('Username: минимум 3 символа латиницей');
    if (password.length < 8) return toast('Пароль должен содержать минимум 8 символов');
    if (password !== passwordAgain) return toast('Пароли не совпадают');
    var updated = await sb.auth.updateUser({ password: password });
    if (updated.error) return fail('Не удалось сохранить пароль: ' + updated.error.message);
    var r = await sb.from('profiles').update({
      display_name: name, username: uname, bio: $('#obBio').value.trim(),
      password_login_enabled: true
    }).eq('id', ME.id).select().maybeSingle();
    if (r.error) return toast(r.error.message.indexOf('duplicate') >= 0 ? 'Этот username уже занят' : r.error.message);
    ME = r.data;
    await loadNotificationPrefs();
  await loadFavoritePostIds();
  await initNativePush();
    showScreen('app');
    startNotificationPolling();
    syncStaffUI();
    renderIdentity();
    var inviteAccepted = await checkInvite();
    if (!inviteAccepted) showTab('feed');
  } catch (e) { fail(e.message || e); }
};

/* ================= ВЛОЖЕНИЯ ================= */
function addStaged(files) {
  if (!ME) return toast('Сначала войдите в аккаунт');
  Array.prototype.forEach.call(files, function (f) {
    if ((f.type || '').indexOf('video/') === 0) return toast('Видео прикреплять нельзя');
    if (f.size > MAX) return toast('Файл больше допустимого лимита (' + sizeF(MAX) + '): ' + f.name);
    STAGED.push(f);
  });
  renderStaged();
}
function renderStaged() {
  var html = STAGED.map(function (f, i) {
    return '<span class="stage-chip">' + esc(f.name) + ' · ' + sizeF(f.size) +
      ' <button data-unstage="' + i + '" type="button">×</button></span>';
  }).join('');
  $$('.staged').forEach(function (el) { el.innerHTML = html; });
}
document.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-unstage]');
  if (btn) { STAGED.splice(+btn.dataset.unstage, 1); renderStaged(); }
});
if ($('#pickPhoto')) $('#pickPhoto').onchange = function () { addStaged(this.files); this.value = ''; };
if ($('#pickFile'))  $('#pickFile').onchange  = function () { addStaged(this.files); this.value = ''; };

async function uploadStaged() {
  var out = [];
  for (var i = 0; i < STAGED.length; i++) {
    var f = STAGED[i];
    var clean = f.name.replace(/[^\w.\-]+/g, '_').slice(-60) || 'file';
    var path = ME.id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + clean;
    var up = await sb.storage.from('attachments').upload(path, f, {
      contentType: f.type || 'application/octet-stream', upsert: false
    });
    if (up.error) throw new Error('Не загрузилось «' + f.name + '»: ' + up.error.message +
      (String(up.error.message).indexOf('size') >= 0 ? ' (на бесплатном тарифе лимит 50 МБ)' : ''));
    out.push({ path: path, name: f.name, size: f.size, mime: f.type || '' });
  }
  return out;
}

async function signPaths(items) {
  var paths = [];
  items.forEach(function (p) { (p.post_attachments || []).forEach(function (a) {
    if (a.path && (!SIGNED[a.path] || !SIGNED_EXPIRES[a.path] || SIGNED_EXPIRES[a.path] < Date.now() + 300000)) paths.push(a.path);
  }); });
  paths = Array.from(new Set(paths)); if (!paths.length) return;
  var r = await sb.storage.from('attachments').createSignedUrls(paths, 3600);
  if (r.error) throw new Error('Не удалось обновить ссылки на вложения: ' + r.error.message);
  (r.data || []).forEach(function (s) { if (s && s.signedUrl && s.path) { SIGNED[s.path] = s.signedUrl; SIGNED_EXPIRES[s.path] = Date.now() + 3300000; } });
}

/* ================= ПОСТЫ ================= */
var POST_SELECT =
  'id,content,created_at,comments_enabled,author_id,space_id,' +
  'author:profiles!posts_author_id_fkey(display_name,username,is_verified,avatar_url),' +
  'post_attachments(id,path,name,size,mime),' +
  'post_likes(user_id),' +
  'comments(id,content,created_at,author_id,author:profiles!comments_author_id_fkey(display_name,username))';

function postHtml(p) {
  var a = p.author || {};
  var atts = p.post_attachments || [];
  var imgs = atts.filter(function (x) { return String(x.mime || '').indexOf('image/') === 0; });
  var files = atts.filter(function (x) { return String(x.mime || '').indexOf('image/') !== 0; });
  var likes = (p.post_likes || []).length;
  var liked = (p.post_likes || []).some(function (l) { return l.user_id === ME.id; });
  var comments = p.comments || [];

  var channelPost = !!(p.space_id && p._space && p._space.type === 'channel');
  var displayName = channelPost ? p._space.name : (a.display_name || 'Без имени');
  var displayAvatar = channelPost ? {display_name:p._space.name,avatar_url:p._space.avatar_url} : a;
  var identityButton = channelPost
    ? '<button class="profile-open post-author" data-open-channel="' + esc(p.space_id) + '">' + avatarMarkup(displayAvatar, '') + '<span><strong>' + esc(displayName) + '</strong></span></button>'
    : '<button class="profile-open post-author" data-profile="' + esc(a.username || '') + '">' + avatarMarkup(displayAvatar, '') + '<span><strong>' + esc(displayName) + '</strong></span></button>';
  var html = '<article class="card post"><div class="post-head">' +
    identityButton + '<div class="who grow">' +
    (!channelPost && a.is_verified ? '<span class="badge">✓</span>' : '') +
    (channelPost ? '<div>Канал · ' + dateF(p.created_at) + '</div>' : '<div>@' + esc(a.username || '—') + ' · ' + dateF(p.created_at) + '</div>') +
    '</div>' +
    '<div class="post-menu-wrap">' +
    '<button class="act post-menu-trigger" data-post-menu="' + p.id + '" aria-label="Меню публикации" aria-expanded="false">•••</button>' +
    '<div class="post-menu" data-post-menu-list="' + p.id + '" hidden>' +
    '<button type="button" data-report="' + p.id + '">Пожаловаться на пост</button>' +
    '<button type="button" data-share-post="' + p.id + '">Поделиться постом</button>' +
    '<button type="button" data-favorite-post="' + p.id + '">' +
    (FAVORITE_POST_IDS.has(p.id) ? 'Убрать из избранного' : 'Сохранить в избранное') +
    '</button></div></div></div>';

  if (p.content) html += '<div class="post-text">' + esc(p.content) + '</div>';

  imgs.forEach(function (x) {
    if (SIGNED[x.path]) html += '<img class="post-img" src="' + SIGNED[x.path] + '" alt="' + esc(x.name) + '" loading="lazy">';
  });
  files.forEach(function (x) {
    html += '<a class="post-file" href="' + (SIGNED[x.path] || '#') + '" target="_blank" rel="noopener">' +
      '<div class="space-ico" style="width:36px;height:36px;flex-basis:36px;font-size:11px">' +
      esc((x.name.split('.').pop() || 'файл').toUpperCase().slice(0, 4)) + '</div>' +
      '<div><div><b>' + esc(x.name) + '</b></div><div class="sub">' + sizeF(x.size) + '</div></div></a>';
  });

  html += '<div class="post-actions">' +
    '<button class="act' + (liked ? ' on' : '') + '" data-like="' + p.id + '">♥ ' + nf(likes) + '</button>' +
    '<button class="act" data-cmt="' + p.id + '">Комментарии (' + comments.length + ')</button>' +
    (p.author_id === ME.id || isStaff() ? '<button class="act" data-del="' + p.id + '">Удалить</button>' : '') +
    '</div>';

  if (OPEN.has(p.id)) {
    html += '<div class="comments">';
    if (!p.comments_enabled) {
      html += '<div class="sub">Автор отключил комментарии.</div>';
    } else {
      comments.forEach(function (c) {
        html += '<div class="comment"><button class="profile-open" data-profile="' + esc((c.author || {}).username || '') + '"><b>' + esc((c.author || {}).display_name || 'Участник') + '</b></button> ' + esc(c.content) + '</div>';
      });
      html += '<div class="comment-form"><input data-comment-input="' + p.id + '" placeholder="Комментарий…">' +
        '<button class="btn ghost" data-comment-send="' + p.id + '">Отправить</button></div>';
    }
    html += '</div>';
  }
  return html + '</article>';
}

async function loadFeed() {
  var box = $('#feed');
  if (!box || !ME) return;
  var userId = ME.id;
  box.innerHTML = '<div class="card empty">Загружаем публикации ваших каналов…</div>';
  try {
    var cached = await cacheGet('feed', 'main');
    if (cached && ME && ME.id === userId) {
      FEED = cached;
      await signPaths(FEED);
      var ca = FEED.reduce(function (a,p) { a.push(p.author || {}); if (p._space) a.push({display_name:p._space.name,avatar_url:p._space.avatar_url}); (p.comments || []).forEach(function(c){a.push(c.author || {});}); return a; }, []);
      await signAvatarPaths(ca);
      if (ME && ME.id === userId) box.innerHTML = FEED.length ? FEED.map(postHtml).join('') : '<div class="card empty">Новых публикаций пока нет.</div>';
    }
    var membership = await sb.from('space_members').select('space_id').eq('user_id', userId);
    if (membership.error) throw new Error('Не удалось загрузить подписки: ' + membership.error.message);
    var ids = Array.from(new Set((membership.data || []).map(function(m){return m.space_id;}).filter(Boolean)));
    if (!ids.length) {
      FEED = []; await cachePut('feed','main',[]);
      box.innerHTML = '<div class="card empty"><h3>В вашей ленте пока тихо</h3><p>Подпишитесь на интересные каналы — их новые публикации будут появляться здесь.</p><button class="btn primary" id="feedFindChannelsEmpty">Найти каналы</button></div>';
      var fe = $('#feedFindChannelsEmpty'); if (fe) fe.onclick = function(){showTab('spaces');}; return;
    }
    var spacesResult = await sb.from('spaces').select('id,name,avatar_url,is_archived,type,description,privacy,comments_enabled,owner_id,created_at').in('id',ids).eq('type','channel');
    if (spacesResult.error) throw spacesResult.error;
    var channels = (spacesResult.data || []).filter(function(x){return !x.is_archived;});
    if (!channels.length) { FEED=[]; await cachePut('feed','main',[]); box.innerHTML='<div class="card empty"><h3>Вы пока не подписаны на каналы</h3><p>Найдите каналы и подпишитесь, чтобы видеть их публикации в ленте.</p></div>'; return; }
    var channelIds = channels.map(function(x){return x.id;});
    var postsResult = await sb.from('posts').select(POST_SELECT).in('space_id',channelIds).order('created_at',{ascending:false}).limit(60);
    if (postsResult.error) throw postsResult.error;
    var byId = {}; channels.forEach(function(x){byId[x.id]=x;});
    FEED = postsResult.data || [];
    FEED.forEach(function(p){p._space=byId[p.space_id]||null;p._spaceName=(p._space&&p._space.name)||'Канал';});
    await cachePut('feed','main',FEED.slice(0,5));
    await signPaths(FEED);
    var avatars = FEED.reduce(function(a,p){a.push(p.author||{});if(p._space)a.push({display_name:p._space.name,avatar_url:p._space.avatar_url});(p.comments||[]).forEach(function(c){a.push(c.author||{});});return a;},[]);
    await signAvatarPaths(avatars);
    if (!ME || ME.id !== userId) return;
    box.innerHTML = FEED.length ? FEED.map(postHtml).join('') : '<div class="card empty"><h3>Новых публикаций пока нет</h3><p>Вы подписаны на '+channels.length+' канал(а). Когда там появятся посты, они отобразятся здесь.</p><button class="btn ghost" id="feedOpenChannels">Мои каналы</button></div>';
    var oc=$('#feedOpenChannels'); if(oc) oc.onclick=function(){showTab('spaces');};
  } catch(e) { if (ME && ME.id===userId) fail(e.message || e); }
}
async function loadSpacePosts() {
  var box = $('#spacePosts');
  if (!box || !CURRENT_SPACE || !ME) return;
  var space = CURRENT_SPACE, userId = ME.id;
  var key = space.id;
  try {
    var cached = await cacheGet('space-posts', key);
    if (cached && CURRENT_SPACE && CURRENT_SPACE.id === key && ME && ME.id === userId) {
      var cachedRows = cached;
      await signPaths(cachedRows);
      cachedRows.forEach(function(p){p._space=space;p._spaceName=space.name;});
      var ca = cachedRows.reduce(function(a,p){a.push(p.author||{},{display_name:space.name,avatar_url:space.avatar_url});(p.comments||[]).forEach(function(c){a.push(c.author||{});});return a;},[]);
      await signAvatarPaths(ca);
      if (CURRENT_SPACE && CURRENT_SPACE.id === key) box.innerHTML = cachedRows.length ? cachedRows.map(postHtml).join('') : '<div class="card sub">Публикаций пока нет.</div>';
    }
    var r = await sb.from('posts').select(POST_SELECT).eq('space_id',key).order('created_at',{ascending:false}).limit(60);
    if (r.error) throw r.error;
    var rows = r.data || [];
    await cachePut('space-posts',key,rows.slice(0,5));
    await signPaths(rows);
    rows.forEach(function(p){p._space=space;p._spaceName=space.name;});
    var avatars = rows.reduce(function(a,p){a.push(p.author||{},{display_name:space.name,avatar_url:space.avatar_url});(p.comments||[]).forEach(function(c){a.push(c.author||{});});return a;},[]);
    await signAvatarPaths(avatars);
    if (!CURRENT_SPACE || CURRENT_SPACE.id !== key || !ME || ME.id !== userId) return;
    box.innerHTML = rows.length ? rows.map(postHtml).join('') : '<div class="card sub">Публикаций пока нет.</div>';
    await markSpaceRead(key);
  } catch(e) { if (CURRENT_SPACE && CURRENT_SPACE.id === key) box.innerHTML = '<div class="card sub">' + esc(e.message || e) + '</div>'; }
}
async function publishPost(spaceId) {
  try {
    if (!ME) return toast('Сначала войдите в аккаунт');
    var box = spaceId ? $('#spaceComposerText') : $('#postText');
    var text = ((box && box.value) || '').trim();
    var allowed = spaceId ? $('#spaceAllowComments') : $('#allowComments');
    if (!text && !STAGED.length) return toast('Добавьте текст или вложение');
    if (isMuted()) return toast('Вам сейчас запрещено писать');

    var ins = await sb.from('posts').insert({
      author_id: ME.id, content: text, space_id: spaceId || null,
      comments_enabled: allowed ? allowed.checked : true
    }).select().maybeSingle();
    if (ins.error) return fail('Публикация не создалась: ' + ins.error.message);

    try {
      var atts = await uploadStaged();
      if (atts.length) {
        atts.forEach(function (a) { a.post_id = ins.data.id; });
        var ar = await sb.from('post_attachments').insert(atts);
        if (ar.error) toast('Пост создан, но вложения не привязались: ' + ar.error.message);
      }
    } catch (err) { fail(err.message); }

    STAGED = []; renderStaged();
    if (box) box.value = '';
    toast('Опубликовано');
    if (spaceId) loadSpacePosts(); else loadFeed();
  } catch (e) { fail(e.message || e); }
}
/* Публикации создаются внутри канала или сообщества. */

/* ================= ПРОСТРАНСТВА ================= */
async function loadSpaces() {
  try {
    var mine = await sb.from('space_members').select('space_id,role').eq('user_id', ME.id);
    if (mine.error) { fail('Не удалось загрузить подписки: ' + mine.error.message); return; }
    SPACE_MY_ROLES = {};
    (mine.data || []).forEach(function (m) { SPACE_MY_ROLES[m.space_id] = m.role; });

    var reqs = await sb.from('join_requests').select('space_id,status').eq('user_id', ME.id);
    if (reqs.error) { fail('Не удалось загрузить заявки: ' + reqs.error.message); return; }
    SPACE_PENDING = {};
    (reqs.data || []).forEach(function (q) { SPACE_PENDING[q.space_id] = q.status; });

    var ids = (mine.data || []).map(function (m) { return m.space_id; }).filter(Boolean);
    var rows = [];
    if (ids.length) {
      var r = await sb.from('spaces')
        .select('id,type,name,description,privacy,comments_enabled,is_archived,owner_id,avatar_url,' +
                'owner:profiles!spaces_owner_id_fkey(display_name,username),members:space_members(count)')
        .in('id', ids).order('created_at', { ascending: false });
      if (r.error) { fail('Каналы не загрузились: ' + r.error.message); return; }
      rows = r.data || [];
    }
    SPACES = decorateSpaceRows(rows);
    await signAvatarPaths(SPACES.map(function (s) { return {display_name:s.name,avatar_url:s.avatar_url}; }));
    await refreshSpaceUnreadCounts();
    SPACES.forEach(function (s) { s._unread = SPACE_UNREAD[s.id] || { posts: 0, comments: 0 }; });

    if (CURRENT_SPACE) {
      var found = SPACES.concat(SPACE_SEARCH_RESULTS).filter(function (s) { return s.id === CURRENT_SPACE.id; })[0];
      if (found) { CURRENT_SPACE = found; return openSpace(found); }
    }
    renderSpaceList();
    var searchInput = $('#spaceSearchInput');
    if (searchInput && searchInput.value.trim()) searchSpaces(searchInput.value.trim());
  } catch (e) { fail(e.message || e); }
}

function decorateSpaceRows(rows) {
  return (rows || []).map(function (s) {
    s._myRole = SPACE_MY_ROLES[s.id] || null;
    s._pending = SPACE_PENDING[s.id] === 'pending';
    s._count = (s.members && s.members[0] && s.members[0].count) || 0;
    s._unread = SPACE_UNREAD[s.id] || { posts: 0, comments: 0 };
    return s;
  });
}

async function searchSpaces(value) {
  var term = String(value || '').trim();
  if (!term) { SPACE_SEARCH_RESULTS = []; renderSpaceList(); return; }
  var safe = term.replace(/[^\p{L}\p{N}\s_-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!safe) { SPACE_SEARCH_RESULTS = []; renderSpaceList(); return; }
  try {
    var r = await sb.from('spaces')
      .select('id,type,name,description,privacy,comments_enabled,is_archived,owner_id,avatar_url,' +
              'owner:profiles!spaces_owner_id_fkey(display_name,username),members:space_members(count)')
      .or('name.ilike.%' + safe + '%,description.ilike.%' + safe + '%')
      .order('created_at', { ascending: false }).limit(60);
    if (r.error) { fail('Поиск не удался: ' + r.error.message); return; }
    var input = $('#spaceSearchInput');
    if (!input || input.value.trim() !== term) return;
    SPACE_SEARCH_RESULTS = decorateSpaceRows((r.data || []).filter(function (s) { return !s.is_archived; }));
    await signAvatarPaths(SPACE_SEARCH_RESULTS.map(function (s) { return {display_name:s.name,avatar_url:s.avatar_url}; }));
    renderSpaceList();
  } catch (e) { fail(e.message || e); }
}

function spaceCardHtml(s) {
  var action = s._myRole
    ? ''
    : s._pending
      ? '<span class="badge gray">Заявка отправлена</span>'
      : '<button class="btn primary space-join-btn" data-join="' + s.id + '">' +
        (s.privacy === 'private' ? 'Запросить доступ' : (s.type === 'channel' ? 'Подписаться' : 'Вступить')) +
        '</button>';

  return '<div class="space-row-item" data-open-space="' + s.id + '">' +
    '<div class="space-ico">' +
      (s.avatar_url ? avatarMarkup({display_name:s.name,avatar_url:s.avatar_url}, 'space-avatar') : ini(s.name)) +
    '</div>' +
    '<div class="space-row-content">' +
      '<div class="space-row-title"><b>' + esc(s.name) + '</b>' +
        '<span class="badge gray">' + (s.type === 'channel' ? 'Канал' : 'Сообщество') + '</span>' +
        (s.is_archived ? '<span class="badge gray">В архиве</span>' : '') +
      '</div>' +
      '<div class="sub">' + nf(s._count) + ' участников · ' +
        (s.description ? esc(s.description) : ('владелец @' + esc((s.owner || {}).username || '—'))) +
      '</div>' +
      ((s._unread && ((NOTIF_PREFS.space_badges && s._unread.posts) || (NOTIF_PREFS.comment_badges && s._unread.comments)))
        ? '<div class="unread-pills">' +
          (NOTIF_PREFS.space_badges && s._unread.posts ? '<span class="unread-badge">' + nf(s._unread.posts) + ' новых</span>' : '') +
          (NOTIF_PREFS.comment_badges && s._unread.comments ? '<span class="unread-badge comments">' + nf(s._unread.comments) + ' комментариев</span>' : '') +
        '</div>' : '') +
    '</div>' + action +
  '</div>';
}

function spaceSectionHtml(title, hint, items, emptyText) {
  return '<section class="space-section">' +
    '<div class="space-section-head"><div><h2>' + title + '</h2><p class="muted">' + hint + '</p></div>' +
    '<span class="section-count">' + items.length + '</span></div>' +
    (items.length
      ? '<div class="space-list">' + items.map(spaceCardHtml).join('') + '</div>'
      : '<div class="card empty space-empty">' + emptyText + '</div>') +
    '</section>';
}

function renderSpaceList() {
  FAVORITES_VIEW = false;
  document.body.classList.remove('channel-open');
  CURRENT_SPACE = null;

  var input = $('#spaceSearchInput');
  var term = input ? input.value.trim() : '';

  var html = '<div class="favorite-entry" data-open-favorites="1">' +
    '<span class="favorite-entry-icon">★</span>' +
    '<span class="favorite-entry-text"><b>Избранное</b><small>Сохранённые публикации</small></span>' +
    '<span class="favorite-entry-count">' + FAVORITE_POST_IDS.size + '</span>' +
    '<span class="favorite-entry-arrow">›</span>' +
  '</div>';

  html += spaceSectionHtml('Мои каналы и сообщества', 'Ваши подписки и сообщества', SPACES,
    'Вы пока не подписаны ни на один канал или сообщество. Найдите интересное через поиск выше.');

  if (term) html += spaceSectionHtml('Результаты поиска', 'Каналы и сообщества по вашему запросу', SPACE_SEARCH_RESULTS,
    'Ничего не найдено. Попробуйте другое название или ключевое слово.');

  $('#spaceView').innerHTML = html;
}

if ($('#spaceSearchInput')) {
  $('#spaceSearchInput').addEventListener('input', function () {
    var term = this.value.trim();
    clearTimeout(SPACE_SEARCH_TIMER);
    if (!term) { SPACE_SEARCH_RESULTS = []; renderSpaceList(); return; }
    SPACE_SEARCH_TIMER = setTimeout(function () { searchSpaces(term); }, 320);
  });
}

async function openSpaceById(spaceId) {
  if (CURRENT_SPACE && CURRENT_SPACE.id === spaceId) return openSpace(CURRENT_SPACE);
  var r = await sb.from('spaces').select('id,type,name,description,privacy,comments_enabled,is_archived,owner_id,avatar_url,owner:profiles!spaces_owner_id_fkey(display_name,username),members:space_members(count)').eq('id', spaceId).maybeSingle();
  if (r.error || !r.data) return toast('Канал недоступен или удалён');
  var role = SPACE_MY_ROLES[spaceId] || null;
  if (!role) { var m = await sb.from('space_members').select('role').eq('space_id', spaceId).eq('user_id', ME.id).maybeSingle(); if (!m.error && m.data) role = m.data.role; }
  var s = decorateSpaceRows([r.data])[0]; s._myRole = role;
  showTab('spaces'); await openSpace(s);
}

async function uploadSpaceAvatar(space, file) {
  if (!space || !space.id || !file || !/^image\//i.test(file.type || '')) return toast('Выберите файл изображения');
  if (file.size > 5 * 1024 * 1024) return toast('Аватар канала должен быть не больше 5 МБ');
  var path = ME.id + '/spaces/' + space.id + '/avatar-' + Date.now() + '-' + file.name.replace(/[^\w.-]+/g, '_').slice(-40);
  var up = await sb.storage.from('attachments').upload(path, file, {contentType:file.type,upsert:false});
  if (up.error) return fail('Не удалось загрузить аватар: ' + up.error.message);
  var saved = await sb.from('spaces').update({avatar_url:path}).eq('id',space.id);
  if (saved.error) { await sb.storage.from('attachments').remove([path]); return fail('Не удалось сохранить аватар. Сначала выполните channel-identity-migration.sql: ' + saved.error.message); }
  space.avatar_url = path; delete AVATAR_URLS[path]; delete AVATAR_URL_EXPIRES[path];
  toast('Аватар канала обновлён'); await openSpace(space);
}

async function openSpace(s) {
  CURRENT_SPACE = s;
  await signAvatarPaths([{display_name:s.name,avatar_url:s.avatar_url}]);

  var localAdmin = s._myRole === 'owner' || (s._myRole === 'admin' && !isStaff());
  var adm = localAdmin || isStaff();
  var canPost = s.type === 'channel' ? localAdmin : (!!s._myRole || isStaff());

  if (s.type === 'channel') {
    document.body.classList.add('channel-open');
  } else {
    document.body.classList.remove('channel-open');
  }

  /* Новый интерфейс только для каналов */
  if (s.type === 'channel') {
    var channelAvatar = s.avatar_url
      ? avatarMarkup({display_name:s.name,avatar_url:s.avatar_url}, 'space-avatar')
      : ini(s.name);

    var html = '<div class="channel-layout">' +

      '<section id="channelMainScreen">' +
        '<header class="channel-topbar">' +
          '<button class="channel-back" data-back-spaces="1" aria-label="Назад">←</button>' +
          '<button class="channel-identity" data-channel-info-open="1">' +
            '<span class="channel-avatar">' + channelAvatar + '</span>' +
            '<span class="channel-identity-text">' +
              '<b>' + esc(s.name) + '</b>' +
              '<small>' + nf(s._count) + ' подписчиков</small>' +
            '</span>' +
          '</button>' +
          '<div class="channel-top-actions">' +
            (!s._myRole ? (s._pending
              ? '<span class="badge gray">Заявка отправлена</span>'
              : '<button class="btn primary" data-join="' + s.id + '">Подписаться</button>') : '') +
            (adm ? '<button class="channel-menu-button" id="spaceManageToggle" aria-label="Управление">⋯</button>' : '') +
          '</div>' +
        '</header>' +

        '<div id="spacePosts" class="channel-feed"></div>' +

        (canPost
          ? '<section class="channel-composer" id="channelComposer">' +
              '<div class="channel-composer-main">' +
                '<textarea id="spaceComposerText" rows="2" placeholder="Публикация…"></textarea>' +
              '</div>' +
              '<div class="channel-composer-bottom">' +
                '<div class="channel-composer-tools">' +
                  '<label title="Добавить фото">▧<input type="file" id="spacePickPhoto" accept="image/*" multiple hidden></label>' +
                  '<label title="Прикрепить файл">↥<input type="file" id="spacePickFile" multiple hidden></label>' +
                  '<label class="channel-comments-option"><input type="checkbox" id="spaceAllowComments"' +
                    (s.comments_enabled ? ' checked' : '') + '> Комментарии</label>' +
                '</div>' +
                '<button class="btn primary" id="spacePublish">Опубликовать</button>' +
              '</div>' +
              '<div class="staged" id="stagedSpace"></div>' +
            '</section>'
          : (!s._myRole
              ? '<div class="channel-subscribe-hint">Подпишитесь на канал, чтобы следить за публикациями</div>'
              : '')) +
      '</section>' +

      '<section id="channelInfoScreen" class="channel-info-screen" hidden>' +
        '<header class="channel-info-topbar">' +
          '<button class="channel-back" id="channelInfoClose">←</button>' +
          '<b>Информация о канале</b>' +
        '</header>' +
        '<div class="channel-info-content">' +
          '<div class="channel-info-avatar">' + channelAvatar + '</div>' +
          '<h2>' + esc(s.name) + '</h2>' +
          '<div class="sub">' + nf(s._count) + ' подписчиков</div>' +
          (s.description ? '<p class="channel-info-description">' + esc(s.description) + '</p>' : '<p class="sub">Описание канала не добавлено</p>') +
          (!s._myRole
            ? (s._pending
                ? '<span class="badge gray">Заявка отправлена</span>'
                : '<button class="btn primary channel-info-subscribe" data-join="' + s.id + '">Подписаться</button>')
            : '<span class="badge gray">Вы подписаны</span>') +
          (adm ? '<button class="btn ghost channel-info-manage" id="channelInfoManage">Управление каналом</button>' : '') +
        '</div>' +
      '</section>';

    if (adm) {
      html += '<section class="card space-manage-panel channel-manage-panel" id="spaceManagePanel" hidden>' +
        '<div class="space-manage-heading"><h3>Управление каналом</h3>' +
          '<button class="btn ghost" id="spaceManageClose">Закрыть</button></div>' +
        '<div class="space-manage-tabs">' +
          '<button class="btn primary" data-space-section="basic">Основное</button>' +
          '<button class="btn ghost" data-space-section="members">Участники</button>' +
          (localAdmin ? '<button class="btn ghost" data-space-section="requests">Заявки</button>' : '') +
        '</div>' +
        '<div class="space-manage-section" id="spaceSectionBasic">' +
          (localAdmin
            ? '<label class="space-manage-label">Название канала<input id="spaceEditName" maxlength="80" value="' + esc(s.name) + '"></label>' +
              '<label class="space-manage-label">Описание<textarea id="spaceEditDescription" rows="3" maxlength="500">' + esc(s.description || '') + '</textarea></label>' +
              '<div class="space-manage-actions">' +
                '<label class="btn ghost space-avatar-change">Изменить аватар<input type="file" id="spaceAvatarPick" accept="image/*" hidden></label>' +
                '<button class="btn ghost" data-invite="' + s.id + '">Ссылка-приглашение</button>' +
                '<button class="btn primary" id="spaceSaveSettings">Сохранить изменения</button>' +
                '<button class="btn ghost" data-del-space="' + s.id + '">Удалить канал</button>' +
              '</div>'
            : '<p class="sub">У вас есть права модератора участников этого канала.</p>') +
        '</div>' +
        '<div class="space-manage-section" id="spaceSectionMembers" hidden>' +
          '<h4>Участники и администраторы</h4><div id="memberList" class="sub">Нажмите, чтобы загрузить список.</div>' +
        '</div>' +
        (localAdmin
          ? '<div class="space-manage-section" id="spaceSectionRequests" hidden>' +
              '<h4>Заявки на вступление</h4><div id="requestList" class="sub">Нажмите, чтобы загрузить заявки.</div>' +
            '</div>'
          : '') +
      '</section>';
    }

    html += '</div>';
    $('#spaceView').innerHTML = html;

    if ($('#spacePublish')) $('#spacePublish').onclick = function () { publishPost(s.id); };
    if ($('#spacePickPhoto')) $('#spacePickPhoto').onchange = function () { addStaged(this.files); this.value = ''; };
    if ($('#spacePickFile')) $('#spacePickFile').onchange = function () { addStaged(this.files); this.value = ''; };

    if ($('#channelInfoClose')) {
      $('#channelInfoClose').onclick = function () {
        $('#channelInfoScreen').hidden = true;
        $('#channelMainScreen').hidden = false;
      };
    }

    $$('[data-channel-info-open]').forEach(function (button) {
      button.onclick = function () {
        $('#channelMainScreen').hidden = true;
        $('#channelInfoScreen').hidden = false;
      };
    });

    if ($('#channelInfoManage')) {
      $('#channelInfoManage').onclick = function () {
        $('#channelInfoScreen').hidden = true;
        $('#channelMainScreen').hidden = false;
        $('#spaceManagePanel').hidden = false;
      };
    }

    if ($('#spaceManageToggle')) {
      $('#spaceManageToggle').onclick = function () {
        $('#spaceManagePanel').hidden = false;
      };

      $('#spaceManageClose').onclick = function () {
        $('#spaceManagePanel').hidden = true;
      };

      $$('[data-space-section]').forEach(function (button) {
        button.onclick = function () {
          var section = button.dataset.spaceSection;

          ['basic','members','requests'].forEach(function (name) {
            var el = $('#spaceSection' + name.charAt(0).toUpperCase() + name.slice(1));
            if (el) el.hidden = name !== section;
          });

          $$('[data-space-section]').forEach(function (b) {
            b.className = 'btn ' + (b === button ? 'primary' : 'ghost');
          });

          if (section === 'members') {
            var box = $('#memberList');
            if (box && box.dataset.loaded !== '1') {
              box.textContent = 'Загрузка…';
              loadMembers(s.id, true).then(function () {
                if (box.isConnected) box.dataset.loaded = '1';
              });
            }
          }

          if (section === 'requests') {
            var box = $('#requestList');
            if (box && box.dataset.loaded !== '1') {
              box.textContent = 'Загрузка…';
              loadRequests(s.id).then(function () {
                if (box.isConnected) box.dataset.loaded = '1';
              });
            }
          }
        };
      });
    }

    if ($('#spaceSaveSettings')) {
      $('#spaceSaveSettings').onclick = async function () {
        var name = $('#spaceEditName').value.trim();
        var description = $('#spaceEditDescription').value.trim();
        if (!name) return toast('Введите название канала');

        var save = await sb.from('spaces').update({
          name: name,
          description: description
        }).eq('id', s.id);

        if (save.error) return fail('Не удалось сохранить изменения: ' + save.error.message);

        s.name = name;
        s.description = description;
        CURRENT_SPACE = s;
        toast('Настройки канала сохранены');
        await openSpace(s);
      };
    }

    if ($('#spaceAvatarPick')) {
      $('#spaceAvatarPick').onchange = async function () {
        var f = this.files && this.files[0];
        this.value = '';
        if (f) await uploadSpaceAvatar(s, f);
      };
    }

    loadSpacePosts();
    return;
  }

  /* Прежний интерфейс сообществ — без изменений */
  var html = '<div class="card space-header-card">' +
    '<div class="space-header-actions">' +
    '<button class="btn ghost" data-back-spaces="1">← К списку каналов</button>' +
    '<div class="row gap wrap">' +
    (!s._myRole ? (s._pending
      ? '<span class="badge gray">Заявка отправлена</span>'
      : '<button class="btn primary" data-join="' + s.id + '">' +
        (s.privacy === 'private' ? 'Запросить доступ' : 'Вступить') +
        '</button>') : '') +
    (adm ? '<button class="btn primary" id="spaceManageToggle">Управление</button>' : '') +
    (adm ? '<button class="btn ghost" data-del-space="' + s.id + '">Удалить</button>' : '') +
    '</div></div>' +
    '<div class="space-row space-profile">' +
    '<div class="space-ico">' +
    (s.avatar_url ? avatarMarkup({display_name:s.name,avatar_url:s.avatar_url}, 'space-avatar') : ini(s.name)) +
    '</div><div class="grow">' +
    '<div class="space-title-line"><b>' + esc(s.name) + '</b> ' +
    '<span class="badge gray">Сообщество</span></div>' +
    '<div class="sub">' + nf(s._count) + ' участников · ' +
    (s.comments_enabled ? 'комментарии включены' : 'комментарии отключены') + '</div>' +
    (s.description ? '<div class="space-description">' + esc(s.description) + '</div>' : '') +
    '</div></div></div>';

  if (adm) {
    html += '<section class="card space-manage-panel" id="spaceManagePanel" hidden>' +
      '<div class="space-manage-heading"><h3>Управление сообществом</h3>' +
      '<button class="btn ghost" id="spaceManageClose">Закрыть</button></div>' +
      '<div class="space-manage-tabs">' +
      '<button class="btn primary" data-space-section="basic">Основное</button>' +
      '<button class="btn ghost" data-space-section="members">Участники</button>' +
      (localAdmin ? '<button class="btn ghost" data-space-section="requests">Заявки</button>' : '') +
      '</div>' +
      '<div class="space-manage-section" id="spaceSectionBasic">' +
      (localAdmin
        ? '<label class="space-manage-label">Название<input id="spaceEditName" maxlength="80" value="' + esc(s.name) + '"></label>' +
          '<label class="space-manage-label">Описание<textarea id="spaceEditDescription" rows="3" maxlength="500">' + esc(s.description || '') + '</textarea></label>' +
          '<div class="space-manage-actions">' +
          '<label class="btn ghost space-avatar-change">Изменить аватар<input type="file" id="spaceAvatarPick" accept="image/*" hidden></label>' +
          '<button class="btn ghost" data-invite="' + s.id + '">Ссылка-приглашение</button>' +
          '<button class="btn primary" id="spaceSaveSettings">Сохранить изменения</button></div>'
        : '<p class="sub">У вас есть права модератора участников этого сообщества.</p>') +
      '</div>' +
      '<div class="space-manage-section" id="spaceSectionMembers" hidden>' +
      '<h4>Участники и администраторы</h4><div id="memberList" class="sub">Нажмите, чтобы загрузить список.</div></div>' +
      (localAdmin ? '<div class="space-manage-section" id="spaceSectionRequests" hidden>' +
        '<h4>Заявки на вступление</h4><div id="requestList" class="sub">Нажмите, чтобы загрузить заявки.</div></div>' : '') +
      '</section>';
  }

  if (canPost) {
    html += '<section class="card space-composer-card">' +
      '<div class="space-composer-heading"><div><h3>Новая публикация</h3>' +
      '<p>Поделитесь новостью или задайте вопрос участникам</p></div></div>' +
      '<textarea id="spaceComposerText" class="space-composer-text" rows="4" placeholder="О чём хотите рассказать?"></textarea>' +
      '<div class="staged" id="stagedSpace"></div>' +
      '<div class="space-composer-footer"><div class="space-composer-tools">' +
      '<label class="space-tool"><input type="file" id="spacePickPhoto" accept="image/*" multiple hidden><span>▧</span> Фото</label>' +
      '<label class="space-tool"><input type="file" id="spacePickFile" multiple hidden><span>↥</span> Файл</label>' +
      '<label class="space-comments-toggle"><input type="checkbox" id="spaceAllowComments"' +
      (s.comments_enabled ? ' checked' : '') + '> Комментарии</label>' +
      '</div><button class="btn primary space-publish-btn" id="spacePublish">Опубликовать</button></div>' +
      '<div class="space-composer-note">Можно прикрепить фото или файл размером до 100 МБ</div></section>';
  }

  html += '<div id="spacePosts"></div>';
  $('#spaceView').innerHTML = html;

  if ($('#spacePublish')) $('#spacePublish').onclick = function () { publishPost(s.id); };
  if ($('#spacePickPhoto')) $('#spacePickPhoto').onchange = function () { addStaged(this.files); this.value = ''; };
  if ($('#spacePickFile')) $('#spacePickFile').onchange = function () { addStaged(this.files); this.value = ''; };

  if ($('#spaceManageToggle')) {
    $('#spaceManageToggle').onclick = function () {
      var panel = $('#spaceManagePanel');
      panel.hidden = !panel.hidden;
    };
    $('#spaceManageClose').onclick = function () { $('#spaceManagePanel').hidden = true; };

    $$('[data-space-section]').forEach(function (button) {
      button.onclick = function () {
        var section = button.dataset.spaceSection;
        ['basic','members','requests'].forEach(function (name) {
          var el = $('#spaceSection' + name.charAt(0).toUpperCase() + name.slice(1));
          if (el) el.hidden = name !== section;
        });
        $$('[data-space-section]').forEach(function (b) {
          b.className = 'btn ' + (b === button ? 'primary' : 'ghost');
        });
        if (section === 'members') {
          var box = $('#memberList');
          if (box && box.dataset.loaded !== '1') {
            box.textContent = 'Загрузка…';
            loadMembers(s.id, true).then(function () { if (box.isConnected) box.dataset.loaded = '1'; });
          }
        }
        if (section === 'requests') {
          var box = $('#requestList');
          if (box && box.dataset.loaded !== '1') {
            box.textContent = 'Загрузка…';
            loadRequests(s.id).then(function () { if (box.isConnected) box.dataset.loaded = '1'; });
          }
        }
      };
    });
  }

  if ($('#spaceSaveSettings')) {
    $('#spaceSaveSettings').onclick = async function () {
      var name = $('#spaceEditName').value.trim();
      var description = $('#spaceEditDescription').value.trim();
      if (!name) return toast('Введите название канала');
      var save = await sb.from('spaces').update({ name:name, description:description }).eq('id', s.id);
      if (save.error) return fail('Не удалось сохранить изменения: ' + save.error.message);
      s.name = name;
      s.description = description;
      CURRENT_SPACE = s;
      toast('Настройки сохранены');
      await openSpace(s);
    };
  }

  if ($('#spaceAvatarPick')) {
    $('#spaceAvatarPick').onchange = async function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (f) await uploadSpaceAvatar(s, f);
    };
  }

  loadSpacePosts();
}
async function loadMembers(spaceId, admin) {
  var box = $('#memberList');
  if (!box) return;
  var r = await sb.from('space_members')
    .select('user_id,role,banned_forever,profiles(display_name,username,is_verified,avatar_url)')
    .eq('space_id', spaceId).limit(200);
  if (r.error) { box.textContent = r.error.message; return; }
  await signAvatarPaths((r.data || []).map(function (m) { return m.profiles || {}; }));
  box.innerHTML = (r.data || []).map(function (m) {
    var p = m.profiles || {};
    var localAdmin = CURRENT_SPACE && CURRENT_SPACE.id === spaceId &&
      (CURRENT_SPACE._myRole === 'owner' || (CURRENT_SPACE._myRole === 'admin' && !isStaff()));
    var actions = admin && m.role !== 'owner'
      ? '<div class="member-actions" hidden>' +
        (localAdmin ? '<button class="act" data-member-admin="' + spaceId + ':' + m.user_id + '">Назначить администратором</button>' : '') +
        '<button class="act" data-member-kick="' + spaceId + ':' + m.user_id + '">Удалить из канала</button>' +
        '<button class="act" data-member-ban="' + spaceId + ':' + m.user_id + '">Заблокировать навсегда</button></div>'
      : '';
    return '<div class="member-row member-row-user" data-member-row="1">' +
      '<button class="profile-open" data-profile="' + esc(p.username || '') + '">' + avatarMarkup(p, 'sm') + '<span class="member-identity"><b>' + esc(p.display_name || '—') + '</b><span class="sub">@' + esc(p.username || '—') + '</span></span></button>' +
      '<div class="member-meta"><span class="badge gray">' + ({ owner: 'владелец', admin: 'админ', member: 'участник' }[m.role] || m.role) + '</span>' +
      (m.banned_forever ? '<span class="badge gray">заблокирован</span>' : '') +
      (actions ? '<button class="member-more" type="button" aria-label="Действия с участником" title="Действия">⋯</button>' : '') +
      '</div>' + actions + '</div>';
  }).join('') || '<div class="sub">Пока никого.</div>';
}

async function loadRequests(spaceId) {
  var box = $('#requestList');
  if (!box) return;
  var r = await sb.from('join_requests').select('id,user_id,profiles(display_name,username)')
    .eq('space_id', spaceId).eq('status', 'pending');
  if (r.error) { box.textContent = r.error.message; return; }
  box.innerHTML = (r.data || []).map(function (q) {
    var p = q.profiles || {};
    return '<div class="member-row"><div class="av sm">' + ini(p.display_name) + '</div>' +
      '<div class="grow">' + esc(p.display_name || '—') + ' <span class="sub">@' + esc(p.username || '—') + '</span></div>' +
      '<button class="act" data-req="' + q.id + ':approved:' + q.user_id + '">Принять</button>' +
      '<button class="act" data-req="' + q.id + ':rejected:' + q.user_id + '">Отклонить</button></div>';
  }).join('') || '<div class="sub">Новых заявок нет.</div>';
}

function closeSpaceModal() { $('#spaceModal').hidden = true; }

$('#openSpaceModal').onclick = function () {
  if (!ME) { toast('Сначала войдите'); showScreen('auth'); return; }
  $('#spaceModal').hidden = false;
};
$('#closeSpaceModal').onclick = closeSpaceModal;
$('#spaceModal').onclick = function (e) { if (e.target === $('#spaceModal')) closeSpaceModal(); };
var showAllSpacesBtn = $('#showAllSpaces');
if (showAllSpacesBtn) showAllSpacesBtn.onclick = function () { CURRENT_SPACE = null; loadSpaces(); };

$('#createSpace').onclick = async function () {
  try {
    if (!ME) { fail('Вы не вошли в аккаунт. Обновите страницу и войдите.'); closeSpaceModal(); return; }
    var name = $('#spName').value.trim();
    if (!name) return toast('Введите название');

    var privacy = $('#spPrivacy').value;
    if (privacy === 'private' && !ME.is_verified && !isStaff()) {
      return toast('Для закрытого пространства нужна галочка верификации');
    }

    // Создаём ID на клиенте и не запрашиваем строку обратно до вступления
    // создателя в space_members: SELECT-политика может скрывать пространство
    // от пользователя, который ещё не стал его участником.
    var spaceId = makeUuid();
    var avatarFile = $('#spAvatar') && $('#spAvatar').files ? $('#spAvatar').files[0] : null;
    if (avatarFile && (!/^image\//i.test(avatarFile.type || '') || avatarFile.size > 5 * 1024 * 1024)) return toast('Аватар должен быть изображением до 5 МБ');
    var r = await sb.from('spaces').insert({
      id: spaceId, owner_id: ME.id, type: $('#spType').value, name: name,
      description: $('#spDesc').value.trim(), privacy: privacy,
      comments_enabled: $('#spComments').checked
    });
    if (r.error) return fail('База отклонила создание: ' + r.error.message + '. Проверьте правила доступа к таблице spaces.');

    var m = await sb.from('space_members').insert({ space_id: spaceId, user_id: ME.id, role: 'owner' });
    if (m.error) return fail('Пространство создано, но не удалось добавить вас в участники: ' + m.error.message);
    if (avatarFile && $('#spType').value === 'channel') {
      var avatarPath = ME.id + '/spaces/' + spaceId + '/avatar-' + Date.now() + '-' + avatarFile.name.replace(/[^\w.-]+/g, '_').slice(-40);
      var avatarUpload = await sb.storage.from('attachments').upload(avatarPath, avatarFile, {contentType:avatarFile.type,upsert:false});
      if (avatarUpload.error) toast('Канал создан, но аватар не загрузился: ' + avatarUpload.error.message);
      else { var avatarSave = await sb.from('spaces').update({avatar_url:avatarPath}).eq('id',spaceId); if (avatarSave.error) toast('Канал создан, но аватар не сохранился. Выполните channel-identity-migration.sql.'); }
    }

    closeSpaceModal();
    $('#spName').value = ''; $('#spDesc').value = ''; if ($('#spAvatar')) $('#spAvatar').value = '';
    toast('Пространство «' + name + '» создано');
    CURRENT_SPACE = null;
    showTab('spaces');
    await loadSpaces();
  } catch (e) { fail('Сбой при создании: ' + (e.message || e)); }
};

/* ================= ЧАТЫ ================= */
async function loadConversations() {
  if (!ME) return;
  var requestId = ++CONV_LOAD_SEQ;
  var userId = ME.id;
  try {
    var cached = await cacheGet('conversations', 'all');
    if (cached && requestId === CONV_LOAD_SEQ && ME && ME.id === userId) {
      CONVS = cached;
      renderConvList();
    }
    var mem = await sb.from('conversation_members').select('conversation_id').eq('user_id', userId);
    if (mem.error) throw mem.error;
    if (requestId !== CONV_LOAD_SEQ || !ME || ME.id !== userId) return;
    var ids = Array.from(new Set((mem.data || []).map(function (m) { return m.conversation_id; }).filter(Boolean)));
    var all = { data: [] }, conversations = [];
    if (ids.length) {
      var cs = await sb.from('conversations').select('id,is_support,owner_user').in('id', ids);
      if (cs.error) throw cs.error;
      all = await sb.from('conversation_members').select('conversation_id,user_id,profiles(display_name,username,avatar_url)').in('conversation_id', ids);
      if (all.error) throw all.error;
      if (requestId !== CONV_LOAD_SEQ || !ME || ME.id !== userId) return;
      var unique = new Map();
      (cs.data || []).forEach(function (c) {
        if (!c || !c.id || unique.has(c.id)) return;
        var others = (all.data || []).filter(function (m) { return m.conversation_id === c.id && m.user_id !== userId; });
        var o = others[0] || {};
        unique.set(c.id, { id:c.id, is_support:c.is_support, owner_user:c.owner_user,
          title:c.is_support ? 'Чат поддержки' : ((o.profiles || {}).display_name || 'Диалог'),
          sub:c.is_support ? 'Обращение в поддержку' : '@' + ((o.profiles || {}).username || '—'),
          target:o.user_id || null, _profile:o.profiles || {} });
      });
      conversations = Array.from(unique.values());
    }
    if (isStaff()) {
      var sup = await sb.from('conversations').select('id,is_support,owner_user,profiles!conversations_owner_user_fkey(display_name,username)').eq('is_support', true);
      if (sup.error) throw sup.error;
      if (requestId !== CONV_LOAD_SEQ || !ME || ME.id !== userId) return;
      (sup.data || []).forEach(function (c) {
        if (!c || !c.id || conversations.some(function (x) { return x.id === c.id; })) return;
        var p = c.profiles || {};
        conversations.push({ id:c.id, is_support:true, owner_user:c.owner_user, staffView:true,
          title:'Поддержка: ' + (p.display_name || 'пользователь'), sub:'@' + (p.username || '—'), target:c.owner_user });
      });
    }
    await signAvatarPaths((all.data || []).map(function (m) { return m.profiles || {}; }));
    if (requestId !== CONV_LOAD_SEQ || !ME || ME.id !== userId) return;
    CONVS = conversations;
    await cachePut('conversations', 'all', CONVS);
    CONV_UNREAD = {};
    var convIds = CONVS.filter(function (c) { return !c.staffView; }).map(function (c) { return c.id; });
    if (convIds.length) {
      var cc = await sb.from('notification_cursors').select('scope_id,last_seen_at').eq('user_id', userId).eq('scope_type', 'conversation').in('scope_id', convIds);
      if (cc.error) throw cc.error;
      if (requestId !== CONV_LOAD_SEQ || !ME || ME.id !== userId) return;
      var cm = {};
      (cc.data || []).forEach(function (v) { cm[v.scope_id] = v.last_seen_at; });
      var fresh = convIds.filter(function (id) { return !cm[id]; });
      for (var ci = 0; ci < fresh.length; ci++) { await markRead('conversation', fresh[ci]); cm[fresh[ci]] = new Date().toISOString(); }
      var msgs = await sb.from('messages').select('conversation_id,sender_id,created_at').in('conversation_id', convIds).neq('sender_id', userId).order('created_at', { ascending: false }).limit(500);
      if (msgs.error) throw msgs.error;
      if (requestId !== CONV_LOAD_SEQ || !ME || ME.id !== userId) return;
      (msgs.data || []).forEach(function (m) {
        if (new Date(m.created_at) > new Date(cm[m.conversation_id])) CONV_UNREAD[m.conversation_id] = (CONV_UNREAD[m.conversation_id] || 0) + 1;
      });
    }
    if (requestId === CONV_LOAD_SEQ && ME && ME.id === userId) renderConvList();
  } catch (e) { if (requestId === CONV_LOAD_SEQ) fail(e.message || e); }
}
function renderConvList() {
  $('#convList').innerHTML = CONVS.length ? CONVS.map(function (c) {
    return '<div class="conv' + (CURRENT_CONV && CURRENT_CONV.id === c.id ? ' on' : '') + '" data-conv="' + c.id + '">' +
      '<div class="conv-content">' +
      (c.is_support ? '<span class="av sm">?</span>' : avatarMarkup(c._profile || {}, 'sm')) +
      '<span class="grow"><span class="conv-title">' + esc(c.title) + '</span>' +
      '<span class="sub">' + esc(c.sub) + '</span></span>' + (CONV_UNREAD[c.id] ? '<span class="unread-badge">' + nf(CONV_UNREAD[c.id]) + '</span>' : '') + '</div></div>';
  }).join('') : '<div class="sub">Диалогов пока нет.</div>';
}

function showMobileChatList() {
  clearInterval(poll);
  poll = null;

  $('#pane-chats').classList.remove('chat-selected');

  animateInomestoElement($('.chat-list'), -18, 0, 250);
}

function renderChatHead() {
  var c = CURRENT_CONV;
  if (!c) { $('#chatHead').textContent = 'Выберите чат'; return; }
  var p = c._profile || {};
  var profile = !c.is_support && p.username
    ? '<button type="button" class="chat-head-profile" data-profile="' + esc(p.username) + '">' +
        avatarMarkup(p, 'sm') + '<span>' + esc(c.title) + '</span><span class="sub">@' + esc(p.username) + '</span></button>'
    : '<div class="chat-head-title">' + esc(c.title) + '</div>';
  $('#chatHead').innerHTML = '<button type="button" class="chat-back-mobile" data-chat-back aria-label="Назад к списку чатов">‹</button>' + profile;
}

async function openConv(id) {
  CURRENT_CONV = CONVS.filter(function (c) { return c.id === id; })[0] || null;
  if (!CURRENT_CONV) return;

  clearInterval(poll);
  poll = null;

  renderConvList();
  renderChatHead();
  $('#pane-chats').classList.add('chat-selected');

  animateInomestoElement($('.chat-window'), 22, 0, 280);

  await loadMessages(true);

  if (!CURRENT_CONV || CURRENT_CONV.id !== id) return;

  await markRead('conversation', id);
  CONV_UNREAD[id] = 0;
  renderConvList();

  poll = setInterval(function () {
    if (CURRENT_CONV && CURRENT_CONV.id === id) loadMessages();
  }, 7000);
}


function linkifyMessageText(value) {
  var text = String(value || '');
  var urlPattern = /https?:\/\/[^\s<>"']+/gi;
  var result = '';
  var last = 0;
  var match;

  while ((match = urlPattern.exec(text)) !== null) {
    var raw = match[0];
    var url = raw;
    var suffix = '';

    while (/[.,!?;:)\]}]$/.test(url)) {
      suffix = url.slice(-1) + suffix;
      url = url.slice(0, -1);
    }

    result += esc(text.slice(last, match.index));

    try {
      var parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        result += esc(raw);
      } else {
        result += '<a class="message-link" href="' + esc(parsed.href) +
          '" target="_blank" rel="noopener noreferrer">' +
          esc(url) + '</a>' + esc(suffix);
      }
    } catch (_) {
      result += esc(raw);
    }

    last = match.index + raw.length;
  }

  return (result + esc(text.slice(last))).replace(/\n/g, '<br>');
}

async function renderMessageRows(messageRows, conversationId, cachedOnly, appendOnly) {
  if (!CURRENT_CONV || CURRENT_CONV.id !== conversationId) return;

  await signMessagePaths(messageRows);
  if (!CURRENT_CONV || CURRENT_CONV.id !== conversationId) return;

  var reactionMap = {};
  var messageIds = cachedOnly ? [] : messageRows.map(function(m) { return m.id; });

  if (messageIds.length) {
    var rx = await sb.from('message_reactions')
      .select('message_id,user_id,emoji')
      .in('message_id', messageIds);

    if (!rx.error) (rx.data || []).forEach(function(x) {
      if (!reactionMap[x.message_id]) reactionMap[x.message_id] = {};
      if (!reactionMap[x.message_id][x.emoji]) {
        reactionMap[x.message_id][x.emoji] = { count: 0, mine: false };
      }
      reactionMap[x.message_id][x.emoji].count++;
      if (x.user_id === ME.id) reactionMap[x.message_id][x.emoji].mine = true;
    });
  }

  var box = $('#messages');
  var quick = CHAT_REACTIONS.slice(0, 5);
  var wasAtBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;

  var previousMessageIds = new Set(
    Array.from(box.querySelectorAll('[data-message-id]')).map(function(el) {
      return el.getAttribute('data-message-id');
    })
  );

  var renderedHtml = messageRows.map(function(m) {
    var mine = m.sender_id === ME.id;
    var label = m.from_support ? 'Чат поддержки' : ((m.profiles || {}).display_name || 'Участник');
    var body = linkifyMessageText(m.body || '');
    var files = (m.attachments || []).map(chatAttachmentHtml).join('');
    var groups = reactionMap[m.id] || {};

    var reactionHtml = CHAT_REACTIONS.filter(function(e) {
      return !!groups[e];
    }).map(function(e) {
      var x = groups[e];
      return '<button class="chat-reaction' + (x.mine ? ' mine' : '') +
        '" data-react-message="' + m.id + '" data-react-emoji="' + e + '">' +
        e + ' <span>' + x.count + '</span></button>';
    }).join('');

    var quickHtml = quick.map(function(e) {
      return '<button class="chat-picker-emoji" data-react-message="' + m.id +
        '" data-react-emoji="' + e + '">' + e + '</button>';
    }).join('');

    var allHtml = CHAT_REACTIONS.map(function(e) {
      return '<button class="chat-picker-emoji" data-react-message="' + m.id +
        '" data-react-emoji="' + e + '">' + e + '</button>';
    }).join('');

    return '<div class="bubble' + (mine ? ' mine' : '') +
      '" data-message-bubble data-message-id="' + esc(m.id) + '">' +
      '<div class="chat-reaction-tools"><div class="chat-reaction-quick">' +
      quickHtml + '<button class="chat-picker-more" data-react-more>＋</button></div>' +
      '<div class="chat-reaction-expanded" hidden>' + allHtml + '</div></div>' +
      (body ? '<div class="message-body">' + body + '</div>' : '') +
      files + '<small>' + (mine ? 'Вы' : esc(label)) + ' · ' +
      dateF(m.created_at) + '</small>' +
      (reactionHtml ? '<div class="chat-reactions">' + reactionHtml + '</div>' : '') +
      '</div>';
  }).join('');

  if (appendOnly) {
    if (box.querySelector('.empty')) box.innerHTML = '';
    if (renderedHtml) box.insertAdjacentHTML('beforeend', renderedHtml);
  } else {
    box.innerHTML = renderedHtml || '<div class="empty">Сообщений пока нет</div>';
  }

  if (!cachedOnly && previousMessageIds.size) {
    box.querySelectorAll('[data-message-id]').forEach(function(el) {
      var id = el.getAttribute('data-message-id');
      if (!previousMessageIds.has(id)) {
        animateInomestoElement(el, 0, 12, 220);
      }
    });
  }

  if (!appendOnly || wasAtBottom) {
    box.scrollTop = box.scrollHeight;
  }
}

async function loadMessages(forceFull) {
  if (!CURRENT_CONV || !ME) return;

  var conversationId = CURRENT_CONV.id;
  var userId = ME.id;

  if (CHAT_LOAD_INFLIGHT[conversationId]) return;
  CHAT_LOAD_INFLIGHT[conversationId] = true;

  try {
    var initialLoad = !!forceFull || !CHAT_LAST_MESSAGE_AT[conversationId];

    if (initialLoad) {
      var cached = await cacheGet('messages', conversationId);

      if (cached && CURRENT_CONV && CURRENT_CONV.id === conversationId &&
          ME && ME.id === userId) {
        await renderMessageRows(cached, conversationId, true, false);
      }

      if (!CURRENT_CONV || CURRENT_CONV.id !== conversationId ||
          !ME || ME.id !== userId) return;

      var requestStartedAt = new Date().toISOString();

      var r = await sb.from('messages')
        .select('id,body,attachments,from_support,sender_id,created_at,profiles(display_name)')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(300);

      if (r.error) throw r.error;

      var messageRows = (r.data || []).reverse();

      if (!CURRENT_CONV || CURRENT_CONV.id !== conversationId ||
          !ME || ME.id !== userId) return;

      CHAT_LAST_MESSAGE_AT[conversationId] =
        messageRows.length ? messageRows[messageRows.length - 1].created_at : requestStartedAt;

      await cachePut('messages', conversationId, messageRows.slice(-10));
      await renderMessageRows(messageRows, conversationId, false, false);

      if (CURRENT_CONV && CURRENT_CONV.id === conversationId) {
        await markRead('conversation', conversationId);
        CONV_UNREAD[conversationId] = 0;
        renderConvList();
      }

      return;
    }

    var since = CHAT_LAST_MESSAGE_AT[conversationId];

    var r = await sb.from('messages')
      .select('id,body,attachments,from_support,sender_id,created_at,profiles(display_name)')
      .eq('conversation_id', conversationId)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(300);

    if (r.error) throw r.error;

    if (!CURRENT_CONV || CURRENT_CONV.id !== conversationId ||
        !ME || ME.id !== userId) return;

    var received = r.data || [];

    if (received.length) {
      CHAT_LAST_MESSAGE_AT[conversationId] =
        received[received.length - 1].created_at;

      var box = $('#messages');
      var displayedIds = new Set(
        Array.from(box.querySelectorAll('[data-message-id]')).map(function(el) {
          return el.getAttribute('data-message-id');
        })
      );

      var newRows = received.filter(function(m) {
        return !displayedIds.has(m.id);
      });

      if (newRows.length) {
        var cachedRows = await cacheGet('messages', conversationId) || [];
        var combined = cachedRows.concat(newRows);
        var cacheIds = new Set();

        combined = combined.filter(function(m) {
          if (cacheIds.has(m.id)) return false;
          cacheIds.add(m.id);
          return true;
        });

        await cachePut('messages', conversationId, combined.slice(-10));
        await renderMessageRows(newRows, conversationId, false, true);

        if (CURRENT_CONV && CURRENT_CONV.id === conversationId) {
          await markRead('conversation', conversationId);
          CONV_UNREAD[conversationId] = 0;
          renderConvList();
        }
      }
    }
  } catch (e) {
    if (CURRENT_CONV && CURRENT_CONV.id === conversationId &&
        ME && ME.id === userId) {
      var existing = $('#messages');
      if (!existing.innerHTML || existing.innerHTML.indexOf('bubble') < 0) {
        existing.innerHTML = '<div class="sub">Не удалось загрузить сообщения. ' +
          esc(e.message || e) + '</div>';
      }
    }
  } finally {
    delete CHAT_LOAD_INFLIGHT[conversationId];
  }
}

function stopVoiceRecording() {
  if (CHAT_RECORD_TIMER) clearTimeout(CHAT_RECORD_TIMER);
  CHAT_RECORD_TIMER = null;
  if (CHAT_RECORDER && CHAT_RECORDER.state !== 'inactive') CHAT_RECORDER.stop();
}
function releaseVoiceStream() {
  if (CHAT_RECORD_STREAM) CHAT_RECORD_STREAM.getTracks().forEach(function (track) { track.stop(); });
  CHAT_RECORD_STREAM = null;
}
async function startVoiceRecording() {
  if (!ME) return toast('Сначала войдите в аккаунт');
  if (!CURRENT_CONV) return toast('Сначала выберите чат');
  if (CHAT_STAGED.length >= 10) return toast('Сначала отправьте или удалите часть вложений');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
    return toast('Запись голоса не поддерживается этим браузером');
  }
  try {
    CHAT_RECORD_STREAM = await navigator.mediaDevices.getUserMedia({ audio: true });
    CHAT_RECORD_PARTS = [];
    var mime = '';
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mime = 'audio/webm;codecs=opus';
    else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) mime = 'audio/ogg;codecs=opus';
    CHAT_RECORDER = new MediaRecorder(CHAT_RECORD_STREAM, mime ? { mimeType: mime } : undefined);
    CHAT_RECORDER.ondataavailable = function (event) {
      if (event.data && event.data.size) CHAT_RECORD_PARTS.push(event.data);
    };
    CHAT_RECORDER.onstop = function () {
      var type = CHAT_RECORDER && CHAT_RECORDER.mimeType || mime || 'audio/webm';
      var ext = type.indexOf('ogg') >= 0 ? 'ogg' : 'webm';
      if (CHAT_RECORD_PARTS.length) {
        var blob = new Blob(CHAT_RECORD_PARTS, { type: type });
        if (blob.size && CHAT_STAGED.length < 10) {
          CHAT_STAGED.push(new File([blob], 'Голосовое сообщение.' + ext, { type: type, lastModified: Date.now() }));
          renderChatStaged();
          toast('Голосовое сообщение готово к отправке');
        }
      }
      CHAT_RECORD_PARTS = [];
      CHAT_RECORDER = null;
      releaseVoiceStream();
      if ($('#recordVoice')) {
        $('#recordVoice').textContent = '🎙 Голосовое';
        $('#recordVoice').classList.remove('recording');
      }
    };
    CHAT_RECORDER.start(250);
    $('#recordVoice').textContent = '■ Завершить запись';
    $('#recordVoice').classList.add('recording');
    toast('Идёт запись. Нажмите «Завершить запись», когда закончите.');
    CHAT_RECORD_TIMER = setTimeout(stopVoiceRecording, 180000);
  } catch (e) {
    releaseVoiceStream();
    fail('Не удалось начать запись: ' + (e.message || e));
  }
}
$('#recordVoice').onclick = function () {
  if (CHAT_RECORDER && CHAT_RECORDER.state !== 'inactive') stopVoiceRecording();
  else startVoiceRecording();
};

function renderChatStaged() {
  var box = $('#chatStaged');
  if (!box) return;
  box.hidden = !CHAT_STAGED.length;
  box.innerHTML = CHAT_STAGED.map(function (f, i) {
    return '<span class="chat-stage-chip">' + esc(f.name) + ' · ' + sizeF(f.size) +
      ' <button type="button" data-chat-unstage="' + i + '" aria-label="Убрать файл">×</button></span>';
  }).join('');
}
$('#attachChatFile').onclick = function () {
  if (!ME) return toast('Сначала войдите в аккаунт');
  if (!CURRENT_CONV) return toast('Сначала выберите чат');
  $('#chatFileInput').click();
};
$('#chatFileInput').onchange = function () {
  var files = Array.prototype.slice.call(this.files || []);
  var maxFile = MAX;
  files.forEach(function (f) {
    if (CHAT_STAGED.length >= 10) return toast('Можно прикрепить не более 10 файлов к одному сообщению');
    if (f.size > maxFile) return toast('Файл больше допустимого лимита (' + sizeF(maxFile) + '): ' + f.name);
    CHAT_STAGED.push(f);
  });
  this.value = '';
  renderChatStaged();
};
document.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-chat-unstage]');
  if (btn) { CHAT_STAGED.splice(+btn.dataset.chatUnstage, 1); renderChatStaged(); }
});

async function uploadChatFiles(files) {
  var out = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var clean = f.name.replace(/[^\w.-]+/g, '_').slice(-60) || 'file';
    var path = ME.id + '/messages/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + clean;
    var up = await sb.storage.from('attachments').upload(path, f, {
      contentType: f.type || 'application/octet-stream', upsert: false
    });
    if (up.error) throw new Error('Не удалось загрузить «' + f.name + '»: ' + up.error.message);
    out.push({ path: path, name: f.name, size: f.size, mime: f.type || 'application/octet-stream' });
  }
  return out;
}
async function signMessagePaths(messages) {
  var paths = [];
  (messages || []).forEach(function (m) { (m.attachments || []).forEach(function (a) {
    if (a.path && (!SIGNED[a.path] || !SIGNED_EXPIRES[a.path] || SIGNED_EXPIRES[a.path] < Date.now() + 300000)) paths.push(a.path);
  }); });
  paths = Array.from(new Set(paths)); if (!paths.length) return;
  var r = await sb.storage.from('attachments').createSignedUrls(paths, 3600);
  if (r.error) throw new Error('Не удалось обновить ссылки на вложения сообщений: ' + r.error.message);
  (r.data || []).forEach(function (x) { if (x && x.signedUrl && x.path) { SIGNED[x.path] = x.signedUrl; SIGNED_EXPIRES[x.path] = Date.now() + 3300000; } });
}
function chatAttachmentHtml(a) {
  var url = a && a.path ? SIGNED[a.path] : '';
  var name = esc(a && a.name || 'Вложение');
  if (!url) return '<div class="chat-file">📎 ' + name + ' <span class="sub">Файл недоступен</span></div>';
  var src = esc(url), mime = String(a.mime || '');
  if (mime.indexOf('image/') === 0) {
    return '<a class="chat-image-link" href="' + src + '" target="_blank" rel="noopener"><img class="chat-image" src="' + src + '" alt="' + name + '" loading="lazy"></a>';
  }
  if (mime.indexOf('audio/') === 0) {
    return '<div class="chat-file"><div>🎵 ' + name + '</div><audio class="chat-audio" controls preload="none" src="' + src + '"></audio></div>';
  }
  if (mime.indexOf('video/') === 0) {
    return '<video class="chat-video" controls preload="metadata" src="' + src + '"></video>';
  }
  return '<a class="chat-file" href="' + src + '" target="_blank" rel="noopener" download="' + name + '">📎 ' + name + ' <span class="sub">Открыть / скачать</span></a>';
}
async function sendMessage() {
  var input = $('#msgInput');
  var body = input.value.trim();
  if ((!body && !CHAT_STAGED.length) || !CURRENT_CONV || !ME || CHAT_SENDING) return;
  CHAT_SENDING = true;
  $('#sendMsg').disabled = true;
  var uploaded = [];
  try {
    if (CHAT_STAGED.length) uploaded = await uploadChatFiles(CHAT_STAGED.slice());
    var r = await sb.from('messages').insert({
      conversation_id: CURRENT_CONV.id, sender_id: ME.id, body: body,
      attachments: uploaded,
      from_support: !!(CURRENT_CONV.staffView && isStaff())
    });
    if (r.error) {
      if (uploaded.length) await sb.storage.from('attachments').remove(uploaded.map(function (x) { return x.path; }));
      return fail(r.error.message);
    }
    input.value = '';
    CHAT_STAGED = [];
    renderChatStaged();
    await loadMessages();
  } catch (e) { fail(e.message || e); }
  finally { CHAT_SENDING = false; $('#sendMsg').disabled = false; }
}
$('#sendMsg').onclick = sendMessage;
$('#msgInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendMessage(); });

$('#messages').addEventListener('click', async function (e) {
  var messageLink = e.target.closest('a.message-link');

  if (messageLink) {
    e.preventDefault();
    e.stopPropagation();

    try {
      var clickedUrl = new URL(messageLink.href);

      if (clickedUrl.protocol !== 'http:' && clickedUrl.protocol !== 'https:') {
        return;
      }

      var canonicalUrl = new URL(siteUrl());
      var normalizePath = function (path) {
        return path.replace(/\/+$/, '') || '/';
      };

      var isInviteLink =
        clickedUrl.origin === canonicalUrl.origin &&
        normalizePath(clickedUrl.pathname) === normalizePath(canonicalUrl.pathname) &&
        clickedUrl.searchParams.has('invite');

      if (isInviteLink) {
        await acceptInviteToken(clickedUrl.searchParams.get('invite'));
        return;
      }

      if (
        isNativeApp() &&
        window.NativeAuthBridge &&
        window.NativeAuthBridge.Browser &&
        typeof window.NativeAuthBridge.Browser.open === 'function'
      ) {
        await window.NativeAuthBridge.Browser.open({ url: clickedUrl.href });
      } else {
        window.open(clickedUrl.href, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      fail('Не удалось открыть ссылку: ' + (err.message || err));
    }

    return;
  }

  var more = e.target.closest('[data-react-more]');
  if (more) {
    e.preventDefault();
    e.stopPropagation();
    var bubble = more.closest('[data-message-bubble]');
    var expanded = bubble && bubble.querySelector('.chat-reaction-expanded');
    if (expanded) {
      expanded.hidden = !expanded.hidden;
      bubble.classList.toggle('reaction-expanded-open', !expanded.hidden);
    }
    return;
  }

  var btn = e.target.closest('[data-react-message]');
  if (btn && !e.target.closest('[data-react-more]')) {
    if (!ME) return;
    var messageId = btn.dataset.reactMessage;
    var emoji = btn.dataset.reactEmoji;
    btn.disabled = true;
    try {
      var existing = await sb.from('message_reactions').select('id')
        .eq('message_id', messageId).eq('user_id', ME.id).eq('emoji', emoji).maybeSingle();
      if (existing.error) throw existing.error;
      var result = existing.data
        ? await sb.from('message_reactions').delete().eq('id', existing.data.id)
        : await sb.from('message_reactions').insert({ message_id: messageId, user_id: ME.id, emoji: emoji });
      if (result.error) throw result.error;
      await loadMessages(true);
    } catch (err) { fail('Не удалось сохранить реакцию: ' + (err.message || err)); btn.disabled = false; }
    return;
  }

  var bubbleTap = e.target.closest('[data-message-bubble]');
  if (bubbleTap && window.matchMedia && window.matchMedia('(max-width: 760px)').matches) {
    var wasOpen = bubbleTap.classList.contains('reaction-open');
    $$('#messages [data-message-bubble].reaction-open').forEach(function (item) {
      item.classList.remove('reaction-open', 'reaction-expanded-open');
      var panel = item.querySelector('.chat-reaction-expanded');
      if (panel) panel.hidden = true;
    });
    if (!wasOpen) bubbleTap.classList.add('reaction-open');
  }
});



$('#startDm').onclick = async function () {
  try {
    var uname = $('#newDmUser').value.trim().toLowerCase().replace(/^@/, '');
    if (!uname) return toast('Введите логин');
    var p = await sb.from('profiles').select('id,display_name,username').eq('username', uname).maybeSingle();
    if (p.error || !p.data) return toast('Пользователь не найден');
    if (p.data.id === ME.id) return toast('Это вы');

    var ok = await sb.rpc('can_dm', { other: p.data.id });
    if (ok.error) return fail(ok.error.message);
    if (!ok.data) return toast('Этот пользователь ограничил личные сообщения');

    var mem = await sb.from('conversation_members').select('conversation_id').eq('user_id', ME.id);
    var ids = (mem.data || []).map(function (m) { return m.conversation_id; });
    if (ids.length) {
      var exist = await sb.from('conversation_members')
        .select('conversation_id,user_id').in('conversation_id', ids).eq('user_id', p.data.id).maybeSingle();
      if (exist.data) { await loadConversations(); return openConv(exist.data.conversation_id); }
    }

    // Не запрашиваем SELECT/RETURNING: до добавления участников чат ещё
    // не проходит conv_select, поэтому .select() здесь вызывает отказ RLS.
    var cid = makeUuid();
    var c = await sb.from('conversations').insert({ id: cid, is_support: false });
    if (c.error) return fail('Не удалось создать чат: ' + c.error.message);
    var added = await sb.from('conversation_members').insert([
      { conversation_id: cid, user_id: ME.id },
      { conversation_id: cid, user_id: p.data.id }
    ]);
    if (added.error) return fail('Чат создан, но не удалось добавить участников: ' + added.error.message);
    $('#newDmUser').value = '';
    await loadConversations();
    openConv(cid);
  } catch (e) { fail(e.message || e); }
};

$('#openSupport').onclick = async function () {
  try {
    var r = await sb.from('conversations').select('id').eq('is_support', true).eq('owner_user', ME.id).maybeSingle();
    var cid = r.data && r.data.id;
    if (!cid) {
      // Создаём без .select(): пользователь ещё не участник нового чата.
      cid = makeUuid();
      var c = await sb.from('conversations').insert({ id: cid, is_support: true, owner_user: ME.id });
      if (c.error) return fail('Не удалось создать чат поддержки: ' + c.error.message);
      var added = await sb.from('conversation_members').insert({ conversation_id: cid, user_id: ME.id });
      if (added.error) return fail('Чат поддержки создан, но не удалось добавить участника: ' + added.error.message);
    }
    showTab('chats');
    await loadConversations();
    openConv(cid);
  } catch (e) { fail(e.message || e); }
};


/* ================= АВАТАРЫ И ПРОФИЛИ ================= */
async function signAvatarPaths(profiles) {
  var paths = [];
  (profiles || []).forEach(function (p) {
    if (p && p.avatar_url && !/^https?:\/\//i.test(p.avatar_url) && (!AVATAR_URLS[p.avatar_url] || !AVATAR_URL_EXPIRES[p.avatar_url] || AVATAR_URL_EXPIRES[p.avatar_url] < Date.now() + 300000)) paths.push(p.avatar_url);
  });
  paths = Array.from(new Set(paths)); if (!paths.length) return;
  var r = await sb.storage.from('attachments').createSignedUrls(paths, 3600);
  if (r.error) throw new Error('Не удалось обновить ссылки на аватары: ' + r.error.message);
  (r.data || []).forEach(function (x) { if (x && x.signedUrl && x.path) { AVATAR_URLS[x.path] = x.signedUrl; AVATAR_URL_EXPIRES[x.path] = Date.now() + 3300000; } });
}
function avatarMarkup(p, extra) {
  p = p || {};
  var src = p.avatar_url ? (/^https?:\/\//i.test(p.avatar_url) ? p.avatar_url : AVATAR_URLS[p.avatar_url]) : '';
  return src ? '<img class="av ' + (extra || '') + '" src="' + esc(src) + '" alt="" loading="lazy">' :
    '<span class="av ' + (extra || '') + '">' + ini(p.display_name) + '</span>';
}
async function openUserProfile(username) {
  if (!username) return;
  var r = await sb.from('profiles').select('id,display_name,username,bio,avatar_url,is_verified,is_owner,is_coowner,dm_policy').eq('username', username).maybeSingle();
  if (r.error || !r.data) return toast('Профиль не найден или недоступен');
  var p = r.data;
  await signAvatarPaths([p]);
  $('#profileModalContent').innerHTML =
    '<div class="profile-cover">' + avatarMarkup(p, 'profile-avatar') + '</div>' +
    '<h2>' + esc(p.display_name || 'Без имени') + (p.is_verified ? ' <span class="badge">✓</span>' : '') + '</h2>' +
    '<div class="sub">@' + esc(p.username) + (p.is_owner ? ' · владелец' : p.is_coowner ? ' · совладелец' : '') + '</div>' +
    '<p class="profile-bio">' + (p.bio ? esc(p.bio) : '<span class="sub">Пользователь пока ничего не рассказал о себе.</span>') + '</p>' +
    (p.id !== ME.id ? '<div class="row gap wrap"><button class="btn primary" id="profileMessage" data-user-name="' + esc(p.username) + '">Написать сообщение</button></div>' : '<div class="sub">Это ваш профиль</div>');
  $('#profileModal').hidden = false;
}
document.addEventListener('click', function (e) {
  var trigger = e.target.closest('[data-profile]');
  if (trigger && trigger.dataset.profile) { e.preventDefault(); e.stopPropagation(); openUserProfile(trigger.dataset.profile).catch(function (x) { fail(x.message || x); }); return; }
  if (e.target.closest('#closeProfileModal') || e.target.id === 'profileModal') { $('#profileModal').hidden = true; return; }
  var dm = e.target.closest('#profileMessage');
  if (dm) {
    $('#profileModal').hidden = true;
    $('#newDmUser').value = '@' + dm.dataset.userName;
    $('#startDm').click();
  }
});
$('#avatarInput').onchange = async function () {
  var file = this.files && this.files[0]; this.value = '';
  if (!file) return;
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type || '')) return toast('Выберите изображение PNG, JPG, WebP или GIF');
  if (file.size > 5 * 1024 * 1024) return toast('Аватар должен быть не больше 5 МБ');
  try {
    var ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    var path = ME.id + '/avatars/' + Date.now() + '.' + ext;
    var up = await sb.storage.from('attachments').upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) return fail('Не удалось загрузить аватар: ' + up.error.message);
    var save = await sb.from('profiles').update({ avatar_url: path }).eq('id', ME.id).select().maybeSingle();
    if (save.error) return fail('Файл загружен, но профиль не обновился: ' + save.error.message);
    ME = save.data; delete AVATAR_URLS[path];
    await signAvatarPaths([ME]); renderMe(); toast('Аватар обновлён');
  } catch (e) { fail(e.message || e); }
};

/* ================= ПРОФИЛЬ ================= */
function renderMe() {
  $('#meName').textContent = ME.display_name || 'Без имени';
  $('#meAvatar').innerHTML = avatarMarkup(ME, 'large');
  signAvatarPaths([ME]).then(function () { $('#meAvatar').innerHTML = avatarMarkup(ME, 'large'); });
  $('#meMeta').textContent = '@' + (ME.username || '—') +
    (ME.is_owner ? ' · владелец соцсети' : ME.is_coowner ? ' · совладелец' : '') +
    (ME.is_verified ? ' · верифицирован' : '');
  $('#setName').value = ME.display_name || '';
  $('#setUser').value = ME.username || '';
  $('#setBio').value = ME.bio || '';
  $('#setDm').value = ME.dm_policy || 'everyone';

  var st = ['Предупреждений: <b>' + (ME.warns || 0) + '</b>'];
  if (ME.muted_forever) st.push('<span class="badge gray">вечный мут</span>');
  else if (isMuted()) st.push('<span class="badge gray">мут до ' + dateF(ME.muted_until) + '</span>');
  if (!ME.can_report) st.push('<span class="badge gray">подача жалоб запрещена</span>');
  $('#meStatus').innerHTML = st.join(' · ');

  sb.from('warnings').select('reason,created_at,removed').eq('user_id', ME.id).then(function (r) {
    var rows = r.data || [];
    $('#myWarns').innerHTML = rows.length ? rows.map(function (w) {
      return '<div class="comment">' + esc(w.reason || 'Без причины') + ' <span class="sub">' + dateF(w.created_at) +
        (w.removed ? ' · снято' : '') + '</span></div>';
    }).join('') : 'Предупреждений нет.';
  });
}

$('#saveProfile').onclick = async function () {
  try {
    var uname = $('#setUser').value.trim().toLowerCase().replace(/[^a-z0-9_.]/g, '');
    if (uname.length < 3) return toast('Логин: минимум 3 символа');
    var r = await sb.from('profiles').update({
      display_name: $('#setName').value.trim() || ME.display_name,
      username: uname, bio: $('#setBio').value.trim(), dm_policy: $('#setDm').value
    }).eq('id', ME.id).select().maybeSingle();
    if (r.error) return toast(r.error.message.indexOf('duplicate') >= 0 ? 'Этот логин уже занят' : r.error.message);
    ME = r.data;
    renderMe(); renderIdentity(); renderConvList();
    toast('Сохранено');
  } catch (e) { fail(e.message || e); }
};

$('#saveNotificationPrefs').onclick = saveNotificationPrefs;

$('#themeSelect').onchange = function () {
  applyTheme(this.value);
  toast(this.value === 'dark' ? 'Включена тёмная тема' : 'Включена светлая тема');
};

$('#enableBrowserNotifications').onclick = requestBrowserNotifications;

/* ================= ИЗБРАННОЕ ================= */
async function loadFavoritePostIds() {
  if (!ME) {
    FAVORITE_POST_IDS = new Set();
    return;
  }
  var userId = ME.id;
  var r = await sb.from('post_favorites')
    .select('post_id')
    .eq('user_id', userId);
  if (r.error) {
    fail('Не удалось загрузить избранное: ' + r.error.message);
    return;
  }
  if (!ME || ME.id !== userId) return;
  FAVORITE_POST_IDS = new Set((r.data || []).map(function (x) { return x.post_id; }));
}

async function toggleFavoritePost(postId) {
  if (!ME) return toast('Сначала войдите');

  var saved = FAVORITE_POST_IDS.has(postId);
  var r;

  if (saved) {
    r = await sb.from('post_favorites').delete()
      .eq('user_id', ME.id).eq('post_id', postId);
  } else {
    r = await sb.from('post_favorites').insert({
      user_id: ME.id,
      post_id: postId
    });
  }

  if (r.error) return fail('Не удалось изменить избранное: ' + r.error.message);

  if (saved) {
    FAVORITE_POST_IDS.delete(postId);
    toast('Убрано из избранного');
  } else {
    FAVORITE_POST_IDS.add(postId);
    toast('Сохранено в избранное');
  }

  if (FAVORITES_VIEW) loadFavoritePosts();
  else if (CURRENT_SPACE) loadSpacePosts();
  else loadFeed();
}

async function sharePost(postId) {
  var url = new URL(siteUrl(), location.href);
  url.searchParams.set('post', postId);
  var link = url.toString();

  try {
    if (navigator.share) {
      await navigator.share({ title: 'Публикация Inomesto', url: link });
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(link);
      toast('Ссылка скопирована');
    } else {
      prompt('Скопируйте ссылку на публикацию:', link);
    }
  } catch (e) {
    if (e.name !== 'AbortError') prompt('Ссылка на публикацию:', link);
  }
}


async function loadFavoritePosts() {
  if (!ME) return toast('Сначала войдите');
  var userId = ME.id;
  FAVORITES_VIEW = true;
  CURRENT_SPACE = null;
  document.body.classList.remove('channel-open');

  var box = $('#spaceView');
  if (!box) return;

  box.innerHTML = '<div class="card empty">Загружаем избранное…</div>';

  try {
    var saved = await sb.from('post_favorites')
      .select('post_id,created_at')
      .eq('user_id', userId)
      .order('created_at', {ascending:false});

    if (saved.error) throw saved.error;

    if (!ME || ME.id !== userId || !FAVORITES_VIEW) return;

    var ids = (saved.data || []).map(function (x) { return x.post_id; });
    FAVORITE_POST_IDS = new Set(ids);

    if (!ids.length) {
      FAVORITE_POSTS = [];
      box.innerHTML =
        '<div class="favorites-heading"><button class="btn ghost" data-back-favorites="1">← Назад</button><h2>Избранное</h2></div>' +
        '<div class="card empty">Здесь пока нет сохранённых публикаций. Откройте меню публикации и выберите «Сохранить в избранное».</div>';
      return;
    }

    var postsResult = await sb.from('posts')
      .select(POST_SELECT)
      .in('id', ids);

    if (postsResult.error) throw postsResult.error;

    var byPostId = {};
    (postsResult.data || []).forEach(function (p) { byPostId[p.id] = p; });
    FAVORITE_POSTS = ids.map(function (id) { return byPostId[id]; }).filter(Boolean);

    var spaceIds = Array.from(new Set(FAVORITE_POSTS.map(function (p) { return p.space_id; }).filter(Boolean)));
    var spaceById = {};

    if (spaceIds.length) {
      var spacesResult = await sb.from('spaces')
        .select('id,name,avatar_url,type')
        .in('id', spaceIds);
      if (!spacesResult.error) {
        (spacesResult.data || []).forEach(function (sp) { spaceById[sp.id] = sp; });
      }
    }

    FAVORITE_POSTS.forEach(function (p) {
      p._space = p.space_id ? (spaceById[p.space_id] || null) : null;
      p._spaceName = p._space ? p._space.name : '';
    });

    await signPaths(FAVORITE_POSTS);

    var avatars = FAVORITE_POSTS.reduce(function (a, p) {
      a.push(p.author || {});
      if (p._space) a.push({display_name:p._space.name, avatar_url:p._space.avatar_url});
      (p.comments || []).forEach(function (cm) { a.push(cm.author || {}); });
      return a;
    }, []);

    await signAvatarPaths(avatars);

    if (!ME || ME.id !== userId || !FAVORITES_VIEW) return;

    box.innerHTML =
      '<div class="favorites-heading"><button class="btn ghost" data-back-favorites="1">← Назад</button><h2>Избранное</h2></div>' +
      (FAVORITE_POSTS.length
        ? FAVORITE_POSTS.map(postHtml).join('')
        : '<div class="card empty">Сохранённые публикации пока недоступны.</div>');
  } catch (e) {
    if (ME && ME.id === userId && FAVORITES_VIEW) {
      box.innerHTML = '<div class="card empty">Не удалось загрузить избранное: ' + esc(e.message || e) + '</div>';
    }
  }
}

/* ================= ЖАЛОБЫ ================= */
async function reportPost(postId) {
  if (!ME) return toast('Сначала войдите');
  if (!ME.can_report) return toast('Подача жалоб недоступна');
  var reason = prompt('Опишите причину жалобы:');
  if (!reason || !reason.trim()) return;
  var p = FEED.concat(FAVORITE_POSTS).filter(function (x) { return x.id === postId; })[0];
  var r = await sb.from('reports').insert({
    reporter_id: ME.id, post_id: postId, space_id: (p && p.space_id) || null, reason: reason.trim()
  });
  if (r.error) return fail('Жалоба не отправлена: ' + r.error.message);
  toast('Жалоба отправлена владельцу и совладельцам');
}

/* ================= МОДЕРАЦИЯ ================= */
async function loadModeration() {
  if (!isStaff()) return;
  var r = await sb.from('reports')
    .select('id,reason,status,created_at,reporter_id,reporter:profiles!reports_reporter_id_fkey(display_name,username)')
    .eq('status', 'open').order('created_at', { ascending: false }).limit(60);
  $('#reportList').innerHTML = (r.data || []).map(function (x) {
    var p = x.reporter || {};
    return '<div class="member-row"><div class="grow"><div>' + esc(x.reason) + '</div>' +
      '<div class="sub">от @' + esc(p.username || '—') + ' · ' + dateF(x.created_at) + '</div></div>' +
      '<button class="act" data-verdict="' + x.id + ':valid">Обоснована</button>' +
      '<button class="act" data-verdict="' + x.id + ':invalid">Необоснованна</button></div>';
  }).join('') || '<div class="sub">Открытых жалоб нет.</div>';

  var d = await sb.from('space_deletions').select('id,space_id,confirm_after,cancelled,spaces(name)').eq('cancelled', false);
  $('#deletionList').innerHTML = (d.data || []).map(function (x) {
    return '<div class="member-row"><div class="grow">' + esc((x.spaces || {}).name || 'пространство') +
      '<div class="sub">удаление после ' + dateF(x.confirm_after) + '</div></div>' +
      '<button class="act" data-cancel-del="' + x.id + '">Отменить</button></div>';
  }).join('') || '<div class="sub">Отложенных удалений нет.</div>';

  var s = await sb.from('conversations')
    .select('id,is_support,owner_user,profiles!conversations_owner_user_fkey(display_name,username)').eq('is_support', true);
  $('#supportList').innerHTML = (s.data || []).map(function (c) {
    var p = c.profiles || {};
    return '<div class="member-row"><div class="av sm">' + ini(p.display_name) + '</div>' +
      '<div class="grow">' + esc(p.display_name || '—') + ' <span class="sub">@' + esc(p.username || '—') + '</span></div>' +
      '<button class="act" data-open-support="' + c.id + '">Открыть</button></div>';
  }).join('') || '<div class="sub">Обращений нет.</div>';
}

$$('[data-staff]').forEach(function (btn) {
  btn.onclick = async function () {
    try {
      var uname = $('#staffUser').value.trim().toLowerCase().replace(/^@/, '');
      if (!uname) return toast('Введите логин');
      var p = await sb.from('profiles').select('id').eq('username', uname).maybeSingle();
      if (!p.data) return toast('Пользователь не найден');
      var a = btn.dataset.staff, res;
      if (a === 'verify')    res = await sb.rpc('set_verified', { target: p.data.id, value: true });
      if (a === 'unverify')  res = await sb.rpc('revoke_verification', { target: p.data.id });
      if (a === 'coowner')   res = await sb.rpc('set_coowner', { target: p.data.id, value: true });
      if (a === 'uncoowner') res = await sb.rpc('set_coowner', { target: p.data.id, value: false });
      if (a === 'warn') {
        var why = prompt('Причина предупреждения:');
        if (!why) return;
        res = await sb.rpc('issue_warning', { target: p.data.id, why: why });
      }
      $('#staffResult').textContent = (res && (res.error ? 'Ошибка: ' + res.error.message : res.data)) || 'Готово';
      if (ME.id === p.data.id) {
        var fresh = await sb.from('profiles').select('*').eq('id', ME.id).maybeSingle();
        if (fresh.data) { ME = fresh.data; renderMe(); renderIdentity(); }
      }
    } catch (e) { fail(e.message || e); }
  };
});

/* Действия с участником открываются долгим нажатием на строку.
   Кнопка ⋯ оставлена как альтернативный способ для мыши и клавиатуры. */
var memberPressTimer = null, memberLongPressRow = null;
document.addEventListener('pointerdown', function (e) {
  var row = e.target.closest('.member-row-user[data-member-row]');
  if (!row || e.target.closest('.member-actions,.member-more')) return;
  if (memberPressTimer) clearTimeout(memberPressTimer);
  memberLongPressRow = row;
  memberPressTimer = setTimeout(function () {
    var panel = $('.member-actions', row);
    if (panel) {
      $$('.member-actions').forEach(function (p) { p.hidden = true; });
      panel.hidden = false;
      row.classList.add('member-actions-open');
      row.dataset.longPressed = '1';
      if (navigator.vibrate) navigator.vibrate(25);
    }
    memberPressTimer = null;
  }, 550);
});
['pointerup','pointercancel','pointerleave'].forEach(function (name) {
  document.addEventListener(name, function () {
    if (memberPressTimer) clearTimeout(memberPressTimer);
    memberPressTimer = null;
  });
});
document.addEventListener('click', function (e) {
  var more = e.target.closest('.member-more');
  if (more) {
    var row = more.closest('.member-row-user');
    var panel = row && $('.member-actions', row);
    if (panel) {
      var opening = panel.hidden;
      $$('.member-actions').forEach(function (p) { p.hidden = true; });
      $$('.member-row-user').forEach(function (r) { r.classList.remove('member-actions-open'); });
      panel.hidden = !opening;
      row.classList.toggle('member-actions-open', opening);
    }
    e.preventDefault();
    return;
  }
  var pressed = e.target.closest('.member-row-user[data-long-pressed="1"]');
  if (pressed && !e.target.closest('.member-actions')) {
    delete pressed.dataset.longPressed;
    e.preventDefault();
    e.stopPropagation();
  }
}, true);
document.addEventListener('contextmenu', function (e) {
  var row = e.target.closest('.member-row-user');
  if (!row || e.target.closest('.member-actions')) return;
  var panel = $('.member-actions', row);
  if (panel) {
    e.preventDefault();
    $$('.member-actions').forEach(function (p) { p.hidden = true; });
    panel.hidden = false;
    row.classList.add('member-actions-open');
  }
});


/* INOMESTO INVITE DIALOGS */

function inviteDialogShell(content) {
  var overlay = document.createElement('div');
  overlay.className = 'inomesto-invite-overlay';
  overlay.innerHTML =
    '<div class="inomesto-invite-dialog" role="dialog" aria-modal="true">' +
    content + '</div>';

  document.body.appendChild(overlay);

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.remove();
  });

  return overlay;
}

function chooseInviteType() {
  return new Promise(function(resolve) {
    var overlay = inviteDialogShell(
      '<button class="inomesto-invite-close" data-choice="cancel" aria-label="Закрыть">×</button>' +
      '<div class="inomesto-invite-icon">🔗</div>' +
      '<h3>Создать ссылку-приглашение</h3>' +
      '<p>Выбери, сколько раз можно использовать эту ссылку</p>' +
      '<button class="inomesto-invite-option" data-choice="single">' +
        '<span><b>Одноразовая ссылка</b><small>Можно вступить только один раз</small></span><span>›</span>' +
      '</button>' +
      '<button class="inomesto-invite-option" data-choice="multiple">' +
        '<span><b>Многоразовая ссылка</b><small>Можно приглашать нескольких участников</small></span><span>›</span>' +
      '</button>' +
      '<button class="inomesto-invite-cancel" data-choice="cancel">Отмена</button>'
    );

    overlay.addEventListener('click', function(e) {
      var button = e.target.closest('[data-choice]');
      if (!button) return;
      var choice = button.dataset.choice;
      overlay.remove();
      resolve(choice === 'single' || choice === 'multiple' ? choice : null);
    });
  });
}

async function showInviteLink(url) {
  var overlay = inviteDialogShell(
    '<button class="inomesto-invite-close" data-invite-close aria-label="Закрыть">×</button>' +
    '<div class="inomesto-invite-icon">🔗</div>' +
    '<h3>Ссылка-приглашение</h3>' +
    '<p>Отправь эту ссылку человеку, которого хочешь пригласить</p>' +
    '<input class="inomesto-invite-url" type="text" readonly aria-label="Ссылка приглашения">' +
    '<button class="btn primary wide" data-invite-copy>Скопировать ссылку</button>' +
    '<button class="btn ghost wide" data-invite-share>Поделиться</button>' +
    '<p class="inomesto-invite-status" aria-live="polite"></p>'
  );

  var input = overlay.querySelector('.inomesto-invite-url');
  var status = overlay.querySelector('.inomesto-invite-status');
  input.value = url;

  overlay.querySelector('[data-invite-close]').addEventListener('click', function() {
    overlay.remove();
  });

  overlay.querySelector('[data-invite-copy]').addEventListener('click', async function() {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        input.focus();
        input.select();
        if (!document.execCommand('copy')) throw new Error('copy failed');
      }
      status.textContent = 'Ссылка скопирована!';
    } catch (e) {
      input.focus();
      input.select();
      status.textContent = 'Не удалось скопировать автоматически. Выдели ссылку и скопируй её вручную.';
    }
  });

  overlay.querySelector('[data-invite-share]').addEventListener('click', async function() {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Ссылка-приглашение в Inomesto', url: url });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        status.textContent = 'Ссылка скопирована!';
      } else {
        input.focus();
        input.select();
        status.textContent = 'Выдели ссылку и скопируй её вручную.';
      }
    } catch (e) {
      if (e.name !== 'AbortError') status.textContent = 'Не удалось открыть меню отправки.';
    }
  });
}

/* ================= ОБРАБОТЧИК КЛИКОВ ================= */
document.addEventListener('click', async function (e) {
  var menuTrigger = e.target.closest('[data-post-menu]');
  if (menuTrigger) {
    var menuId = menuTrigger.dataset.postMenu;
    var postCard = menuTrigger.closest('.post');
    var menu = postCard
      ? postCard.querySelector('.post-menu[data-post-menu-list="' + menuId + '"]')
      : null;
    var opening = menu && menu.hidden;
    $$('[data-post-menu-list]').forEach(function (item) { item.hidden = true; });
    $$('[data-post-menu]').forEach(function (item) {
      item.setAttribute('aria-expanded', 'false');
    });
    if (menu) {
      menu.hidden = !opening;
      menuTrigger.setAttribute('aria-expanded', String(!!opening));
    }
    return;
  }

  if (!e.target.closest('.post-menu')) {
    $$('[data-post-menu-list]').forEach(function (item) { item.hidden = true; });
    $$('[data-post-menu]').forEach(function (item) {
      item.setAttribute('aria-expanded', 'false');
    });
  }

  var t = e.target.closest('[data-open-favorites],[data-back-favorites],[data-like],[data-cmt],[data-favorite-post],[data-share-post],[data-report],[data-del],[data-open-space],[data-open-channel],[data-back-spaces],[data-join],[data-invite],[data-del-space],[data-conv],[data-verdict],[data-cancel-del],[data-open-support],[data-req],[data-member-admin],[data-member-kick],[data-member-ban],[data-comment-send],[data-chat-back]');
  if (!t) return;
  var d = t.dataset;

  if (d.openFavorites) return loadFavoritePosts();
  if (d.backFavorites) { renderSpaceList(); return; }

  if (d.like) {
    var post = FEED.concat(FAVORITE_POSTS).filter(function (p) { return p.id === d.like; })[0];
    var liked = post && (post.post_likes || []).some(function (l) { return l.user_id === ME.id; });
    if (liked) await sb.from('post_likes').delete().match({ post_id: d.like, user_id: ME.id });
    else await sb.from('post_likes').insert({ post_id: d.like, user_id: ME.id });
    if (CURRENT_SPACE) loadSpacePosts(); else loadFeed();
    return;
  }
  if (d.cmt) { if (OPEN.has(d.cmt)) OPEN.delete(d.cmt); else OPEN.add(d.cmt); if (CURRENT_SPACE) loadSpacePosts(); else loadFeed(); return; }
  if (d.favoritePost) return toggleFavoritePost(d.favoritePost);
  if (d.sharePost) return sharePost(d.sharePost);
  if (d.report) return reportPost(d.report);

  if (d.del) {
    if (!confirm('Удалить публикацию?')) return;
    var r = await sb.from('posts').delete().eq('id', d.del);
    if (r.error) fail(r.error.message);
    if (CURRENT_SPACE) loadSpacePosts(); else loadFeed();
    return;
  }
  if (d.commentSend) {
    var inp = $('[data-comment-input="' + d.commentSend + '"]');
    if (!inp || !inp.value.trim()) return;
    var cr = await sb.from('comments').insert({ post_id: d.commentSend, author_id: ME.id, content: inp.value.trim() });
    if (cr.error) fail(cr.error.message);
    if (CURRENT_SPACE) loadSpacePosts(); else loadFeed();
    return;
  }
  if (d.openSpace) { var s = SPACES.concat(SPACE_SEARCH_RESULTS).filter(function (x) { return x.id === d.openSpace; })[0]; if (s) openSpace(s); return; }
  if (d.openChannel) { await openSpaceById(d.openChannel); return; }
  if (d.backSpaces) { renderSpaceList(); return; }
  if (d.join) {
    var sp = SPACES.concat(SPACE_SEARCH_RESULTS).filter(function (x) { return x.id === d.join; })[0] || {};
    if (sp.privacy === 'private') {
      var jr = await sb.from('join_requests').insert({ space_id: d.join, user_id: ME.id });
      toast(jr.error ? jr.error.message : 'Заявка отправлена владельцу');
    } else {
      var jm = await sb.from('space_members').insert({ space_id: d.join, user_id: ME.id, role: 'member' });
      toast(jm.error ? jm.error.message : 'Вы вступили');
    }
    CURRENT_SPACE = null; loadSpaces(); return;
  }
  if (d.invite) {
    var inviteType = await chooseInviteType();
    if (!inviteType) return;

    var token = Math.random().toString(36).slice(2, 10) +
      Math.random().toString(36).slice(2, 10);

    var ir = await sb.from('space_invites').insert({
      space_id: d.invite,
      token: token,
      single_use: inviteType === 'single',
      created_by: ME.id
    });

    if (ir.error) return fail(ir.error.message);

    var inviteUrl = new URL(siteUrl());
    inviteUrl.searchParams.set('invite', token);

    await showInviteLink(inviteUrl.href);
    return;
  }
  if (d.delSpace) {
    if (!confirm('Удалить пространство? Если участников больше 1000, удаление отложится на час.')) return;
    var dr = await sb.rpc('request_space_delete', { s: d.delSpace });
    toast(dr.error ? dr.error.message : dr.data);
    CURRENT_SPACE = null; loadSpaces(); return;
  }
  if (t.hasAttribute('data-chat-back')) { showMobileChatList(); return; }
  if (d.conv) return openConv(d.conv);
  if (d.verdict) {
    var parts = d.verdict.split(':');
    var vr = await sb.rpc('resolve_report', { r: parts[0], verdict: parts[1] });
    toast(vr.error ? vr.error.message : vr.data);
    loadModeration(); return;
  }
  if (d.cancelDel) { var cd = await sb.rpc('cancel_space_delete', { d: d.cancelDel }); toast(cd.error ? cd.error.message : cd.data); loadModeration(); return; }
  if (d.openSupport) { showTab('chats'); await loadConversations(); openConv(d.openSupport); return; }

  if (d.req) {
    var q = d.req.split(':');
    var reqSpaceId = CURRENT_SPACE && CURRENT_SPACE.id;
    if (!reqSpaceId) return fail('Откройте канал заново и повторите действие.');
    var reqUpdate = await sb.from('join_requests').update({ status: q[1] }).eq('id', q[0]).eq('space_id', reqSpaceId);
    if (reqUpdate.error) return fail('Не удалось обработать заявку: ' + reqUpdate.error.message);
    if (q[1] === 'approved') {
      var addMember = await sb.from('space_members').insert({ space_id: reqSpaceId, user_id: q[2], role: 'member' });
      if (addMember.error) return fail('Заявка одобрена, но добавить участника не удалось: ' + addMember.error.message);
    }
    toast(q[1] === 'approved' ? 'Заявка одобрена' : 'Заявка отклонена');
    await loadRequests(reqSpaceId); await loadMembers(reqSpaceId, true); return;
  }
  if (d.memberAdmin || d.memberKick || d.memberBan) {
    var raw = (d.memberAdmin || d.memberKick || d.memberBan).split(':');
    var sid = raw[0], uid = raw[1], actionResult;
    if (!sid || !uid) return fail('Не удалось определить участника. Обновите страницу.');
    if (d.memberAdmin && !(CURRENT_SPACE && CURRENT_SPACE.id === sid &&
        (CURRENT_SPACE._myRole === 'owner' || (CURRENT_SPACE._myRole === 'admin' && !isStaff())))) {
      return fail('Назначать администраторов может только владелец или администратор этого канала, не являющийся глобальным модератором.');
    }
    if (d.memberKick && !confirm('Удалить участника из канала?')) return;
    if (d.memberBan && !confirm('Заблокировать участника навсегда?')) return;
    if (d.memberAdmin) actionResult = await sb.from('space_members').update({ role: 'admin' }).match({ space_id: sid, user_id: uid });
    if (d.memberKick) actionResult = await sb.from('space_members').delete().match({ space_id: sid, user_id: uid });
    if (d.memberBan) actionResult = await sb.from('space_members').update({ banned_forever: true }).match({ space_id: sid, user_id: uid });
    if (actionResult && actionResult.error) return fail('Не удалось выполнить действие: ' + actionResult.error.message);
    toast(d.memberAdmin ? 'Пользователь назначен администратором' : d.memberKick ? 'Участник удалён из канала' : 'Участник заблокирован');
    await loadMembers(sid, true); return;
  }
});

$$('[data-tab]').forEach(function (b) { b.onclick = function () { showTab(b.dataset.tab); }; });
if ($('#feedFindChannels')) $('#feedFindChannels').onclick = function () { showTab('spaces'); };

/* ================= ПРОВЕРКА ПОДКЛЮЧЕНИЯ ================= */
$('#runDiag').onclick = async function () {
  var out = [];
  try {
    var u = await sb.auth.getUser();
    out.push(u.data && u.data.user ? '✅ Вход выполнен: ' + u.data.user.email : '❌ Нет входа');
    var p = await sb.from('profiles').select('id').limit(1);
    out.push(p.error ? '❌ Таблица profiles: ' + p.error.message : '✅ Таблица profiles на месте');
    var s = await sb.from('spaces').select('id').limit(1);
    out.push(s.error ? '❌ Таблица spaces: ' + s.error.message : '✅ Таблица spaces на месте');
    var c = await sb.from('conversations').select('id').limit(1);
    out.push(c.error ? '❌ Таблица conversations: ' + c.error.message : '✅ Таблица conversations на месте');
    var st = await sb.storage.from('attachments').list('', { limit: 1 });
    out.push(st.error ? '❌ Хранилище attachments: ' + st.error.message : '✅ Хранилище attachments на месте');
    out.push('Права: ' + (ME && ME.is_owner ? 'владелец' : ME && ME.is_coowner ? 'совладелец' : 'обычный пользователь') +
      (ME && ME.is_verified ? ', есть галочка' : ''));
    out.push('Кнопка GitHub: ' + (PROV.github === false ? 'выключена в config.js' : 'включена'));
    out.push('Адрес возврата после входа: ' + siteUrl());
    out.push(!isNativeApp() && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
      ? '⚠️ Сайт открыт на localhost — в Supabase Site URL всё ещё http://localhost:3000'
      : '✅ Адрес приложения определён корректно');
  } catch (e) { out.push('❌ Сбой: ' + (e.message || e)); }
  $('#diagOut').innerHTML = out.join('<br>');
};

var INVITE_PROCESSING = false;

async function acceptInviteToken(token) {
  if (!ME) {
    toast('Сначала войдите в аккаунт');
    return false;
  }

  if (!token || INVITE_PROCESSING) return false;

  INVITE_PROCESSING = true;

  try {
    var r = await sb.rpc('join_by_invite_space', { tok: token });

    if (r.error) {
      toast(r.error.message || 'Не удалось принять приглашение');
      return false;
    }

    if (!r.data) {
      toast('Не удалось определить пространство');
      return false;
    }

    toast('Вы вступили');
    await loadSpaces();
    await openSpaceById(r.data);
    return true;
  } catch (e) {
    fail(e.message || e);
    return false;
  } finally {
    INVITE_PROCESSING = false;
  }
}

async function checkInvite() {
  var params = new URLSearchParams(location.search || '');
  var token = params.get('invite');

  if (!token || !ME) return;

  var accepted = await acceptInviteToken(token);

  if (accepted) {
    params.delete('invite');
    var query = params.toString();
    history.replaceState(
      {},
      '',
      location.pathname + (query ? '?' + query : '') + location.hash
    );
  }

  return accepted;
}


/* ===== INOMESTO SPLASH ANIMATION ===== */

function startInomestoSplash() {
  var splash = document.getElementById('inomestoSplash');
  var stage = document.getElementById('splashStage');
  var word = document.getElementById('splashWord');
  var logo = document.getElementById('splashLogo');

  if (!splash || !stage || !word || !logo) {
    window.__inomestoSplashPromise = Promise.resolve();
    return;
  }

  var reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!reduced || !Element.prototype.animate) {
    window.__inomestoSplashPromise = (async function () {
      var letters = Array.prototype.slice.call(
        word.querySelectorAll('.splash-letter')
      );

      // 1. Название плавно въезжает справа.
      var intro = word.animate([
        {
          transform: 'translate3d(68vw,0,0)',
          opacity: 0
        },
        {
          transform: 'translate3d(0,0,0)',
          opacity: 1
        }
      ], {
        duration: 1050,
        easing: 'cubic-bezier(.16,1,.3,1)',
        fill: 'forwards'
      });

      await intro.finished;
      word.style.transform = 'translateX(0)';
      intro.cancel();

      // 2. Название немного смещается, освобождая место знаку.
      var shift = word.animate([
        { transform: 'translateX(0)' },
        { transform: 'translateX(30px)' }
      ], {
        duration: 420,
        easing: 'cubic-bezier(.22,1,.36,1)',
        fill: 'forwards'
      });

      await shift.finished;
      word.style.transform = 'translateX(30px)';
      shift.cancel();

      // 3. Логотип начинает движение над верхней частью надписи.
      var logoSize = 48;
      var wordRect = word.getBoundingClientRect();
      var startX = window.innerWidth + 70;

      // Нижняя грань знака находится чуть выше букв.
      var baseY = wordRect.top - logoSize + 8;

      logo.style.left = startX + 'px';
      logo.style.top = baseY + 'px';
      logo.style.marginTop = '0';
      logo.style.opacity = '1';
      logo.style.transform = 'translate3d(0,0,0)';

      var currentDX = 0;

      // Три точки касания — единая непрерывная траектория.
      var landingIndexes = [7, 4, 1];
      var frames = [{
        offset: 0,
        transform: 'translate3d(0,0,0) rotateY(0deg) rotateZ(0deg)'
      }];

      for (var k = 0; k < landingIndexes.length; k++) {
        var i = landingIndexes[k];
        var rect = letters[i].getBoundingClientRect();
        var targetX = rect.left + rect.width / 2 - logoSize / 2;
        var targetDX = targetX - startX;

        var middleDX = currentDX + (targetDX - currentDX) * 0.5;
        var baseOffset = k / landingIndexes.length;
        var span = 1 / landingIndexes.length;

        frames.push({
          offset: baseOffset + span * 0.48,
          transform:
            'translate3d(' + middleDX + 'px,-66px,0) ' +
            'rotateY(' + (k * 360 + 180) + 'deg) ' +
            'rotateZ(' + (k * 360 + 180) + 'deg)'
        });

        frames.push({
          offset: baseOffset + span * 0.84,
          transform:
            'translate3d(' +
            (currentDX + (targetDX - currentDX) * 0.88) +
            'px,-17px,0) ' +
            'rotateY(' + (k * 360 + 315) + 'deg) ' +
            'rotateZ(' + (k * 360 + 315) + 'deg)'
        });

        frames.push({
          offset: baseOffset + span,
          transform:
            'translate3d(' + targetDX + 'px,0,0) ' +
            'rotateY(' + ((k + 1) * 360) + 'deg) ' +
            'rotateZ(' + ((k + 1) * 360) + 'deg)'
        });

        currentDX = targetDX;
      }

      // Одна анимация: никаких пауз между касаниями букв.
      var travel = logo.animate(frames, {
        duration: 1560,
        easing: 'linear',
        fill: 'forwards'
      });

      await travel.finished;

      logo.style.transform =
        'translate3d(' + currentDX + 'px,0,0)';
      travel.cancel();

      // 5. Последний прыжок — на место слева от названия.
      var wordRect = word.getBoundingClientRect();
      var finalX = wordRect.left - logoSize - 13;
      var finalY = wordRect.top + (wordRect.height - logoSize) / 2;
      var finalDX = finalX - startX;
      var finalDY = finalY - baseY;

      var finish = logo.animate([
        {
          transform:
            'translate3d(' + currentDX + 'px,0,0) rotateY(0deg) rotateZ(0deg)'
        },
        {
          offset: .48,
          transform:
            'translate3d(' + ((currentDX + finalDX) / 2) +
            'px,-54px,0) rotateY(180deg) rotateZ(180deg)'
        },
        {
          transform:
            'translate3d(' + finalDX + 'px,' + finalDY +
            'px,0) rotateY(360deg) rotateZ(360deg)'
        }
      ], {
        duration: 430,
        easing: 'cubic-bezier(.16,1,.3,1)',
        fill: 'forwards'
      });

      await finish.finished;

      logo.style.transform =
        'translate3d(' + finalDX + 'px,' + finalDY + 'px,0)';
      finish.cancel();

      splash.classList.add('splash-settled');
    })().catch(function (e) {
      console.warn('Splash animation:', e);
    });

  } else {
    // Уважение системной настройки уменьшения движения.
    stage.classList.add('is-reduced');
    word.style.transform = 'translateX(30px)';
    logo.style.opacity = '1';
    window.__inomestoSplashPromise = Promise.resolve();
  }
}

function finishInomestoSplash() {
  var splash = document.getElementById('inomestoSplash');
  if (!splash) return;

  Promise.resolve(window.__inomestoSplashPromise)
    .catch(function () {})
    .then(function () {
      splash.classList.add('splash-dismissed');
      window.setTimeout(function () {
        splash.hidden = true;
      }, 750);
    });
}



/* INOMESTO IMAGE VIEWER */
(function () {
  var viewer = null;
  var image = null;
  var stage = null;
  var counter = null;
  var info = null;
  var items = [];
  var current = 0;
  var scale = 1;
  var tx = 0;
  var ty = 0;
  var pointers = new Map();
  var pinchStart = null;
  var dragStart = null;
  var lastTap = 0;

  function createViewer() {
    if (viewer) return;

    viewer = document.createElement('div');
    viewer.className = 'image-viewer';
    viewer.hidden = true;
    viewer.innerHTML =
      '<div class="image-viewer-top">' +
        '<button type="button" data-iv="close" aria-label="Закрыть"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
        '<span class="image-viewer-counter"></span>' +
        '<div class="image-viewer-tools">' +
          '<button type="button" data-iv="info" aria-label="Информация"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg></button>' +
          '<button type="button" data-iv="share" aria-label="Поделиться"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg></button>' +
          '<button type="button" data-iv="save" aria-label="Сохранить"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 19h14"/></svg></button>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="image-viewer-arrow prev" data-iv="prev" aria-label="Предыдущее фото"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>' +
      '<div class="image-viewer-stage">' +
        '<img class="image-viewer-image" alt="" draggable="false">' +
      '</div>' +
      '<button type="button" class="image-viewer-arrow next" data-iv="next" aria-label="Следующее фото"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>' +
      '<div class="image-viewer-info" hidden></div>' +
      '<div class="image-viewer-hint">Два касания или два пальца — увеличить · Свайп — переместить</div>';

    document.body.appendChild(viewer);

    stage = viewer.querySelector('.image-viewer-stage');
    image = viewer.querySelector('.image-viewer-image');
    counter = viewer.querySelector('.image-viewer-counter');
    info = viewer.querySelector('.image-viewer-info');

    viewer.addEventListener('click', function (e) {
      var button = e.target.closest('[data-iv]');
      if (button) {
        e.preventDefault();
        e.stopPropagation();
        var action = button.getAttribute('data-iv');
        if (action === 'close') closeViewer();
        if (action === 'prev') showImage(current - 1);
        if (action === 'next') showImage(current + 1);
        if (action === 'save') saveImage();
        if (action === 'share') shareImage();
        if (action === 'info') toggleInfo();
        return;
      }
      if (e.target === viewer) closeViewer();
    });

    image.addEventListener('dblclick', function (e) {
      e.preventDefault();
      if (scale > 1) resetZoom();
      else setZoom(2.5, 0, 0);
    });

    stage.addEventListener('pointerdown', pointerDown);
    stage.addEventListener('pointermove', pointerMove);
    stage.addEventListener('pointerup', pointerEnd);
    stage.addEventListener('pointercancel', pointerEnd);

    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      setZoom(scale * (e.deltaY < 0 ? 1.2 : 0.83), 0, 0);
    }, { passive: false });

    stage.addEventListener('click', function (e) {
      var now = Date.now();
      if (now - lastTap < 300) {
        if (scale > 1) resetZoom();
        else setZoom(2.5, 0, 0);
      }
      lastTap = now;
    });

    document.addEventListener('keydown', function (e) {
      if (!viewer || viewer.hidden) return;
      if (e.key === 'Escape') closeViewer();
      if (e.key === 'ArrowLeft') showImage(current - 1);
      if (e.key === 'ArrowRight') showImage(current + 1);
    });
  }

  function updateTransform() {
    if (!image) return;
    image.style.transform =
      'translate3d(' + tx + 'px,' + ty + 'px,0) scale(' + scale + ')';
  }

  function resetZoom() {
    scale = 1;
    tx = 0;
    ty = 0;
    updateTransform();
  }

  function setZoom(next, dx, dy) {
    scale = Math.max(1, Math.min(5, next));
    if (scale === 1) {
      tx = 0;
      ty = 0;
    } else {
      tx += dx || 0;
      ty += dy || 0;
    }
    updateTransform();
  }

  function showImage(index) {
    if (!items.length) return;
    current = (index + items.length) % items.length;
    var item = items[current];

    resetZoom();
    info.hidden = true;
    image.src = item.src;
    image.alt = item.alt || 'Фотография';
    counter.textContent = (current + 1) + ' / ' + items.length;

    viewer.querySelector('[data-iv="prev"]').hidden = items.length < 2;
    viewer.querySelector('[data-iv="next"]').hidden = items.length < 2;

    info.textContent = (item.alt || 'Фотография') +
      (image.naturalWidth ? ' · ' + image.naturalWidth + ' × ' + image.naturalHeight : '');

    image.onload = function () {
      info.textContent = (item.alt || 'Фотография') +
        ' · ' + image.naturalWidth + ' × ' + image.naturalHeight;
    };
  }

  function openViewer(list, index) {
    createViewer();
    items = list;
    viewer.hidden = false;
    document.body.classList.add('image-viewer-open');
    showImage(index);
  }

  function closeViewer() {
    if (!viewer || viewer.hidden) return;
    viewer.hidden = true;
    image.removeAttribute('src');
    document.body.classList.remove('image-viewer-open');
    info.hidden = true;
    pointers.clear();
    resetZoom();
  }

  function toggleInfo() {
    info.hidden = !info.hidden;
  }

  function currentItem() {
    return items[current] || null;
  }

  async function saveImage() {
    var item = currentItem();
    if (!item) return;

    try {
      var response = await fetch(item.src);
      if (!response.ok) throw new Error('Не удалось получить файл');
      var blob = await response.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = item.alt || 'inomesto-photo';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    } catch (e) {
      window.open(item.src, '_blank', 'noopener');
    }
  }

  async function shareImage() {
    var item = currentItem();
    if (!item) return;

    try {
      if (navigator.share) {
        if (navigator.canShare && window.File) {
          try {
            var response = await fetch(item.src);
            var blob = await response.blob();
            var file = new File([blob], item.alt || 'photo.jpg', {
              type: blob.type || 'image/jpeg'
            });
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({ files: [file], title: item.alt || 'Фото' });
              return;
            }
          } catch (_) {}
        }
        await navigator.share({ title: item.alt || 'Фото', url: item.src });
        return;
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(item.src);
        info.textContent = 'Ссылка на фотографию скопирована';
        info.hidden = false;
      } else {
        window.open(item.src, '_blank', 'noopener');
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        info.textContent = 'Не удалось поделиться фотографией';
        info.hidden = false;
      }
    }
  }

  function pointerDown(e) {
    if (e.target !== image) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      dragStart = { x: e.clientX, y: e.clientY, tx: tx, ty: ty };
    } else if (pointers.size === 2) {
      var p = Array.from(pointers.values());
      pinchStart = {
        distance: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y),
        scale: scale
      };
    }
  }

  function pointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    e.preventDefault();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2 && pinchStart) {
      var p = Array.from(pointers.values());
      var distance = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      setZoom(pinchStart.scale * distance / Math.max(1, pinchStart.distance), 0, 0);
    } else if (pointers.size === 1 && dragStart && scale > 1) {
      var point = pointers.get(e.pointerId);
      tx = dragStart.tx + point.x - dragStart.x;
      ty = dragStart.ty + point.y - dragStart.y;
      updateTransform();
    }
  }

  function pointerEnd(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (!pointers.size) dragStart = null;
  }

  document.addEventListener('click', function (e) {
    if (viewer && !viewer.hidden) return;

    var target = e.target.closest('.chat-image-link, .post-img');
    if (!target) return;

    var img = target.matches('img') ? target : target.querySelector('img');
    if (!img) return;

    var scope = img.closest('.post') || img.closest('[data-message-bubble]');
    var gallery = scope
      ? Array.from(scope.querySelectorAll('.post-img, .chat-image-link img'))
      : [img];

    var list = gallery.map(function (node) {
      return {
        src: node.currentSrc || node.src,
        alt: node.alt || 'Фотография'
      };
    }).filter(function (item) { return !!item.src; });

    var index = gallery.indexOf(img);
    if (!list.length) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    openViewer(list, Math.max(0, index));
  }, true);

})();

startInomestoSplash();

setupNativeAuth()
  .then(function () { return boot(); })
  .catch(function (e) { fail('Запуск не удался: ' + (e.message || e)); })
  .finally(function () { finishInomestoSplash(); });
})();
