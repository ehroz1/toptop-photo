# PhotoSeek — прокси на Cloudflare Worker

Держит все API-ключи фотостоков на сервере (у Cloudflare), а не в браузере
и не в публичном репозитории. Сайт обращается к воркеру без единого ключа —
воркер сам подставляет нужный секрет перед обращением к настоящему API.

Бесплатного тарифа Cloudflare Workers (100 000 запросов в день) для личного
проекта с большим запасом хватает.

## Деплой через сайт Cloudflare (без установки чего-либо, самый простой путь)

1. Зарегистрируйтесь / войдите на [dash.cloudflare.com](https://dash.cloudflare.com)
   (бесплатно, без привязки домена).
2. В меню слева откройте **Workers & Pages** → **Create** → **Create Worker**.
3. Дайте воркеру имя, например `photoseek-proxy`, нажмите **Deploy**
   (сначала создастся с кодом-заглушкой "Hello World" — это нормально).
4. Откройте воркер → **Edit code** (или "Quick edit"). Удалите весь код-заглушку
   и вставьте вместо него содержимое файла [`worker.js`](./worker.js) из этой
   папки. Нажмите **Deploy**.
5. Вернитесь на страницу воркера → вкладка **Settings** → **Variables and Secrets**.
   Добавьте (каждую — кнопкой **Add**, тип **Secret**, чтобы значение было
   скрыто и зашифровано):
   - `PIXABAY_KEY` — ваш ключ Pixabay
   - `PEXELS_KEY` — ваш ключ Pexels
   - `UNSPLASH_ACCESS_KEY` — ваш Access Key Unsplash
   - `FLICKR_API_KEY` — ключ Flickr, если используете (необязательно)
   - `SHUTTERSTOCK_CONSUMER_KEY` и `SHUTTERSTOCK_CONSUMER_SECRET` — если
     используете Shutterstock (необязательно; берутся на
     shutterstock.com/account/developers/apps → ваше приложение → вкладка
     "Аутентификация", поля "Ключ потребителя"/"Секрет потребителя").
     Воркер сам обменивает их на access-токен через OAuth 2.0
     client_credentials и кэширует его до истечения — вписывать готовый
     токен вручную не нужно и не стоит (он короткоживущий).
   - `PEXAFY_API_KEY` — ключ Pexafy, если используете (необязательно;
     создаётся на pexafy.com/dashboard/api-keys/create — выберите тип
     **Pexafy API**, не **MCP**, это ключ для другого протокола)
   - `COVERR_API_KEY` — ключ Coverr для поиска видео, если используете
     (необязательно). ⚠️ Формат авторизации (`Authorization: Bearer …`) и
     схема ответа в `js/videoProviders.js` реконструированы по памяти и НЕ
     проверены вживую — после того как добавите ключ, откройте сайт,
     выполните видео-поиск с включённым только источником Coverr и
     посмотрите в devtools (вкладка Network), что реально приходит; если
     поля отличаются — поправьте маппинг в `js/videoProviders.js`
     (`CoverrVideoProvider`). Источник появится в интерфейсе только после
     того, как включите `COVERR_ENABLED: true` в `js/config.js`.

   Видео-поиск Pixabay/Pexels отдельных ключей не требует — воркер
   переиспользует те же `PIXABAY_KEY`/`PEXELS_KEY`, что и у фото.

   И ещё один секрет — если хотите включить вход/лимиты/админку (см. раздел
   "Вход, лимиты и админка" ниже, можно пропустить и вернуться к этому позже):
   - `SUPABASE_SECRET_KEY` — Supabase → **Project Settings → API** → раздел
     **API Keys** → **Secret key** (нажмите "Reveal", чтобы увидеть значение).
     Даёт полный доступ к базе в обход RLS — храните только как секрет
     воркера, никогда не в коде сайта.

   И обычные переменные (тип **Text**, не секрет):
   - `ALLOWED_ORIGINS` — адрес вашего сайта, например
     `https://ehroz1.github.io` (без слэша на конце). Если сайт открывается
     по другому адресу — впишите точно тот, что в адресной строке браузера.
   - `SUPABASE_URL` и `SUPABASE_PUBLISHABLE_KEY` — тоже с той же страницы
     Supabase (**Project Settings → API**: **Project URL** и **Publishable
     key**); нужны только для входа/лимитов/админки, без них воркер работает
     как раньше.
6. Сохраните — воркер передеплоится автоматически.
7. На странице воркера скопируйте его адрес (что-то вроде
   `https://photoseek-proxy.ваш-логин.workers.dev`).
8. Впишите этот адрес в [`js/config.js`](../js/config.js) в поле
   `WORKER_BASE_URL`, закоммитьте и запушьте — теперь сайт ходит за фото
   через воркер, а не напрямую с ключом в браузере.

## Деплой через терминал (wrangler), если удобнее

```bash
npm install -g wrangler
cd cloudflare-worker
wrangler login
wrangler deploy
wrangler secret put PIXABAY_KEY
wrangler secret put PEXELS_KEY
wrangler secret put UNSPLASH_ACCESS_KEY
wrangler secret put FLICKR_API_KEY   # необязательно
wrangler secret put SHUTTERSTOCK_CONSUMER_KEY   # необязательно
wrangler secret put SHUTTERSTOCK_CONSUMER_SECRET   # необязательно
wrangler secret put PEXAFY_API_KEY   # необязательно
wrangler secret put COVERR_API_KEY   # необязательно, видео-поиск Coverr
wrangler secret put SUPABASE_SECRET_KEY   # необязательно, вход/лимиты/админка
```

`SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`/`ANON_DAILY_LIMIT` — обычные `vars` в
[`wrangler.toml`](./wrangler.toml) (уже прописаны, если используете реальный
Supabase-проект из этого репозитория; при своём проекте поменяйте значения
там же).

`wrangler deploy` выведет адрес воркера — впишите его в `js/config.js` так же,
как в шаге 8 выше.

## Вход, лимиты и админка (Supabase + Cloudflare KV) — необязательно

Без этого раздела воркер и сайт работают точно как раньше. Включите, если
хотите: вход через Google/почту, снятие дневного лимита для вошедших,
управление ключами без редеплоя и страницу `admin.html` со статистикой.

**1. Supabase — база и вход.** Схема (`profiles`, `search_stats`) — в
[`../supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql).
Откройте Supabase Dashboard → **SQL Editor** → **New query**, вставьте
содержимое файла целиком → **Run**. Google/почта как способ входа
настраиваются в Supabase Dashboard → **Authentication → Sign In / Providers**.

**2. Cloudflare KV — два namespace.**
Cloudflare Dashboard → **Workers & Pages** → **Storage & Databases → KV**
(в некоторых интерфейсах просто **KV**) → **Create a namespace**:
- `photoseek-keys` — хранит ключи фотостоков, которые правит админка.
- `photoseek-limits` — счётчики дневного лимита гостей.

Затем привяжите оба к воркеру: страница воркера → **Settings → Bindings** →
**Add binding** → **KV Namespace**:
- Variable name `KEYS` → namespace `photoseek-keys`.
- Variable name `LIMITS` → namespace `photoseek-limits`.

(Если деплоите через wrangler — вместо этого впишите id namespace'ов в
закомментированные `[[kv_namespaces]]` блоки в `wrangler.toml`, см. комментарии
там же.)

**3. Секреты и переменные** — `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY` — см. шаг 5 выше (раздел "Деплой через сайт
Cloudflare"). Необязательно: `ANON_DAILY_LIMIT` (Text-переменная, число
запросов к источникам в сутки на IP для гостей). **Без неё лимита нет**, даже
если KV `LIMITS` привязан, — так воркер можно обновлять, пока вход на сайте
выключен. Один поиск — это 6–8 запросов (по одному на источник), поэтому
закладывайте примерно 10 запросов на поиск.

**4. Сделать себя админом.** Войдите на сайте (кнопка с силуэтом человека в
шапке) хотя бы один раз через тот email, которым будете пользоваться как
админ — это создаст вашу строку в `profiles`. Затем в Supabase Dashboard →
**Table Editor** → таблица `profiles` найдите свою строку по email и
включите галочку `is_admin`. После этого `admin.html` откроется для вас
(остальным — "не является администратором").

**Как это работает:** ключи читаются сначала из KV `KEYS`, а если там пусто —
из secrets воркера (ничего не ломается, пока админка не сохранит своё
значение). Дневной лимит считается по IP только для гостей — у кого в
запросе есть валидный токен сессии Supabase, лимита нет вообще. `/admin/*`
эндпоинты воркера проверяют и токен, и `profiles.is_admin` на каждый запрос —
сама кнопка "Админка" в интерфейсе ничего не защищает, это просто ссылка.

## После деплоя — обязательно перевыпустите старые ключи

Ключи, которые раньше лежали в `js/config.js`, навсегда остались в истории
git-коммитов этого публичного репозитория — их всё ещё можно найти, даже
после того как мы убрали их из текущей версии файла. Чтобы это не имело
значения, зайдите в личный кабинет каждого сервиса и **перевыпустите
(regenerate) ключ**, а новый впишите только в секреты воркера (шаг 5 выше),
никогда больше — в код:

- Pixabay: [pixabay.com/api/docs](https://pixabay.com/api/docs/) → личный кабинет
- Pexels: [pexels.com/api](https://www.pexels.com/api/) → личный кабинет
- Unsplash: [unsplash.com/oauth/applications](https://unsplash.com/oauth/applications)
- Flickr (если используется): [flickr.com/services/apps/](https://www.flickr.com/services/apps/)

## Как проверить, что всё работает

Откройте сайт, выполните любой поиск. Если что-то из источников не отвечает,
в интерфейсе появится предупреждение с текстом ошибки прямо от воркера
(например, "PIXABAY_KEY is not configured" — значит забыли добавить секрет,
или "origin not allowed" — значит `ALLOWED_ORIGINS` не совпадает с реальным
адресом сайта).
