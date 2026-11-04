/* ============================================================
   Круг — клиентская логика. Работает на GitHub Pages + Supabase.
   ============================================================ */
(function () {
'use strict';

var CFG = window.CONFIG || {};
var MAX = CFG.MAX_FILE_BYTES || (100 * 1024 * 1024);

if (!window.supabase || !CFG.SUPABASE_URL) {
  document.body.innerHTML = '<div style="padding:40px;font:15px system-ui">Не загрузился клиент Supabase. Проверьте интернет и файл config.js.</div>';
  return;
}

var sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

var ME = null, STAGED = [], FEED = [], SIGNED = {}, SPACES = [], CONVS = [];
var CURRENT_SPACE = null, CURRENT_CONV = null, OPEN = new Set(), poll = null;

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
var isStaff = function () { return !!(ME && (ME.is_owner || ME.is_coowner)); };

function toast(msg) {
  var t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(function () { t.classList.remove('show'); }, 3000);
}

function showScreen(id) {
  $$('.screen').forEach(function (s) { s.classList.remove('active'); });
  var el = document.getElementById('screen-' + id);
  if (el) el.classList.add('active');
}

function showTab(name) {
  $$('.pane').forEach(function (p) { p.classList.remove('active'); });
  var pane = document.getElementById('pane-' + name);
  if (pane) pane.classList.add('active');
  $$('[data-tab]').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
  window.scrollTo(0, 0);
  if (name === 'feed') loadFeed();
  if (name === 'spaces') loadSpaces();
  if (name === 'chats') loadConversations();
  if (name === 'me') renderMe();
  if (name === 'mod') loadModeration();
}

/* ---------------- ВХОД ---------------- */
$('#signInGoogle').onclick = function () {
  var back = location.origin + location.pathname;
  sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: back } }).then(function (r) {
    if (r.error) toast('Ошибка входа: ' + r.error.message);
  });
};

$('#signOut').onclick = function () {
  sb.auth.signOut().then(function () { location.reload(); });
};

async function boot() {
  var s = await sb.auth.getSession();
  if (!s.data.session) { showScreen('auth'); return; }
  await afterLogin(s.data.session.user);
}

async function afterLogin(user) {
  var r = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (r.error) { toast(r.error.message); showScreen('auth'); return; }
  ME = r.data;
  if (!ME) {
    var name = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || (user.email || '').split('@')[0];
    var ins = await sb.from('profiles').insert({
      id: user.id,
      display_name: name,
      avatar_url: (user.user_metadata && user.user_metadata.avatar_url) || null
    }).select().maybeSingle();
    if (ins.error) { toast('Не удалось создать профиль: ' + ins.error.message); showScreen('auth'); return; }
    ME = ins.data;
  }
  if (!ME.username) { showScreen('onboarding'); $('#obName').value = ME.display_name || ''; return; }
  showScreen('app');
  if (isStaff()) $$('.staff-only').forEach(function (b) { b.hidden = false; });
  renderIdentity();
  showTab('feed');
}

function renderIdentity() {
  var muted = ME.muted_forever || (ME.muted_until && new Date(ME.muted_until) > new Date());
  var b = $('#muteBanner');
  if (muted) {
    b.hidden = false;
    b.textContent = ME.muted_forever
      ? 'Вам запрещено писать и подавать жалобы. Личные чаты, начатые ранее, по-прежнему доступны.'
      : 'Мут до ' + dateF(ME.muted_until) + '. Личные чаты, начатые ранее, по-прежнему доступны.';
  } else { b.hidden = true; }
}

$('#saveOnboarding').onclick = async function () {
  var name = $('#obName').value.trim();
  var uname = $('#obUser').value.trim().toLowerCase().replace(/[^a-z0-9_.]/g, '');
  if (!name) return toast('Введите имя');
  if (uname.length < 3) return toast('Имя пользователя: минимум 3 символа латиницей');
  var r = await sb.from('profiles').update({
    display_name: name, username: uname, bio: $('#obBio').value.trim()
  }).eq('id', ME.id).select().maybeSingle();
  if (r.error) return toast(r.error.message.indexOf('duplicate') >= 0 ? 'Этот логин уже занят' : r.error.message);
  ME = r.data;
  showScreen('app');
  if (isStaff()) $$('.staff-only').forEach(function (b) { b.hidden = false; });
  renderIdentity();
  showTab('feed');
};

