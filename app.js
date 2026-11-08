/* ============================================================
   supabase-lite.js — своя замена библиотеки Supabase.
   Лежит прямо в твоём репозитории, поэтому сайту НЕ нужны
   никакие внешние сети и CDN. Работает только с твоей базой.

   Что умеет (везде возвращает {data, error}, как настоящая библиотека):
     • вход через GitHub, выход, хранение сессии, обновление токена
     • чтение и запись таблиц: select / insert / update / delete
     • функции базы: rpc('имя_функции', {параметры})
     • файлы: загрузка, временные ссылки, список

   Подключается одной строкой в index.html ДО файла app-core.js:
     <script src="supabase-lite.js"></script>
   ============================================================ */
(function () {
  'use strict';

  var STORE = 'krug-supabase-auth';   /* где в браузере хранится вход */

  function enc(v) { return encodeURIComponent(v == null ? '' : String(v)); }
  function seg(p) { return String(p == null ? '' : p).split('/').map(enc).join('/'); }

  function readSaved() { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { return null; } }
  function saveSaved(s) { try { if (s) localStorage.setItem(STORE, JSON.stringify(s)); else localStorage.removeItem(STORE); } catch (e) {} }

  /* содержимое токена читается прямо в браузере: имя, почта, аватар */
  function readToken(t) {
    try {
      var p = String(t).split('.')[1] || '';
      p = p.replace(/-/g, '+').replace(/_/g, '/');
      while (p.length % 4) p += '=';
      var bin = atob(p), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } catch (e) { return {}; }
  }

  function asError(body, status, fallback) {
    var m = (body && (body.message || body.msg || body.error_description || body.error)) || fallback || 'Ошибка запроса';
    return {
      message: String(m),
      code: (body && (body.code || body.error_code)) || null,
      status: status || null,
      details: (body && body.details) || null,
      hint: (body && body.hint) || null
    };
  }

  function asJson(r) {
    return r.text().then(function (t) {
      if (!t) return {};
      try { return JSON.parse(t); } catch (e) { return { message: t.slice(0, 300) }; }
    }, function () { return {}; });
  }

  /* ==================== КЛИЕНТ ==================== */
  function Client(url, key, opts) {
    this.url = String(url || '').replace(/\/+$/, '');
    this.key = key || '';
    this.opts = opts || {};
    this.session = readSaved();
    this.listeners = [];
    this.auth = new Auth(this);
    this.storage = new Storage(this);
    var self = this;
    this._pickSessionFromUrl();
    if (this.opts.auth && this.opts.auth.autoRefreshToken !== false) {
      this._timer = setInterval(function () { self._fresh().catch(function () {}); }, 10 * 60 * 1000);
    }
  }

  Client.prototype._headers = function (extra) {
    var h = { apikey: this.key };
    h.Authorization = 'Bearer ' + ((this.session && this.session.access_token) || this.key);
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  };

  Client.prototype._emit = function (event, session) {
    this.listeners.slice().forEach(function (cb) {
      try { cb(event, session); } catch (e) {}
    });
  };

  Client.prototype._mkSession = function (j) {
    var at = j.access_token;
    var claims = readToken(at);
    var old = this.session || {};
    return {
      access_token: at,
      refresh_token: j.refresh_token || old.refresh_token || null,
      token_type: 'bearer',
      expires_in: j.expires_in || 3600,
      expires_at: j.expires_at || (Math.floor(Date.now() / 1000) + (j.expires_in || 3600)),
      user: j.user || old.user || {
        id: claims.sub,
        email: claims.email || null,
        user_metadata: claims.user_metadata || {},
        app_metadata: claims.app_metadata || {}
      }
    };
  };

  /* вход пришёл в адресе страницы — принимаем сразу, без сети */
  Client.prototype._pickSessionFromUrl = function () {
    var h = String((typeof location !== 'undefined' && location.hash) || '');
    if (!h || this.session) return;
    var at = /(?:^|[#&])access_token=([^&]+)/.exec(h);
    var rt = /(?:^|[#&])refresh_token=([^&]+)/.exec(h);
    if (!at || !rt) return;
    var s = this._mkSession({ access_token: decodeURIComponent(at[1]), refresh_token: decodeURIComponent(rt[1]) });
    this.session = s;
    saveSaved(s);
    try { history.replaceState({}, '', location.pathname + location.search); } catch (e) {}
    var self = this;
    setTimeout(function () { self._emit('SIGNED_IN', s); }, 0);
  };

  /* токен живёт час — тихо продлеваем его, когда подходит срок */
  Client.prototype._fresh = function () {
    var self = this, s = this.session;
    if (!s || !s.refresh_token) return Promise.resolve(null);
    var now = Math.floor(Date.now() / 1000);
    if (s.expires_at && s.expires_at - now > 90) return Promise.resolve(s);
    return fetch(this.url + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: this.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    }).then(asJson).then(function (j) {
      if (!j || !j.access_token) { self.session = null; saveSaved(null); return null; }
      self.session = self._mkSession(j);
      saveSaved(self.session);
      return self.session;
    }, function () { return null; });
  };

  /* ==================== ВХОД ==================== */
  function Auth(c) { this.c = c; }

  Auth.prototype.getSession = function () {
    return Promise.resolve({ data: { session: this.c.session || null }, error: null });
  };

  Auth.prototype.setSession = function (t) {
    try {
      var s = this.c._mkSession({ access_token: t.access_token, refresh_token: t.refresh_token });
      this.c.session = s;
      saveSaved(s);
      var self = this.c;
      setTimeout(function () { self._emit('SIGNED_IN', s); }, 0);
      return Promise.resolve({ data: { session: s, user: s.user }, error: null });
    } catch (e) {
      return Promise.resolve({ data: { session: null, user: null }, error: { message: String(e.message || e) } });
    }
  };

  Auth.prototype.getUser = function () {
    var c = this.c;
    if (!c.session) return Promise.resolve({ data: { user: null }, error: { message: 'Нет входа' } });
    return c._fresh().then(function (s) {
      if (!s) return { data: { user: null }, error: { message: 'Нет входа' } };
      return fetch(c.url + '/auth/v1/user', { headers: c._headers() }).then(function (r) {
        return asJson(r).then(function (j) {
          if (!r.ok) return { data: { user: null }, error: asError(j, r.status, 'Не удалось получить профиль') };
          c.session.user = j; saveSaved(c.session);
          return { data: { user: j }, error: null };
        });
      });
    });
  };

  Auth.prototype.signInWithOAuth = function (o) {
    o = o || {};
    var redirect = (o.options && o.options.redirectTo) ||
      ((typeof location !== 'undefined') ? location.origin + location.pathname : '');
    var q = 'provider=' + enc(o.provider) + '&redirect_to=' + enc(redirect);
    if (o.options && o.options.scopes) q += '&scopes=' + enc(o.options.scopes);
    var link = this.c.url + '/auth/v1/authorize?' + q;
    try { location.href = link; } catch (e) {}
    return Promise.resolve({ data: { provider: o.provider, url: link }, error: null });
  };

  Auth.prototype.signInWithOtp = function (o) {
    o = o || {};
    var to = (o.options && o.options.emailRedirectTo) || '';
    var url = this.c.url + '/auth/v1/otp' + (to ? '?redirect_to=' + enc(to) : '');
    return fetch(url, {
      method: 'POST',
      headers: this.c._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email: o.email, create_user: !(o.options && o.options.shouldCreateUser === false), gotrue_meta_security: {} })
    }).then(function (r) { return asJson(r).then(function (j) { return { data: r.ok ? j : null, error: r.ok ? null : asError(j, r.status) }; }); });
  };

  Auth.prototype.signOut = function () {
    var c = this.c;
    var go = c.session ? fetch(c.url + '/auth/v1/logout', { method: 'POST', headers: c._headers() }).catch(function () {}) : Promise.resolve();
    return go.then(function () {
      c.session = null;
      saveSaved(null);
      setTimeout(function () { c._emit('SIGNED_OUT', null); }, 0);
      return { error: null };
    });
  };

  Auth.prototype.onAuthStateChange = function (cb) {
    var list = this.c.listeners;
    list.push(cb);
    return { data: { subscription: { unsubscribe: function () { var i = list.indexOf(cb); if (i >= 0) list.splice(i, 1); } } } };
  };

  /* ==================== ТАБЛИЦЫ ==================== */
  function Query(c, table) {
    this.c = c; this.table = table;
    this.verb = 'GET'; this.body = null;
    this.cols = '*'; this.hasCols = false;
    this.filters = []; this.orders = []; this.limitN = null;
    this.mode = '';
  }

  Query.prototype.select = function (cols) {
    this.hasCols = true;
    if (cols) this.cols = cols;
    if (this.verb === 'GET') this.cols = cols || '*';
    return this;
  };
  Query.prototype.insert = function (rows) { this.verb = 'POST'; this.body = rows; return this; };
  Query.prototype.upsert = function (rows) { this.verb = 'POST'; this.body = rows; this.upsertOn = true; return this; };
  Query.prototype.update = function (patch) { this.verb = 'PATCH'; this.body = patch; return this; };
  Query.prototype.delete = function () { this.verb = 'DELETE'; return this; };
  Query.prototype.eq = function (col, val) { this.filters.push(val === null ? col + '=is.null' : col + '=eq.' + enc(val)); return this; };
  Query.prototype.neq = function (col, val) { this.filters.push(col + '=neq.' + enc(val)); return this; };
  Query.prototype.is = function (col, val) { this.filters.push(col + '=is.' + (val === null ? 'null' : enc(val))); return this; };
  Query.prototype['in'] = function (col, list) { this.filters.push(col + '=in.(' + (list || []).map(enc).join(',') + ')'); return this; };
  Query.prototype.match = function (obj) { var self = this; for (var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) self.eq(k, obj[k]); } return this; };
  Query.prototype.order = function (col, o) { this.orders.push(col + '.' + ((o && o.ascending === false) ? 'desc' : 'asc')); return this; };
  Query.prototype.limit = function (n) { this.limitN = n; return this; };
  Query.prototype.range = function (from, to) { return this; };
  Query.prototype.single = function () { this.mode = 'single'; return this; };
  Query.prototype.maybeSingle = function () { this.mode = 'maybeSingle'; return this; };

  Query.prototype._url = function () {
    var q = [];
    if (this.verb === 'GET' || this.hasCols || this.verb !== 'DELETE') q.push('select=' + enc(this.cols || '*'));
    else q.push('select=' + enc(this.cols || '*'));
    this.filters.forEach(function (f) { q.push(f); });
    if (this.orders.length) q.push('order=' + this.orders.join(','));
    if (this.limitN != null) q.push('limit=' + this.limitN);
    return this.c.url + '/rest/v1/' + this.table + (q.length ? '?' + q.join('&') : '');
  };

  Query.prototype._run = function () {
    var self = this, c = this.c;
    var head = c._headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
    if (this.verb !== 'GET') head.Prefer = 'return=representation' + (this.upsertOn ? ',resolution=merge-duplicates' : '');
    return c._fresh().then(function () {
      head.Authorization = 'Bearer ' + ((c.session && c.session.access_token) || c.key);
      return fetch(self._url(), {
        method: self.verb,
        headers: head,
        body: self.body == null ? undefined : JSON.stringify(self.body)
      });
    }).then(function (r) {
      return asJson(r).then(function (j) {
        if (!r.ok) return { data: null, error: asError(j, r.status), status: r.status };
        var rows = Array.isArray(j) ? j : (j == null ? [] : [j]);
        if (self.mode === 'maybeSingle') {
          return { data: rows[0] || null, error: null, status: r.status };
        }
        if (self.mode === 'single') {
          if (rows.length !== 1) return { data: null, error: asError(null, r.status, 'Запись не найдена (получено ' + rows.length + ')'), status: r.status };
          return { data: rows[0], error: null, status: r.status };
        }
        return { data: rows, error: null, status: r.status };
      });
    }, function (e) {
      return { data: null, error: asError(null, 0, 'Сети нет: ' + (e && e.message ? e.message : e)) };
    });
  };

  Query.prototype.then = function (ok, bad) { return this._run().then(ok, bad); };
  Query.prototype.catch = function (bad) { return this._run().catch(bad); };

  /* ==================== ФУНКЦИИ БАЗЫ ==================== */
  Client.prototype.rpc = function (fn, args) {
    var c = this;
    return this._fresh().then(function () {
      return fetch(c.url + '/rest/v1/rpc/' + fn, {
        method: 'POST',
        headers: c._headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(args || {})
      });
    }).then(function (r) {
      return asJson(r).then(function (j) {
        return r.ok ? { data: j, error: null } : { data: null, error: asError(j, r.status) };
      });
    }, function (e) {
      return { data: null, error: asError(null, 0, 'Сети нет: ' + (e && e.message ? e.message : e)) };
    });
  };

  Client.prototype.from = function (table) { return new Query(this, table); };

  /* ==================== ФАЙЛЫ ==================== */
  function Storage(c) { this.c = c; }
  Storage.prototype.from = function (bucket) { return new Bucket(this.c, bucket); };

  function Bucket(c, bucket) { this.c = c; this.bucket = bucket; }

  Bucket.prototype.upload = function (path, file, o) {
    o = o || {};
    var c = this.c, self = this, full = String(path).split('/').map(enc).join('/');
    return c._fresh().then(function () {
      return fetch(c.url + '/storage/v1/object/' + self.bucket + '/' + full, {
        method: 'POST',
        headers: c._headers({
          'Content-Type': o.contentType || file.type || 'application/octet-stream',
          'x-upsert': String(!!o.upsert),
          'cache-control': '3600'
        }),
        body: file
      });
    }).then(function (r) {
      return asJson(r).then(function (j) {
        if (!r.ok) return { data: null, error: asError(j, r.status, 'Файл не загрузился') };
        return { data: { path: path, fullPath: self.bucket + '/' + path, id: (j && j.Id) || null }, error: null };
      });
    }, function (e) {
      return { data: null, error: asError(null, 0, 'Сети нет: ' + (e && e.message ? e.message : e)) };
    });
  };

  Bucket.prototype.createSignedUrls = function (paths, expiresIn) {
    var c = this.c, bucket = this.bucket;
    return c._fresh().then(function () {
      return fetch(c.url + '/storage/v1/object/sign/' + bucket, {
        method: 'POST',
        headers: c._headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ expiresIn: expiresIn || 3600, paths: paths || [] })
      });
    }).then(function (r) {
      return asJson(r).then(function (j) {
        if (!r.ok) return { data: null, error: asError(j, r.status, 'Ссылки не получены') };
        var list = (Array.isArray(j) ? j : []).map(function (x) {
          var su = x.signedURL || x.signedUrl || x.signed_url || '';
          return {
            error: x.error || null,
            path: x.path,
            signedUrl: su ? (/^https?:/.test(su) ? su : c.url + '/storage/v1' + su) : null
          };
        });
        return { data: list, error: null };
      });
    });
  };

  Bucket.prototype.createSignedUrl = function (path, expiresIn) {
    return this.createSignedUrls([path], expiresIn).then(function (r) {
      if (r.error) return r;
      var one = (r.data || [])[0] || null;
      return { data: one, error: null };
    });
  };

  Bucket.prototype.list = function (prefix, o) {
    o = o || {};
    var c = this.c, bucket = this.bucket;
    return c._fresh().then(function () {
      return fetch(c.url + '/storage/v1/object/list/' + bucket, {
        method: 'POST',
        headers: c._headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefix: prefix || '', limit: o.limit || 100, offset: o.offset || 0, sortBy: { column: 'name', order: 'asc' } })
      });
    }).then(function (r) {
      return asJson(r).then(function (j) {
        return r.ok ? { data: Array.isArray(j) ? j : [], error: null } : { data: null, error: asError(j, r.status, 'Хранилище недоступно') };
      });
    }, function (e) {
      return { data: null, error: asError(null, 0, 'Сети нет: ' + (e && e.message ? e.message : e)) };
    });
  };

  Bucket.prototype.remove = function (paths) {
    var c = this.c;
    return c._fresh().then(function () {
      return fetch(c.url + '/storage/v1/object/' + this.bucket, {
        method: 'DELETE',
        headers: c._headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefixes: paths || [] })
      });
    }).then(function (r) {
      return asJson(r).then(function (j) {
        return r.ok ? { data: j, error: null } : { data: null, error: asError(j, r.status) };
      });
    });
  };

  Bucket.prototype.getPublicUrl = function (path) {
    return { data: { publicUrl: this.c.url + '/storage/v1/object/public/' + this.bucket + '/' + String(path).split('/').map(enc).join('/') } };
  };

  Bucket.prototype.download = function (path) {
    var c = this.c;
    return c._fresh().then(function () {
      return fetch(c.url + '/storage/v1/object/' + this.bucket + '/' + String(path).split('/').map(enc).join('/'), { headers: c._headers() });
    }).then(function (r) {
      if (!r.ok) return asJson(r).then(function (j) { return { data: null, error: asError(j, r.status) }; });
      return r.blob().then(function (b) { return { data: b, error: null }; });
    });
  };

  /* ==================== ПОДКЛЮЧЕНИЕ ==================== */
  var api = {
    version: 'supabase-lite 1.0',
    createClient: function (url, key, opts) { return new Client(url, key, opts); }
  };

  if (typeof window !== 'undefined') window.supabase = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
", "node", "--check", "supabase-lite.js", "&&", "echo", "\"СИНТАКСИС OK, строк:\"", "&&", "wc", "-l", "supabase-lite.js", "&&", "wc", "-c", "supabase-lite.js"))_
