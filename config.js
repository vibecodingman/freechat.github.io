/* Публичные настройки. Они всё равно видны в браузере, поэтому лежат прямо здесь.
   Секретный ключ service_role сюда вставлять НЕЛЬЗЯ. */
window.CONFIG = {
  SUPABASE_URL: 'https://uikanilmlquwziptlgrr.supabase.co' [1](#citation-fallback-0),
  SUPABASE_ANON_KEY: 'sb_publishable_Sj1RDipj1LrJpyiX_IU0_g_XjnYxyMn',
  APP_NAME: 'Круг',
  MAX_FILE_BYTES: 100 * 1024 * 1024,

  /* Адрес сайта, куда Supabase вернёт после входа. Впишите свой со слэшем на конце:
       SITE_URL: 'https://vibecodingman.github.io/krug/' [2](#citation-fallback-1)
     Если оставить пустым — возьмётся адрес открытой страницы.
     Этот же адрес должен стоять в Supabase → Authentication → URL Configuration. */
  SITE_URL: '',

  /* Оставлен только GitHub: Google и почта не настроены в Supabase,
     поэтому кнопки не показываются вовсе. */
  PROVIDERS: { github: true, google: false, email: false }
};
