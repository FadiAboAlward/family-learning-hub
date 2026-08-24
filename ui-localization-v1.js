(() => {
  const hintCountText=n=>{
    n=Number(n||0);
    if(n===1)return 'استخدمت تلميحًا واحدًا سابقًا في هذا السؤال.';
    if(n===2)return 'استخدمت تلميحين سابقًا في هذا السؤال.';
    if(n>=3&&n<=10)return `استخدمت ${n} تلميحات سابقًا في هذا السؤال.`;
    return `استخدمت ${n} تلميحًا سابقًا في هذا السؤال.`;
  };
  const flaggedCountText=n=>{
    n=Number(n||0);
    if(n===1)return 'علّمت سؤالًا واحدًا للمراجعة.';
    if(n===2)return 'علّمت سؤالين للمراجعة.';
    if(n>=3&&n<=10)return `علّمت ${n} أسئلة للمراجعة.`;
    return `علّمت ${n} سؤالًا للمراجعة.`;
  };
  const replacements=[
    [/^Level\s+(\d+)$/,'المستوى $1'],
    [/^Hints$/,'التلميحات'],
    [/^Hint$/,'تلميح'],
    [/^Learning Mode$/,'وضع التعلّم'],
    [/^Exam Mode$/,'وضع الامتحان'],
    [/^جارِ\s+/,'جارٍ '],
    [/^تذكرني على هذا الجهاز$/,'تذكّرني على هذا الجهاز'],
    [/^متابعة آية ومحمد والنتائج والمكافآت\.$/,'متابعة الأبناء والنتائج والمكافآت.'],
    [/^وصلت أعلى مستوى الحالي 🎉$/,'وصلت إلى أعلى مستوى حاليًا 🎉'],
    [/^استخدمت (\d+) تلميح\/تلميحات سابقًا في هذا السؤال\.$/,(_,n)=>hintCountText(n)],
    [/^علّمت (\d+) سؤال\/أسئلة للمراجعة\.$/,(_,n)=>flaggedCountText(n)]
  ];
  function localize(){
    const root=document.getElementById('app'); if(!root)return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes=[]; while(walker.nextNode())nodes.push(walker.currentNode);
    for(const node of nodes){
      if(!node.parentElement||['SCRIPT','STYLE'].includes(node.parentElement.tagName))continue;
      const raw=(node.nodeValue||'').trim(); if(!raw)continue;
      let next=raw;
      for(const [re,to] of replacements){
        if(re.test(next)){
          next=typeof to==='function'?next.replace(re,to):next.replace(re,to);
          break;
        }
      }
      if(next!==raw)node.nodeValue=(node.nodeValue||'').replace(raw,next);
    }
  }
  const observer=new MutationObserver(localize);observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',localize);localize();
})();
