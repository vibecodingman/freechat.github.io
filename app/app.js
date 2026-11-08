/* app.js — маленький файл-указатель.
   Сам код сайта лежит в файле app-core.js.
   Этот файл просто подключает его, поэтому переименовывать ничего обратно не нужно.

   Проверять/менять тут нечего. */
(function () {
  'use strict';

  var s = document.createElement('script');
  s.src = 'app-core.js?v=3';          /* ?v=3 — чтобы браузер взял свежую версию, а не старую из кэша */
  s.onerror = function () {
    var d = document.getElementById('diag');
    if (d) {
      d.hidden = false;
      d.textContent = 'Не найден файл app-core.js — проверьте, что он лежит рядом с index.html в корне репозитория.';
    }
  };
  (document.body || document.head).appendChild(s);
})();
