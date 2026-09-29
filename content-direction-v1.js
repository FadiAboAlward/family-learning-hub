(() => {
  const DIRECTIONS = new Map([['ar','rtl'],['tr','ltr'],['en','ltr']]);

  function normalizeLanguage(value) {
    const raw = String(value || '').trim().toLowerCase();
    const base = raw.split(/[-_]/u)[0];
    return DIRECTIONS.has(base) ? base : '';
  }

  function direction(value) {
    const lang = normalizeLanguage(value);
    return lang ? DIRECTIONS.get(lang) : 'auto';
  }

  function attrs(value) {
    const lang = normalizeLanguage(value);
    return lang ? `lang="${lang}" dir="${DIRECTIONS.get(lang)}"` : 'dir="auto"';
  }

  function normalizeText(value) {
    let output = String(value ?? '');
    for (let pass = 0; pass < 2; pass++) {
      const next = output
        .replace(/&(?:#39|apos);/giu, "'")
        .replace(/&quot;/giu, '"')
        .replace(/&lt;/giu, '<')
        .replace(/&gt;/giu, '>')
        .replace(/&amp;/giu, '&');
      if (next === output) break;
      output = next;
    }
    return output;
  }

  globalThis.FLHContentDirection = { normalizeLanguage, direction, attrs, normalizeText };
})();
