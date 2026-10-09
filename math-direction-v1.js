(() => {
  const MATH_CLASS = 'flh-math-ltr';
  const MATH_INPUT_CLASS = 'flh-math-input';
  const LETTER_OR_DIGIT = /[\p{L}\p{N}\p{M}_]/u;
  const HTML_ENTITY = /^&(?:#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/i;
  const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const MAX_DEPTH = 24;
  const MAX_TOKENS = 256;
  const MAX_EXPRESSION_LENGTH = 2048;

  // The small source grammar typesets supported notation; it never evaluates
  // answers or rewrites stored content. Limits also bound malformed input work.
  function parseExpression(text, start) {
    let pos = start, tokens = 0;
    const skip = () => {
      while (/\s/.test(text[pos] || '') && pos < text.length) {
        if (++pos - start > MAX_EXPRESSION_LENGTH) throw new Error('MATH_LIMIT');
      }
    };
    const check = depth => {
      if (depth > MAX_DEPTH || ++tokens > MAX_TOKENS || pos - start > MAX_EXPRESSION_LENGTH) throw new Error('MATH_LIMIT');
    };
    const group = (open, close, depth) => {
      if (text[pos] !== open) throw new Error('MATH_GROUP');
      const begin = pos++;
      const inner = expression(0, depth + 1);
      skip();
      if (text[pos] !== close) throw new Error('MATH_GROUP');
      pos++;
      return {kind:'group', inner, open, close, source:text.slice(begin, pos)};
    };
    const atom = depth => {
      check(depth); skip();
      const begin = pos;
      let node;
      if (text.startsWith('\\frac', pos)) {
        pos += 5; skip(); const numerator = group('{', '}', depth); skip();
        const denominator = group('{', '}', depth);
        node = {kind:'fraction', numerator:numerator.inner, denominator:denominator.inner};
      } else if (text.startsWith('\\sqrt', pos) || text.startsWith('sqrt(', pos) || text[pos] === '√') {
        const latex = text.startsWith('\\sqrt', pos), named = text.startsWith('sqrt(', pos);
        pos += latex ? 5 : named ? 4 : 1; skip();
        let radicand;
        if (latex) radicand = group('{', '}', depth).inner;
        else if (named || text[pos] === '(') radicand = group('(', ')', depth).inner;
        else radicand = unary(depth + 1);
        node = {kind:'root', radicand};
      } else if (text[pos] === '(') {
        node = group('(', ')', depth);
      } else {
        const number = /^[0-9٠-٩]+(?:[.,٫][0-9٠-٩]+)?/.exec(text.slice(pos, start + MAX_EXPRESSION_LENGTH + 1));
        const variable = /^[A-Za-z](?![A-Za-z_])/.exec(text.slice(pos, pos + 2));
        const value = number?.[0] || variable?.[0];
        if (!value) throw new Error('MATH_ATOM');
        pos += value.length;
        if (pos - start > MAX_EXPRESSION_LENGTH) throw new Error('MATH_LIMIT');
        node = {kind:'text', source:value, variable:!number};
      }
      node.source = text.slice(begin, pos);
      return node;
    };
    const unary = depth => {
      check(depth); skip();
      const begin = pos;
      if (/[+\-−]/.test(text[pos] || '') && pos < text.length) {
        pos++; skip(); const inner = unary(depth + 1);
        return {kind:'unary', sign:text.slice(begin, pos - inner.source.length), inner, source:text.slice(begin, pos)};
      }
      let node = atom(depth + 1);
      const saved = pos; skip();
      if (text[pos] === '^') {
        pos++; skip();
        const exponent = text[pos] === '{' ? group('{','}',depth).inner : unary(depth + 1);
        node = {kind:'power', base:node, exponent, source:text.slice(begin, pos)};
      } else {
        const superscript = /^[⁺⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+/.exec(text.slice(pos, start + MAX_EXPRESSION_LENGTH + 1));
        if (superscript) {
          pos += superscript[0].length;
          if (pos - start > MAX_EXPRESSION_LENGTH) throw new Error('MATH_LIMIT');
          const exponent = {kind:'text', source:Array.from(superscript[0], digit => digit === '⁻' ? '-' : digit === '⁺' ? '+' : String(SUPERSCRIPT_DIGITS.indexOf(digit))).join('')};
          node = {kind:'power', base:node, exponent, source:text.slice(begin, pos)};
        } else pos = saved;
      }
      return node;
    };
    const operators = /^(?:&lt;=?|&gt;=?|<=|>=|[=<>≤≥≠+\-−×÷*/])/;
    // A slash forms a stacked fraction operand before ×, ÷ or *. Rendering
    // their whole left side as the next fraction numerator changes notation.
    const precedence = op => /^(?:[=<>≤≥≠]|&(?:lt|gt);)/.test(op) ? 1 : /^[+\-−]$/.test(op) ? 2 : op === '/' ? 4 : 3;
    const expression = (minimum, depth) => {
      check(depth); skip(); const begin = pos; let left = unary(depth + 1);
      while (true) {
        const saved = pos; skip();
        const match = operators.exec(text.slice(pos, pos + 6));
        if (!match || precedence(match[0]) < minimum) { pos = saved; break; }
        const op = match[0]; pos += op.length;
        let right;
        try { right = expression(precedence(op) + 1, depth + 1); }
        catch (error) {
          if (error.message === 'MATH_LIMIT') throw error;
          // A trailing blank or incomplete operand is text after the valid
          // prefix. Restore its operator rather than discarding that prefix.
          pos = saved; break;
        }
        const source = text.slice(begin, pos);
        left = op === '/' ? {kind:'fraction', numerator:left, denominator:right, source} : {kind:'binary', left, right, between:text.slice(saved, pos - right.source.length), source};
      }
      return left;
    };
    try {
      const node = expression(0, 0);
      const saved = pos; skip();
      if (/[%٪]/.test(text[pos] || '') && pos < text.length) { node.suffix = text.slice(saved, ++pos); }
      else pos = saved;
      if (pos - start > MAX_EXPRESSION_LENGTH) return null;
      return {node, end:pos};
    } catch { return null; }
  }

  function safeText(value) {
    return String(value).replace(/&(?!(?:#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);)/gi,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function attribute(value) {
    return String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function sourceLabel(value) {
    return value.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
  }
  function structured(node) {
    if (['fraction','power','root'].includes(node.kind)) return true;
    return Boolean((node.inner && structured(node.inner)) || (node.left && structured(node.left)) || (node.right && structured(node.right)));
  }
  function renderNode(node) {
    let html;
    switch (node.kind) {
      case 'fraction': html = `<span class="frac"><span class="n">${renderNode(node.numerator)}</span><span class="d">${renderNode(node.denominator)}</span></span>`; break;
      case 'power': html = `<span class="flh-math-power">${renderNode(node.base)}<sup>${renderNode(node.exponent)}</sup></span>`; break;
      case 'root': html = `<span class="flh-math-root"><span class="flh-math-radical">√</span><span class="flh-math-radicand">${renderNode(node.radicand)}</span></span>`; break;
      case 'group': html = safeText(node.open) + renderNode(node.inner) + safeText(node.close); break;
      case 'unary': html = safeText(node.sign) + renderNode(node.inner); break;
      case 'binary': html = renderNode(node.left) + safeText(node.between) + renderNode(node.right); break;
      default: html = safeText(node.source);
    }
    return html + safeText(node.suffix || '');
  }
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
    for (let start = 0; start < text.length; start++) {
      if (text[start] === '&') {
        const entity = HTML_ENTITY.exec(text.slice(start));
        if (entity) { start += entity[0].length - 1; continue; }
      }
      if (!/[0-9٠-٩(√+\-−\\A-Za-z]/.test(text[start])) continue;
      const before = start > 0 ? text[start - 1] : '';
      if (before && LETTER_OR_DIGIT.test(before)) {
        // An identifier/digit run is one lexical unit. In particular, do not
        // retry an oversized number at each digit or isolate UTC-4's suffix.
        while (/[0-9٠-٩]/.test(text[start + 1] || '')) start++;
        continue;
      }
      const parsed = parseExpression(text, start);
      if (!parsed) continue;
      const end = parsed.end;
      const source = text.slice(start, end);
      const nextStart = end - 1;
      const after = end < text.length ? text[end] : '';
      if ((after && LETTER_OR_DIGIT.test(after)) || /^[A-Z][A-Z0-9_]*-[0-9]+$/.test(source)) { start = nextStart; continue; }
      // Do not turn prose words/identifiers or a standalone letter into math.
      if (!/[0-9٠-٩]/.test(source) && !/[=<>≤≥≠+\-−×÷*/^√]/.test(source)) continue;
      if (start > last) out.push({text: text.slice(last, start), math: false});
      out.push({text:source, math:true, node:parsed.node});
      last = end;
      start = nextStart;
    }
    if (last < text.length) out.push({text: text.slice(last), math: false});
    if (!out.length && text) out.push({text, math: false});
    return out;
  }

  function isolateMathHtml(value) {
    const text = String(value ?? '');
    if (!text) return text;
    const isolatePlain = plain => splitMathText(plain).map(part => part.math ? mathHtml(part) : safeText(part.text)).join('');
    // Only renderer-owned markup is retained. Other tags remain readable text;
    // HTML attributes are never parsed as mathematical content.
    const owned = /<bdi class=["']flh-math-ltr["'] dir=["']ltr["'](?: role="math")?(?: aria-label="[^"]*")?>[\s\S]*?<\/bdi>|<span class="frac"><span class="n">[0-9٠-٩]+<\/span><span class="d">[0-9٠-٩]+<\/span><\/span>|<\/?[A-Za-z][^>]*>/g;
    let last=0,result='',match;
    while((match=owned.exec(text))){
      result+=isolatePlain(text.slice(last,match.index));
      if (match[0].startsWith('<bdi')) result += sanitizeOwnedMarkup(match[0]);
      else if (match[0].startsWith('<span class="frac">')) result += `<bdi class="${MATH_CLASS}" dir="ltr">${match[0]}</bdi>`;
      else result += safeText(match[0]);
      last=owned.lastIndex;
    }
    return result+isolatePlain(text.slice(last));
  }

  function sanitizeOwnedMarkup(html) {
    return html.replace(/<[^>]*>/g, tag => /^(?:<bdi class=["']flh-math-ltr["'] dir=["']ltr["'](?: role="math")?(?: aria-label="[^"<>]*")?>|<\/bdi>|<span class="(?:frac|n|d|flh-math-power|flh-math-root|flh-math-radical|flh-math-radicand)">|<\/span>|<sup>|<\/sup>)$/.test(tag) ? tag : safeText(tag));
  }
  function mathHtml(part) {
    if (structured(part.node)) return `<bdi class="${MATH_CLASS}" dir="ltr" role="math" aria-label="${attribute(sourceLabel(part.text))}">${renderNode(part.node)}</bdi>`;
    return `<bdi class="${MATH_CLASS}" dir="ltr">${safeText(part.text)}</bdi>`;
  }

  const originalMath = typeof globalThis.math === 'function' ? globalThis.math : null;
  if (originalMath && !originalMath.__flhDirectionSafe) {
    // Parse the original escaped source before the base helper expands fractions,
    // so a complete expression keeps one isolation boundary.
    const directionSafeMath = value => isolateMathHtml(value);
    directionSafeMath.__flhDirectionSafe = true;
    directionSafeMath.__flhOriginalMath = originalMath;
    globalThis.math = directionSafeMath;
  }

  const api = {splitMathText, isolateMathHtml};
  globalThis.FLHMathDirection = api;

  if (typeof document === 'undefined') return;

  function makeMathNode(part) {
    const node = document.createElement('bdi');
    node.className = MATH_CLASS;
    node.dir = 'ltr';
    if (structured(part.node)) { node.setAttribute('role', 'math'); node.setAttribute('aria-label', sourceLabel(part.text)); }
    node.innerHTML = renderNode(part.node);
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
    for (const part of parts) fragment.append(part.math ? makeMathNode(part) : document.createTextNode(part.text));
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
