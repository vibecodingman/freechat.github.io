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

var ME = null, STAGED = [], FEED = [], SIGNED = {}, SIGNED_EXPIRES = {}, AVATAR_URLS = {}, AVATAR_URL_EXPIRES = {}, SPACES = [], SPACE_SEARCH_RESULTS = [], SPACE_MY_ROLES = {}, SPACE_PENDING = {}, SPACE_SEARCH_TIMER = null, CONVS = [];
var CHAT_STAGED = [], CHAT_SENDING = false;
var CHAT_RECORDER = null, CHAT_RECORD_STREAM = null, CHAT_RECORD_PARTS = [], CHAT_RECORD_TIMER = null;
var CHAT_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

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

function showTab(name) {
  if (name === 'mod' && !isStaff()) {
    toast('У вас нет доступа к панели модерации');
    name = 'feed';
  }
  Array.prototype.forEach.call(document.querySelectorAll('.pane'), function (p) { p.classList.remove('active'); });
  var pane = document.getElementById('pane-' + name);
  if (pane) pane.classList.add('active');
  $$('[data-tab]').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
  window.scrollTo(0, 0);
  if (name === 'feed') { CURRENT_SPACE = null; loadFeed(); }
  if (name === 'spaces') loadSpaces();
  if (name === 'chats') loadConversations();
  if (name === 'me') renderMe();
  if (name === 'mod') loadModeration();
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

if ($('#signOut')) $('#signOut').onclick = function () { sb.auth.signOut().then(function () { location.reload(); }); };

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
  if (!ME.username) {
    showScreen('onboarding');
    $('#obName').value = ME.display_name || '';
    var hint = (user.user_metadata && (user.user_metadata.user_name || user.user_metadata.preferred_username)) || '';
    $('#obUser').value = String(hint).toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 24);
    return;
  }
  await loadNotificationPrefs();
  showScreen('app');
  startNotificationPolling();
  syncStaffUI();
  renderIdentity();
  showTab('feed');
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
    if (!name) return toast('Введите имя');
    if (uname.length < 3) return toast('Логин: минимум 3 символа латиницей');
    var r = await sb.from('profiles').update({
      display_name: name, username: uname, bio: $('#obBio').value.trim()
    }).eq('id', ME.id).select().maybeSingle();
    if (r.error) return toast(r.error.message.indexOf('duplicate') >= 0 ? 'Этот логин уже занят' : r.error.message);
    ME = r.data;
    await loadNotificationPrefs();
    showScreen('app');
    startNotificationPolling();
    syncStaffUI();
    renderIdentity();
    showTab('feed');
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
    '<button class="act" data-report="' + p.id + '">Жалоба</button></div>';

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
  box.innerHTML = '<div class="card empty">Загружаем публикации ваших каналов…</div>';
  try {
    var membership = await sb.from('space_members').select('space_id').eq('user_id', ME.id);
    if (membership.error) { fail('Не удалось загрузить подписки: ' + membership.error.message); return; }

    var ids = Array.from(new Set((membership.data || []).map(function (m) { return m.space_id; }).filter(Boolean)));
    if (!ids.length) {
      FEED = [];
      box.innerHTML = '<div class="card empty"><h3>В вашей ленте пока тихо</h3><p>Подпишитесь на интересные каналы — их новые публикации будут появляться здесь.</p><button class="btn primary" id="feedFindChannelsEmpty">Найти каналы</button></div>';
      var findEmpty = $('#feedFindChannelsEmpty');
      if (findEmpty) findEmpty.onclick = function () { showTab('spaces'); };
      return;
    }

    var spacesResult = await sb.from('spaces').select('id,name,avatar_url,is_archived,type,description,privacy,comments_enabled,owner_id,created_at').in('id', ids).eq('type', 'channel');
    if (spacesResult.error) { fail('Не удалось проверить каналы: ' + spacesResult.error.message); return; }
    var channels = (spacesResult.data || []).filter(function (s) { return !s.is_archived; });
    if (!channels.length) {
      FEED = [];
      box.innerHTML = '<div class="card empty"><h3>Вы пока не подписаны на каналы</h3><p>Найдите каналы и подпишитесь, чтобы видеть их публикации в ленте.</p><button class="btn primary" id="feedFindChannelsEmpty">Найти каналы</button></div>';
      var findNoChannels = $('#feedFindChannelsEmpty');
      if (findNoChannels) findNoChannels.onclick = function () { showTab('spaces'); };
      return;
    }

    var channelIds = channels.map(function (s) { return s.id; });
    var postsResult = await sb.from('posts').select(POST_SELECT).in('space_id', channelIds)
      .order('created_at', { ascending: false }).limit(60);
    if (postsResult.error) { fail('Лента не загрузилась: ' + postsResult.error.message); return; }

    var spacesById = {};
    channels.forEach(function (s) { spacesById[s.id] = s; });
    FEED = postsResult.data || [];
    FEED.forEach(function (p) { p._space = spacesById[p.space_id] || null; p._spaceName = (p._space && p._space.name) || 'Канал'; });
    await signPaths(FEED);
    var avatarItems = FEED.reduce(function (a, p) { a.push(p.author || {}); if (p._space) a.push({display_name:p._space.name,avatar_url:p._space.avatar_url}); (p.comments || []).forEach(function (c) { a.push(c.author || {}); }); return a; }, []);
    await signAvatarPaths(avatarItems);

    box.innerHTML = FEED.length ? FEED.map(postHtml).join('')
      : '<div class="card empty"><h3>Новых публикаций пока нет</h3><p>Вы подписаны на ' + channels.length + ' канал(а). Когда там появятся посты, они отобразятся здесь.</p><button class="btn ghost" id="feedOpenChannels">Мои каналы</button></div>';
    var openChannels = $('#feedOpenChannels');
    if (openChannels) openChannels.onclick = function () { showTab('spaces'); };
  } catch (e) { fail(e.message || e); }
}