/* ---------------- ВЛОЖЕНИЯ ---------------- */
function addStaged(files) {
  Array.prototype.forEach.call(files, function (f) {
    if ((f.type || '').indexOf('video/') === 0) return toast('Видео прикреплять нельзя');
    if (f.size > MAX) return toast('Файл больше 100 МБ: ' + f.name);
    STAGED.push(f);
  });
  renderStaged();
}
function renderStaged() {
  $('#staged').innerHTML = STAGED.map(function (f, i) {
    return '<span class="stage-chip">' + esc(f.name) + ' · ' + sizeF(f.size) +
      ' <button data-unstage="' + i + '" type="button">×</button></span>';
  }).join('');
}
document.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-unstage]');
  if (btn) { STAGED.splice(+btn.dataset.unstage, 1); renderStaged(); }
});

$('#pickPhoto').onchange = function () { addStaged(this.files); this.value = ''; };
$('#pickFile').onchange = function () { addStaged(this.files); this.value = ''; };

async function uploadStaged() {
  var out = [];
  for (var i = 0; i < STAGED.length; i++) {
    var f = STAGED[i];
    var clean = f.name.replace(/[^\w.\-]+/g, '_').slice(-60) || 'file';
    var path = ME.id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + clean;
    var up = await sb.storage.from('attachments').upload(path, f, {
      contentType: f.type || 'application/octet-stream', upsert: false
    });
    if (up.error) throw new Error('Не загрузилось: ' + f.name + ' — ' + up.error.message);
    out.push({ path: path, name: f.name, size: f.size, mime: f.type || '' });
  }
  return out;
}

async function signPaths(items) {
  var paths = [];
  items.forEach(function (p) {
    (p.post_attachments || []).forEach(function (a) { if (!SIGNED[a.path]) paths.push(a.path); });
  });
  if (!paths.length) return;
  var r = await sb.storage.from('attachments').createSignedUrls(paths, 3600);
  (r.data || []).forEach(function (s) { if (s && s.signedUrl) SIGNED[s.path] = s.signedUrl; });
}

/* ---------------- ПОСТЫ ---------------- */
var POST_SELECT =
  'id,content,created_at,comments_enabled,author_id,space_id,' +
  'author:profiles!posts_author_id_fkey(display_name,username,is_verified),' +
  'post_attachments(id,path,name,size,mime),' +
  'post_likes(user_id),' +
  'comments(id,content,created_at,author_id,author:profiles!comments_author_id_fkey(display_name))';

function postHtml(p) {
  var a = p.author || {};
  var atts = p.post_attachments || [];
  var imgs = atts.filter(function (x) { return String(x.mime || '').indexOf('image/') === 0; });
  var files = atts.filter(function (x) { return String(x.mime || '').indexOf('image/') !== 0; });
  var likes = (p.post_likes || []).length;
  var liked = (p.post_likes || []).some(function (l) { return l.user_id === ME.id; });
  var comments = p.comments || [];
  var open = OPEN.has(p.id);

  var html = '<article class="card post" data-post="' + p.id + '"><div class="post-head">' +
    '<div class="av">' + ini(a.display_name) + '</div><div class="who grow"><strong>' + esc(a.display_name || 'Без имени') + '</strong>' +
    (a.is_verified ? '<span class="badge">✓</span>' : '') +
    '<div>@' + esc(a.username || '—') + ' · ' + dateF(p.created_at) + '</div></div>' +
    '<button class="act" data-report="' + p.id + '" title="Пожаловаться">Жалоба</button></div>';

  if (p.content) html += '<div class="post-text">' + esc(p.content) + '</div>';

  imgs.forEach(function (x) {
    if (SIGNED[x.path]) html += '<img class="post-img" src="' + SIGNED[x.path] + '" alt="' + esc(x.name) + '" loading="lazy">';
  });
  files.forEach(function (x) {
    html += '<a class="post-file" href="' + (SIGNED[x.path] || '#') + '" target="_blank" rel="noopener">' +
      '<div class="space-ico" style="width:36px;height:36px;flex-basis:36px;font-size:11px">' + esc((x.name.split('.').pop() || 'файл').toUpperCase().slice(0, 4)) + '</div>' +
      '<div><div><b>' + esc(x.name) + '</b></div><div class="sub">' + sizeF(x.size) + '</div></div></a>';
  });

  html += '<div class="post-actions">' +
    '<button class="act' + (liked ? ' on' : '') + '" data-like="' + p.id + '">♥ ' + nf(likes) + '</button>' +
    '<button class="act" data-cmt="' + p.id + '">Комментарии (' + comments.length + ')</button>' +
    (p.author_id === ME.id || isStaff() ? '<button class="act" data-del="' + p.id + '">Удалить</button>' : '') +
    '</div>';

  if (open) {
    html += '<div class="comments">';
    if (!p.comments_enabled) {
      html += '<div class="sub">Автор отключил комментарии.</div>';
    } else {
      comments.forEach(function (c) {
        html += '<div class="comment"><b>' + esc((c.author || {}).display_name || 'Участник') + '</b>' + esc(c.content) + '</div>';
      });
      html += '<div class="comment-form"><input data-comment-input="' + p.id + '" placeholder="Комментарий…">' +
        '<button class="btn ghost" data-comment-send="' + p.id + '">Отправить</button></div>';
    }
    html += '</div>';
  }
  return html + '</article>';
}

