(() => {
  const safe = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const statusText = status => ({pending:'بانتظار موافقة الأهل',approved:'معتمد',rejected:'مرفوض',redeemed:'تم تسليم الجائزة',cancelled:'ملغى'})[status] || 'مسجّل';
  const sourceFilter = source => !source || ['academic','quiz','quiz_attempt','learning','exam'].includes(source) ? 'academic' : source;
  const sourceText = source => ({behavior:'سلوك عائلي',behavior_occurrence:'سلوك عائلي',behavior_submission:'سلوك عائلي',family_behavior:'سلوك عائلي',reward_claim:'استبدال جائزة',reward_spend:'استبدال جائزة',manual_adjustment:'تعديل موثّق',adjustment:'تعديل موثّق',reversal:'عكس حركة',academic:'تعلّم أكاديمي'})[sourceFilter(source)] || 'مصدر آخر';
  const errorMessages = {
    AUTH_REQUIRED:'سجّل الدخول أولًا.',INVALID_SESSION:'انتهت جلسة الدخول. سجّل الدخول من جديد.',INVALID_PARENT_SESSION:'انتهت جلسة الأهل. سجّل الدخول من جديد.',
    NOT_A_PARENT_MEMBER:'هذا الحساب لا يملك صلاحية إدارة العائلة.',PARENT_MANAGEMENT_REQUIRED:'هذه الإدارة متاحة لمالك العائلة أو المشرف فقط.',PARENT_MANAGE_FORBIDDEN:'هذه الإدارة متاحة لمالك العائلة أو المشرف فقط.',NOT_REWARDS_ADMIN:'هذه الإدارة متاحة لمالك العائلة أو المشرف فقط.',FORBIDDEN:'لا يملك هذا الحساب صلاحية تنفيذ العملية.',
    INVALID_RULE:'تحقّق من عنوان السلوك وفئته ونقاطه وحدود التكرار.',INVALID_CATEGORY:'اكتب عنوانًا صحيحًا للفئة.',INVALID_REWARD:'تحقّق من عنوان الجائزة ونوعها وشروطها.',
    INVALID_INPUT:'تحقّق من الحقول المطلوبة والقيم المدخلة.',VALIDATION_ERROR:'تحقّق من الحقول المطلوبة والقيم المدخلة.',INVALID_ADJUSTMENT:'أدخل حركة نقاط صحيحة مع سبب واضح.',
    INSUFFICIENT_POINTS:'رصيد النقاط غير كافٍ لهذه العملية.',INSUFFICIENT_BALANCE:'رصيد النقاط غير كافٍ لهذه العملية.',REWARD_NOT_ELIGIBLE:'شروط هذه الجائزة لم تكتمل بعد.',
    REWARD_UNAVAILABLE:'هذه الجائزة غير متاحة الآن.',REDEMPTION_LIMIT_REACHED:'وصلت إلى حد استبدال هذه الجائزة.',CADENCE_LIMIT_REACHED:'بلغ هذا السلوك حد التكرار المسموح لهذه الفترة.',
    AWARD_LIMIT_REACHED:'بلغ هذا السلوك حد التكرار المسموح لهذه الفترة.',SELF_REPORT_NOT_ALLOWED:'لا يسمح هذا السلوك بالتسجيل الذاتي.',RULE_NOT_ELIGIBLE:'هذا السلوك غير متاح لحسابك.',
    RULE_INACTIVE:'هذا السلوك معطّل حاليًا.',CATEGORY_INACTIVE:'فئة هذا السلوك معطّلة حاليًا.',INVALID_TRANSITION:'تغيّرت حالة الطلب. حدّث الصفحة للتحقّق.',
    REQUEST_CONFLICT:'يوجد طلب سابق لهذه العملية. حدّث السجل للتحقّق.',IDEMPOTENCY_CONFLICT:'هذا الطلب سبق استخدامه ببيانات مختلفة. حدّث الصفحة قبل إنشاء عملية جديدة.',
    RULE_SCOPE_FORBIDDEN:'هذا السلوك غير متاح للطالب المحدد.',SELF_REPORT_FORBIDDEN:'لا يسمح هذا السلوك بالتسجيل الذاتي.',REWARD_SCOPE_FORBIDDEN:'هذه الجائزة غير متاحة لحسابك.',
    INVALID_SCOPE:'اختر طالبًا واحدًا على الأقل عند تحديد نطاق الطلاب.',INVALID_CRITERIA:'تحقّق من شروط الجائزة وقيمها.',INVALID_OCCURRED_AT:'أدخل وقتًا صحيحًا لحدوث السلوك.',ADJUSTMENT_REASON_REQUIRED:'سبب تعديل النقاط مطلوب.',
    CADENCE_LIMIT:'بلغ هذا السلوك حد التكرار المسموح لهذه الفترة.',CLAIM_NOT_APPROVED:'يجب اعتماد طلب الجائزة قبل تسجيل تسليمها.',REWARD_INACTIVE:'هذه الجائزة معطّلة حاليًا.',
    LEVEL_REQUIRED:'لم تصل إلى المستوى المطلوب لهذه الجائزة بعد.',XP_REQUIRED:'لم يكتمل التقدم الأكاديمي المطلوب بعد.',STREAK_REQUIRED:'لم تكتمل سلسلة التعلّم المطلوبة بعد.',BADGE_REQUIRED:'لم تحصل على الأوسمة المطلوبة لهذه الجائزة بعد.',
    REDEMPTION_LIMIT:'وصلت إلى حد استبدال هذه الجائزة.',CLAIM_ALREADY_PENDING:'لديك طلب لهذه الجائزة بانتظار الموافقة.',ALREADY_REVERSED:'تم عكس هذه الحركة سابقًا.',
    LEARNER_NOT_FOUND:'الطالب غير متاح لهذا الحساب.',CATEGORY_NOT_FOUND:'الفئة غير متاحة. حدّث الصفحة.',RULE_NOT_FOUND:'السلوك غير متاح. حدّث الصفحة.',REWARD_NOT_FOUND:'الجائزة غير متاحة. حدّث الصفحة.',SUBMISSION_NOT_FOUND:'طلب السلوك غير متاح. حدّث الصفحة.',CLAIM_NOT_FOUND:'طلب الجائزة غير متاح. حدّث الصفحة.',REVERSAL_EVENT_NOT_FOUND:'الحركة الأصلية غير متاحة لهذا الطالب.',
  };
  let generation = 0;
  let screen = null;
  const requestKeys = new Map();
  const parentToken = () => {
    try { return (typeof state !== 'undefined' && state.parentSession?.access_token) || JSON.parse(localStorage.getItem('parent_session') || 'null')?.access_token || ''; }
    catch { return ''; }
  };
  const learnerToken = () => (typeof state !== 'undefined' && state.learnerSession) || localStorage.getItem('learner_session') || sessionStorage.getItem('learner_session') || '';
  const tokenFor = role => role === 'parent' ? parentToken() : learnerToken();
  const current = view => screen === view && generation === view.generation && tokenFor(view.role) === view.token && location.hash === `#${view.role === 'parent' ? 'parent' : 'student'}-rewards`;
  const date = value => {
    if (!value) return '—';
    try { return new Intl.DateTimeFormat('ar', {timeZone:'Europe/Istanbul',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)); }
    catch { return '—'; }
  };
  const isolated = value => `<bdi dir="ltr">${safe(value)}</bdi>`;
  const field = (id, label, control) => `<div class="field"><label for="${id}">${safe(label)}</label>${control}</div>`;
  const input = (id, type = 'text', extra = '') => `<input id="${id}" name="${id}" type="${type}" ${extra}>`;
  const checkbox = (id, label, checked = false) => `<label class="fr-check" for="${id}"><input id="${id}" type="checkbox" ${checked ? 'checked' : ''}>${safe(label)}</label>`;
  const message = html => `<div class="fr-message" role="status" aria-live="polite">${html}</div>`;
  const formFooter = label => `<div class="actions"><button class="btn btn-primary" type="submit">${label}</button><button class="btn btn-soft" type="button" data-fr-form-reset>إلغاء التعديل / جديد</button></div>${message('')}`;

  async function call(view, action, payload = {}) {
    if (!current(view)) throw new Error('SESSION_CHANGED');
    return api(action, payload, view.token);
  }
  function reportError(host, error) {
    const code = String(error?.message || 'SERVER_ERROR');
    const text = errorMessages[code] || (Number(error?.status) === 403 ? 'لا يملك هذا الحساب صلاحية تنفيذ العملية.' : Number(error?.status) === 400 ? 'تحقّق من الحقول المطلوبة والقيم المدخلة.' : 'تعذر إتمام العملية الآن. حاول مرة أخرى؛ رصيدك لم يتغيّر في هذه الصفحة.');
    host.innerHTML = `<div class="error" role="alert">${safe(text)}</div>`;
  }
  function savedRefreshNotice(view,host=view.root.querySelector('.fr-message')) {
    if(!current(view))return;
    view.refreshRequired=true;
    if(host)host.innerHTML=`<div class="success">${safe(view.savedMessage)} تعذر تحديث العرض؛ اضغط «تحديث» لعرض أحدث البيانات.</div>`;
    view.root.querySelectorAll('button,input,select,textarea').forEach(control=>control.disabled=true);
  }
  function value(form, id) { return form.querySelector(`#${id}`)?.value.trim() || ''; }
  function checked(form, id) { return !!form.querySelector(`#${id}`)?.checked; }
  function optionalNumber(form, id) { const raw = value(form, id); return raw === '' ? null : Number(raw); }
  function learners(view) { return view.data.learners || (view.data.learner ? [view.data.learner] : []); }
  function scopeFields(view, prefix) {
    return `${field(`${prefix}Scope`, 'الطلاب المشمولون', `<select id="${prefix}Scope"><option value="all">كل الطلاب الحقيقيين</option><option value="selected">طلاب محددون</option></select>`)}<fieldset class="fr-scope" data-fr-scope="${prefix}" hidden><legend>اختر الطلاب المشمولين</legend>${learners(view).map(learner => `<label class="fr-check"><input type="checkbox" name="learner_ids" value="${safe(learner.id)}">${safe(learner.display_name)}</label>`).join('') || '<div class="empty">لا يوجد طلاب متاحون.</div>'}</fieldset>`;
  }
  function scopePayload(form, prefix) { return {learner_scope:value(form, `${prefix}Scope`), learner_ids:[...form.querySelectorAll('[name="learner_ids"]:checked')].map(element => element.value)}; }
  function selectOptions(rows, label, selected = '') { return `<option value="">${safe(label)}</option>${rows.map(row => `<option value="${safe(row.id)}" ${row.id === selected ? 'selected' : ''}>${safe(row.title || row.display_name)}${row.is_active === false ? ' (معطّل)' : ''}</option>`).join('')}`; }
  function name(view, id) { return learners(view).find(row => row.id === id)?.display_name || 'الطالب'; }
  function categoryName(view, row) { return row.category_title || row.category_name || row.metadata?.category_title || view.data.categories?.find(category => category.id === (row.category_id || row.metadata?.category_id))?.title || sourceText(row.source_type); }
  function ruleName(view, row) { return row.rule_title || row.behavior_title || row.metadata?.rule_title || view.data.rules?.find(rule => rule.id === (row.rule_id || row.metadata?.rule_id))?.title || row.reason || 'حركة نقاط'; }
  function adhkarBonus(row) { const metadata=row?.metadata||{};return number(row?.adhkar_bonus_points ?? metadata.adhkar_bonus_points); }
  function pointParts(row) {
    const metadata = row.metadata || {};
    const base = row.base_points ?? metadata.base_points;
    const bonus = row.initiative_bonus_points ?? metadata.initiative_bonus_points ?? metadata.initiative_bonus;
    const adhkar = adhkarBonus(row);
    return base != null || bonus != null || adhkar ? `<div class="fr-points-parts">أساس السلوك ${isolated(number(base))} + مكافأة المبادرة ${isolated(number(bonus))}${adhkar ? ` + أذكار ما بعد الصلاة ${isolated(adhkar)}` : ''}</div>` : '';
  }
  function statusBadge(status) { return `<span class="fr-status ${safe(status || 'recorded')}">${safe(statusText(status))}</span>`; }
  function ledgerCard(view, row) {
    const metadata = row.metadata || {}, delta = number(row.reward_points_delta ?? row.total_points ?? metadata.total_points);
    return `<article data-fr-event="${safe(row.id)}" class="fr-ledger-item"><div class="topline"><b>${safe(ruleName(view, row))}</b><strong class="fr-delta ${delta < 0 ? 'spent' : ''}">${isolated(`${delta > 0 ? '+' : ''}${delta}`)} نقطة</strong></div><div class="muted">${view.role === 'parent' ? `${safe(name(view, row.learner_id))} · ` : ''}${safe(categoryName(view, row))} · ${safe(sourceText(row.source_type))}</div>${pointParts(row)}${row.reason ? `<p>${safe(row.reason)}</p>` : ''}<div class="fr-ledger-meta">${statusBadge(row.status || metadata.status || 'approved')}<span>${isolated(date(row.occurred_at || metadata.occurred_at || row.created_at))}</span></div><details><summary>تفاصيل الحركة</summary><dl class="fr-details"><dt>مرجع الحركة</dt><dd>${isolated(row.id)}</dd><dt>المصدر</dt><dd>${safe(sourceText(row.source_type))}${row.source_id ? ` · ${isolated(row.source_id)}` : ''}</dd><dt>صاحب الطلب</dt><dd>${safe(row.requester_name || metadata.requester_name || (metadata.requester_learner_id ? name(view,metadata.requester_learner_id) : metadata.requester_type === 'parent' ? 'ولي الأمر' : metadata.actor_id ? 'ولي الأمر' : 'النظام الأكاديمي'))}${view.role === 'parent' && (metadata.requester_id || metadata.actor_id) ? ` · ${isolated(metadata.requester_id || metadata.actor_id)}` : ''}</dd><dt>المراجع</dt><dd>${safe(row.reviewer_name || metadata.reviewer_name || (metadata.reviewer_id ? 'ولي الأمر' : '—'))}${view.role === 'parent' && metadata.reviewer_id ? ` · ${isolated(metadata.reviewer_id)}` : ''}</dd><dt>تاريخ الاعتماد</dt><dd>${isolated(date(row.approved_at || metadata.approved_at || row.created_at))}</dd></dl></details></article>`;
  }
  function submissionCard(view, row) {
    const rule = view.data.rules?.find(rule => rule.id === row.rule_id), title = row.rule_title || rule?.title || row.reason || 'سلوك عائلي';
    return `<article data-fr-submission="${safe(row.id)}" class="fr-item"><div class="topline"><b>${safe(title)}</b>${statusBadge(row.status)}</div><div class="muted">${view.role === 'parent' ? `${safe(name(view, row.learner_id))} · ` : ''}${safe(categoryName(view, {...row,category_id:row.category_id || rule?.category_id}))} · ${isolated(date(row.occurred_at || row.created_at || row.requested_at))}</div>${row.status === 'pending' && rule ? `<div class="muted">النقاط المتوقعة بحسب القاعدة الحالية عند الاعتماد:</div>${pointParts({base_points:rule.base_points,initiative_bonus_points:row.initiative?rule.initiative_bonus_points:0,adhkar_bonus_points:row.adhkar_completed?rule.adhkar_bonus_points:0})}` : pointParts(row)}${row.initiative ? '<div class="muted">تم دون تذكير</div>' : ''}${row.adhkar_completed ? '<div class="muted">تمت أذكار ما بعد الصلاة</div>' : ''}${row.reason ? `<p>${safe(row.reason)}</p>` : ''}${row.review_reason ? `<p>ملاحظة الأهل: ${safe(row.review_reason)}</p>` : ''}${row.status === 'pending' ? '<div class="muted">لا تُضاف نقاط قبل موافقة الأهل.</div>' : ''}${view.role === 'parent' && row.status === 'pending' ? `<div class="actions"><button class="btn btn-primary" data-fr-behavior-approve="${safe(row.id)}">اعتماد السلوك</button><button class="btn btn-soft" data-fr-behavior-reject="${safe(row.id)}">رفض</button></div>` : ''}</article>`;
  }
  function claimCard(view, row) {
    const reward = view.data.rewards?.find(reward => reward.id === row.reward_id);
    return `<article data-fr-claim="${safe(row.id)}" class="fr-item"><div class="topline"><b>🎁 ${safe(row.reward_title || reward?.title || 'جائزة')}</b>${statusBadge(row.status)}</div><div class="muted">${view.role === 'parent' ? `${safe(name(view, row.learner_id))} · ` : ''}${isolated(date(row.requested_at))}</div><div>${number(row.points_spent) ? `خُصم ${isolated(row.points_spent)} نقطة عند الاعتماد.` : 'لم تُخصم نقاط لهذا الطلب بعد.'}</div>${row.note ? `<p>${safe(row.note)}</p>` : ''}${view.role === 'parent' && row.status === 'pending' ? `<div class="actions"><button class="btn btn-primary" data-fr-claim-approve="${safe(row.id)}">اعتماد الجائزة</button><button class="btn btn-soft" data-fr-claim-reject="${safe(row.id)}">رفض</button></div>` : ''}${view.role === 'parent' && row.status === 'approved' ? `<div class="actions"><button class="btn btn-primary" data-fr-claim-redeem="${safe(row.id)}">تم تسليم الجائزة</button></div><div class="muted">التسليم لا يخصم النقاط مرة ثانية.</div>` : ''}</article>`;
  }
  const eligibilityReason = reason => ({INSUFFICIENT_POINTS:'اجمع مزيدًا من النقاط',INSUFFICIENT_BALANCE:'اجمع مزيدًا من النقاط',REQUIRED_LEVEL:'واصل التعلّم للوصول إلى المستوى المطلوب',LEVEL_REQUIRED:'واصل التعلّم للوصول إلى المستوى المطلوب',REWARD_UNAVAILABLE:'غير متاحة الآن',REDEMPTION_LIMIT_REACHED:'وصلت إلى حد الاستبدال',CRITERIA_NOT_MET:'أكمل شروط الجائزة',OUTSIDE_SCOPE:'غير متاحة لحسابك'})[reason] || errorMessages[reason] || 'بعض شروط الجائزة لم تكتمل بعد';
  function rewardCard(view, reward) {
    const progress = reward.progress || {}, cost = number(reward.required_reward_points), balance = number(view.data.states?.[0]?.reward_points ?? view.data.state?.reward_points);
    const percent = cost ? Math.min(100, Math.max(0, number(progress.points_percent ?? progress.percent ?? balance / cost * 100))) : 100;
    const reasons = reward.ineligibility_reasons || [];
    return `<article data-fr-reward="${safe(reward.id)}" class="fr-item"><div class="topline"><b>🎁 ${safe(reward.title)}</b>${reward.is_active === false ? '<span class="fr-status">معطّلة</span>' : ''}</div>${reward.description ? `<p>${safe(reward.description)}</p>` : ''}<div class="muted">${isolated(cost)} نقطة${reward.required_level ? ` · المستوى ${isolated(reward.required_level)}` : ''}${reward.max_redemptions_per_learner ? ` · ${isolated(reward.max_redemptions_per_learner)} استبدال لكل طالب` : ''}</div>${reward.available_from || reward.available_until ? `<div class="muted">${reward.available_from ? `من ${isolated(date(reward.available_from))}` : ''} ${reward.available_until ? `حتى ${isolated(date(reward.available_until))}` : ''}</div>` : ''}${view.role === 'parent' ? `<div class="actions"><button class="btn btn-soft" data-fr-edit-reward="${safe(reward.id)}" data-fr-reward-edit="${safe(reward.id)}">تعديل الجائزة</button><button class="btn btn-soft" data-fr-toggle-reward="${safe(reward.id)}">${reward.is_active === false ? 'تفعيل' : 'تعطيل'}</button></div>` : `<div class="fr-progress" role="progressbar" aria-label="التقدم بالنقاط نحو ${safe(reward.title)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(percent)}"><span style="width:${percent}%"></span></div><div class="muted">${cost ? `معك ${isolated(balance)} من ${isolated(cost)} نقطة.` : 'هذه الجائزة لا تحتاج نقاطًا.'}</div>${reasons.length ? `<div class="muted">${reasons.map(reason => safe(eligibilityReason(typeof reason === 'string' ? reason : reason.code))).join(' · ')}</div>` : ''}<div class="actions"><button class="btn btn-primary" data-fr-request-reward="${safe(reward.id)}" ${reward.eligible === true ? '' : 'disabled'}>${reward.eligible === true ? 'طلب الجائزة' : 'شروط الجائزة لم تكتمل'}</button></div>`}</article>`;
  }

  function categoryForm(view) {
    return `<details class="fr-section"><summary>فئات السلوك</summary><div class="fr-card-grid">${(view.data.categories || []).map(category => `<article data-fr-category="${safe(category.id)}" class="fr-item"><div class="topline"><b>${safe(category.title)}</b><span class="fr-status">${category.is_active === false ? 'معطّلة' : 'نشطة'}</span></div><p>${safe(category.description || '')}</p><div class="actions"><button class="btn btn-soft" data-fr-edit-category="${safe(category.id)}" data-fr-category-edit="${safe(category.id)}">تعديل الفئة</button><button class="btn btn-soft" data-fr-toggle-category="${safe(category.id)}">${category.is_active === false ? 'تفعيل' : 'تعطيل'}</button></div></article>`).join('') || '<div class="empty">لا توجد فئات بعد.</div>'}</div><form id="frCategoryForm" class="fr-form"><h3>إنشاء / تعديل فئة</h3>${field('frCategoryTitle','اسم الفئة',input('frCategoryTitle','text','required maxlength="120"'))}${field('frCategoryDescription','الوصف (اختياري)',`<textarea id="frCategoryDescription" maxlength="1000" rows="2"></textarea>`)}${checkbox('frCategoryActive','الفئة نشطة',true)}${formFooter('حفظ الفئة')}</form></details>`;
  }
  function ruleForm(view) {
    return `<details class="fr-section"><summary>قواعد السلوك والعادات</summary><div class="fr-card-grid">${(view.data.rules || []).map(rule => `<article data-fr-rule="${safe(rule.id)}" class="fr-item"><div class="topline"><b>${safe(rule.title)}</b><span class="fr-status">${rule.is_active === false ? 'معطّل' : 'نشط'}</span></div><div class="muted">${safe(categoryName(view,rule))} · أساس ${isolated(rule.base_points)} + مبادرة ${isolated(rule.initiative_bonus_points)}</div><div class="muted">${rule.cadence === 'unlimited' ? 'دون حد تكرار' : `${isolated(rule.max_awards)} ${rule.cadence === 'week' ? 'في الأسبوع' : 'في اليوم'}`} · ${rule.self_report_allowed ? 'يسمح بتسجيل الطالب' : 'يسجّله الأهل'}</div><div class="actions"><button class="btn btn-soft" data-fr-edit-rule="${safe(rule.id)}" data-fr-rule-edit="${safe(rule.id)}">تعديل السلوك</button><button class="btn btn-soft" data-fr-toggle-rule="${safe(rule.id)}">${rule.is_active === false ? 'تفعيل' : 'تعطيل'}</button></div></article>`).join('') || '<div class="empty">أضف أول سلوك تشجّعه العائلة.</div>'}</div><form id="frRuleForm" class="fr-form"><h3>إنشاء / تعديل سلوك</h3><div class="fr-form-grid">${field('frRuleTitle','اسم السلوك',input('frRuleTitle','text','required maxlength="120"'))}${field('frRuleCategory','الفئة',`<select id="frRuleCategory" required>${selectOptions(view.data.categories || [],'اختر الفئة')}</select>`)}${field('frRuleBase','نقاط السلوك الأساسية',input('frRuleBase','number','required min="0" max="100000" step="1" value="5" inputmode="numeric" dir="ltr"'))}${field('frRuleBonus','مكافأة المبادرة دون تذكير',input('frRuleBonus','number','required min="0" max="100000" step="1" value="0" inputmode="numeric" dir="ltr"'))}</div>${field('frRuleDescription','وصف السلوك (اختياري)',`<textarea id="frRuleDescription" maxlength="1000" rows="2"></textarea>`)}${scopeFields(view,'frRule')}<div class="fr-form-grid">${field('frRuleCadence','فترة حد التكرار',`<select id="frRuleCadence"><option value="day">يومي</option><option value="week">أسبوعي</option><option value="unlimited">دون حد</option></select>`)}${field('frRuleLimit','أقصى مرات الاعتماد في الفترة',input('frRuleLimit','number','min="1" step="1" value="1" inputmode="numeric" dir="ltr"'))}</div>${checkbox('frRuleSelfReport','السماح للطالب بتسجيل السلوك')}${checkbox('frRuleApproval','يتطلب اعتماد الأهل',true)}<div class="muted">تسجيل الطالب يظل بانتظار موافقة الأهل دائمًا؛ لا يمنح نقاطًا تلقائيًا.</div>${checkbox('frRuleActive','السلوك نشط',true)}${formFooter('حفظ السلوك')}</form></details>`;
  }
  function occurrenceForm(view, learner) {
    const role = view.role, prefix = role === 'parent' ? 'frOccurrence' : 'frSelfReport', rows = (view.data.rules || []).filter(rule => rule.is_active !== false && (role === 'parent' || rule.self_report_allowed));
    return `<form id="${prefix}Form" class="fr-form"><h3>${role === 'parent' ? 'تسجيل سلوك معتمد مباشرة' : 'سجّل سلوكًا قمت به'}</h3>${role === 'parent' ? field('frOccurrenceLearner','الطالب',`<select id="frOccurrenceLearner" required>${selectOptions(learners(view),'اختر الطالب',learner)}</select>`) : '<p class="muted">سيصل الطلب إلى الأهل. تُضاف النقاط بعد موافقتهم.</p>'}${field(`${prefix}Rule`,'السلوك',`<select id="${prefix}Rule" required>${selectOptions(rows,rows.length ? 'اختر السلوك' : 'لا توجد سلوكيات تسمح بالتسجيل الآن')}</select>`)}${checkbox(`${prefix}Initiative`,'قمت به دون تذكير (مبادرة)')}<div data-fr-adhkar="${prefix}" hidden>${checkbox(`${prefix}Adhkar`,'قرأت أذكار ما بعد الصلاة (+٢ نقطة)')}</div>${field(`${prefix}At`,'وقت حدوث السلوك',input(`${prefix}At`,'datetime-local','dir="ltr"'))}${field(`${prefix}Reason`,'ملاحظة أو سبب (اختياري)',`<textarea id="${prefix}Reason" maxlength="1000" rows="2"></textarea>`)}${formFooter(role === 'parent' ? 'تسجيل واعتماد السلوك' : 'إرسال إلى الأهل')}</form>`;
  }
  function rewardForm(view) {
    return `<details class="fr-section"><summary>إدارة الجوائز</summary><div class="fr-card-grid">${(view.data.rewards || []).map(reward => rewardCard(view,reward)).join('') || '<div class="empty">لم تُضف جوائز بعد.</div>'}</div><form id="frRewardForm" class="fr-form"><h3>إنشاء / تعديل جائزة</h3><div class="fr-form-grid">${field('frRewardTitle','اسم الجائزة',input('frRewardTitle','text','required maxlength="120"'))}${field('frRewardType','نوع الجائزة',`<select id="frRewardType">${[['activity','نشاط'],['outing','نزهة'],['experience','تجربة'],['privilege','امتياز'],['gift','هدية'],['custom','مخصصة']].map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select>`)}</div>${field('frRewardDescription','وصف الجائزة (اختياري)',`<textarea id="frRewardDescription" maxlength="1000" rows="2"></textarea>`)}<div class="fr-form-grid">${field('frRewardPoints','النقاط المطلوبة (اختياري)',input('frRewardPoints','number','min="0" step="1" inputmode="numeric" dir="ltr"'))}${field('frRewardLevel','المستوى المطلوب (اختياري)',input('frRewardLevel','number','min="1" step="1" inputmode="numeric" dir="ltr"'))}</div>${scopeFields(view,'frReward')}<div class="fr-form-grid">${field('frRewardFrom','متاحة من (اختياري)',input('frRewardFrom','datetime-local','dir="ltr"'))}${field('frRewardUntil','متاحة حتى (اختياري)',input('frRewardUntil','datetime-local','dir="ltr"'))}${field('frRewardLimit','حد الاستبدال لكل طالب (اختياري)',input('frRewardLimit','number','min="1" step="1" inputmode="numeric" dir="ltr"'))}</div><fieldset class="fr-criteria"><legend>شروط التقدّم الإضافية (اختيارية)</legend><div class="fr-form-grid">${field('frRewardStreak','سلسلة التعلّم الحالية بالأيام',input('frRewardStreak','number','min="0" max="2147483647" step="1" inputmode="numeric" dir="ltr"'))}${field('frRewardLongestStreak','أطول سلسلة تعلّم بالأيام',input('frRewardLongestStreak','number','min="0" max="2147483647" step="1" inputmode="numeric" dir="ltr"'))}${field('frRewardXp','الحد الأدنى من XP الأكاديمي',input('frRewardXp','number','min="0" max="2147483647" step="1" inputmode="numeric" dir="ltr"'))}${`<fieldset id="frRewardBadges" class="fr-criteria"><legend>الأوسمة المطلوبة (اختيارية)</legend>${(view.data.badges || []).map(badge => `<label class="fr-check"><input type="checkbox" name="required_badge_codes" value="${safe(badge.code)}">${safe(badge.title)}${badge.is_active === false ? ' (غير نشط)' : ''}</label>`).join('') || '<div class="muted">لا توجد أوسمة متاحة للاختيار حاليًا.</div>'}</fieldset>`}</div></fieldset>${checkbox('frRewardActive','الجائزة نشطة',true)}<div class="muted">اعتماد الجائزة يخصم النقاط مرة واحدة. تسليمها لاحقًا لا يخصم مجددًا.</div>${formFooter('حفظ الجائزة')}</form></details>`;
  }
  function adjustmentForm(view, learner) {
    return `<details class="fr-section"><summary>تعديل موثّق أو عكس حركة نقاط</summary><p class="muted">كل تعديل ينشئ حركة جديدة بالسبب واسم الفاعل. لا تتغير الحركات السابقة ولا تُستخدم النقاط لعقوبة تلقائية.</p><form id="frAdjustmentForm" class="fr-form">${field('frAdjustmentLearner','الطالب',`<select id="frAdjustmentLearner" required>${selectOptions(learners(view),'اختر الطالب',learner)}</select>`)}${field('frAdjustmentDelta','فرق النقاط: موجب للإضافة وسالب للتصحيح',input('frAdjustmentDelta','number','required min="-1000000" max="1000000" step="1" inputmode="numeric" dir="ltr"'))}${field('frAdjustmentReason','سبب التعديل أو العكس',`<textarea id="frAdjustmentReason" required maxlength="1000" rows="2"></textarea>`)}${field('frAdjustmentReversal','مرجع الحركة الأصلية عند العكس (اختياري)',input('frAdjustmentReversal','text','inputmode="numeric" dir="ltr"'))}<div class="muted">عند إدخال مرجع حركة، يحسب الخادم عكس قيمتها تلقائيًا.</div>${formFooter('تسجيل حركة تعويضية')}</form></details>`;
  }

  function ledgerSection(view) {
    const sources=[...new Set(['academic','family_behavior','reward_claim','manual_adjustment',...(view.data.ledger || []).map(row=>row.source_type),...(Array.isArray(view.data.breakdown)?view.data.breakdown:[]).map(row=>row.source_type)].map(sourceFilter))];
    return `<section class="panel fr-section" data-fr-ledger-section><h2>سجل النقاط ومصدرها</h2><div class="fr-form-grid">${field('frLedgerCategory','الفئة',`<select id="frLedgerCategory"><option value="">كل الفئات</option>${(view.data.categories || []).map(category=>`<option value="${safe(category.id)}">${safe(category.title)}</option>`).join('')}</select>`)}${field('frLedgerSource','مصدر النقاط',`<select id="frLedgerSource"><option value="">كل المصادر</option>${sources.map(source=>`<option value="${safe(source)}">${safe(sourceText(source))}</option>`).join('')}</select>`)}</div><div data-fr-ledger class="fr-list">${ledgerRows(view)}</div><div class="actions"><button class="btn btn-soft" data-fr-ledger-all>عرض السجل الكامل</button><button class="btn btn-soft" data-fr-ledger-more hidden>تحميل حركات أقدم</button></div>${message('')}</section>`;
  }
  function ledgerRows(view) { return (view.ledger || []).filter(row => !view.selectedLearner || row.learner_id === view.selectedLearner).map(row=>ledgerCard(view,row)).join('') || '<div class="empty">لا توجد حركات نقاط ضمن هذا الاختيار.</div>'; }
  function summary(view) {
    const states = view.data.states || (view.data.state ? [view.data.state] : []), chosen = view.selectedLearner ? states.filter(row=>row.learner_id===view.selectedLearner) : states;
    const balance = chosen.reduce((sum,row)=>sum+number(row.reward_points),0), xp = chosen.reduce((sum,row)=>sum+number(row.xp),0);
    const allBreakdown = Array.isArray(view.data.breakdown) ? view.data.breakdown : (view.data.breakdown?.categories || []);
    const breakdown = allBreakdown.filter(row=>!view.selectedLearner || row.learner_id===view.selectedLearner);
    return `<section class="panel fr-summary"><h2>${view.role === 'parent' ? 'النقاط القابلة للاستبدال' : 'تقدّمك وجوائزك'}</h2>${view.role === 'parent' ? field('frLearnerFilter','عرض نقاط الطالب',`<select id="frLearnerFilter"><option value="">كل الطلاب الحقيقيين</option>${learners(view).map(learner=>`<option value="${safe(learner.id)}" ${learner.id===view.selectedLearner?'selected':''}>${safe(learner.display_name)}</option>`).join('')}</select>`) : ''}<div class="fr-balance"><span>🪙 نقاط الجوائز</span><strong data-fr-balance>${isolated(balance)}</strong></div><div class="muted">⭐ XP أكاديمي: <b data-fr-xp>${isolated(xp)}</b></div><p class="muted">XP للتعلّم الأكاديمي. نقاط الجوائز تجمع التعلّم والسلوك العائلي المعتمد ويمكن استبدالها.</p>${view.role === 'parent' && !view.selectedLearner ? `<div class="fr-card-grid">${learners(view).map(learner=>`<button class="fr-breakdown" data-fr-select-learner="${safe(learner.id)}"><b>${safe(learner.display_name)}</b><span>${isolated(states.find(row=>row.learner_id===learner.id)?.reward_points || 0)} نقطة</span></button>`).join('')}</div>` : ''}${breakdown.length ? `<h3>توزيع النقاط حسب الفئة والمصدر</h3><div class="fr-card-grid">${breakdown.map(row=>`<button class="fr-breakdown" data-fr-breakdown-category="${safe(row.category_id || '')}" data-fr-breakdown-source="${safe(row.source_type || '')}" data-fr-breakdown-learner="${safe(row.learner_id || '')}"><span>${safe(categoryName(view,row))}${row.source_type ? ` · ${safe(sourceText(row.source_type))}` : ''}</span><b>${isolated(row.points ?? row.total_points ?? row.reward_points_delta ?? row.total ?? 0)} نقطة</b></button>`).join('')}</div>` : '<div class="empty">سيظهر توزيع النقاط بعد أول حركة مسجّلة.</div>'}</section>`;
  }
  function paint(view, success = '') {
    if (!current(view)) return;
    view.ledgerSerial++;
    view.ledgerBusy = false;
    view.ledger = view.data.ledger || [];
    view.ledgerCursor = null;
    view.fullLedger = false;
    const submissions = (view.data.submissions || []).filter(row=>!view.selectedLearner || row.learner_id===view.selectedLearner), claims = (view.data.claims || []).filter(row=>!view.selectedLearner || row.learner_id===view.selectedLearner);
    const parent = view.role === 'parent';
    view.root.innerHTML = `${success ? `<div class="success" role="status">${safe(success)}</div>` : ''}${summary(view)}${parent ? `<section class="panel fr-section"><h2>الطلبات والموافقات</h2>${field('frReviewReason','سبب القرار أو ملاحظة المراجعة (اختياري)',`<textarea id="frReviewReason" maxlength="1000" rows="2"></textarea>`)}<h3>السلوكيات بانتظار المراجعة</h3><div class="fr-card-grid">${submissions.filter(row=>row.status==='pending').map(row=>submissionCard(view,row)).join('') || '<div class="empty">لا توجد سلوكيات بانتظار المراجعة.</div>'}</div><h3>طلبات الجوائز</h3><div class="fr-card-grid">${claims.filter(row=>row.status==='pending'||row.status==='approved').map(row=>claimCard(view,row)).join('') || '<div class="empty">لا توجد طلبات جوائز تحتاج إجراءً.</div>'}</div>${message('')}</section><section class="panel">${occurrenceForm(view,view.selectedLearner)}</section>${categoryForm(view)}${ruleForm(view)}${rewardForm(view)}${adjustmentForm(view,view.selectedLearner)}` : `<section class="panel fr-section"><h2>جوائزك والتقدّم نحوها</h2><div class="fr-card-grid">${(view.data.rewards || []).map(reward=>rewardCard(view,reward)).join('') || '<div class="empty">لم يضف الأهل جوائز متاحة لك بعد.</div>'}</div>${message('')}</section><section class="panel">${occurrenceForm(view)}</section>`}${!parent ? `<section class="panel fr-section"><h2>سلوكياتك بانتظار موافقة الأهل</h2><div class="fr-card-grid">${submissions.filter(row=>row.status==='pending').map(row=>submissionCard(view,row)).join('') || '<div class="empty">لا توجد سلوكيات بانتظار الموافقة.</div>'}</div></section>` : ''}${ledgerSection(view)}<details class="fr-section"><summary>${parent?'سجل السلوكيات والجوائز':'سلوكياتك وطلبات جوائزك'}</summary><h3>السلوكيات</h3><div class="fr-card-grid" data-fr-submissions>${submissions.map(row=>submissionCard(view,row)).join('') || '<div class="empty">لم تُسجّل سلوكيات بعد.</div>'}</div><h3>طلبات الجوائز وسجل التسليم</h3><div class="fr-card-grid">${claims.map(row=>claimCard(view,row)).join('') || '<div class="empty">لم تُطلب جوائز بعد.</div>'}</div>${message('')}</details>`;
    bind(view);
    if(view.refreshRequired)savedRefreshNotice(view);
  }
  async function refresh(view, success = '') {
    const data = await call(view, `${view.role}_rewards_dashboard`);
    if (!current(view)) return;
    view.data = data;
    if (view.role === 'parent' && view.selectedLearner && !learners(view).some(learner=>learner.id===view.selectedLearner)) view.selectedLearner='';
    view.refreshRequired=false;
    const savedMessage=success||view.savedMessage||'';delete view.savedMessage;
    paint(view,savedMessage);
  }
  async function mutation(view, element, action, payload, success, keyHolder = element) {
    if (!current(view) || view.refreshRequired || element.dataset.frBusy === '1') return;
    const host = element.closest('form')?.querySelector('.fr-message') || element.closest('.fr-section')?.querySelector('.fr-message') || view.root.querySelector('.fr-message');
    element.dataset.frBusy = '1';
    const controls = element.tagName === 'FORM' ? [...element.querySelectorAll('button')] : [element];
    controls.forEach(control=>control.disabled=true);
    element.setAttribute('aria-busy','true');
    if (host) host.innerHTML='<span>جارٍ حفظ العملية…</span>';
    if (payload.idempotency_key === true) {
      keyHolder.dataset.idempotencyKey ||= crypto.randomUUID();
      payload.idempotency_key = keyHolder.dataset.idempotencyKey;
    }
    try {
      await call(view,action,payload);
      if (!current(view)) return;
      // The command succeeded; a failed dashboard read must not invite resubmission.
      delete keyHolder.dataset.idempotencyKey;
      if(action==='reward_request')requestKeys.delete(`${view.token}:${payload.reward_id}`);
      view.savedMessage=success;
      try{await refresh(view,success);}
      catch(error){savedRefreshNotice(view,host);}
    } catch(error) {
      if (current(view) && host) reportError(host,error);
    } finally {
      element.dataset.frBusy = '0';
      element.removeAttribute('aria-busy');
      controls.forEach(control=>control.disabled=!!view.refreshRequired);
    }
  }
  function datetime(raw) { return raw ? new Date(raw).toISOString() : null; }
  function localDatetime(raw) { if(!raw)return'';const parsed=new Date(raw);if(!Number.isFinite(parsed.getTime()))return'';return new Date(parsed.getTime()-parsed.getTimezoneOffset()*60000).toISOString().slice(0,16); }
  function setFields(form, fields) { for (const [id,val] of Object.entries(fields)) { const element=form.querySelector(`#${id}`);if(!element)continue;if(element.type==='checkbox')element.checked=!!val;else element.value=val??''; } }
  function setScope(view,form,prefix,row) {
    form.querySelectorAll('[data-fr-preserved-scope]').forEach(element=>element.remove());
    const scope=form.querySelector(`[data-fr-scope="${prefix}"]`);
    const shown=new Set([...scope.querySelectorAll('[name="learner_ids"]')].map(element=>element.value));
    for(const id of row.learner_ids||[])if(!shown.has(id)){
      const learner=(view.data.inactive_scope_learners||[]).find(learner=>learner.id===id);
      scope.insertAdjacentHTML('beforeend',`<label class="fr-check" data-fr-preserved-scope><input type="checkbox" name="learner_ids" value="${safe(id)}">${safe(learner?.display_name||'طالب سبق ربطه')} (غير نشط)</label>`);
    }
    setFields(form,{[`${prefix}Scope`]:row.learner_scope||'all'});
    scope.querySelectorAll('[name="learner_ids"]').forEach(element=>element.checked=(row.learner_ids||[]).includes(element.value));
    scope.hidden=(row.learner_scope||'all')!=='selected';
  }
  function focusForm(form) { form.closest('details')?.setAttribute('open','');form.scrollIntoView({behavior:'smooth',block:'start'});form.querySelector('input,select,textarea')?.focus({preventScroll:true}); }
  function edit(view,kind,id) {
    const row = (view.data[`${kind === 'category' ? 'categorie' : kind}s`] || []).find(row=>row.id===id), form=view.root.querySelector(`#fr${kind[0].toUpperCase()+kind.slice(1)}Form`);
    if(!row||!form)return;
    form.reset();form.dataset.recordId=id;delete form.dataset.idempotencyKey;
    if(kind==='category')setFields(form,{frCategoryTitle:row.title,frCategoryDescription:row.description,frCategoryActive:row.is_active});
    if(kind==='rule'){setFields(form,{frRuleTitle:row.title,frRuleDescription:row.description,frRuleCategory:row.category_id,frRuleBase:row.base_points,frRuleBonus:row.initiative_bonus_points,frRuleCadence:row.cadence,frRuleLimit:row.max_awards,frRuleSelfReport:row.self_report_allowed,frRuleApproval:row.parent_approval_required,frRuleActive:row.is_active});setScope(view,form,'frRule',row);}
    if(kind==='reward'){const criteria=row.criteria||{};setFields(form,{frRewardTitle:row.title,frRewardDescription:row.description,frRewardType:row.reward_type,frRewardPoints:row.required_reward_points,frRewardLevel:row.required_level,frRewardFrom:localDatetime(row.available_from),frRewardUntil:localDatetime(row.available_until),frRewardLimit:row.max_redemptions_per_learner,frRewardStreak:criteria.current_streak,frRewardLongestStreak:criteria.longest_streak,frRewardXp:criteria.min_xp,frRewardActive:row.is_active});setScope(view,form,'frReward',row);form.querySelectorAll('[name="required_badge_codes"]').forEach(element=>element.checked=(criteria.required_badge_codes||[]).includes(element.value));}
    syncCadence(form);focusForm(form);
  }
  function syncCadence(form) { const cadence=form.querySelector('#frRuleCadence'),limit=form.querySelector('#frRuleLimit');if(cadence&&limit){limit.disabled=cadence.value==='unlimited';limit.required=cadence.value!=='unlimited';} }
  function syncAdhkar(view,prefix) {
    const select=view.root.querySelector(`#${prefix}Rule`),wrap=view.root.querySelector(`[data-fr-adhkar="${prefix}"]`),box=view.root.querySelector(`#${prefix}Adhkar`);
    if(!select||!wrap||!box)return;
    const rule=(view.data.rules||[]).find(row=>row.id===select.value),enabled=adhkarBonus(rule)>0;
    wrap.hidden=!enabled;
    if(!enabled)box.checked=false;
  }
  function bindForm(view,id,action,makePayload,success) {
    const form=view.root.querySelector(`#${id}`);if(!form)return;
    form.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity())return;let payload;try{payload=makePayload(form);}catch(error){reportError(form.querySelector('.fr-message'),error);return;}if(form.dataset.recordId)payload.id=form.dataset.recordId;mutation(view,form,action,payload,success,form);});
  }
  async function loadLedger(view,reset=true) {
    if(!current(view)||view.ledgerBusy)return;
    const host=view.root.querySelector('[data-fr-ledger-section]'), messageHost=host.querySelector('.fr-message'), rows=host.querySelector('[data-fr-ledger]');
    const filter={...(view.role==='parent'&&view.selectedLearner?{learner_id:view.selectedLearner}:{}),category_id:host.querySelector('#frLedgerCategory').value||null,source_type:host.querySelector('#frLedgerSource').value||null,page_size:30,...(!reset&&view.ledgerCursor?{before_id:view.ledgerCursor}:{})};
    const serial=++view.ledgerSerial;view.ledgerBusy=true;host.setAttribute('aria-busy','true');messageHost.textContent='جارٍ تحميل السجل…';
    host.querySelectorAll('button,select').forEach(control=>control.disabled=true);
    try{const data=await call(view,`${view.role}_rewards_ledger`,filter);if(!current(view)||serial!==view.ledgerSerial)return;view.ledger=reset?(data.ledger||[]):view.ledger.concat(data.ledger||[]);view.ledgerCursor=data.next_cursor||null;view.fullLedger=true;rows.innerHTML=ledgerRows(view);host.querySelector('[data-fr-ledger-all]').hidden=true;host.querySelector('[data-fr-ledger-more]').hidden=!view.ledgerCursor;messageHost.textContent='';}
    catch(error){if(current(view)&&serial===view.ledgerSerial)reportError(messageHost,error);}
    finally{if(serial===view.ledgerSerial)view.ledgerBusy=false;host.removeAttribute('aria-busy');host.querySelectorAll('button,select').forEach(control=>control.disabled=false);}
  }
  function bind(view) {
    const root=view.root;
    root.querySelector('#frLearnerFilter')?.addEventListener('change',event=>{view.selectedLearner=event.target.value;paint(view);});
    root.querySelectorAll('[data-fr-select-learner]').forEach(button=>button.onclick=()=>{view.selectedLearner=button.dataset.frSelectLearner;paint(view);});
    root.querySelectorAll('[data-fr-breakdown-category]').forEach(button=>button.onclick=()=>{if(button.dataset.frBreakdownLearner){view.selectedLearner=button.dataset.frBreakdownLearner;paint(view);}root.querySelector('#frLedgerCategory').value=button.dataset.frBreakdownCategory;root.querySelector('#frLedgerSource').value=sourceFilter(button.dataset.frBreakdownSource);loadLedger(view);root.querySelector('[data-fr-ledger-section]').scrollIntoView({behavior:'smooth'});});
    root.querySelectorAll('[data-fr-scope]').forEach(fieldset=>{const select=root.querySelector(`#${fieldset.dataset.frScope}Scope`);select.onchange=()=>fieldset.hidden=select.value!=='selected';});
    root.querySelector('#frRuleCadence')?.addEventListener('change',event=>syncCadence(event.target.form));
    for(const prefix of ['frOccurrence','frSelfReport']){const select=root.querySelector(`#${prefix}Rule`);if(select){select.addEventListener('change',()=>syncAdhkar(view,prefix));syncAdhkar(view,prefix);}}
    root.querySelector('#frAdjustmentReversal')?.addEventListener('input',event=>{const delta=root.querySelector('#frAdjustmentDelta'),reversal=event.target.value.trim();delta.required=!reversal;delta.disabled=!!reversal;});
    root.querySelectorAll('[data-fr-form-reset]').forEach(button=>button.onclick=()=>{const form=button.closest('form');form.reset();form.querySelectorAll('[data-fr-preserved-scope]').forEach(element=>element.remove());delete form.dataset.recordId;delete form.dataset.idempotencyKey;form.querySelectorAll('[data-fr-scope]').forEach(fieldset=>fieldset.hidden=true);syncCadence(form);for(const prefix of ['frOccurrence','frSelfReport'])if(form.id===`${prefix}Form`)syncAdhkar(view,prefix);const delta=form.querySelector('#frAdjustmentDelta');if(delta){delta.disabled=false;delta.required=true;}form.querySelector('.fr-message').textContent='';});
    ['category','rule','reward'].forEach(kind=>{
      root.querySelectorAll(`[data-fr-edit-${kind}]`).forEach(button=>button.onclick=()=>edit(view,kind,button.getAttribute(`data-fr-edit-${kind}`)));
      root.querySelectorAll(`[data-fr-toggle-${kind}]`).forEach(button=>button.onclick=()=>{const rows=view.data[kind==='category'?'categories':`${kind}s`]||[],row=rows.find(row=>row.id===button.getAttribute(`data-fr-toggle-${kind}`));if(!row)return;mutation(view,button,`${kind}_save`,{...row,is_active:row.is_active===false},row.is_active===false?'تم التفعيل.':'تم التعطيل.');});
    });
    bindForm(view,'frCategoryForm','category_save',form=>({title:value(form,'frCategoryTitle'),description:value(form,'frCategoryDescription'),is_active:checked(form,'frCategoryActive')}),'تم حفظ الفئة.');
    bindForm(view,'frRuleForm','rule_save',form=>({title:value(form,'frRuleTitle'),description:value(form,'frRuleDescription'),category_id:value(form,'frRuleCategory'),base_points:optionalNumber(form,'frRuleBase'),initiative_bonus_points:optionalNumber(form,'frRuleBonus'),...scopePayload(form,'frRule'),cadence:value(form,'frRuleCadence'),max_awards:value(form,'frRuleCadence')==='unlimited'?null:optionalNumber(form,'frRuleLimit'),self_report_allowed:checked(form,'frRuleSelfReport'),parent_approval_required:checked(form,'frRuleApproval'),is_active:checked(form,'frRuleActive')}),'تم حفظ السلوك.');
    bindForm(view,'frRewardForm','reward_save',form=>{const criteria={};for(const [id,key]of[['frRewardStreak','current_streak'],['frRewardLongestStreak','longest_streak'],['frRewardXp','min_xp']]){const n=optionalNumber(form,id);if(n!==null)criteria[key]=n;}const badges=[...form.querySelectorAll('[name="required_badge_codes"]:checked')].map(element=>element.value);if(badges.length)criteria.required_badge_codes=badges;return{title:value(form,'frRewardTitle'),description:value(form,'frRewardDescription'),reward_type:value(form,'frRewardType'),required_reward_points:optionalNumber(form,'frRewardPoints'),required_level:optionalNumber(form,'frRewardLevel'),criteria,...scopePayload(form,'frReward'),available_from:datetime(value(form,'frRewardFrom')),available_until:datetime(value(form,'frRewardUntil')),max_redemptions_per_learner:optionalNumber(form,'frRewardLimit'),parent_approval_required:true,is_active:checked(form,'frRewardActive')};},'تم حفظ الجائزة.');
    for(const [prefix,action]of[['frOccurrence','behavior_record'],['frSelfReport','behavior_submit']])bindForm(view,`${prefix}Form`,action,form=>({...(view.role==='parent'?{learner_id:value(form,'frOccurrenceLearner')}:{}),rule_id:value(form,`${prefix}Rule`),initiative:checked(form,`${prefix}Initiative`),adhkar_completed:checked(form,`${prefix}Adhkar`),occurred_at:datetime(value(form,`${prefix}At`)),reason:value(form,`${prefix}Reason`),idempotency_key:true}),view.role==='parent'?'تم اعتماد السلوك وتحديث الرصيد.':'وصل طلبك إلى الأهل. نقاطك تظل كما هي حتى الموافقة.');
    bindForm(view,'frAdjustmentForm','points_adjust',form=>({learner_id:value(form,'frAdjustmentLearner'),delta:optionalNumber(form,'frAdjustmentDelta'),reason:value(form,'frAdjustmentReason'),...(value(form,'frAdjustmentReversal')?{reversal_event_id:value(form,'frAdjustmentReversal')}:{}),idempotency_key:true}),'تم تسجيل الحركة التعويضية في السجل.');
    for(const [kind,idField,action]of[['behavior','submission_id','behavior_review'],['claim','claim_id','reward_review']])for(const [suffix,decision]of[['approve','approved'],['reject','rejected']])root.querySelectorAll(`[data-fr-${kind}-${suffix}]`).forEach(button=>button.onclick=()=>mutation(view,button,action,{[idField]:button.getAttribute(`data-fr-${kind}-${suffix}`),decision,reason:root.querySelector('#frReviewReason')?.value.trim()||''},decision==='approved'?'تم الاعتماد وتحديث السجل.':'تم رفض الطلب دون تغيير النقاط.'));
    root.querySelectorAll('[data-fr-claim-redeem]').forEach(button=>button.onclick=()=>mutation(view,button,'reward_redeem',{claim_id:button.dataset.frClaimRedeem,reason:root.querySelector('#frReviewReason')?.value.trim()||''},'تم تسجيل تسليم الجائزة؛ لا يوجد خصم إضافي.'));
    root.querySelectorAll('[data-fr-request-reward]').forEach(button=>button.onclick=()=>{const id=button.dataset.frRequestReward,key=`${view.token}:${id}`;if(requestKeys.has(key))button.dataset.idempotencyKey=requestKeys.get(key);else{button.dataset.idempotencyKey=crypto.randomUUID();requestKeys.set(key,button.dataset.idempotencyKey);}mutation(view,button,'reward_request',{reward_id:id,idempotency_key:true},'طلب الجائزة بانتظار موافقة الأهل.');});
    root.querySelector('#frLedgerCategory').onchange=()=>loadLedger(view);
    root.querySelector('#frLedgerSource').onchange=()=>loadLedger(view);
    root.querySelector('[data-fr-ledger-all]').onclick=()=>loadLedger(view);
    root.querySelector('[data-fr-ledger-more]').onclick=()=>loadLedger(view,false);
    syncCadence(root.querySelector('#frRuleForm')||root);
  }
  async function route() {
    const role=location.hash==='#parent-rewards'?'parent':location.hash==='#student-rewards'?'student':null;
    generation++;
    if(!role){screen=null;requestKeys.clear();return;}
    const token=tokenFor(role);
    if(!token){location.hash=role==='parent'?'parents':'student';return;}
    const view={role,token,generation,data:{},selectedLearner:'',ledger:[],ledgerSerial:0,ledgerBusy:false};screen=view;
    shell(role==='parent'?'🎁 الجوائز والعادات':'🎁 جوائزي وعاداتي',role==='parent'?'نقاط واضحة، سلوكيات تشجّعها العائلة، وجوائز باعتماد الأهل.':'تقدّمك الشخصي ومصدر نقاطك، خطوة بخطوة.',`<div class="actions fr-page-actions"><a class="btn btn-soft" href="#${role==='parent'?'parents':'student'}">رجوع ${role==='parent'?'للوحة الأهل':'إلى صفحتي'}</a><button class="btn btn-soft" data-fr-refresh>تحديث</button></div><div data-family-rewards data-role="${role}"><div class="loading-card" role="status">جارٍ تحميل النقاط والجوائز…</div></div>`);
    view.root=document.querySelector('[data-family-rewards]');
    document.querySelector('[data-fr-refresh]').onclick=async()=>{try{await refresh(view);}catch(error){if(current(view)){if(view.refreshRequired)savedRefreshNotice(view);else reportError(view.root,error);}}};
    try{await refresh(view);}catch(error){if(current(view)){reportError(view.root,error);view.root.insertAdjacentHTML('beforeend','<div class="actions"><button class="btn btn-soft" data-fr-retry>إعادة المحاولة</button></div>');view.root.querySelector('[data-fr-retry]').onclick=route;}}
  }
  window.addEventListener('hashchange',()=>setTimeout(route,0));
  document.addEventListener('DOMContentLoaded',()=>setTimeout(route,0),{once:true});
  if(location.hash==='#parent-rewards'||location.hash==='#student-rewards')setTimeout(route,0);
})();
