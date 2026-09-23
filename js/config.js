// Настройки клиента. Настоящие API-ключи здесь больше не хранятся — они
// живут только как секреты Cloudflare Worker (см. cloudflare-worker/), сайт
// обращается к ним через WORKER_BASE_URL без ключей вообще.
window.APP_CONFIG = {
  // URL вашего задеплоенного воркера, без слэша в конце.
  WORKER_BASE_URL: "https://photoseek-proxy.safarimax777.workers.dev",
  // Название приложения ИЗ настроек на unsplash.com/oauth/applications —
  // нужно для utm-метки в ссылках на автора/фото (это требование их
  // API Guidelines для получения повышенного лимита). Поставьте точное имя
  // вашего приложения, если оно отличается от "photoseek".
  UNSPLASH_APP_NAME: "photoseek",
  // Показывать ли чип Flickr — включите, только если добавили
  // FLICKR_API_KEY в секреты воркера.
  FLICKR_ENABLED: false,
  // Показывать ли источник видео Coverr — включите, только если добавили
  // COVERR_API_KEY в секреты воркера И проверили, что /coverr в воркере
  // реально отвечает (их API не тестировался вживую при подключении —
  // см. комментарий в cloudflare-worker/worker.js).
  COVERR_ENABLED: false,
  // Вход/лимиты/статистика (Supabase + обновлённый воркер). Включать только
  // ПОСЛЕ того, как на Cloudflare задеплоен новый cloudflare-worker/worker.js:
  // старый воркер отклоняет запросы с заголовком авторизации (CORS), и у
  // вошедших пользователей перестали бы работать источники через воркер.
  ACCOUNTS_ENABLED: false,
  // Supabase — вход через Google/почту, профили, статистика. Project URL и
  // Publishable key НЕ секретные (Publishable по дизайну Supabase безопасно
  // светить на клиенте — доступ к данным ограничивает RLS в базе), поэтому
  // хранятся прямо тут. Если оставить пустыми (или ACCOUNTS_ENABLED: false),
  // окно профиля в шапке покажет «регистрация скоро появится», остальной
  // функционал не пострадает.
  SUPABASE_URL: "https://stmjykymgtijghbcullm.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_TUerYlzR3Z6Ap4rNdXV5IA_lv1XJMdz",
  // Контакты в окне «молния» в шапке (текст «об авторе» — ключ about_text в
  // js/i18n.js). Каждая строка — { label: "как подписать", url: "ссылка" };
  // для почты url вида "mailto:имя@почта.ru".
  CONTACTS: [
    { label: "GitHub", url: "https://github.com/ehroz1" },
  ],
  // Ссылка для доната (пункт «Поддержать проект» в меню). Пока пусто, пункт
  // показывает «ссылка скоро появится».
  DONATE_URL: "",
};
