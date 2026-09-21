// Ключи API. Репозиторий публичный — при желании держите этот файл
// в .gitignore и создавайте его локально из config.example.js.
window.APP_CONFIG = {
  PIXABAY_KEY: "39541689-1120d9cb88846ce0ffcf822d8",
  PEXELS_KEY: "klZgGCRag8p0P4WwRIXVFfgV0183YbvPnj5MveXkzizgC4d3OWG2GgEr",
  UNSPLASH_ACCESS_KEY: "CQixfAKKmy4-7UkY88ZHps4ZOGDUyQ0vctcJyOH1zHM",
  // Название приложения ИЗ настроек на unsplash.com/oauth/applications —
  // нужно для utm-метки в ссылках на автора/фото (это требование их
  // API Guidelines для получения повышенного лимита). Поставьте точное имя
  // вашего приложения, если оно отличается от "photoseek".
  UNSPLASH_APP_NAME: "photoseek",
  // Wikimedia Commons и Openverse ключа не требуют.
  // Чтобы включить Flickr, получите бесплатный ключ на
  // https://www.flickr.com/services/apps/create/apply и впишите его сюда.
  FLICKR_API_KEY: ""
};
