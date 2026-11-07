/* ============================================================
   boot.js — запуск сайта «Круг».
   Лежит под именем app.js, реальный код сайта — в app-core.js.
   Библиотека Supabase берётся с 10 адресов по очереди, первым —
   копия с собственного сайта (vendor/supabase.js).
   ============================================================ */
(function () {
  'use strict';

  var LIB = '2.45.4';
  var APP = 'app-core.js?v=2';          /* файл с кодом самого сайта */

  var SOURCES = [
    { u: 'vendor/supabase.js',                                                    m: 'script' },
    { u: 'https://gcore.jsdelivr.net/npm/@supabase/supabase-js@' + LIB + '/dist/umd/supabase.js',      m: 'script' },
    { u: 'https://fastly.jsdelivr.net/npm/@supabase/supabase-js@' + LIB + '/dist/umd/supabase.js',     m: 'script' },
    { u: 'https://testingcf.jsdelivr.net/npm/@supabase/supabase-js@' + LIB + '/dist/umd/supabase.js',  m: 'script' },
    { u: 'https://unpkg.com/@supabase/supabase-js@' + LIB + '/dist/umd/supabase.js',                  m: 'script' },
    { u: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@' + LIB + '/dist/umd/supabase.js',        m: 'script' },
    { u: 'https://esm.sh/@supabase/supabase-js@' + LIB,                                                m: 'import' },
    { u: 'https://esm.run/@supabase/supabase-js@' + LIB,                                               m: 'import' },
    { u: 'https://cdn.skypack.dev/@supabase/supabase-js@' + LIB,                                       m: 'import' }
  ];

  var WAIT = 5000;
  var tried = [], started = false, timer = null;

  function box() { return document.getElementById('diag'); }
  function say(html) { var d = box(); if (!d) return; d.hidden = false; d.onclick = null; d.innerHTML = html; }
  function quiet() { var d = box(); if (d && /Supabase|Загружаю/i.test(d.textContent || '')) { d.textContent = ''; d.hidden = true; } }
  function haveLib() { return !!(window.supabase && typeof window.supabase.createClient === 'function'); }

  function startApp() {
    if (started) return;
    started = true;
    clearTimeout(timer);
    quiet();
    var s = document.createElement('script');
    s.src = APP;
    s.onerror = function () {
      say('<b>Библиотека загрузилась, но не найден файл app-core.js.</b><br>' +
          'Значит старый app.js ещё не переименован. Переименуйте его в app-core.js — сайт запустится.');
    };
    (document.body || document.head).appendChild(s);
  }

  function nothingWorked() {
    clearTimeout(timer);
    var rows = tried.map(function (t) {
      return '<div>' + (t.ok ? '✅' : '❌') + ' ' + t.url + (t.note ? ' — ' + t.note : '') + '</div>';
    }).join('');
    say('<b>Библиотека Supabase не загрузилась — ни один адрес не ответил.</b><br>' +
        'Это значит, что провайдер или блокировщик режет внешние CDN.<br><br>' + rows + '<br>' +
        '<b>Надёжное лечение:</b> откройте рабочий адрес из списка в браузере, сохраните файл (Ctrl+S) ' +
        'как <b>supabase.js</b> и загрузите его в репозиторий в папку <b>vendor</b> ' +
        '(на сайте GitHub: Add file → Upload files). Тогда библиотека будет грузиться с вашего же сайта, ' +
        'и внешние адреса станут не нужны вообще.<br><br>' +
        '<button class="btn ghost" id="bootRetry">Проверить ещё раз</button>');
    var b = document.getElementById('bootRetry');
    if (b) b.onclick = function () { quiet(); tried = []; run(); };
  }

  function tryScript(url, done) {
    var finished = false, s;
    function step(ok, note) {
      if (finished) return;
      finished = true;
      clearTimeout(t);
      tried.push({ url: url, ok: ok, note: note || '' });
      s.onload = s.onerror = null;
      if (s.parentNode) s.parentNode.removeChild(s);
      done(ok);
    }
    s = document.createElement('script');
    s.src = url;
    s.async = false;
    var t = setTimeout(function () { step(false, 'нет ответа'); }, WAIT);
    s.onload = function () { var ok = haveLib(); step(ok, ok ? '' : 'пришёл не тот файл'); };
    s.onerror = function () { step(false, 'заблокирован или 404'); };
    document.head.appendChild(s);
  }

  function tryImport(url, done) {
    var finished = false;
    var t = setTimeout(function () {
      if (finished) return;
      finished = true;
      tried.push({ url: url, ok: false, note: 'нет ответа' });
      done(false);
    }, WAIT + 2000);
    import(url).then(function (m) {
      if (finished) return;
      finished = true;
      clearTimeout(t);
      var api = (m && typeof m.createClient === 'function') ? m
              : (m && m.default && typeof m.default.createClient === 'function') ? m.default : null;
      if (api) { window.supabase = api; tried.push({ url: url, ok: true }); done(true); }
      else { tried.push({ url: url, ok: false, note: 'пришёл не тот файл' }); done(false); }
    }).catch(function () {
      if (finished) return;
      finished = true;
      clearTimeout(t);
      tried.push({ url: url, ok: false, note: 'заблокирован' });
      done(false);
    });
  }

  function step(i) {
    if (i >= SOURCES.length) return nothingWorked();
    var src = SOURCES[i];
    var go = (src.m === 'import') ? tryImport : tryScript;
    go(src.u, function (ok) { if (ok) startApp(); else step(i + 1); });
  }

  function run() {
    if (haveLib()) return startApp();   /* библиотеку уже успел загрузить index.html */
    timer = setTimeout(function () { say('Загружаю библиотеку Supabase…'); }, 2000);
    step(0);
  }

  run();
})();
