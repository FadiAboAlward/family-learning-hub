(() => {
  const MATH_CLASS = 'flh-math-ltr';
  const MATH_INPUT_CLASS = 'flh-math-input';
  const DIGIT = '[0-9٠-٩]';
  const NUMBER = `${DIGIT}+(?:[.,٫]${DIGIT}+)?`;
  const FRACTION = `${NUMBER}(?:\\s*\\/\\s*${NUMBER})?`;
  const ATOM = `(?:[+\\-−]?\\s*${FRACTION}|\\(\\s*[+\\-−]?\\s*${FRACTION}\\s*\\))`;
  const OPERATOR = '(?:[+\\-−×÷*/=≤≥]|&lt;|&gt;|<|>)';
  const MATH_RE = new RegExp(`${ATOM}(?:\\s*${OPERATOR}\\s*${ATOM})*(?:\\s*[%٪])?`, 'g');
  const LETTER_OR_DIGIT = /[0-9٠-٩A-Za-z_\u0600-\u06FF]/;
  const TARGET_SELECTOR = [
    '.question',
    '.answer',
    '.flh-hint-card',
    '.flh-explanation',
    '.exam-explanation-steps',
    '.exam-review',
    '.flh-history-review',
    '.flh-history-explanation',
    '.flh-review-answer',
    '.review-body',
    '.feedback',
    '.hint-box',
    '.more-box',
    '.steps',
    '.parent-exam',
    '.parent-exam-row'
  ].join(',');

  function splitMathText(value) {
    const text = String(value ?? '');
    const out = [];
    let last = 0;
    MATH_RE.lastIndex = 0;
    let match;
    while ((match = MATH_RE.exec(text))) {
      const start = match.index;
      const end = start + match[0].length;
      const before = start > 0 ? text[start - 1] : '';
      const after = end < text.length ? text[end] : '';
      if ((before && LETTER_OR_DIGIT.test(before)) || (after && LETTER_OR_DIGIT.test(after))) continue;
      if (start > last) out.push({text: text.slice(last, start), math: false});
      out.push({text: match[0], math: true});
      last = end;
    }
    if (last < text.length) out.push({text: text.slice(last), math: false});
    if (!out.length && text) out.push({text, math: false});
    return out;
  }

  function isolateMathHtml(value) {
    const text = String(value ?? '');
    if (!text || text.includes(`class=\"${MATH_CLASS}\"`) || text.includes(`class='${MATH_CLASS}'`)) return text;
    return splitMathText(text).map(part => part.math
      ? `<bdi class="${MATH_CLASS}" dir="ltr">${part.text}</bdi>`
      : part.text
    ).join('');
  }

  const originalMath = typeof globalThis.math === 'function' ? globalThis.math : null;
  if (originalMath && !originalMath.__flhDirectionSafe) {
    const directionSafeMath = value => originalMath(isolateMathHtml(value));
    directionSafeMath.__flhDirectionSafe = true;
    directionSafeMath.__flhOriginalMath = originalMath;
    globalThis.math = directionSafeMath;
  }

  const api = {splitMathText, isolateMathHtml};
  globalThis.FLHMathDirection = api;

  if (typeof document === 'undefined') return;

  function makeMathNode(text) {
    const node = document.createElement('bdi');
    node.className = MATH_CLASS;
    node.dir = 'ltr';
    node.textContent = text;
    return node;
  }

  function shouldSkipTextNode(node) {
    const parent = node.parentElement;
    if (!parent || !node.nodeValue || !/[0-9٠-٩]/.test(node.nodeValue)) return true;
    return Boolean(parent.closest(`.${MATH_CLASS},.frac,script,style,textarea,select,option,pre,code`));
  }

  function enhanceTextNode(node) {
    if (shouldSkipTextNode(node)) return;
    const parts = splitMathText(node.nodeValue);
    if (!parts.some(part => part.math)) return;
    const fragment = document.createDocumentFragment();
    for (const part of parts) fragment.append(part.math ? makeMathNode(part.text) : document.createTextNode(part.text));
    node.replaceWith(fragment);
  }

  function enhance(root) {
    if (!root?.querySelectorAll) return;
    const scopes = [];
    if (root.matches?.(TARGET_SELECTOR)) scopes.push(root);
    scopes.push(...root.querySelectorAll(TARGET_SELECTOR));
    for (const scope of new Set(scopes)) {
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) enhanceTextNode(node);
    }
    root.querySelectorAll('input[inputmode="numeric"],input[inputmode="decimal"],input[type="number"],[data-math-input]').forEach(input => {
      input.classList.add(MATH_INPUT_CLASS);
      input.setAttribute('dir', 'ltr');
    });
  }

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      enhance(document.getElementById('app'));
    });
  }

  const appRoot = document.getElementById('app');
  if (appRoot) {
    new MutationObserver(records => {
      if (records.some(record => record.addedNodes.length)) schedule();
    }).observe(appRoot, {childList: true, subtree: true});
    schedule();
  }
})();
