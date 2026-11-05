# Круг — версия 1.2 (вход через GitHub)

Соцсеть на GitHub Pages + Supabase. Файлы статические, все данные — в Supabase.

| Файл | Назначение |
|---|---|
| `index.html` | Разметка всех экранов |
| `styles.css` | Оформление |
| `app.js` | Логика сайта |
| `config.js` | Адрес Supabase, публичный ключ, список способов входа |
| `supabase-schema.sql` | Таблицы, правила доступа, функции |

## Что нового в 1.2

- На экране входа три кнопки: **GitHub**, **Google**, **ссылка на почту**.
- Ошибки входа показываются по-русски полосой сверху (в том числе бывшее `Unsupported provider`).
- Кнопка способа, который не включён в Supabase, скрывается: поставьте `false` в `config.js` → `PROVIDERS`.
- Имя и логин при входе через GitHub подставляются автоматически в профиль.

---

## Настройка входа через GitHub (5 минут)

1. Откройте **github.com** → аватар справа сверху → **Settings**.
2. Прокрутите в самый низ → **Developer settings** (левое меню).
3. **OAuth Apps** → **New OAuth App**.
4. Заполните:
   - **Application name** — `Круг`
   - **Homepage URL** — адрес вашего сайта, например `https://freechat.github.io`
   - **Authorization callback URL** — ровно эта строка, без изменений:
     ```
     https://uikanilmlquwziptlgrr.supabase.co/auth/v1/callback
     ```
5. **Register application**.
6. Нажмите **Generate a new client secret**. Секрет показывается один раз — скопируйте его сразу. Client ID уже виден на странице.
7. Откройте **supabase.com** → ваш проект → **Authentication** → **Providers** → **GitHub** → включите переключатель **Enable GitHub** → вставьте **Client ID** и **Client Secret** → **Save**.
8. Там же **Authentication** → **URL Configuration**:
   - **Site URL** — адрес сайта, например `https://freechat.github.io`
   - **Redirect URLs** → **Add URL** — тот же адрес с `/**` на конце: `https://freechat.github.io/**` → **Save**.

Всё. Кнопка «Войти через GitHub» начнёт работать.

## Порядок работ

1. **База.** Supabase → **SQL Editor** → **New query** → вставить весь `supabase-schema.sql` → **Run**.
2. **Провайдеры.** GitHub — по шагам выше. Google можно не включать: тогда в `config.js` поставьте `google: false`, и его кнопка исчезнет.
3. **Публикация.** Загрузите `index.html`, `styles.css`, `app.js`, `config.js` в репозиторий → **Settings → Pages → Deploy from a branch → main → / (root)**.
4. **Ждём 1–2 минуты.** GitHub обновляет сайт не мгновенно. Если видите старую версию — обновите страницу со сдвигом: `Ctrl+F5` (Mac: `Cmd+Shift+R`).
5. **Владелец.** Войдите на сайт, заполните профиль, затем выполните в SQL Editor:
   ```sql
   update public.profiles set is_owner = true, is_verified = true
    where id = (select id from auth.users where email = 'ВАША_ПОЧТА@example.com');
   ```
6. После этого в профиле появится кнопка **Проверить** — она покажет, всё ли подключено.

## Исправлено ранее, в 1.1

- Окно «Новое пространство» больше не всплывает само.
- Кнопка «Создать» показывает причину ошибки, если база отказала.
- «Фото» и «Файл» работают и внутри пространств.

## Если что-то не работает

| Что видно | Что делать |
|---|---|
| `Unsupported provider` | Провайдер не включён в Supabase → Providers |
| `redirect_uri_mismatch`, `redirect not allowed` | В GitHub OAuth App callback должен быть ровно `https://uikanilmlquwziptlgrr.supabase.co/auth/v1/callback`; адрес сайта добавить в Redirect URLs |
| Сайт выглядит старым | GitHub Pages не обновился: подождать и обновить `Ctrl+F5` |
| Красная полоса с текстом ошибки | Смотреть текст — это причина, а не сбой сайта |
| Файл не грузится | На бесплатном тарифе Supabase лимит 50 МБ на файл |

## Ограничения

- Видео не принимаются (отклоняются и сайтом, и правилами хранилища).
- Секретный ключ `service_role` в файлы сайта не помещать.
- Файлы `index.html` нельзя открывать двойным щелчком — вход работает только по настоящему адресу.
- Сообщения в чате обновляются раз в 7 секунд (без realtime).

## Ещё не сделано

Realtime, вход через Apple, аватары, уведомления, автоматическое удаление архивов через 30 дней.