async function loadSpacePosts() {
  var box = $('#spacePosts');
  if (!box || !CURRENT_SPACE) return;
  var r = await sb.from('posts').select(POST_SELECT).eq('space_id', CURRENT_SPACE.id)
    .order('created_at', { ascending: false }).limit(60);
  if (r.error) { box.innerHTML = '<div class="card sub">' + esc(r.error.message) + '</div>'; return; }
  var rows = r.data || [];
  await signPaths(rows);
  rows.forEach(function (p) { p._space = CURRENT_SPACE; p._spaceName = CURRENT_SPACE.name; });
  var avatarItems = rows.reduce(function (a, p) { a.push(p.author || {}, {display_name:CURRENT_SPACE.name,avatar_url:CURRENT_SPACE.avatar_url}); (p.comments || []).forEach(function (c) { a.push(c.author || {}); }); return a; }, []);
  await signAvatarPaths(avatarItems);
  box.innerHTML = rows.length ? rows.map(postHtml).join('') : '<div class="card sub">Публикаций пока нет.</div>';
  await markSpaceRead(CURRENT_SPACE.id);
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
        .in('id', ids).eq('type', 'channel').order('created_at', { ascending: false });
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
  var joined = !!s._myRole;
  var action = joined
    ? '<button class="btn primary" data-open-space="' + s.id + '">Открыть</button>'
    : s._pending
      ? '<span class="badge gray">Заявка отправлена</span>'
      : '<button class="btn primary" data-join="' + s.id + '">' +
        (s.privacy === 'private' ? 'Запросить доступ' : (s.type === 'channel' ? 'Подписаться' : 'Вступить')) +
        '</button>';
  return '<div class="card space-card"><div class="space-row"><div class="space-ico">' + (s.avatar_url ? avatarMarkup({display_name:s.name,avatar_url:s.avatar_url}, 'space-avatar') : ini(s.name)) + '</div>' +
    '<div class="grow"><div><b>' + esc(s.name) + '</b> <span class="badge gray">' + (s.type === 'channel' ? 'Канал' : 'Сообщество') + '</span>' +
    ' <span class="badge gray">' + (s.privacy === 'private' ? 'Закрытое' : 'Открытое') + '</span>' +
    (s.is_archived ? ' <span class="badge gray">В архиве</span>' : '') + '</div>' +
    '<div class="sub">' + nf(s._count) + ' участников · владелец @' + esc((s.owner || {}).username || '—') + '</div>' +
    (s.description ? '<div class="space-description">' + esc(s.description) + '</div>' : '') +
    ((s._unread && ((NOTIF_PREFS.space_badges && s._unread.posts) || (NOTIF_PREFS.comment_badges && s._unread.comments))) ? '<div class="unread-pills">' + (NOTIF_PREFS.space_badges && s._unread.posts ? '<span class="unread-badge">' + nf(s._unread.posts) + ' новых</span>' : '') + (NOTIF_PREFS.comment_badges && s._unread.comments ? '<span class="unread-badge comments">' + nf(s._unread.comments) + ' комментариев</span>' : '') + '</div>' : '') + '</div>' +
    action + '</div></div>';
}

