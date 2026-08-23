(() => {
  const replacements=[
    [/^Level\s+(\d+)$/,'المستوى $1'],
    [/^Hints$/,'التلميحات'],
    [/^Hint$/,'تلميح'],
    [/^Learning Mode$/,'وضع التعلّم'],
    [/^Exam Mode$/,'وضع الامتحان']
  ];
  function localize(){
    const root=document.getElementById('app'); if(!root)return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes=[]; while(walker.nextNode())nodes.push(walker.currentNode);
    for(const node of nodes){
      if(!node.parentElement||['SCRIPT','STYLE'].includes(node.parentElement.tagName))continue;
      const raw=(node.nodeValue||'').trim(); if(!raw)continue;
      let next=raw;
      for(const [re,to] of replacements){if(re.test(next)){next=next.replace(re,to);break;}}
      if(next!==raw)node.nodeValue=(node.nodeValue||'').replace(raw,next);
    }
  }
  const observer=new MutationObserver(localize);observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',localize);localize();
})();
