// Локализация интерфейса. Переключателя языка в UI нет специально —
// язык определяется автоматически по языку браузера (navigator.language)
// один раз при загрузке страницы, так же как тема следует за системной.
(function (global) {
  "use strict";

  const DICT = {
    ru: {
      meta_title: "PhotoSeek — поиск фото сразу везде",
      meta_description: "Универсальный поиск фото по Pixabay, Pexels, Unsplash, Wikimedia Commons, Openverse и Flickr одновременно, с быстрым переходом в Яндекс, Google и Pinterest.",

      brand_home_title: "На главный экран",

      search_placeholder: "Например: закат над океаном, кот, город ночью…",
      search_operators_title: 'Поддерживается: -слово (исключить), "точная фраза", слово1 ИЛИ слово2',
      mic_title: "Голосовой поиск",
      mic_unsupported: "Голосовой поиск не поддерживается в этом браузере",
      clear_title: "Очистить (Esc)",
      submit_title: "Искать",

      favorites_title: "Избранное",
      select_mode_title: "Выбрать несколько фото",
      insights_title: "Статистика и лимиты",
      theme_toggle_title: "Сменить тему",

      translated_hint_prefix: "Ищем как:",
      translated_hint_undo: "искать как есть",
      spell_hint_prefix: "Возможно, вы имели в виду:",
      spell_hint_apply: "исправить",

      quality_label: "Качество",
      quality_any: "Любое",
      quality_2k: "От 2K (2048px+)",
      quality_4k: "От 4K (3840px+)",
      quality_8k: "От 8K (7680px+)",

      orientation_label: "Ориентация",
      orientation_any: "Любая",
      orientation_horizontal: "Горизонтальная",
      orientation_vertical: "Вертикальная",
      orientation_square: "Квадрат",

      sort_label: "Сортировка",
      sort_popular: "Популярное",
      sort_newest: "Новое",

      people_label: "Люди",
      people_any_short: "Любые",
      people_any: "Любые фото",
      people_with: "Только с людьми",
      people_without: "Без людей",

      color_label: "Цвет",
      color_any_short: "Любой",
      color_any: "Любой цвет",
      color_bw: "Чёрно-белое",
      color_black: "Чёрный",
      color_white: "Белый",
      color_gray: "Серый",
      color_red: "Красный",
      color_orange: "Оранжевый",
      color_yellow: "Жёлтый",
      color_green: "Зелёный",
      color_turquoise: "Бирюзовый",
      color_blue: "Синий",
      color_purple: "Фиолетовый",
      color_pink: "Розовый",
      color_brown: "Коричневый",

      source_yandex_title: "Открыть этот запрос в Яндекс.Картинках",
      source_yandex_label: "Яндекс.Картинки",
      source_google_title: "Открыть этот запрос в Google Картинках",
      source_google_label: "Google Картинки",
      source_pinterest_title: "Открыть этот запрос в Pinterest",
      source_cosmos_title: "Открыть этот запрос в Cosmos",
      external_search_need_query: "Сначала введите запрос",

      hero_h1_before: "Найдите фото сразу",
      hero_h1_underline: "везде",
      hero_p: "Один запрос — и PhotoSeek одновременно спрашивает Pixabay, Pexels, Unsplash, Wikimedia Commons, Openverse и Flickr, собирая всё в одну ленту.",
      try_label: "Попробуйте:",
      recent_label: "Недавние:",

      favorites_empty_h1: "Пока пусто",
      favorites_empty_p: "Нажимайте на сердечко на фото, чтобы добавить их сюда — избранное сохраняется в этом браузере.",

      load_more: "Показать ещё",
      loading: "Загрузка…",

      no_results_h1: "Ничего не найдено",
      no_results_p: "Попробуйте другой запрос или снимите часть фильтров.",

      bulk_cancel: "Отмена",
      bulk_download: "Скачать zip",
      bulk_selected: "Выбрано: {n}",

      lightbox_close_title: "Закрыть (Esc)",
      lightbox_prev_title: "Предыдущее (←)",
      lightbox_next_title: "Следующее (→)",
      lightbox_heart_title: "В избранное",
      lightbox_copy_title: "Скопировать ссылку на изображение",
      lightbox_copy_label: "Ссылка",
      lightbox_copy_image_title: "Скопировать саму картинку (Ctrl+V в другом приложении)",
      lightbox_copy_image_label: "Картинка",
      lightbox_share_title: "Поделиться",
      lightbox_download_title: "Скачать изображение (D)",
      lightbox_download_label: "Скачать",
      lightbox_source_link: "Открыть источник",
      lightbox_untitled: "Без названия",
      lightbox_author_prefix: "Автор:",

      card_heart_title: "В избранное",
      card_download_title: "Скачать",

      insights_downloads: "Скачано фото",
      insights_searches: "Поисков выполнено",
      insights_top_source: "Любимый источник",
      insights_unsplash_limit: "Лимит Unsplash (в час)",
      insights_of: "из",
      insights_cooldown: "пауза ~{mins} мин",
      insights_none: "—",

      warn_cooldown: "{label}: пауза ~{mins} мин (лимит запросов)",
      warn_rate_limited: "{label}: превышен лимит запросов, пауза 10 минут",
      warn_generic_error: "ошибка запроса",
      warn_with_message: "{label}: {message}",

      results_found: "Найдено фото: {n}",
      results_favorites: "В избранном: {n}",

      toast_archiver_missing: "Архиватор не загрузился — скачиваю по одному",
      toast_archiving: "Архивирую {i} из {n}…",
      toast_archive_failed_all: "Не удалось скачать ни одного файла",
      toast_archive_building: "Собираю архив…",
      toast_archive_done: "Готово: {ok} из {n}",
      toast_downloading: "Скачивание…",
      toast_download_done: "Готово!",
      toast_opening_tab: "Открываю в новой вкладке…",
      toast_link_copied: "Ссылка скопирована",
      toast_copy_failed: "Не удалось скопировать",
      toast_image_copy_unsupported: "Браузер не поддерживает копирование картинок",
      toast_copying_image: "Копирую картинку…",
      toast_image_copied: "Картинка скопирована — вставьте Ctrl+V",
      toast_image_copy_failed: "Не удалось скопировать картинку",

      zip_filename: "photoseek-{n}-фото.zip",
      share_title_fallback: "Фото из PhotoSeek",
      share_title_plain: "Фото",

      suggestions: ["природа", "город ночью", "кофе", "океан", "горы", "космос", "еда", "животные"],
      locale: "ru-RU",
    },
    en: {
      meta_title: "PhotoSeek — search photos everywhere at once",
      meta_description: "Universal photo search across Pixabay, Pexels, Unsplash, Wikimedia Commons, Openverse and Flickr at once, with quick links to Yandex, Google and Pinterest.",

      brand_home_title: "Go to home screen",

      search_placeholder: "e.g. sunset over the ocean, cat, city at night…",
      search_operators_title: 'Supported: -word (exclude), "exact phrase", word1 OR word2',
      mic_title: "Voice search",
      mic_unsupported: "Voice search isn't supported in this browser",
      clear_title: "Clear (Esc)",
      submit_title: "Search",

      favorites_title: "Favorites",
      select_mode_title: "Select multiple photos",
      insights_title: "Stats & limits",
      theme_toggle_title: "Toggle theme",

      translated_hint_prefix: "Searching as:",
      translated_hint_undo: "search as typed",
      spell_hint_prefix: "Did you mean:",
      spell_hint_apply: "fix",

      quality_label: "Quality",
      quality_any: "Any",
      quality_2k: "2K+ (2048px+)",
      quality_4k: "4K+ (3840px+)",
      quality_8k: "8K+ (7680px+)",

      orientation_label: "Orientation",
      orientation_any: "Any",
      orientation_horizontal: "Horizontal",
      orientation_vertical: "Vertical",
      orientation_square: "Square",

      sort_label: "Sort",
      sort_popular: "Popular",
      sort_newest: "Newest",

      people_label: "People",
      people_any_short: "Any",
      people_any: "Any photos",
      people_with: "People only",
      people_without: "No people",

      color_label: "Color",
      color_any_short: "Any",
      color_any: "Any color",
      color_bw: "Black & white",
      color_black: "Black",
      color_white: "White",
      color_gray: "Gray",
      color_red: "Red",
      color_orange: "Orange",
      color_yellow: "Yellow",
      color_green: "Green",
      color_turquoise: "Turquoise",
      color_blue: "Blue",
      color_purple: "Purple",
      color_pink: "Pink",
      color_brown: "Brown",

      source_yandex_title: "Open this search in Yandex Images",
      source_yandex_label: "Yandex Images",
      source_google_title: "Open this search in Google Images",
      source_google_label: "Google Images",
      source_pinterest_title: "Open this search in Pinterest",
      source_cosmos_title: "Open this search in Cosmos",
      external_search_need_query: "Enter a search first",

      hero_h1_before: "Find photos",
      hero_h1_underline: "everywhere",
      hero_p: "One search — and PhotoSeek queries Pixabay, Pexels, Unsplash, Wikimedia Commons, Openverse and Flickr at the same time, gathering it all into one feed.",
      try_label: "Try:",
      recent_label: "Recent:",

      favorites_empty_h1: "Nothing here yet",
      favorites_empty_p: "Tap the heart on a photo to add it here — favorites are saved in this browser.",

      load_more: "Load more",
      loading: "Loading…",

      no_results_h1: "Nothing found",
      no_results_p: "Try a different search or remove some filters.",

      bulk_cancel: "Cancel",
      bulk_download: "Download zip",
      bulk_selected: "Selected: {n}",

      lightbox_close_title: "Close (Esc)",
      lightbox_prev_title: "Previous (←)",
      lightbox_next_title: "Next (→)",
      lightbox_heart_title: "Add to favorites",
      lightbox_copy_title: "Copy image link",
      lightbox_copy_label: "Link",
      lightbox_copy_image_title: "Copy the image itself (Ctrl+V in another app)",
      lightbox_copy_image_label: "Image",
      lightbox_share_title: "Share",
      lightbox_download_title: "Download image (D)",
      lightbox_download_label: "Download",
      lightbox_source_link: "Open source",
      lightbox_untitled: "Untitled",
      lightbox_author_prefix: "By",

      card_heart_title: "Add to favorites",
      card_download_title: "Download",

      insights_downloads: "Photos downloaded",
      insights_searches: "Searches made",
      insights_top_source: "Top source",
      insights_unsplash_limit: "Unsplash limit (per hour)",
      insights_of: "of",
      insights_cooldown: "cooldown ~{mins} min",
      insights_none: "—",

      warn_cooldown: "{label}: cooldown ~{mins} min (rate limit)",
      warn_rate_limited: "{label}: rate limit exceeded, pausing 10 minutes",
      warn_generic_error: "request error",
      warn_with_message: "{label}: {message}",

      results_found: "Photos found: {n}",
      results_favorites: "In favorites: {n}",

      toast_archiver_missing: "Archiver failed to load — downloading one by one",
      toast_archiving: "Archiving {i} of {n}…",
      toast_archive_failed_all: "Couldn't download any files",
      toast_archive_building: "Building the archive…",
      toast_archive_done: "Done: {ok} of {n}",
      toast_downloading: "Downloading…",
      toast_download_done: "Done!",
      toast_opening_tab: "Opening in a new tab…",
      toast_link_copied: "Link copied",
      toast_copy_failed: "Couldn't copy",
      toast_image_copy_unsupported: "This browser doesn't support copying images",
      toast_copying_image: "Copying the image…",
      toast_image_copied: "Image copied — paste with Ctrl+V",
      toast_image_copy_failed: "Couldn't copy the image",

      zip_filename: "photoseek-{n}-photos.zip",
      share_title_fallback: "Photo from PhotoSeek",
      share_title_plain: "Photo",

      suggestions: ["nature", "city at night", "coffee", "ocean", "mountains", "space", "food", "animals"],
      locale: "en-US",
    },
  };

  function detectLang() {
    const raw = (navigator.language || navigator.languages?.[0] || "ru").toLowerCase();
    return raw.startsWith("ru") ? "ru" : "en";
  }

  const LANG = detectLang();
  const TABLE = DICT[LANG] || DICT.ru;

  function t(key, vars) {
    let str = TABLE[key] ?? DICT.ru[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) str = str.split(`{${k}}`).join(v);
    }
    return str;
  }

  // Применяет переводы к статической разметке: data-i18n → textContent,
  // data-i18n-title → атрибут title, data-i18n-placeholder → placeholder.
  function applyStaticI18n() {
    document.documentElement.lang = LANG;
    document.title = t("meta_title");
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute("content", t("meta_description"));

    document.querySelectorAll("[data-i18n]").forEach((n) => { n.textContent = t(n.getAttribute("data-i18n")); });
    document.querySelectorAll("[data-i18n-title]").forEach((n) => { n.title = t(n.getAttribute("data-i18n-title")); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((n) => { n.placeholder = t(n.getAttribute("data-i18n-placeholder")); });
  }

  global.I18N = { t, LANG, applyStaticI18n };
})(window);
