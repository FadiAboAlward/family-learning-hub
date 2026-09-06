(() => {
  const AR_NUM = ['١','٢','٣','٤','٥','٦','٧','٨','٩','١٠'];
  const OPTION_PREFIX = 'الخيار';
  let queued = false;

  /**
   * Convert decimal digits in a value to Arabic-Indic digits for the RTL UI.
   * @param {string|number} value Value whose decimal digits should be localized.
   * @returns {string} Value with every decimal digit rendered as Arabic-Indic.
   */
  const toArabicDigits = value => String(value).replace(/\d/g, digit => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]);

  /**
   * Build the visible localized label for a zero-based answer option index.
   * @param {number} i Zero-based answer option index.
   * @returns {string} Localized label such as "الخيار ١".
   */
  const choiceLabel = i => `${OPTION_PREFIX} ${AR_NUM[i] || toArabicDigits(i + 1)}`;

  /**
   * Read answer text without including the generated option-label element.
   * @param {HTMLElement} answer Answer button element.
   * @returns {string} Normalized visible answer content.
   */
  function cleanText(answer){
    const clone = answer.cloneNode(true);
    clone.querySelectorAll('.answer-number').forEach(x => x.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Detect compact numeric or symbolic choices that should be isolated as LTR math.
   * @param {string} text Answer content text.
   * @returns {boolean} True when the content contains digits but no Arabic/Latin letters.
   */
  function isMathLikeText(text){
    const value = String(text || '').trim();
    if(!value || !/[0-9٠-٩]/.test(value)) return false;
    return !/[A-Za-z\u0600-\u06FF]/.test(value);
  }

  /**
   * Set an element attribute only when the value actually changes.
   * @param {HTMLElement} el Element to update.
   * @param {string} name Attribute name.
   * @param {string} value Attribute value.
   * @returns {void}
   */
  function setAttrIfChanged(el, name, value){
    if(el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  /**
   * Normalize one rendered answer group while preserving selection and accessibility state.
   * @param {HTMLElement} group Container whose direct answer children should be enhanced.
   * @returns {void}
   */
  function enhanceGroup(group){
    const answers = [...group.children].filter(x => x.classList?.contains('answer'));
    if(!answers.length) return;

    group.classList.add('answer-layout-v8');
    const lengths = [];

    answers.forEach((answer, i) => {
      const label = choiceLabel(i);
      const selected = answer.classList.contains('selected');
      const visibleLabel = selected ? `✓ ${label}` : label;
      let number = answer.querySelector(':scope > .answer-number');
      if(!number){
        number = document.createElement('span');
        number.className = 'answer-number';
        answer.prepend(number);
      }
      if(number.textContent !== visibleLabel) number.textContent = visibleLabel;
      setAttrIfChanged(number, 'aria-hidden', 'true');
      setAttrIfChanged(number, 'dir', 'rtl');

      let content = answer.querySelector(':scope > .answer-content-v8');
      if(!content){
        content = document.createElement('span');
        content.className = 'answer-content-v8';
        [...answer.childNodes].forEach(node => {
          if(node !== number) content.appendChild(node);
        });
        answer.appendChild(content);
      }

      const text = cleanText(answer);
      const mathLike = isMathLikeText(text);
      setAttrIfChanged(content, 'dir', mathLike ? 'ltr' : 'auto');
      content.classList.toggle('math-choice', mathLike);
      setAttrIfChanged(answer, 'aria-label', `${label}: ${text}${selected ? '، محدد' : ''}`);
      setAttrIfChanged(answer, 'aria-pressed', String(selected));
      lengths.push(text.length);
    });

    const max = Math.max(...lengths);
    const avg = lengths.reduce((a,b) => a + b, 0) / lengths.length;
    // Two columns are only for genuinely compact choices. Longer text and
    // multi-part mathematical relations keep the full row for readability.
    const shortEnough = max <= 18 && avg <= 16;
    group.classList.toggle('answer-layout-short', shortEnough);
    group.classList.toggle('answer-layout-long', !shortEnough);
  }

  /**
   * Enhance all Learning Mode and Exam Mode answer groups currently present.
   * @returns {void}
   */
  function enhanceAll(){
    queued = false;
    document.querySelectorAll('.answers, .answer-grid').forEach(enhanceGroup);
  }

  /**
   * Coalesce repeated DOM mutations into one animation-frame enhancement pass.
   * @returns {void}
   */
  function schedule(){
    if(queued) return;
    queued = true;
    requestAnimationFrame(enhanceAll);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {childList:true, subtree:true});
  document.addEventListener('DOMContentLoaded', schedule);
  document.addEventListener('click', () => {
    schedule();
    setTimeout(schedule, 40);
  });
  window.addEventListener('resize', schedule, {passive:true});
  window.addEventListener('hashchange', () => setTimeout(schedule, 20));
  if(document.readyState !== 'loading') schedule();
})();