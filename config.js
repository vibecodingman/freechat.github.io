/* Публичные настройки. Они всё равно видны в браузере, поэтому лежат прямо здесь.
   Секретный ключ service_role сюда вставлять НЕЛЬЗЯ. */
window.CONFIG = {
  SUPABASE_URL: 'https://uikanilmlquwziptlgrr.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_Sj1RDipj1LrJpyiX_IU0_g_XjnYxyMn',
  APP_NAME: 'Круг',
  MAX_FILE_BYTES: 100 * 1024 * 1024,

  /* Адрес сайта, куда Supabase вернёт после входа.
     Впишите свой адрес GitHub Pages со слэшем на конце, например:
       SITE_URL: 'https://vibecodingman.github.io/krug/'
     Если оставить пустым — возьмётся адрес открытой страницы.
     Этот же адрес должен стоять в Supabase → Authentication → URL Configuration. */
  SITE_URL: '',

  /* Какие кнопки входа показывать.
     Поставьте false тому способу, который не включён в Supabase — кнопка просто исчезнет. */
  PROVIDERS: { github: true, google: true, email: true }
};