async function loadFeed() {
  var r = await sb.from('posts').select(POST_SELECT).is('space_id', null).order('created_at', { ascending: false }).limit(40);
  if (r.error) { $('#feed').innerHTML = '<div class="card"><div class="sub">' + esc(r.error.message) + '</div></div>'; return; }
  FEED = r.data || [];
  await signPaths(FEED);
  $('#feed').innerHTML = FEED.length ? FEED.map(postHtml).join('')
    : '<div class="card empty"><b>Пока пусто</b><br>Станьте первым — напишите первый пост.</div>';
}

async function loadSpacePosts() {
  var box = $('#spacePosts');
  var r = await sb.from('posts').select(POST_SELECT).eq('space_id', CURRENT_SPACE.id).order('created_at', { ascending: false }).limit(60);
  if (r.error) { box.innerHTML = '<div class="sub">' + esc(r.error.message) + '</div>'; return; }
  var rows = r.data || [];
  await signPaths(rows);
  box.innerHTML = rows.length ? rows.map(postHtml).join('') : '<div class="sub">Публикаций пока нет.</div>';
}

async function publishPost(spaceId) {
  var box = spaceId ? $('#spaceComposerText') : $('#postText');
  var text = (box && box.value || '').trim();
  var allowed = spaceId ? $('#spaceAllowComments') : $('#allowComments');
  if (!text && !STAGED.length) return toast('Добавьте текст или вложение');
  if (ME.muted_forever) return toast('Вам запрещено писать');

  var ins = await sb.from('posts').insert({
    author_id: ME.id, content: text, space_id: spaceId || null,
    comments_enabled: allowed ? allowed.checked : true
  }).select().maybeSingle();
  if (ins.error) return toast(ins.error.message);

  try {
    var atts = await uploadStaged();
    if (atts.length) {
      atts.forEach(function (a) { a.post_id = ins.data.id; });
      var ar = await sb.from('post_attachments').insert(atts);
      if (ar.error) toast('Пост создан, но вложения не привязались');
    }
  } catch (err) { toast(err.message); }

  STAGED = []; renderStaged();
  if (box) box.value = '';
  toast('Опубликовано');
  if (spaceId) loadSpacePosts(); else loadFeed();
}

$('#publish').onclick = function () { publishPost(null); };

/* ---------------- ПРОСТРАНСТВА ---------------- */
async function loadSpaces() {
  var r = await sb.from('spaces')
    .select('id,type,name,description,privacy,comments_enabled,is_archived,owner_id,owner:profiles!spaces_owner_id_fkey(display_name,username),members:space_members(count)')
    .order('created_at', { ascending: false }).limit(60);
  if (r.error) { $('#spaceView').innerHTML = '<div class="card sub">' + esc(r.error.message) + '</div>'; return; }

  var mine = await sb.from('space_members').select('space_id,role,banned_forever').eq('user_id', ME.id);
  var myMap = {};
  (mine.data || []).forEach(function (m) { myMap[m.space_id] = m; });
  var reqs = await sb.from('join_requests').select('space_id,status').eq('user_id', ME.id);
  var reqMap = {};
  (reqs.data || []).forEach(function (q) { reqMap[q.space_id] = q.status; });

  SPACES = (r.data || []).map(function (s) {
    s._myRole = myMap[s.id] ? myMap[s.id].role : null;
    s._pending = reqMap[s.id] === 'pending';
    s._count = (s.members && s.members[0] && s.members[0].count) || 0;
    return s;
  });

  if (CURRENT_SPACE) {
    var found = SPACES.filter(function (s) { return s.id === CURRENT_SPACE.id; })[0];
    if (found) { CURRENT_SPACE = found; return openSpace(found, true); }
  }
  renderSpaceList();
}

