(() => {
  const OPTION_LABELS = ['A','B','C','D','E','F'];
  let queued = false;

  function choiceLabel(i){
    if(i >= 0 && i < OPTION_LABELS.length) return OPTION_LABELS[i];
    if(i >= 0 && i < 26) return String.fromCharCode(65 + i);
    return String(i + 1);
  }

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
      setAttrIfChanged(number, 'dir', 'ltr');

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
      setAttrIfChanged(answer, 'aria-label', `الخيار ${label}: ${text}${selected ? '، محدد' : ''}`);
      setAttrIfChanged(answer, 'aria-pressed', String(selected));
      lengths.push(text.length);
    });

    const max = Math.max(...lengths);
    const avg = lengths.reduce((a,b) => a + b, 0) / lengths.length;
    const shortEnough = max <= 18 && avg <= 16;
    group.classList.toggle('answer-layout-short', shortEnough);
    group.classList.toggle('answer-layout-long', !shortEnough);
  }

  function enhanceAll(){
    queued = false;
    const root = document.getElementById('app') || document;
    root.querySelectorAll('.answers, .answer-grid').forEach(enhanceGroup);
  }

  function schedule(){
    if(queued) return;
    queued = true;
    requestAnimationFrame(enhanceAll);
  }

  function mutationNeedsEnhancement(records){
    return records.some(record => [...record.addedNodes].some(node => {
      if(node.nodeType !== 1) return false;
      return node.matches?.('.answers,.answer-grid,.answer') || Boolean(node.querySelector?.('.answers,.answer-grid,.answer'));
    }));
  }

  const appRoot = document.getElementById('app');
  if(appRoot){
    const observer = new MutationObserver(records => { if(mutationNeedsEnhancement(records)) schedule(); });
    observer.observe(appRoot, {childList:true, subtree:true});
  }
  document.addEventListener('DOMContentLoaded', schedule, {once:true});
  if(document.readyState !== 'loading') schedule();
})();