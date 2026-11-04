# Круг — версия 1.1

Соцсеть на GitHub Pages + Supabase. Файлы статические, данные — в Supabase.

| Файл | Назначение |
|---|---|
| `index.html` | Разметка экранов |
| `styles.css` | Оформление |
| `app.js` | Логика |
| `config.js` | Адрес и публичный ключ Supabase |
| `supabase-schema.sql` | Таблицы, правила, функции |

## Что исправлено в 1.1

- Окно «Новое пространство» больше не выскакивает само при открытии сайта.
- При нажатии «Создать» ошибка теперь показывается прямо на экране красной полосой сверху, а не молчит.
- Кнопки «Фото» и «Файл» появились и внутри пространств.
- Добавлена кнопка «Проверить подключение» в профиле.

## Установка

1. **База.** Supabase → SQL Editor → New query → вставить весь `supabase-schema.sql` → Run.
2. **Вход через Google.** Supabase → Authentication → Providers → Google → Enable. Нужны Client ID и Client Secret из Google Cloud Console (OAuth consent screen → Credentials → OAuth client ID → Web application, а в Authorized redirect URIs вставить Callback URL из Supabase).
3. **Адреса.** Supabase → Authentication → URL Configuration → Site URL и Redirect URLs = адрес сайта на GitHub Pages.
4. **Публикация.** Залить файлы в репозиторий → Settings → Pages → Deploy from a branch → main → / (root).
5. **Сделать себя владельцем.** Войти на сайт, затем выполнить в SQL Editor:
   ```sql
   update public.profiles set is_owner = true, is_verified = true
    where id = (select id from auth.users where email = 'ВАША_ПОЧТА@gmail.com');
   ```

## Если что-то не работает

1. Откройте вкладку **Профиль** → **Проверка подключения** → **Проверить**. Красные пункты показывают, какой шаг пропущен.
2. Красная полоса сверху экрана сообщает текст ошибки — консоль открывать не нужно.
3. Частые причины: не выполнен SQL-скрипт; не заполнены URL Configuration; вход выполнен не через Google; файл больше 50 МБ (лимит бесплатного тарифа).

## Ограничения

- Бесплатный тариф Supabase: максимальный размер файла 50 МБ (в правилах стоит 100 МБ).
- Секретный ключ `service_role` в файлы сайта не помещать.
- Открытие `index.html` двойным щелчком не работает — нужен настоящий адрес. Для проверки: `python3 -m http.server`.
- Обновление сообщений в чате — раз в 7 секунд.

## Не сделано

Realtime, вход через Apple, аватары, уведомления, автоудаление архивов через 30 дней.
