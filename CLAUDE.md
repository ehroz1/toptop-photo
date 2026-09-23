# Picta — заметки для Claude

## Порядок работы (решение владельца проекта)

- Сайт публикуется на GitHub Pages из ветки **`claude/sleepy-volta-rtt33x`** —
  это основная (default) ветка репозитория, ветки `main` нет.
- После каждой готовой правки: `npm run check` и `npm test` должны пройти,
  затем коммит, пуш в рабочую ветку и **сразу, без отдельного вопроса
  владельцу**, Pull Request в `claude/sleepy-volta-rtt33x` и его слияние, чтобы
  изменение появилось на сайте. Если проверки не проходят — не вливать,
  сначала починить.
- Владелец не программист: объяснять по-русски, простыми словами.

## Правила проекта

- Без сборки и фреймворков: чистые HTML/CSS/JS. Node.js нужен только для тестов.
- Тесты: `npm run check` (статические проверки), `npm test` (jsdom,
  `tests/unit`), `npm run test:e2e` (Chromium, `tests/e2e`). CI —
  `.github/workflows/ci.yml`.
- Новый свой JS/CSS-файл в `index.html` → добавить в `SHELL_FILES` в `sw.js`
  (иначе `npm run check` упадёт). При заметных изменениях поднимать
  `CACHE_NAME` в `sw.js`.
- Любая новая надпись в `index.html` — через `data-i18n` с ключами и в `ru`,
  и в `en` в `js/i18n.js`.
- Вход/лимиты/админка (Supabase + Cloudflare KV) на паузе: `ACCOUNTS_ENABLED:
  false` в `js/config.js`. Включать только после деплоя нового
  `cloudflare-worker/worker.js` на Cloudflare — старый воркер отклоняет
  заголовок `Authorization`.
- Имя проекта — **Picta**, домен **picta.cc** (подключается к GitHub Pages).
  Воркер принимает запросы только с адресов из `ALLOWED_ORIGINS` (настройка
  воркера) или `DEFAULT_ALLOWED_ORIGIN` в `cloudflare-worker/worker.js` —
  при смене адреса сайта обновлять там. Ключи localStorage `photoseek-*` не
  переименовывать: у посетителей пропадут избранное и история.