function renderSpaceList() {
  if (!SPACES.length) {
    $('#spaceView').innerHTML = '<div class="card empty"><b>Пространств пока нет</b><br>Создайте первое — канал или сообщество.</div>';
    return;
  }
  $('#spaceView').innerHTML = SPACES.map(function (s) {
    var badge = s.type === 'channel' ? 'Канал' : 'Сообщество';
    var priv = s.privacy === 'private' ? 'Закрытое' : 'Открытое';
    return '<div class="card"><div class="space-row"><div class="space-ico">' + ini(s.name) + '</div>' +
      '<div class="grow"><div><b>' + esc(s.name) + '</b> <span class="badge gray">' + badge + '</span> <span class="badge gray">' + priv + '</span>' +
      (s.is_archived ? ' <span class="badge gray">В архиве</span>' : '') + '</div>' +
      '<div class="sub">' + nf(s._count) + ' участников · владелец @' + esc((s.owner || {}).username || '—') + '</div>' +
      (s.description ? '<div class="sub">' + esc(s.description) + '</div>' : '') + '</div>' +
      '<button class="btn primary" data-open-space="' + s.id + '">Открыть</button></div></div>';
  }).join('');
}

async function openSpace(s, keep) {
  CURRENT_SPACE = s;
  var isOwnerOrAdmin = s._myRole === 'owner' || s._myRole === 'admin' || isStaff();
  var canPost = s.type === 'channel' ? isOwnerOrAdmin : (!!s._myRole || isStaff());
  var html = '<div class="card"><div class="row between wrap gap">' +
    '<button class="btn ghost" data-back-spaces="1">← Все пространства</button>' +
    '<div class="row gap">' +
    (s._myRole ? '' : (s._pending
      ? '<span class="badge gray">Заявка отправлена</span>'
      : '<button class="btn primary" data-join="' + s.id + '">' + (s.privacy === 'private' ? 'Подать заявку' : 'Вступить') + '</button>')) +
    (isOwnerOrAdmin ? '<button class="btn ghost" data-invite="' + s.id + '">Ссылка-приглашение</button>' : '') +
    (isOwnerOrAdmin ? '<button class="btn ghost" data-del-space="' + s.id + '">Удалить</button>' : '') +
    '</div></div>' +
    '<div class="space-row mt"><div class="space-ico">' + ini(s.name) + '</div><div class="grow">' +
    '<div><b style="font-size:17px">' + esc(s.name) + '</b> <span class="badge gray">' + (s.type === 'channel' ? 'Канал' : 'Сообщество') + '</span></div>' +
    '<div class="sub">' + nf(s._count) + ' участников · ' + (s.comments_enabled ? 'комментарии включены' : 'комментарии отключены') + '</div>' +
    (s.description ? '<div class="sub">' + esc(s.description) + '</div>' : '') + '</div></div>';

  if (canPost) {
    html += '<div class="mt"><textarea id="spaceComposerText" placeholder="Новая публикация в «' + esc(s.name) + '»"></textarea>' +
      '<div class="row between mt"><label class="check"><input type="checkbox" id="spaceAllowComments"' + (s.comments_enabled ? ' checked' : '') + '> Комментарии</label>' +
      '<button class="btn primary" id="spacePublish">Опубликовать</button></div></div>';
  }
  html += '<div class="staged" id="stagedSpace"></div></div>';

  html += '<div class="card"><h3>Участники</h3><div id="memberList" class="sub">Загрузка…</div></div>';
  if (isOwnerOrAdmin) html += '<div class="card"><h3>Заявки на вступление</h3><div id="requestList" class="sub">Загрузка…</div></div>';
  html += '<div id="spacePosts"></div>';

  $('#spaceView').innerHTML = html;
  if ($('#spacePublish')) $('#spacePublish').onclick = function () { publishPost(s.id); };
  loadSpacePosts();
  loadMembers(s.id, isOwnerOrAdmin);
  if (isOwnerOrAdmin) loadRequests(s.id);
}

