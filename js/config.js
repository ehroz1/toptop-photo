// Настройки клиента. Настоящие API-ключи здесь больше не хранятся — они
// живут только как секреты Cloudflare Worker (см. cloudflare-worker/), сайт
// обращается к ним через WORKER_BASE_URL без ключей вообще.
window.APP_CONFIG = {
  // URL вашего задеплоенного воркера, без слэша в конце.
  // Пример: "https://photoseek-proxy.ваш-логин.workers.dev"
  WORKER_BASE_URL: "",
  // Название приложения ИЗ настроек на unsplash.com/oauth/applications —
  // нужно для utm-метки в ссылках на автора/фото (это требование их
  // API Guidelines для получения повышенного лимита). Поставьте точное имя
  // вашего приложения, если оно отличается от "photoseek".
  UNSPLASH_APP_NAME: "photoseek",
  // Показывать ли чип Flickr — включите, только если добавили
  // FLICKR_API_KEY в секреты воркера.
  FLICKR_ENABLED: false
};
