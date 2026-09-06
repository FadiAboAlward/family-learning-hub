(() => {
  const AR_NUM = ['١','٢','٣','٤','٥','٦','٧','٨','٩','١٠'];
  const OPTION_PREFIX = 'الخيار';
  let queued = false;

  const choiceLabel = i => `${OPTION_PREFIX} ${AR_NUM[i] || String(i + 1)}`;

  function cleanText(answer){
    const clone = answer.cloneNode(true);
    clone.querySelectorAll('.answer-number').forEach(x => x.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isMathLikeText(text){
    const value = String(text || '').trim();
    if(!value || !/[0-9٠-٩]/.test(value)) return false;
    return !/[A-Za-z\u0600-\u06FF]/.test(value);
  }

  function setAttrIfChanged(el, name, value){
    if(el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function enhanceGroup(group){
    const answers = [...group.children].filter(x => x.classList?.contains('answer'));
    if(!answers.length) return;

    group.classList.add('answer-layout-v8');
    const lengths = [];

    answers.forEach((answer, i) => {
      const label = choiceLabel(i);
      let number = answer.querySelector(':scope > .answer-number');
      if(!number){
        number = document.createElement('span');
        number.className = 'answer-number';
        answer.prepend(number);
      }
      if(number.textContent !== label) number.textContent = label;
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
      setAttrIfChanged(answer, 'aria-label', `${label}: ${text}`);
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

  function enhanceAll(){
    queued = false;
    document.querySelectorAll('.answers').forEach(enhanceGroup);
  }

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