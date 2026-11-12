/* Публичные настройки. Они всё равно видны в браузере, поэтому лежат прямо здесь.
   Секретный ключ service_role сюда вставлять НЕЛЬЗЯ. */
window.CONFIG = {
  SUPABASE_URL: 'https://uikanilmlquwziptlgrr.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_Sj1RDipj1LrJpyiX_IU0_g_XjnYxyMn',
  APP_NAME: 'Inomesto',
  MAX_FILE_BYTES: 50 * 1024 * 1024,

  /* Адрес сайта, куда Supabase вернёт после входа. Слэш на конце обязателен. */
  SITE_URL: 'https://vibecodingman.github.io/freechat.github.io/',

  /* Какие кнопки входа показывать.
     Поставьте false тому способу, который не включён в Supabase — кнопка просто исчезнет. */
  PROVIDERS: { github: true, google: true, email: false }
};