async function loadMembers(spaceId, admin) {
  var r = await sb.from('space_members')
    .select('user_id,role,banned_forever,profiles(display_name,username,is_verified)')
    .eq('space_id', spaceId).limit(200);
  var box = $('#memberList');
  if (!box) return;
  if (r.error) { box.textContent = r.error.message; return; }
  box.innerHTML = (r.data || []).map(function (m) {
    var p = m.profiles || {};
    return '<div class="member-row"><div class="av sm">' + ini(p.display_name) + '</div>' +
      '<div class="grow">' + esc(p.display_name || '—') + ' <span class="sub">@' + esc(p.username || '—') + '</span></div>' +
      '<span class="badge gray">' + ({ owner: 'владелец', admin: 'админ', member: 'участник' }[m.role] || m.role) + '</span>' +
      (m.banned_forever ? '<span class="badge gray">заблокирован</span>' : '') +
      (admin ? '<button class="act" data-member-admin="' + spaceId + ':' + m.user_id + '">Админ</button>' +
               '<button class="act" data-member-kick="' + spaceId + ':' + m.user_id + '">Исключить</button>' +
               '<button class="act" data-member-ban="' + spaceId + ':' + m.user_id + '">Навсегда</button>' : '') +
      '</div>';
  }).join('') || '<div class="sub">Пока никого.</div>';
}

async function loadRequests(spaceId) {
  var r = await sb.from('join_requests')
    .select('id,user_id,profiles(display_name,username)').eq('space_id', spaceId).eq('status', 'pending');
  var box = $('#requestList');
  if (!box) return;
  if (r.error) { box.textContent = r.error.message; return; }
  box.innerHTML = (r.data || []).map(function (q) {
    var p = q.profiles || {};
    return '<div class="member-row"><div class="av sm">' + ini(p.display_name) + '</div>' +
      '<div class="grow">' + esc(p.display_name || '—') + ' <span class="sub">@' + esc(p.username || '—') + '</span></div>' +
      '<button class="act" data-req="' + q.id + ':approved:' + q.user_id + '">Принять</button>' +
      '<button class="act" data-req="' + q.id + ':rejected:' + q.user_id + '">Отклонить</button></div>';
  }).join('') || '<div class="sub">Новых заявок нет.</div>';
}

/* создание пространства */
$('#openSpaceModal').onclick = function () { $('#spaceModal').hidden = false; };
$('#closeSpaceModal').onclick = function () { $('#spaceModal').hidden = true; };
$('#spaceModal').onclick = function (e) { if (e.target === $('#spaceModal')) $('#spaceModal').hidden = true; };

$('#createSpace').onclick = async function () {
  var name = $('#spName').value.trim();
  if (!name) return toast('Введите название');
  var privacy = $('#spPrivacy').value;
  if (privacy === 'private' && !ME.is_verified && !isStaff()) {
    return toast('Для закрытого пространства нужна галочка верификации');
  }
  var r = await sb.from('spaces').insert({
    owner_id: ME.id, type: $('#spType').value, name: name,
    description: $('#spDesc').value.trim(), privacy: privacy,
    comments_enabled: $('#spComments').checked
  }).select().maybeSingle();
  if (r.error) return toast(r.error.message);
  await sb.from('space_members').insert({ space_id: r.data.id, user_id: ME.id, role: 'owner' });
  $('#spaceModal').hidden = true;
  $('#spName').value = ''; $('#spDesc').value = '';
  toast('Пространство создано');
  CURRENT_SPACE = null;
  loadSpaces();
};

