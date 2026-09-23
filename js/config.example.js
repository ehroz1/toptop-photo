// Скопируйте этот файл в config.js и впишите адрес своего воркера.
// Сами API-ключи сюда не вписываются — они задаются как секреты
// Cloudflare Worker, см. cloudflare-worker/README.md.
window.APP_CONFIG = {
  WORKER_BASE_URL: "",
  UNSPLASH_APP_NAME: "photoseek",
  FLICKR_ENABLED: false,
  COVERR_ENABLED: false,
  // Необязательно: вход через Google/почту (Supabase). Оставьте пустыми,
  // если регистрация на сайте не нужна.
  SUPABASE_URL: "",
  SUPABASE_PUBLISHABLE_KEY: ""
};
