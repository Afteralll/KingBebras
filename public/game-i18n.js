function getLang() {
  const urlLang = new URLSearchParams(window.location.search).get('lang');
  if (urlLang) return urlLang;
  try {
    return localStorage.getItem('kb_lang') || 'en';
  } catch {
    return 'en';
  }
}

function isRtlLang(lang) {
  return lang === 'ar' || lang.startsWith('ar-');
}

function walkTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const t = node.nodeValue;
      if (!t) return NodeFilter.FILTER_REJECT;
      if (!t.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  // eslint-disable-next-line no-cond-assign
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function applyDictToDom(dict) {
  if (!dict || typeof dict !== 'object') return;
  const nodes = walkTextNodes(document.body);
  for (const n of nodes) {
    const original = n.nodeValue;
    if (!original) continue;
    // Try exact match first, then trimmed match.
    if (Object.prototype.hasOwnProperty.call(dict, original)) {
      n.nodeValue = dict[original];
      continue;
    }
    const trimmed = original.trim();
    if (Object.prototype.hasOwnProperty.call(dict, trimmed)) {
      // Preserve surrounding whitespace.
      const pre = original.slice(0, original.indexOf(trimmed));
      const post = original.slice(original.indexOf(trimmed) + trimmed.length);
      n.nodeValue = `${pre}${dict[trimmed]}${post}`;
      continue;
    }

    // Substring replacements for dynamic strings (best-effort).
    // This helps when the game updates message text via templates that include known phrases.
    let replaced = original;
    for (const [k, v] of Object.entries(dict)) {
      if (!k || typeof k !== 'string') continue;
      if (k.length < 4) continue; // avoid over-replacing tiny tokens
      if (replaced.includes(k)) replaced = replaced.split(k).join(String(v));
    }
    if (replaced !== original) n.nodeValue = replaced;
  }

  // Attributes (placeholder, aria-label, title, value for buttons/inputs)
  const attrNames = ['placeholder', 'aria-label', 'title', 'value'];
  for (const el of document.querySelectorAll('*')) {
    for (const a of attrNames) {
      const v = el.getAttribute?.(a);
      if (!v) continue;
      if (Object.prototype.hasOwnProperty.call(dict, v)) {
        el.setAttribute(a, dict[v]);
      }
    }
  }
}

async function loadGameDict(taskId, lang) {
  if (!taskId || !lang || lang === 'en') return null;
  const urls = [
    `/i18n/games/common.${encodeURIComponent(lang)}.json`,
    `/i18n/games/${encodeURIComponent(taskId)}.${encodeURIComponent(lang)}.json`
  ];
  const merged = {};
  for (const url of urls) {
    const res = await fetch(url, { cache: 'force-cache' }).catch(() => null);
    if (!res?.ok) continue;
    const json = await res.json().catch(() => null);
    if (json && typeof json === 'object') Object.assign(merged, json);
  }
  return Object.keys(merged).length ? merged : null;
}

export async function applyGameI18n({ taskId } = {}) {
  const lang = getLang();
  document.documentElement.lang = lang;
  document.documentElement.dir = isRtlLang(lang) ? 'rtl' : 'ltr';

  const dict = await loadGameDict(taskId, lang);
  if (!dict) return { ok: false, lang };
  applyDictToDom(dict);

  // Re-apply for dynamically updated text (games often set innerHTML/textContent later).
  const mo = new MutationObserver(() => {
    applyDictToDom(dict);
  });
  mo.observe(document.body, { subtree: true, childList: true, characterData: true });

  return { ok: true, lang };
}