function spaceSectionHtml(title, hint, items, emptyText) {
  return '<section class="space-section"><div class="space-section-head"><div><h2>' + title + '</h2><p class="muted">' + hint + '</p></div>' +
    '<span class="section-count">' + items.length + '</span></div>' +
    (items.length ? items.map(spaceCardHtml).join('') : '<div class="card empty space-empty">' + emptyText + '</div>') +
    '</section>';
}

function renderSpaceList() {
  CURRENT_SPACE = null;
  var input = $('#spaceSearchInput');
  var term = input ? input.value.trim() : '';
  var html = spaceSectionHtml('Мои каналы', 'Все каналы, на которые вы подписаны', SPACES,
    'Вы пока не подписаны ни на один канал. Найдите интересный канал через поиск выше.');
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

  var html = '<div class="card space-header-card"><div class="space-header-actions">' +
    '<button class="btn ghost" data-back-spaces="1">← К списку каналов</button>' +
    '<div class="row gap wrap">' +
    (!s._myRole ? (s._pending
      ? '<span class="badge gray">Заявка отправлена</span>'
      : '<button class="btn primary" data-join="' + s.id + '">' + (s.privacy === 'private' ? 'Запросить доступ' : (s.type === 'channel' ? 'Подписаться' : 'Вступить')) + '</button>') : '') +
    (localAdmin ? '<label class="btn ghost space-avatar-change">Аватар канала<input type="file" id="spaceAvatarPick" accept="image/*" hidden></label><button class="btn ghost" data-invite="' + s.id + '">Ссылка-приглашение</button>' : '') +
    (adm ? '<button class="btn ghost" data-del-space="' + s.id + '">Удалить</button>' : '') +
    '</div></div>' +
    '<div class="space-row space-profile"><div class="space-ico">' + (s.avatar_url ? avatarMarkup({display_name:s.name,avatar_url:s.avatar_url}, 'space-avatar') : ini(s.name)) + '</div><div class="grow">' +
    '<div class="space-title-line"><b>' + esc(s.name) + '</b> <span class="badge gray">' + (s.type === 'channel' ? 'Канал' : 'Сообщество') + '</span></div>' +
    '<div class="sub">' + nf(s._count) + ' участников · ' + (s.comments_enabled ? 'комментарии включены' : 'комментарии отключены') + '</div>' +
    (s.description ? '<div class="space-description">' + esc(s.description) + '</div>' : '') + '</div></div></div>';

  if (canPost) {
    html += '<section class="card space-composer-card">' +
      '<div class="space-composer-heading"><div><h3>Новая публикация</h3><p>Поделитесь новостью или задайте вопрос участникам</p></div></div>' +
      '<textarea id="spaceComposerText" class="space-composer-text" rows="4" placeholder="О чём хотите рассказать?"></textarea>' +
      '<div class="staged" id="stagedSpace"></div>' +
      '<div class="space-composer-footer"><div class="space-composer-tools">' +
      '<label class="space-tool"><input type="file" id="spacePickPhoto" accept="image/*" multiple hidden><span aria-hidden="true">▧</span> Фото</label>' +
      '<label class="space-tool"><input type="file" id="spacePickFile" multiple hidden><span aria-hidden="true">↥</span> Файл</label>' +
      '<label class="space-comments-toggle"><input type="checkbox" id="spaceAllowComments"' + (s.comments_enabled ? ' checked' : '') + '> Комментарии</label>' +
      '</div><button class="btn primary space-publish-btn" id="spacePublish">Опубликовать</button></div>' +
      '<div class="space-composer-note">Можно прикрепить фото или файл размером до 100 МБ</div></section>';
  }

  // Список участников и инструменты управления доступны только владельцу/администратору пространства
  // или глобальной команде проекта.
  if (adm) {
    html += '<div class="card"><h3>Участники и управление</h3><div id="memberList" class="sub">Загрузка…</div></div>';
  }
  if (localAdmin) {
    html += '<div class="card"><h3>Заявки на вступление</h3><div id="requestList" class="sub">Загрузка…</div></div>';
  }
  html += '<div id="spacePosts"></div>';

  $('#spaceView').innerHTML = html;
  if ($('#spacePublish')) $('#spacePublish').onclick = function () { publishPost(s.id); };
  if ($('#spacePickPhoto')) $('#spacePickPhoto').onchange = function () { addStaged(this.files); this.value = ''; };
  if ($('#spacePickFile')) $('#spacePickFile').onchange = function () { addStaged(this.files); this.value = ''; };
  if ($('#spaceAvatarPick')) $('#spaceAvatarPick').onchange = async function () { var f = this.files && this.files[0]; this.value = ''; if (f) await uploadSpaceAvatar(s, f); };
  loadSpacePosts();
  if (adm) loadMembers(s.id, true);
  if (localAdmin) loadRequests(s.id);
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
  try {
    var mem = await sb.from('conversation_members').select('conversation_id').eq('user_id', ME.id);
    var ids = (mem.data || []).map(function (m) { return m.conversation_id; });
    var all = { data: [] };
    CONVS = [];

    if (ids.length) {
      var cs = await sb.from('conversations').select('id,is_support,owner_user').in('id', ids);
      all = await sb.from('conversation_members')
        .select('conversation_id,user_id,profiles(display_name,username,avatar_url)').in('conversation_id', ids);
      (cs.data || []).forEach(function (c) {
        var others = (all.data || []).filter(function (m) { return m.conversation_id === c.id && m.user_id !== ME.id; });
        var o = others[0] || {};
        CONVS.push({
          id: c.id, is_support: c.is_support, owner_user: c.owner_user,
          title: c.is_support ? 'Чат поддержки' : ((o.profiles || {}).display_name || 'Диалог'),
          sub: c.is_support ? 'Обращение к владельцу и совладельцам' : '@' + ((o.profiles || {}).username || '—'),
          target: o.user_id || null, _profile: o.profiles || {}
        });
      });
    }

    if (isStaff()) {
      var sup = await sb.from('conversations')
        .select('id,is_support,owner_user,profiles!conversations_owner_user_fkey(display_name,username)')
        .eq('is_support', true);
      (sup.data || []).forEach(function (c) {
        if (CONVS.some(function (x) { return x.id === c.id; })) return;
        var p = c.profiles || {};
        CONVS.push({
          id: c.id, is_support: true, owner_user: c.owner_user, staffView: true,
          title: 'Поддержка: ' + (p.display_name || 'пользователь'),
          sub: '@' + (p.username || '—'), target: c.owner_user
        });
      });
    }
    await signAvatarPaths((all.data || []).map(function (m) { return m.profiles || {}; }));
    CONV_UNREAD = {};
    var convIds = CONVS.filter(function (c) { return !c.staffView; }).map(function (c) { return c.id; });
    if (convIds.length) {
      var cc = await sb.from('notification_cursors').select('scope_id,last_seen_at').eq('user_id', ME.id)
        .eq('scope_type', 'conversation').in('scope_id', convIds);
      var cm = {};
      (cc.data || []).forEach(function (v) { cm[v.scope_id] = v.last_seen_at; });
      var fresh = convIds.filter(function (id) { return !cm[id]; });
      for (var ci = 0; ci < fresh.length; ci++) { await markRead('conversation', fresh[ci]); cm[fresh[ci]] = new Date().toISOString(); }
      var msgs = await sb.from('messages').select('conversation_id,sender_id,created_at')
        .in('conversation_id', convIds).neq('sender_id', ME.id).order('created_at', { ascending: false }).limit(500);
      (msgs.data || []).forEach(function (m) {
        if (new Date(m.created_at) > new Date(cm[m.conversation_id])) CONV_UNREAD[m.conversation_id] = (CONV_UNREAD[m.conversation_id] || 0) + 1;
      });
    }
    renderConvList();
  } catch (e) { fail(e.message || e); }
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
  clearInterval(poll); poll = null;
  renderConvList(); renderChatHead(); $('#pane-chats').classList.add('chat-selected');
  await loadMessages();
  if (!CURRENT_CONV || CURRENT_CONV.id !== id) return;
  await markRead('conversation', id); CONV_UNREAD[id] = 0; renderConvList();
  poll = setInterval(function () { if (CURRENT_CONV && CURRENT_CONV.id === id) loadMessages(); }, 7000);
}