/* ---------------- ЧАТЫ ---------------- */
async function loadConversations() {
  var mem = await sb.from('conversation_members').select('conversation_id').eq('user_id', ME.id);
  var ids = (mem.data || []).map(function (m) { return m.conversation_id; });
  CONVS = [];

  if (ids.length) {
    var cs = await sb.from('conversations').select('id,is_support,owner_user').in('id', ids);
    var all = await sb.from('conversation_members')
      .select('conversation_id,user_id,profiles(display_name,username)').in('conversation_id', ids);
    (cs.data || []).forEach(function (c) {
      var others = (all.data || []).filter(function (m) { return m.conversation_id === c.id && m.user_id !== ME.id; });
      CONVS.push({
        id: c.id, is_support: c.is_support, owner_user: c.owner_user,
        title: c.is_support ? 'Чат поддержки' : ((others[0] && others[0].profiles && others[0].profiles.display_name) || 'Диалог'),
        sub: c.is_support ? 'Обращение к владельцу и совладельцам' : '@' + (((others[0] || {}).profiles || {}).username || '—'),
        target: (others[0] || {}).user_id || null
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

  renderConvList();
}

function renderConvList() {
  $('#convList').innerHTML = CONVS.length ? CONVS.map(function (c) {
    return '<div class="conv' + (CURRENT_CONV && CURRENT_CONV.id === c.id ? ' on' : '') + '" data-conv="' + c.id + '">' +
      '<div class="av sm">' + (c.is_support ? '?' : ini(c.title)) + '</div>' +
      '<div class="grow"><div style="font-size:13px;font-weight:650">' + esc(c.title) + '</div>' +
      '<div class="sub">' + esc(c.sub) + '</div></div></div>';
  }).join('') : '<div class="sub">Диалогов пока нет.</div>';
}

async function openConv(id) {
  CURRENT_CONV = CONVS.filter(function (c) { return c.id === id; })[0] || null;
  if (!CURRENT_CONV) return;
  renderConvList();
  $('#chatHead').textContent = CURRENT_CONV.title;
  await loadMessages();
  clearInterval(poll);
  poll = setInterval(loadMessages, 7000);
}

async function loadMessages() {
  if (!CURRENT_CONV) return;
  var r = await sb.from('messages')
    .select('id,body,from_support,sender_id,created_at,profiles(display_name)')
    .eq('conversation_id', CURRENT_CONV.id).order('created_at').limit(300);
  if (r.error) { $('#messages').innerHTML = '<div class="sub">' + esc(r.error.message) + '</div>'; return; }
  var box = $('#messages');
  box.innerHTML = (r.data || []).map(function (m) {
    var mine = m.sender_id === ME.id;
    var label = m.from_support ? 'Чат поддержки' : ((m.profiles || {}).display_name || 'Участник');
    return '<div class="bubble' + (mine ? ' mine' : '') + '">' + esc(m.body) +
      '<small>' + (mine ? 'Вы' : esc(label)) + ' · ' + dateF(m.created_at) + '</small></div>';
  }).join('') || '<div class="empty">Сообщений пока нет</div>';
  box.scrollTop = box.scrollHeight;
}

async function sendMessage() {
  var input = $('#msgInput');
  var body = input.value.trim();
  if (!body || !CURRENT_CONV) return;
  var fromSupport = !!(CURRENT_CONV.staffView && isStaff());
  var r = await sb.from('messages').insert({
    conversation_id: CURRENT_CONV.id, sender_id: ME.id, body: body, from_support: fromSupport
  });
  if (r.error) return toast(r.error.message);
  input.value = '';
  loadMessages();
}
$('#sendMsg').onclick = sendMessage;
$('#msgInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendMessage(); });

$('#startDm').onclick = async function () {
  var uname = $('#newDmUser').value.trim().toLowerCase().replace(/^@/, '');
  if (!uname) return toast('Введите логин');
  var p = await sb.from('profiles').select('id,display_name,username,dm_policy').eq('username', uname).maybeSingle();
  if (p.error || !p.data) return toast('Пользователь не найден');
  if (p.data.id === ME.id) return toast('Это вы');

  var ok = await sb.rpc('can_dm', { other: p.data.id });
  if (ok.error) return toast(ok.error.message);
  if (!ok.data) return toast('Этот пользователь ограничил личные сообщения');

  var mem = await sb.from('conversation_members').select('conversation_id').eq('user_id', ME.id);
  var ids = (mem.data || []).map(function (m) { return m.conversation_id; });
  if (ids.length) {
    var exist = await sb.from('conversation_members').select('conversation_id,user_id')
      .in('conversation_id', ids).eq('user_id', p.data.id).maybeSingle();
    if (exist.data) {
      await loadConversations();
      return openConv(exist.data.conversation_id);
    }
  }

  var c = await sb.from('conversations').insert({ is_support: false }).select().maybeSingle();
  if (c.error) return toast(c.error.message);
  await sb.from('conversation_members').insert([
    { conversation_id: c.data.id, user_id: ME.id },
    { conversation_id: c.data.id, user_id: p.data.id }
  ]);
  $('#newDmUser').value = '';
  await loadConversations();
  openConv(c.data.id);
};

$('#openSupport').onclick = async function () {
  var r = await sb.from('conversations').select('id').eq('is_support', true).eq('owner_user', ME.id).maybeSingle();
  var cid = r.data && r.data.id;
  if (!cid) {
    var c = await sb.from('conversations').insert({ is_support: true, owner_user: ME.id }).select().maybeSingle();
    if (c.error) return toast(c.error.message);
    cid = c.data.id;
    await sb.from('conversation_members').insert({ conversation_id: cid, user_id: ME.id });
  }
  showTab('chats');
  await loadConversations();
  openConv(cid);
};

/* ---------------- ПРОФИЛЬ ---------------- */
function renderMe() {
  $('#meName').textContent = ME.display_name || 'Без имени';
  $('#meMeta').textContent = '@' + (ME.username || '—') +
    (ME.is_owner ? ' · владелец соцсети' : ME.is_coowner ? ' · совладелец' : '') +
    (ME.is_verified ? ' · верифицирован' : '');
  $('#setName').value = ME.display_name || '';
  $('#setUser').value = ME.username || '';
  $('#setBio').value = ME.bio || '';
  $('#setDm').value = ME.dm_policy || 'everyone';

  var muted = ME.muted_forever || (ME.muted_until && new Date(ME.muted_until) > new Date());
  var st = [];
  st.push('Предупреждений: <b>' + (ME.warns || 0) + '</b>');
  if (ME.muted_forever) st.push('<span class="badge gray">вечный мут</span>');
  else if (muted) st.push('<span class="badge gray">мут до ' + dateF(ME.muted_until) + '</span>');
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
  var uname = $('#setUser').value.trim().toLowerCase().replace(/[^a-z0-9_.]/g, '');
  if (uname.length < 3) return toast('Логин: минимум 3 символа');
  var r = await sb.from('profiles').update({
    display_name: $('#setName').value.trim() || ME.display_name,
    username: uname,
    bio: $('#setBio').value.trim(),
    dm_policy: $('#setDm').value
  }).eq('id', ME.id).select().maybeSingle();
  if (r.error) return toast(r.error.message.indexOf('duplicate') >= 0 ? 'Этот логин уже занят' : r.error.message);
  ME = r.data;
  renderMe(); renderIdentity(); renderConvList();
  toast('Сохранено');
};

/* ---------------- ЖАЛОБЫ ---------------- */
async function reportPost(postId) {
  if (!ME.can_report) return toast('Подача жалоб недоступна');
  var reason = prompt('Опишите причину жалобы:');
  if (!reason || !reason.trim()) return;
  var p = FEED.filter(function (x) { return x.id === postId; })[0];
  var r = await sb.from('reports').insert({
    reporter_id: ME.id, post_id: postId, space_id: (p && p.space_id) || null, reason: reason.trim()
  });
  toast(r.error ? r.error.message : 'Жалоба отправлена владельцу и совладельцам');
}

/* ---------------- МОДЕРАЦИЯ ---------------- */
async function loadModeration() {
  if (!isStaff()) return;
  var r = await sb.from('reports')
    .select('id,reason,status,created_at,reporter_id,post_id,reporter:profiles!reports_reporter_id_fkey(display_name,username)')
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
    return '<div class="member-row"><div class="grow">' + esc((x.spaces || {}).name || x.space_id) +
      '<div class="sub">удаление после ' + dateF(x.confirm_after) + '</div></div>' +
      '<button class="act" data-cancel-del="' + x.id + '">Отменить</button></div>';
  }).join('') || '<div class="sub">Отложенных удалений нет.</div>';

  var s = await sb.from('conversations').select('id,is_support,owner_user,profiles!conversations_owner_user_fkey(display_name,username)').eq('is_support', true);
  $('#supportList').innerHTML = (s.data || []).map(function (c) {
    var p = c.profiles || {};
    return '<div class="member-row"><div class="av sm">' + ini(p.display_name) + '</div>' +
      '<div class="grow">' + esc(p.display_name || '—') + ' <span class="sub">@' + esc(p.username || '—') + '</span></div>' +
      '<button class="act" data-open-support="' + c.id + '">Открыть</button></div>';
  }).join('') || '<div class="sub">Обращений нет.</div>';
}

$$('[data-staff]').forEach(function (btn) {
  btn.onclick = async function () {
    var uname = $('#staffUser').value.trim().toLowerCase().replace(/^@/, '');
    if (!uname) return toast('Введите логин');
    var p = await sb.from('profiles').select('id,display_name,username').eq('username', uname).maybeSingle();
    if (!p.data) return toast('Пользователь не найден');
    var action = btn.dataset.staff, res;

    if (action === 'verify')   res = await sb.rpc('set_verified', { target: p.data.id, value: true });
    if (action === 'unverify') res = await sb.rpc('revoke_verification', { target: p.data.id });
    if (action === 'coowner')  res = await sb.rpc('set_coowner', { target: p.data.id, value: true });
    if (action === 'uncoowner')res = await sb.rpc('set_coowner', { target: p.data.id, value: false });
    if (action === 'warn') {
      var why = prompt('Причина предупреждения:');
      if (!why) return;
      res = await sb.rpc('issue_warning', { target: p.data.id, why: why });
    }
    $('#staffResult').textContent = (res && (res.error ? res.error.message : res.data)) || 'Готово';
  };
});

/* ---------------- ОБРАБОТЧИКИ КЛИКОВ ---------------- */
document.addEventListener('click', async function (e) {
  var t = e.target.closest('[data-like],[data-cmt],[data-report],[data-del],[data-open-space],[data-back-spaces],[data-join],[data-invite],[data-del-space],[data-conv],[data-verdict],[data-cancel-del],[data-open-support],[data-req],[data-member-admin],[data-member-kick],[data-member-ban],[data-comment-send]');
  if (!t) return;
  var d = t.dataset;

  if (d.like) {
    var post = FEED.concat().filter(function (p) { return p.id === d.like; })[0];
    var liked = post && (post.post_likes || []).some(function (l) { return l.user_id === ME.id; });
    if (liked) await sb.from('post_likes').delete().match({ post_id: d.like, user_id: ME.id });
    else await sb.from('post_likes').insert({ post_id: d.like, user_id: ME.id });
    if (CURRENT_SPACE && $('#spacePosts').innerHTML) loadSpacePosts(); else loadFeed();
    return;
  }
  if (d.cmt) { OPEN.has(d.cmt) ? OPEN.delete(d.cmt) : OPEN.add(d.cmt); if (CURRENT_SPACE) loadSpacePosts(); else loadFeed(); return; }
  if (d.report) return reportPost(d.report);

  if (d.del) {
    if (!confirm('Удалить публикацию?')) return;
    var r = await sb.from('posts').delete().eq('id', d.del);
    if (r.error) toast(r.error.message);
    if (CURRENT_SPACE) loadSpacePosts(); else loadFeed();
    return;
  }
  if (d.commentSend) {
    var inp = $('[data-comment-input="' + d.commentSend + '"]');
    if (!inp || !inp.value.trim()) return;
    var cr = await sb.from('comments').insert({ post_id: d.commentSend, author_id: ME.id, content: inp.value.trim() });
    if (cr.error) toast(cr.error.message);
    if (CURRENT_SPACE) loadSpacePosts(); else loadFeed();
    return;
  }

  if (d.openSpace) { var s = SPACES.filter(function (x) { return x.id === d.openSpace; })[0]; if (s) openSpace(s); return; }
  if (d.backSpaces) { CURRENT_SPACE = null; renderSpaceList(); return; }
  if (d.join) {
    var sp = SPACES.filter(function (x) { return x.id === d.join; })[0];
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
    var single = confirm('Одноразовая ссылка? ОК — одноразовая, Отмена — многоразовая.');
    var token = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    var ir = await sb.from('space_invites').insert({ space_id: d.invite, token: token, single_use: single, created_by: ME.id });
    if (ir.error) return toast(ir.error.message);
    var link = location.origin + location.pathname + '?invite=' + token;
    prompt('Ссылка-приглашение (скопируйте):', link);
    return;
  }
  if (d.delSpace) {
    if (!confirm('Удалить пространство? Для пространств с 1000+ участников потребуется подтверждение.')) return;
    var dr = await sb.rpc('request_space_delete', { s: d.delSpace });
    toast(dr.error ? dr.error.message : dr.data);
    CURRENT_SPACE = null; loadSpaces(); return;
  }
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
    await sb.from('join_requests').update({ status: q[1] }).eq('id', q[0]);
    if (q[1] === 'approved') {
      await sb.from('space_members').insert({ space_id: CURRENT_SPACE.id, user_id: q[2], role: 'member' });
    }
    loadRequests(CURRENT_SPACE.id); loadMembers(CURRENT_SPACE.id, true); return;
  }
  if (d.memberAdmin || d.memberKick || d.memberBan) {
    var raw = (d.memberAdmin || d.memberKick || d.memberBan).split(':');
    var sid = raw[0], uid = raw[1];
    if (d.memberAdmin) await sb.from('space_members').update({ role: 'admin' }).match({ space_id: sid, user_id: uid });
    if (d.memberKick)  await sb.from('space_members').delete().match({ space_id: sid, user_id: uid });
    if (d.memberBan)   await sb.from('space_members').update({ banned_forever: true }).match({ space_id: sid, user_id: uid });
    loadMembers(sid, true); return;
  }
});

$$('[data-tab]').forEach(function (b) { b.onclick = function () { showTab(b.dataset.tab); }; });

/* вступление по ссылке из адреса */
async function checkInvite() {
  var m = location.search.match(/[?&]invite=([^&]+)/);
  if (!m || !ME) return;
  var r = await sb.rpc('join_by_invite', { tok: decodeURIComponent(m[1]) });
  toast(r.error ? r.error.message : r.data);
  history.replaceState({}, '', location.pathname);
  loadSpaces();
}

boot().then(checkInvite);
})();
