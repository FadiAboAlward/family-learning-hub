(() => {
  const AR_NUM = ['١','٢','٣','٤','٥','٦','٧','٨','٩','١٠'];
  let queued = false;

  function cleanText(answer){
    const clone = answer.cloneNode(true);
    clone.querySelectorAll('.answer-number').forEach(x=>x.remove());
    return (clone.textContent || '').replace(/\s+/g,' ').trim();
  }

  function enhanceGroup(group){
    const answers = [...group.children].filter(x=>x.classList?.contains('answer'));
    if(!answers.length) return;

    group.classList.add('answer-layout-v8');
    const lengths = [];

    answers.forEach((answer, i) => {
      let number = answer.querySelector(':scope > .answer-number');
      if(!number){
        number = document.createElement('span');
        number.className = 'answer-number';
        number.setAttribute('aria-hidden','true');
        number.textContent = AR_NUM[i] || String(i+1);
        answer.prepend(number);
      } else if(number.textContent !== (AR_NUM[i] || String(i+1))){
        number.textContent = AR_NUM[i] || String(i+1);
      }

      let content = answer.querySelector(':scope > .answer-content-v8');
      if(!content){
        content = document.createElement('span');
        content.className = 'answer-content-v8';
        [...answer.childNodes].forEach(node => {
          if(node !== number) content.appendChild(node);
        });
        answer.appendChild(content);
      }
      answer.setAttribute('aria-label', `الخيار ${i+1}: ${cleanText(answer)}`);
      lengths.push(cleanText(answer).length);
    });

    const max = Math.max(...lengths);
    const avg = lengths.reduce((a,b)=>a+b,0) / lengths.length;
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

  document.addEventListener('DOMContentLoaded', schedule);
  document.addEventListener('click', () => {
    schedule();
    setTimeout(schedule, 40);
  });
  window.addEventListener('resize', schedule, {passive:true});
  window.addEventListener('hashchange', () => setTimeout(schedule, 20));
  if(document.readyState !== 'loading') schedule();
})();
