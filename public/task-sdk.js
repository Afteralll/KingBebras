export function createKbTask(taskId) {
  // Ensure Google Translate can work inside iframe games (if host sets googtrans cookie).
  (function ensureIframeGoogleTranslate() {
    if (window.__kbGoogleTranslateInit) return;
    window.__kbGoogleTranslateInit = true;

    const params = new URLSearchParams(window.location.search);
    const lang = params.get('lang');
    if (!lang || lang === 'en') return;

    // Set cookie so translator knows target language.
    const value = `/en/${lang}`;
    document.cookie = `googtrans=${encodeURIComponent(value)}; path=/`;

    // Create hidden container.
    if (!document.getElementById('google_translate_element')) {
      const div = document.createElement('div');
      div.id = 'google_translate_element';
      div.style.display = 'none';
      document.body.appendChild(div);
    }

    // If already loaded, init immediately.
    const init = () => {
      // eslint-disable-next-line no-new
      new window.google.translate.TranslateElement(
        { pageLanguage: 'en', autoDisplay: false },
        'google_translate_element'
      );

      // Try to set dropdown to requested lang.
      const trySet = () => {
        const combo = document.querySelector('.goog-te-combo');
        if (!combo) return false;
        combo.value = lang;
        combo.dispatchEvent(new Event('change'));
        return true;
      };
      let tries = 0;
      const t = setInterval(() => {
        tries++;
        if (trySet() || tries > 40) clearInterval(t);
      }, 100);
    };

    if (window.google?.translate?.TranslateElement) {
      init();
      return;
    }

    window.googleTranslateElementInit = init;
    const script = document.createElement('script');
    script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    script.async = true;
    document.body.appendChild(script);
  })();

  function send(moveType, payload = {}, penalty = 0) {
    window.parent.postMessage(
      { kind: 'kb_move', taskId, moveType, payload, penalty },
      window.location.origin
    );
  }

  function finish(payload = {}) {
    window.parent.postMessage({ kind: 'kb_finish', taskId, payload }, window.location.origin);
  }

  function click(payload = {}) {
    send('click', payload, 0);
  }

  return { send, click, finish, taskId };
}

