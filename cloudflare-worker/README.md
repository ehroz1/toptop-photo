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
   - `SHUTTERSTOCK_TOKEN` — Personal Access Token Shutterstock, если
     используете (необязательно; создаётся в личном кабинете на
     shutterstock.com/developers/apps → API Access, отдельный client_id/
     secret не нужен — токен подставляется сразу как `Bearer`)

   И одну обычную переменную (тип **Text**, не секрет):
   - `ALLOWED_ORIGINS` — адрес вашего сайта, например
     `https://ehroz1.github.io` (без слэша на конце). Если сайт открывается
     по другому адресу — впишите точно тот, что в адресной строке браузера.
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
wrangler secret put SHUTTERSTOCK_TOKEN   # необязательно
```

`wrangler deploy` выведет адрес воркера — впишите его в `js/config.js` так же,
как в шаге 8 выше.

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