async function loadMessages() {
  if (!CURRENT_CONV) return;
  var conversationId = CURRENT_CONV.id;
  var r = await sb.from('messages')
    .select('id,body,attachments,from_support,sender_id,created_at,profiles(display_name)')
    .eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(300);
  if (r.error) { if (CURRENT_CONV && CURRENT_CONV.id === conversationId) $('#messages').innerHTML = '<div class="sub">' + esc(r.error.message) + '</div>'; return; }
  var messageRows = (r.data || []).reverse();
  if (!CURRENT_CONV || CURRENT_CONV.id !== conversationId) return;
  await signMessagePaths(messageRows);
  if (!CURRENT_CONV || CURRENT_CONV.id !== conversationId) return;
  var messageIds = messageRows.map(function (m) { return m.id; });
  var reactionMap = {};
  if (messageIds.length) {
    var rx = await sb.from('message_reactions').select('message_id,user_id,emoji').in('message_id', messageIds);
    if (rx.error) console.warn('Реакции не загрузились:', rx.error.message);
    (rx.data || []).forEach(function (x) {
      if (!reactionMap[x.message_id]) reactionMap[x.message_id] = {};
      if (!reactionMap[x.message_id][x.emoji]) reactionMap[x.message_id][x.emoji] = { count: 0, mine: false };
      reactionMap[x.message_id][x.emoji].count++;
      if (x.user_id === ME.id) reactionMap[x.message_id][x.emoji].mine = true;
    });
  }
  var box = $('#messages');
  var quickReactions = CHAT_REACTIONS.slice(0, 5);
  box.innerHTML = messageRows.map(function (m) {
    var mine = m.sender_id === ME.id;
    var label = m.from_support ? 'Чат поддержки' : ((m.profiles || {}).display_name || 'Участник');
    var body = esc(m.body || '').replace(/\n/g, '<br>');
    var files = (m.attachments || []).map(chatAttachmentHtml).join('');
    var groups = reactionMap[m.id] || {};
    var reactionHtml = CHAT_REACTIONS.filter(function (emoji) { return !!groups[emoji]; }).map(function (emoji) {
      var item = groups[emoji];
      return '<button type="button" class="chat-reaction' + (item.mine ? ' mine' : '') + '" data-react-message="' + m.id + '" data-react-emoji="' + emoji + '" title="Убрать или поставить реакцию">' + emoji + ' <span>' + item.count + '</span></button>';
    }).join('');
    var quickHtml = quickReactions.map(function (emoji) {
      return '<button type="button" class="chat-picker-emoji" data-react-message="' + m.id + '" data-react-emoji="' + emoji + '" aria-label="Поставить реакцию ' + emoji + '">' + emoji + '</button>';
    }).join('');
    var allHtml = CHAT_REACTIONS.map(function (emoji) {
      return '<button type="button" class="chat-picker-emoji" data-react-message="' + m.id + '" data-react-emoji="' + emoji + '" aria-label="Поставить реакцию ' + emoji + '">' + emoji + '</button>';
    }).join('');
    return '<div class="bubble' + (mine ? ' mine' : '') + '" data-message-bubble>' +
      '<div class="chat-reaction-tools">' +
        '<div class="chat-reaction-quick">' + quickHtml +
          '<button type="button" class="chat-picker-more" data-react-more aria-label="Показать все эмодзи" title="Все эмодзи">＋</button>' +
        '</div>' +
        '<div class="chat-reaction-expanded" hidden>' + allHtml + '</div>' +
      '</div>' +
      (body ? '<div class="message-body">' + body + '</div>' : '') + files +
      '<small>' + (mine ? 'Вы' : esc(label)) + ' · ' + dateF(m.created_at) + '</small>' +
      (reactionHtml ? '<div class="chat-reactions">' + reactionHtml + '</div>' : '') + '</div>';
  }).join('') || '<div class="empty">Сообщений пока нет</div>';
  box.scrollTop = box.scrollHeight;
  if (CURRENT_CONV && CURRENT_CONV.id === conversationId) { await markRead('conversation', conversationId); CONV_UNREAD[conversationId] = 0; renderConvList(); }
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
      await loadMessages();
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
$('#enableBrowserNotifications').onclick = requestBrowserNotifications;

/* ================= ЖАЛОБЫ ================= */
async function reportPost(postId) {
  if (!ME) return toast('Сначала войдите');
  if (!ME.can_report) return toast('Подача жалоб недоступна');
  var reason = prompt('Опишите причину жалобы:');
  if (!reason || !reason.trim()) return;
  var p = FEED.filter(function (x) { return x.id === postId; })[0];
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

/* ================= ОБРАБОТЧИК КЛИКОВ ================= */
document.addEventListener('click', async function (e) {
  var t = e.target.closest('[data-like],[data-cmt],[data-report],[data-del],[data-open-space],[data-open-channel],[data-back-spaces],[data-join],[data-invite],[data-del-space],[data-conv],[data-verdict],[data-cancel-del],[data-open-support],[data-req],[data-member-admin],[data-member-kick],[data-member-ban],[data-comment-send],[data-chat-back]');
  if (!t) return;
  var d = t.dataset;

  if (d.like) {
    var post = FEED.filter(function (p) { return p.id === d.like; })[0];
    var liked = post && (post.post_likes || []).some(function (l) { return l.user_id === ME.id; });
    if (liked) await sb.from('post_likes').delete().match({ post_id: d.like, user_id: ME.id });
    else await sb.from('post_likes').insert({ post_id: d.like, user_id: ME.id });
    if (CURRENT_SPACE) loadSpacePosts(); else loadFeed();
    return;
  }
  if (d.cmt) { if (OPEN.has(d.cmt)) OPEN.delete(d.cmt); else OPEN.add(d.cmt); if (CURRENT_SPACE) loadSpacePosts(); else loadFeed(); return; }
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
    var single = confirm('Одноразовая ссылка?\nОК — одноразовая, Отмена — многоразовая.');
    var token = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    var ir = await sb.from('space_invites').insert({ space_id: d.invite, token: token, single_use: single, created_by: ME.id });
    if (ir.error) return fail(ir.error.message);
    prompt('Ссылка-приглашение (скопируйте):', location.origin + location.pathname + '?invite=' + token);
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

async function checkInvite() {
  var m = location.search.match(/[?&]invite=([^&]+)/);
  if (!m || !ME) return;
  var r = await sb.rpc('join_by_invite', { tok: decodeURIComponent(m[1]) });
  toast(r.error ? r.error.message : r.data);
  history.replaceState({}, '', location.pathname);
  loadSpaces();
}

setupNativeAuth()
  .then(function () { return boot(); })
  .then(checkInvite)
  .catch(function (e) { fail('Запуск не удался: ' + (e.message || e)); });
})();
