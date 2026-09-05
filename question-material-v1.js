(() => {
  const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function typeMeta(type='text') {
    return {
      text: ['📖','نص للقراءة'],
      image: ['🖼️','صورة'],
      audio: ['🎧','استماع'],
      table: ['📊','جدول']
    }[type] || ['📎','مادة السؤال'];
  }

  function bodyHtml(material) {
    if (material.type === 'text') return `<p class="question-material-text">${esc(material.text || '')}</p>`;
    if (material.type === 'image' && material.src) return `<img src="${esc(material.src)}" alt="${esc(material.alt || material.title || 'صورة السؤال')}" style="max-width:100%;height:auto;border-radius:16px;display:block;margin:auto">`;
    if (material.type === 'audio' && material.src) return `<audio controls preload="metadata" style="width:100%"><source src="${esc(material.src)}"></audio>`;
    if (material.type === 'table' && material.html) return material.html;
    return `<p class="question-material-text">المادة المطلوبة غير متاحة حاليًا.</p>`;
  }

  function materialCardHtml(material, {intro=false}={}) {
    const [icon,label] = typeMeta(material.type);
    return `<section class="question-material-card" data-material-id="${esc(material.id || '')}">
      <div class="question-material-kicker"><span>${icon}</span><span>${intro ? 'قبل ما نبدأ' : label}</span></div>
      <h2 class="question-material-title">${esc(material.title || 'مادة السؤال')}</h2>
      ${bodyHtml(material)}
      ${material.sourceLabel ? `<div class="question-material-source">${esc(material.sourceLabel)}</div>` : ''}
    </section>`;
  }

  function ensureDialog() {
    let root = document.getElementById('questionMaterialBackdrop');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'questionMaterialBackdrop';
    root.className = 'question-material-backdrop';
    root.setAttribute('role','presentation');
    root.innerHTML = `<div class="question-material-dialog" role="dialog" aria-modal="true" aria-labelledby="questionMaterialDialogTitle">
      <div class="question-material-dialog-head"><h3 id="questionMaterialDialogTitle">مادة السؤال</h3><button type="button" class="question-material-close" aria-label="إغلاق">✕</button></div>
      <div id="questionMaterialDialogBody"></div>
    </div>`;
    document.body.appendChild(root);
    const close = () => { root.classList.remove('open'); document.body.style.overflow=''; };
    root.querySelector('.question-material-close').addEventListener('click', close);
    root.addEventListener('click', e => { if (e.target === root) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && root.classList.contains('open')) close(); });
    return root;
  }

  function open(material) {
    const root = ensureDialog();
    const [icon,label] = typeMeta(material.type);
    root.querySelector('#questionMaterialDialogTitle').textContent = `${icon} ${material.title || label}`;
    root.querySelector('#questionMaterialDialogBody').innerHTML = `${bodyHtml(material)}${material.sourceLabel ? `<div class="question-material-source">${esc(material.sourceLabel)}</div>` : ''}`;
    root.classList.add('open');
    document.body.style.overflow='hidden';
    root.querySelector('.question-material-close').focus();
  }

  function mountIntro(container, material, options={}) {
    const el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) return;
    el.innerHTML = `${materialCardHtml(material,{intro:true})}<div class="question-material-actions"><button type="button" class="question-material-btn primary" data-material-start>${esc(options.startLabel || 'ابدأ الأسئلة')}</button></div>`;
    el.querySelector('[data-material-start]')?.addEventListener('click', () => options.onStart?.());
  }

  function mountToggle(container, material, label='📖 عرض النص') {
    const el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) return;
    el.innerHTML = `<div class="question-material-toggle"><button type="button" data-material-open>${esc(label)}</button></div>`;
    el.querySelector('[data-material-open]')?.addEventListener('click', () => open(material));
  }

  window.FamilyLearningQuestionMaterial = { mountIntro, mountToggle, open, materialCardHtml };
})();