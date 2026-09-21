// Разбор поисковых операторов: -слово (исключить), "точная фраза", СЛОВО1 ИЛИ СЛОВО2.
// Плюс небольшой словарь синонимов, расширяющий обычные слова в OR-группу.
(function (global) {
  "use strict";

  // Небольшой встроенный словарь — расширяет самые частые темы фотопоиска.
  const SYNONYMS = {
    "кот": ["кошка", "котёнок", "котик"],
    "кошка": ["кот", "котёнок", "котик"],
    "собака": ["пёс", "щенок", "псина"],
    "пёс": ["собака", "щенок"],
    "город": ["мегаполис", "улица"],
    "лес": ["чаща", "роща"],
    "море": ["океан", "побережье"],
    "океан": ["море", "побережье"],
    "гора": ["горы", "вершина", "хребет"],
    "закат": ["сумерки", "заря"],
    "рассвет": ["заря", "восход"],
    "дом": ["здание", "жильё"],
    "еда": ["блюдо", "кухня"],
    "машина": ["автомобиль", "авто"],
    "цветок": ["цветы", "растение"],
    "дерево": ["деревья"],
    "человек": ["люди", "персона"],
    "ребёнок": ["дети", "малыш"],
    "зима": ["снег", "снежный"],
    "лето": ["солнечный"],
  };

  function tokenize(raw) {
    return raw.match(/-?"[^"]+"|\S+/g) || [];
  }

  function stripQuotes(t) {
    return t.startsWith('"') && t.endsWith('"') && t.length > 2 ? t.slice(1, -1) : null;
  }

  // Разбирает сырой запрос на структуру { apiQuery, mustPhrases, mustNot, orGroups }.
  // orGroups — только группы, которые явно написал пользователь (слово1 ИЛИ слово2),
  // они и проверяются клиентским фильтром. synonymGroups — наши собственные
  // расширения по словарю: они только РАСШИРЯЮТ текст запроса к API, но не
  // используются как обязательное условие — иначе легитимные результаты, которых
  // просто нет в нашем маленьком словаре синонимов, будут ошибочно отброшены.
  function parseSearchQuery(raw) {
    const tokens = tokenize(raw.trim());
    const mustNot = [];
    const mustPhrases = [];
    const orGroups = [];
    const synonymGroups = [];
    const plain = [];
    let i = 0;
    while (i < tokens.length) {
      let t = tokens[i];
      if (t.toUpperCase() === "OR") { i++; continue; }

      let negate = false;
      if (t.startsWith("-") && t.length > 1) { negate = true; t = t.slice(1); }
      const phrase = stripQuotes(t);
      const bare = phrase !== null ? phrase : t;

      if (negate) {
        mustNot.push(bare);
        i++;
        continue;
      }

      const nextIsOr = tokens[i + 1] && tokens[i + 1].toUpperCase() === "OR";
      if (nextIsOr) {
        const group = [bare];
        let j = i + 1;
        while (tokens[j] && tokens[j].toUpperCase() === "OR" && tokens[j + 1]) {
          const nt = stripQuotes(tokens[j + 1]) ?? tokens[j + 1];
          group.push(nt);
          j += 2;
        }
        orGroups.push(group);
        i = j;
        continue;
      }

      if (phrase !== null) {
        mustPhrases.push(bare);
      } else {
        const syns = SYNONYMS[bare.toLowerCase()];
        if (syns) synonymGroups.push([bare, ...syns]);
        else plain.push(bare);
      }
      i++;
    }

    const apiTerms = [...plain, ...mustPhrases, ...orGroups.map((g) => g.join(" ")), ...synonymGroups.map((g) => g.join(" "))];
    const apiQuery = apiTerms.join(" ").trim() || raw;
    return {
      apiQuery,
      mustPhrases,
      mustNot,
      orGroups,
      synonymGroups,
      hasOperators: mustPhrases.length > 0 || mustNot.length > 0 || orGroups.length > 0,
    };
  }

  // translatedTerms: Map(оригинал в нижнем регистре -> перевод в нижнем регистре), опционально.
  function buildQueryMatcher(parsed, translatedTerms) {
    function variants(term) {
      const lower = term.toLowerCase();
      const t = translatedTerms?.get(lower);
      return t && t !== lower ? [lower, t] : [lower];
    }
    return function matches(item) {
      const haystack = [item.title, item.description, ...(item.tags || []), item.author]
        .filter(Boolean).join(" ").toLowerCase();
      for (const phrase of parsed.mustPhrases) {
        if (!variants(phrase).some((v) => haystack.includes(v))) return false;
      }
      for (const bad of parsed.mustNot) {
        if (variants(bad).some((v) => haystack.includes(v))) return false;
      }
      for (const group of parsed.orGroups) {
        if (!group.some((term) => variants(term).some((v) => haystack.includes(v)))) return false;
      }
      return true;
    };
  }

  global.parseSearchQuery = parseSearchQuery;
  global.buildQueryMatcher = buildQueryMatcher;
})(window);
