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
    REDEMPTION_LIMIT:'وصلت إلى حد استبدال هذه الجائزة.',CLAIM_ALREADY_PENDING:'لديك طلب لهذه الجائزة بانتظار الموافقة.',DUPLICATE_OCCURRENCE:'تمت مكافأة هذه الواقعة سابقًا؛ لم تُضف نقاط مرة ثانية.',ALREADY_REVERSED:'تم عكس هذه الحركة سابقًا.',
    RETURN_EVENT_REQUIRED:'اختر مناسبة العودة الحقيقية قبل الاعتماد.',RETURN_EVENT_NOT_FOUND:'المناسبة غير متاحة لهذا الحساب. حدّث القائمة.',INVALID_RETURN_EVENT:'تحقّق من مناسبة العودة المختارة.',RETURN_EVENT_IMMUTABLE:'لا يمكن تغيير مناسبة معتمدة؛ حدّث السجل.',
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
  const OCCURRENCE_TIME_ZONE='Europe/Istanbul';
  const occurrenceZoneParts = dateValue => Object.fromEntries(
    new Intl.DateTimeFormat('en-US',{
      timeZone:OCCURRENCE_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',
    }).formatToParts(new Date(dateValue)).filter(part=>part.type!=='literal').map(part=>[part.type,part.value])
  );
  const zonedYmd = dateValue => {
    const parts=occurrenceZoneParts(dateValue);
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const zonedHm = dateValue => {
    const parts=occurrenceZoneParts(dateValue);
    return `${parts.hour}:${parts.minute}`;
  };
  function shiftYmd(day,deltaDays){
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(day||'');
    if(!match)throw new Error('INVALID_OCCURRED_AT');
    const shifted=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])+deltaDays));
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth()+1).padStart(2,'0')}-${String(shifted.getUTCDate()).padStart(2,'0')}`;
  }
  function zonedLocalIso(day,clock){
    const dayMatch=/^(\d{4})-(\d{2})-(\d{2})$/.exec(day||'');
    const timeMatch=/^(\d{2}):(\d{2})$/.exec(clock||'');
    if(!dayMatch||!timeMatch)throw new Error('INVALID_OCCURRED_AT');
    const expected={
      year:Number(dayMatch[1]),month:Number(dayMatch[2]),day:Number(dayMatch[3]),
      hour:Number(timeMatch[1]),minute:Number(timeMatch[2]),second:0,
    };
    if(expected.month<1||expected.month>12||expected.day<1||expected.day>31||expected.hour>23||expected.minute>59)throw new Error('INVALID_OCCURRED_AT');
    const targetUtc=Date.UTC(expected.year,expected.month-1,expected.day,expected.hour,expected.minute,0);
    let guess=targetUtc;
    for(let i=0;i<4;i++){
      const parts=occurrenceZoneParts(new Date(guess));
      const seenUtc=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second));
      const correction=targetUtc-seenUtc;
      guess+=correction;
      if(correction===0)break;
    }
    const finalParts=occurrenceZoneParts(new Date(guess));
    if(
      Number(finalParts.year)!==expected.year||Number(finalParts.month)!==expected.month||Number(finalParts.day)!==expected.day||
      Number(finalParts.hour)!==expected.hour||Number(finalParts.minute)!==expected.minute
    )throw new Error('INVALID_OCCURRED_AT');
    return new Date(guess).toISOString();
  }
  function ruleEligibleForLearner(rule, learnerId) {
    return rule.learner_scope !== 'selected' || !learnerId || (rule.learner_ids || []).includes(learnerId);
  }
  function occurrenceRules(view, prefix) {
    const learnerId = prefix === 'frOccurrence' ? (view.root?.querySelector('#frOccurrenceLearner')?.value || view.selectedLearner || '') : (learners(view)[0]?.id || '');
    return (view.data.rules || []).filter(rule => rule.is_active !== false && view.data.categories?.find(category=>category.id===rule.category_id)?.is_active !== false && (prefix === 'frOccurrence' || rule.self_report_allowed) && ruleEligibleForLearner(rule, learnerId));
  }
  function recentBehaviorOrder(rules, submissions, learnerId) {
    const usage=new Map();
    for(const row of submissions||[]){
      if(row.learner_id!==learnerId||!['approved','pending'].includes(row.status))continue;
      const at=Date.parse(row.occurred_at||row.requested_at||'');if(!Number.isFinite(at))continue;
      const previous=usage.get(row.rule_id)||{count:0,at:0};usage.set(row.rule_id,{count:previous.count+1,at:Math.max(previous.at,at)});
    }
    return rules.map((rule,index)=>({rule,index,usage:usage.get(rule.id)||{count:0,at:0}})).sort((a,b)=>b.usage.count-a.usage.count||b.usage.at-a.usage.at||a.index-b.index).map(item=>item.rule);
  }
  function occurrenceCategories(view, prefix) {
    const ids = new Set(occurrenceRules(view,prefix).map(rule => rule.category_id));
    return (view.data.categories || []).filter(category => category.is_active !== false && ids.has(category.id));
  }
  function syncOccurrenceCategories(view,prefix) {
    const category=view.root.querySelector(`#${prefix}Category`);
    if(!category){syncBehaviorPicker(view,prefix);return;}
    const previous=category.value, rows=occurrenceCategories(view,prefix);
    category.innerHTML=`<option value="">اختر الفئة</option>${rows.map(row=>`<option value="${safe(row.id)}">${safe(row.title)}</option>`).join('')}`;
    if(rows.some(row=>row.id===previous))category.value=previous;
    syncBehaviorPicker(view,prefix);
  }
  function syncBehaviorPicker(view, prefix) {
    const category = view.root.querySelector(`#${prefix}Category`), ruleSelect = view.root.querySelector(`#${prefix}Rule`);
    if(!ruleSelect)return;
    if(prefix==='frSelfReport'){
      const previous=ruleSelect.value,rows=recentBehaviorOrder(occurrenceRules(view,prefix),view.data.submissions,learners(view)[0]?.id);
      ruleSelect.innerHTML=selectOptions(rows,rows.length?'اختر السلوك':'لا توجد سلوكيات متاحة');
      if(rows.some(row=>row.id===previous))ruleSelect.value=previous;
      ruleSelect.disabled=!rows.length;syncPrayerBonuses(view,prefix);return;
    }
    if (!category) return;
    const rows = occurrenceRules(view,prefix).filter(rule => rule.category_id === category.value);
    ruleSelect.innerHTML = selectOptions(rows, category.value ? (rows.length ? 'اختر السلوك' : 'لا توجد سلوكيات في هذه الفئة') : 'اختر الفئة أولًا');
    ruleSelect.disabled = !category.value || !rows.length;
    syncPrayerBonuses(view,prefix);
  }
  function syncOccurrenceWhen(view, prefix) {
    const dateMode=view.root.querySelector(`#${prefix}DateMode`), timeMode=view.root.querySelector(`#${prefix}TimeMode`);
    const dateWrap=view.root.querySelector(`[data-fr-custom-date="${prefix}"]`), timeWrap=view.root.querySelector(`[data-fr-custom-time="${prefix}"]`);
    if(!dateMode)return;
    if(dateWrap)dateWrap.hidden=dateMode.value!=='custom';
    if(!timeMode)return;
    const nowOption=timeMode.querySelector('option[value="now"]');
    if(nowOption)nowOption.disabled=dateMode.value!=='today';
    if(dateMode.value!=='today'&&timeMode.value==='now')timeMode.value='morning';
    if(timeWrap)timeWrap.hidden=timeMode.value!=='custom';
  }
  function occurrenceAt(form,prefix) {
    const now=new Date(), dateMode=value(form,`${prefix}DateMode`), timeMode=value(form,`${prefix}TimeMode`);
    if(prefix==='frSelfReport'){
      const signature=JSON.stringify([value(form,`${prefix}Rule`),dateMode,dateMode==='custom'?value(form,`${prefix}Date`):'']);
      if(form.dataset.occurrenceSignature!==signature){delete form.dataset.idempotencyKey;delete form.dataset.occurredAt;form.dataset.occurrenceSignature=signature;}
      if(dateMode==='today')return null; // The server binds its timestamp to the idempotency key.
      if(form.dataset.occurredAt)return form.dataset.occurredAt;
      const day=dateMode==='yesterday'?shiftYmd(zonedYmd(now),-1):value(form,`${prefix}Date`);
      if(!day)throw new Error('INVALID_OCCURRED_AT');
      const automatic=new Date(zonedLocalIso(day,zonedHm(now))).getTime()+now.getUTCSeconds()*1000+now.getUTCMilliseconds();
      form.dataset.occurredAt=new Date(automatic).toISOString();
      return form.dataset.occurredAt;
    }
    let day;
    if(dateMode==='today')day=zonedYmd(now);
    else if(dateMode==='yesterday')day=shiftYmd(zonedYmd(now),-1);
    else day=value(form,`${prefix}Date`);
    if(!day)throw new Error('INVALID_OCCURRED_AT');
    let clock;
    if(timeMode==='now'){if(dateMode!=='today')throw new Error('INVALID_OCCURRED_AT');return null;}
    else if(timeMode==='morning')clock='08:00';
    else if(timeMode==='afternoon')clock='15:00';
    else if(timeMode==='evening')clock='19:00';
    else clock=value(form,`${prefix}Time`);
    if(!clock)throw new Error('INVALID_OCCURRED_AT');
    return zonedLocalIso(day,clock);
  }
  function exactOccurrenceKey(row) {
    if(!row?.learner_id||!row?.rule_id||!row?.occurred_at)return '';
    const parsed=new Date(row.occurred_at);
    return Number.isFinite(parsed.getTime()) ? `${row.learner_id}|${row.rule_id}|${parsed.toISOString()}` : '';
  }
  function duplicateSubmissionIds(rows,eventFor=()=>null) {
    const keyFor=row=>{
      if(row.rule_id!==PARENT_RETURN_RULE)return exactOccurrenceKey(row);
      const eventId=eventFor(row)?.id||row.return_event_id;
      return eventId&&row.learner_id?`${row.learner_id}|${row.rule_id}|${eventId}`:'';
    };
    const seen=new Map(), duplicates=new Set(), approved=new Set(rows.filter(row=>row.status==='approved').map(keyFor).filter(Boolean));
    for(const row of rows.filter(row=>row.status==='pending')){
      const key=keyFor(row),event=eventFor(row);
      if(row.possible_duplicate||event?.awarded_learner_ids?.includes(row.learner_id)||key&&approved.has(key))duplicates.add(row.id);
      if(!key)continue;
      if(seen.has(key)){duplicates.add(seen.get(key));duplicates.add(row.id);} else seen.set(key,row.id);
    }
    return duplicates;
  }
  function name(view, id) { return learners(view).find(row => row.id === id)?.display_name || 'الطالب'; }
  function categoryName(view, row) { return row.category_title || row.category_name || row.metadata?.category_title || view.data.categories?.find(category => category.id === (row.category_id || row.metadata?.category_id))?.title || sourceText(row.source_type); }
  function ruleName(view, row) { return row.rule_title || row.behavior_title || row.metadata?.rule_title || view.data.rules?.find(rule => rule.id === (row.rule_id || row.metadata?.rule_id))?.title || row.reason || 'حركة نقاط'; }
  function linkedBonus(row,key) { const metadata=row?.metadata||{};return number(row?.[key+'_bonus_points'] ?? metadata[key+'_bonus_points']); }
  function adhkarBonus(row) { return linkedBonus(row,'adhkar'); }
  function pointParts(row) {
    const metadata = row.metadata || {};
    const base = row.base_points ?? metadata.base_points;
    const bonus = row.initiative_bonus_points ?? metadata.initiative_bonus_points ?? metadata.initiative_bonus;
    const adhkar = adhkarBonus(row);
    const congregation = linkedBonus(row,'congregation');
    const mosque = linkedBonus(row,'mosque');
    const sunnah = linkedBonus(row,'sunnah');
    return base != null || bonus != null || adhkar || congregation || mosque || sunnah ? `<div class="fr-points-parts">أساس السلوك ${isolated(number(base))} + مكافأة المبادرة ${isolated(number(bonus))}${congregation ? ` + صلاة الجماعة ${isolated(congregation)}` : ''}${mosque ? ` + الصلاة في المسجد ${isolated(mosque)}` : ''}${sunnah ? ` + سنة الصلاة ${isolated(sunnah)}` : ''}${adhkar ? ` + أذكار ما بعد الصلاة ${isolated(adhkar)}` : ''}</div>` : '';
  }
  const PREVIEW_COMPONENTS=[['base_points','أساس السلوك'],['initiative_bonus_points','المبادرة'],['congregation_bonus_points','صلاة الجماعة'],['mosque_bonus_points','الصلاة في المسجد'],['sunnah_bonus_points','سنة الصلاة'],['adhkar_bonus_points','أذكار ما بعد الصلاة']];
  const PARENT_RETURN_RULE='a315e8af-9d9b-473b-95ac-c5425ad7de5b';
  function pendingProjection(rules,row,event=null){
    const snapshot=row.snapshot;
    const duplicate=row.possible_duplicate===true||!!event?.awarded_learner_ids?.includes(row.learner_id);
    const projection=value=>({...value,forecast:duplicate?0:value.total,duplicate,conditional:row.rule_id===PARENT_RETURN_RULE&&!event});
    if(snapshot&&Object.keys(snapshot).length){
      const valid=snapshot.policy_version==='flh-010-v1.5'&&snapshot.status==='pending'&&snapshot.rule_id===row.rule_id&&PREVIEW_COMPONENTS.every(([key])=>typeof snapshot[key]==='number'&&Number.isInteger(snapshot[key])&&snapshot[key]>=0&&snapshot[key]<=100000)&&typeof snapshot.total_points==='number'&&snapshot.total_points===PREVIEW_COMPONENTS.reduce((sum,[key])=>sum+snapshot[key],0);
      return projection(valid?{total:snapshot.total_points,parts:snapshot,source:'captured'}:{total:null,parts:null,source:'unavailable'});
    }
    const rule=rules.find(rule=>rule.id===row.rule_id);if(!rule)return projection({total:null,parts:null,source:'unavailable'});
    const parts={base_points:rule.base_points};
    for(const [key,flag] of [['initiative_bonus_points','initiative'],['congregation_bonus_points','congregation_completed'],['mosque_bonus_points','mosque_completed'],['sunnah_bonus_points','sunnah_completed'],['adhkar_bonus_points','adhkar_completed']])parts[key]=row[flag]?(rule[key]??0):0;
    if(!PREVIEW_COMPONENTS.every(([key])=>typeof parts[key]==='number'&&Number.isInteger(parts[key])&&parts[key]>=0&&parts[key]<=100000))return projection({total:null,parts:null,source:'unavailable'});
    return projection({total:PREVIEW_COMPONENTS.reduce((sum,[key])=>sum+parts[key],0),parts,source:'current'});
  }
  function pendingSummary(rules,rows,eventFor=()=>null){
    rows=rows.filter(row=>row.status==='pending');
    const unique=new Map();
    for(const row of rows){
      const event=eventFor(row),key=row.rule_id===PARENT_RETURN_RULE?(event?.id?row.learner_id+'|'+row.rule_id+'|'+event.id:row.id):exactOccurrenceKey(row)||row.id,preview=pendingProjection(rules,row,event);
      if(!unique.has(key))unique.set(key,preview.forecast);
      else if(unique.get(key)!==preview.forecast)unique.set(key,null);
    }
    const totals=[...unique.values()];
    return{count:rows.length,uniqueCount:unique.size,total:totals.some(total=>total===null)?null:totals.reduce((sum,total)=>sum+total,0)};
  }

  function selectedReturnEvent(view,row){
    const id=view.returnSelections.get(row.id)||row.return_event_id;
    return id?view.returnEvents.get(id)||{id,awarded_learner_ids:[]}:null;
  }
  function returnApprovalPayload(view,row){
    if(row?.rule_id!==PARENT_RETURN_RULE)return{};
    return{return_event_id:view.returnSelections.get(row.id)||row.return_event_id||null};
  }
  function clearReturnChoiceError(view,key,host){
    const bindingErrors=['RETURN_EVENT_REQUIRED','RETURN_EVENT_NOT_FOUND','INVALID_RETURN_EVENT'];
    if(bindingErrors.includes(view.approvalErrors.get(key))){
      view.approvalErrors.delete(key);host.closest('[data-fr-submission]')?.querySelector('.fr-item-error')?.remove();
    }
    const messageHost=host.closest('form')?.querySelector('.fr-message')||host.closest('[data-fr-approvals]')?.querySelector('.fr-message');
    if(messageHost&&bindingErrors.some(code=>messageHost.textContent===errorMessages[code]))messageHost.textContent='';
  }
  function returnEventControl(view,key,claimedAt){
    const selected=view.returnEvents.get(view.returnSelections.get(key)),day=zonedYmd(new Date(selected?.occurred_at||claimedAt||Date.now()));
    const prefix='frReturn'+key.replace(/[^a-zA-Z0-9]/g,'');
    return `<fieldset class="fr-return-control" data-fr-return-context="${safe(key)}" data-fr-return-prefix="${prefix}">
      <legend>مناسبة العودة الموثّقة</legend><p class="muted">اختر المناسبة المسجّلة لهذه العودة نفسها، ولو تكررت القبلات أو بلّغ طالب آخر عنها. أنشئ سجلًا جديدًا فقط لعودة حقيقية أخرى.</p>
      ${field(prefix+'ListDay','يوم مناسبة العودة',`<input id="${prefix}ListDay" type="date" dir="ltr" data-fr-return-day value="${safe(day)}">`)}
      ${field(prefix+'Select','مناسبة العودة',`<select id="${prefix}Select" data-fr-return-select><option value="">اختر مناسبة مسجّلة</option></select>`)}
      <div class="actions"><button class="btn btn-soft" type="button" data-fr-return-load>تحديث المناسبات</button><button class="btn btn-soft" type="button" data-fr-return-more hidden>مناسبات أخرى</button></div>
      <details data-fr-return-create-details><summary>تسجيل مناسبة عودة حقيقية جديدة</summary>
        <p class="muted">تحقّق من القائمة أولًا. سجل المناسبة مشترك بين الطلاب، ولا يمنح نقاطًا بمجرد إنشائه.</p>
        <div class="fr-form-grid">${field(prefix+'DateMode','تاريخ العودة',`<select id="${prefix}DateMode"><option value="today">اليوم</option><option value="yesterday">أمس</option><option value="custom">اختيار تاريخ</option></select>`)}
        <div data-fr-custom-date="${prefix}" hidden>${field(prefix+'Date','التاريخ المحدد',`<input id="${prefix}Date" type="date" dir="ltr">`)}</div>
        ${field(prefix+'TimeMode','وقت العودة',`<select id="${prefix}TimeMode"><option value="now">الآن</option><option value="morning">صباحًا</option><option value="afternoon">ظهرًا</option><option value="evening">مساءً</option><option value="custom">وقت محدد</option></select>`)}
        <div data-fr-custom-time="${prefix}" hidden>${field(prefix+'Time','الوقت المحدد',`<input id="${prefix}Time" type="time" dir="ltr">`)}</div></div>
        <div class="actions"><button class="btn btn-primary" type="button" data-fr-return-create>تسجيل واختيار المناسبة</button><button class="btn btn-soft" type="button" data-fr-return-cancel>إلغاء</button></div>
      </details><div class="fr-return-message" role="status" aria-live="polite"></div></fieldset>`;
  }
  function syncReturnForecasts(view){
    if(!current(view))return;
    view.duplicateSubmissionIds=duplicateSubmissionIds(view.data.submissions||[],row=>selectedReturnEvent(view,row));
    for(const row of view.data.submissions||[]){
      if(row.status!=='pending')continue;
      const preview=pendingProjection(view.data.rules||[],row,selectedReturnEvent(view,row));
      for(const card of [...view.root.querySelectorAll('[data-fr-submission]')].filter(card=>card.dataset.frSubmission===row.id)){
        const duplicate=view.duplicateSubmissionIds.has(row.id),stack=card.querySelector('.fr-status-stack');
        let badge=stack?.querySelector('.fr-duplicate');
        if(duplicate&&stack&&!badge){badge=document.createElement('span');badge.className='fr-status fr-duplicate';badge.textContent='مكرر محتمل';stack.append(badge);}
        else if(!duplicate)badge?.remove();
        const explanation=card.querySelector('.fr-duplicate-explanation');if(explanation)explanation.hidden=!duplicate;
        const estimate=card.querySelector('.fr-estimate');
        if(estimate)estimate.innerHTML=preview.forecast===null?'التقدير غير متاح':`${isolated(preview.forecast)} نقطة متوقعة`;
        const source=card.querySelector('.fr-preview-source');
        if(source&&row.rule_id===PARENT_RETURN_RULE)source.textContent=preview.duplicate?'تم منح نقاط لهذه المناسبة؛ لا يتوقع منح نقاط جديدة.':preview.conditional?'نقطتان مشروطتان باختيار مناسبة حقيقية والتحقق من الحد اليومي':'تقدير مشروط بالتحقق من الحد اليومي؛ لم يضف إلى الرصيد';
      }
    }
    for(const group of view.root.querySelectorAll('[data-fr-approval-learner]')){
      const ids=new Set([...group.querySelectorAll('[data-fr-submission]')].map(card=>card.dataset.frSubmission));
      const rows=(view.data.submissions||[]).filter(row=>row.status==='pending'&&row.learner_id===group.dataset.frApprovalLearner&&ids.has(row.id));
      const summary=pendingSummary(view.data.rules||[],rows,row=>selectedReturnEvent(view,row));
      group.querySelector('[data-fr-pending-total]').innerHTML=summary.total===null?'غير متاح':`${isolated(summary.total)} نقطة`;
    }
  }
  function syncReturnControl(view,host){
    if(!current(view)||!host.isConnected)return;
    const key=host.dataset.frReturnContext,day=host.querySelector('[data-fr-return-day]').value,page=view.returnPages.get(day),chosen=view.returnSelections.get(key);
    const rows=[...(page?.rows||[])],selected=view.returnEvents.get(chosen);
    if(selected&&!rows.some(event=>event.id===chosen))rows.unshift(selected);
    host.querySelector('[data-fr-return-select]').innerHTML='<option value="">اختر مناسبة مسجّلة</option>'+rows.map(event=>`<option value="${safe(event.id)}" ${event.id===chosen?'selected':''}>${safe(date(event.occurred_at))}</option>`).join('');
    host.querySelector('[data-fr-return-more]').hidden=!page?.cursor;
    host.querySelector('[data-fr-return-load]').disabled=!!page?.busy;
    host.querySelector('[data-fr-return-more]').disabled=!!page?.busy;
    const messageHost=host.querySelector('.fr-return-message');
    messageHost.textContent=page?.busy?'جارٍ تحميل المناسبات…':page?.error?(errorMessages[page.error]||'تعذر تحميل المناسبات. أعد المحاولة.'):page?.loaded&&!rows.length?'لا توجد مناسبات مسجّلة لهذا اليوم.':'';
  }
  async function loadReturnEvents(view,host,more=false){
    if(!current(view)||!host.isConnected)return;
    const day=host.querySelector('[data-fr-return-day]').value;
    if(!day)return;
    const previous=view.returnPages.get(day);
    if(previous?.busy)return;
    const cursor=more?previous?.cursor:null,serial=++view.returnSerial;
    const page={rows:more?previous?.rows||[]:[],cursor:null,busy:true,loaded:false,serial};
    view.returnPages.set(day,page);
    view.root.querySelectorAll('[data-fr-return-context]').forEach(control=>syncReturnControl(view,control));
    try{
      const result=await call(view,'return_events_list',{return_event_day:day,...(cursor?{return_event_before_at:cursor.occurred_at,return_event_before_id:cursor.id}:{})});
      if(!current(view)||view.returnPages.get(day)?.serial!==serial)return;
      for(const event of result.return_events||[])view.returnEvents.set(event.id,event);
      page.rows=[...new Map([...page.rows,...(result.return_events||[])].map(event=>[event.id,event])).values()];
      page.cursor=result.return_event_next_cursor||null;page.loaded=true;
    }catch(error){if(current(view)&&view.returnPages.get(day)?.serial===serial)page.error=String(error?.message||'SERVER_ERROR');}
    finally{if(current(view)&&view.returnPages.get(day)?.serial===serial){page.busy=false;view.root.querySelectorAll('[data-fr-return-context]').forEach(control=>syncReturnControl(view,control));syncReturnForecasts(view);}}
  }
  async function createReturnEvent(view,host){
    if(!current(view)||view.refreshRequired||host.dataset.frBusy==='1')return;
    const prefix=host.dataset.frReturnPrefix,messageHost=host.querySelector('.fr-return-message'),key=host.dataset.frReturnContext;
    let occurredAt;
    try{occurredAt=host.dataset.createOccurredAt||occurrenceAt(host,prefix)||new Date().toISOString();if(!Number.isFinite(new Date(occurredAt).getTime()))throw new Error('INVALID_OCCURRED_AT');}
    catch(error){reportError(messageHost,error);return;}
    host.dataset.createOccurredAt=occurredAt;host.dataset.idempotencyKey||=crypto.randomUUID();host.dataset.frBusy='1';
    const controls=[...host.querySelectorAll('button,input,select')];controls.forEach(control=>control.disabled=true);host.setAttribute('aria-busy','true');
    try{
      const result=await call(view,'return_event_create',{occurred_at:occurredAt,idempotency_key:host.dataset.idempotencyKey}),event=result?.return_event;
      if(!current(view)||!host.isConnected)return;
      if(!event?.id||!Number.isFinite(new Date(event.occurred_at).getTime()))throw new Error('SERVER_ERROR');
      view.returnEvents.set(event.id,{...event,awarded_learner_ids:[]});view.returnSelections.set(key,event.id);
      clearReturnChoiceError(view,key,host);
      const day=zonedYmd(new Date(event.occurred_at)),page=view.returnPages.get(day)||{rows:[],loaded:true};
      page.rows=[event,...page.rows.filter(row=>row.id!==event.id)];view.returnPages.set(day,page);
      host.querySelector('[data-fr-return-day]').value=day;host.querySelector('[data-fr-return-create-details]').open=false;
      delete host.dataset.idempotencyKey;delete host.dataset.createOccurredAt;
      syncReturnControl(view,host);syncReturnForecasts(view);messageHost.textContent='تم تسجيل المناسبة واختيارها. لم تُضف نقاط؛ اعتمد الطلب بعد التحقق.';
    }catch(error){if(current(view)&&host.isConnected)reportError(messageHost,error);}
    finally{host.dataset.frBusy='0';host.removeAttribute('aria-busy');controls.forEach(control=>control.disabled=!!view.refreshRequired);}
  }
  function syncDirectReturn(view){
    if(view.role!=='parent')return;
    const host=view.root.querySelector('[data-fr-direct-return]');if(!host)return;
    host.hidden=view.root.querySelector('#frOccurrenceRule')?.value!==PARENT_RETURN_RULE;
  }
  function bindReturnControls(view){
    if(view.role!=='parent')return;
    for(const host of view.root.querySelectorAll('[data-fr-return-context]')){
      const select=host.querySelector('[data-fr-return-select]'),day=host.querySelector('[data-fr-return-day]'),key=host.dataset.frReturnContext,prefix=host.dataset.frReturnPrefix;
      select.onchange=()=>{if(select.value){view.returnSelections.set(key,select.value);clearReturnChoiceError(view,key,host);}else view.returnSelections.delete(key);syncReturnForecasts(view);};
      day.onchange=()=>{view.returnSelections.delete(key);loadReturnEvents(view,host);syncReturnForecasts(view);};
      host.querySelector('[data-fr-return-load]').onclick=()=>loadReturnEvents(view,host);
      host.querySelector('[data-fr-return-more]').onclick=()=>loadReturnEvents(view,host,true);
      host.querySelector('[data-fr-return-create]').onclick=()=>createReturnEvent(view,host);
      host.querySelector('[data-fr-return-cancel]').onclick=()=>{host.querySelector('[data-fr-return-create-details]').open=false;host.querySelector('.fr-return-message').textContent='';};
      for(const control of host.querySelectorAll('[data-fr-return-create-details] input,[data-fr-return-create-details] select'))control.addEventListener('change',()=>{delete host.dataset.idempotencyKey;delete host.dataset.createOccurredAt;syncOccurrenceWhen(view,prefix);});
      syncOccurrenceWhen(view,prefix);
      syncReturnControl(view,host);
      if(!view.returnPages.get(day.value)?.loaded)loadReturnEvents(view,host);
    }
  }

  function projectionDetails(preview){
    if(!preview.parts)return'<div class="muted">لا يتوفر تقدير موثوق لهذا الطلب.</div>';
    return `<div class="fr-preview-parts">${PREVIEW_COMPONENTS.filter(([key])=>key==='base_points'||preview.parts[key]>0).map(([key,label])=>`<div>${safe(label)}: ${isolated(preview.parts[key])}</div>`).join('')}<div><b>المجموع المتوقع: ${isolated(preview.total)} نقطة</b></div></div>`;
  }
  const estimateText=total=>total===null?'التقدير غير متاح':`${total} نقطة متوقعة`;
  function statusBadge(status) { return `<span class="fr-status ${safe(status || 'recorded')}">${safe(statusText(status))}</span>`; }
  function ledgerCard(view, row) {
    const metadata = row.metadata || {}, delta = number(row.reward_points_delta ?? row.total_points ?? metadata.total_points);
    return `<article data-fr-event="${safe(row.id)}" class="fr-ledger-item"><div class="topline"><b>${safe(ruleName(view, row))}</b><strong class="fr-delta ${delta < 0 ? 'spent' : ''}">${isolated(`${delta > 0 ? '+' : ''}${delta}`)} نقطة</strong></div><div class="muted">${view.role === 'parent' ? `${safe(name(view, row.learner_id))} · ` : ''}${safe(categoryName(view, row))} · ${safe(sourceText(row.source_type))}</div>${pointParts(row)}${metadata.verified_occurred_at?`<div class="muted">وقت العودة الموثّقة: ${isolated(date(metadata.verified_occurred_at))}</div>`:''}${row.reason ? `<p>${safe(row.reason)}</p>` : ''}<div class="fr-ledger-meta">${statusBadge(row.status || metadata.status || 'approved')}<span>${isolated(date(row.occurred_at || metadata.occurred_at || row.created_at))}</span></div><details><summary>تفاصيل الحركة</summary><dl class="fr-details"><dt>مرجع الحركة</dt><dd>${isolated(row.id)}</dd><dt>المصدر</dt><dd>${safe(sourceText(row.source_type))}${row.source_id ? ` · ${isolated(row.source_id)}` : ''}</dd><dt>صاحب الطلب</dt><dd>${safe(row.requester_name || metadata.requester_name || (metadata.requester_learner_id ? name(view,metadata.requester_learner_id) : metadata.requester_type === 'parent' ? 'ولي الأمر' : metadata.actor_id ? 'ولي الأمر' : 'النظام الأكاديمي'))}${view.role === 'parent' && (metadata.requester_id || metadata.actor_id) ? ` · ${isolated(metadata.requester_id || metadata.actor_id)}` : ''}</dd><dt>المراجع</dt><dd>${safe(row.reviewer_name || metadata.reviewer_name || (metadata.reviewer_id ? 'ولي الأمر' : '—'))}${view.role === 'parent' && metadata.reviewer_id ? ` · ${isolated(metadata.reviewer_id)}` : ''}</dd><dt>تاريخ الاعتماد</dt><dd>${isolated(date(row.approved_at || metadata.approved_at || row.created_at))}</dd></dl></details></article>`;
  }
  function submissionCard(view, row, showReturnChoice=false) {
    const rule = view.data.rules?.find(rule => rule.id === row.rule_id), title = row.rule_title || rule?.title || row.reason || 'سلوك عائلي';
    if(row.status==='pending'){
      const preview=pendingProjection(view.data.rules||[],row,selectedReturnEvent(view,row)),error=view.approvalErrors?.get(row.id);
      const source=preview.conditional?'نقطتان مشروطتان باختيار مناسبة حقيقية والتحقق من الحد اليومي':preview.source==='captured'?'تقدير مسجّل مع الطلب':preview.source==='current'?'تقدير بحسب القاعدة الحالية؛ هذا الطلب القديم بلا تقدير مسجّل':'التقدير غير متاح';
      const conditions=[row.initiative&&preview.parts?.initiative_bonus_points>0?'تم دون تذكير':'',row.congregation_completed?'صلاة جماعة':'',row.mosque_completed?'في المسجد':'',row.sunnah_completed?'سنة الصلاة':'',row.adhkar_completed?'أذكار ما بعد الصلاة':''].filter(Boolean);
      return `<article data-fr-submission="${safe(row.id)}" class="fr-item fr-pending-card"><div class="topline"><b>${safe(title)}</b><span class="fr-status-stack">${statusBadge(row.status)}${view.duplicateSubmissionIds?.has(row.id)?'<span class="fr-status fr-duplicate">مكرر محتمل</span>':''}</span></div><div class="muted fr-occurrence-meta">${view.role==='parent'?`${safe(name(view,row.learner_id))} · `:''}${row.rule_id===PARENT_RETURN_RULE?'وقت البلاغ: ':''}${isolated(date(row.occurred_at||row.requested_at))}</div><div class="fr-estimate">${preview.forecast===null?'التقدير غير متاح':`${isolated(preview.forecast)} نقطة متوقعة`}</div><div class="muted fr-preview-source">${safe(source)}</div>${preview.duplicate?'<div class="muted">تم منح نقاط لهذه الواقعة سابقًا؛ لا يتوقع منح نقاط جديدة لهذا الطلب.</div>':''}${conditions.length?`<div class="fr-captured-status">${conditions.map(safe).join(' · ')}</div>`:''}${error?`<div class="error fr-item-error" role="alert">${safe(errorMessages[error]||'تعذر اعتماد هذا الطلب. حدّث العرض أو أعد المحاولة.')}</div>`:''}${view.role==='parent'&&showReturnChoice&&row.rule_id===PARENT_RETURN_RULE?returnEventControl(view,row.id,row.occurred_at):''}${view.role==='parent'?`<div class="actions fr-card-actions"><button class="btn btn-primary" data-fr-behavior-approve="${safe(row.id)}">اعتماد السلوك</button><button class="btn btn-soft" data-fr-behavior-reject="${safe(row.id)}">رفض</button></div>`:''}<details class="fr-submission-details"><summary>التفاصيل</summary>${projectionDetails(preview)}<div class="muted">${safe(categoryName(view,row))}</div>${row.reason?`<p>${safe(row.reason)}</p>`:''}${row.requested_at?`<div class="muted">وقت إرسال الطلب: ${isolated(date(row.requested_at))}</div>`:''}<div class="muted fr-duplicate-explanation" ${view.duplicateSubmissionIds?.has(row.id)?'':'hidden'}>قد يمثل هذا الطلب واقعة مسجّلة سابقًا؛ يتحقق الخادم قبل منح النقاط.</div></details></article>`;
    }
    return `<article data-fr-submission="${safe(row.id)}" class="fr-item"><div class="topline"><b>${safe(title)}</b><span class="fr-status-stack">${statusBadge(row.status)}${view.duplicateSubmissionIds?.has(row.id) ? '<span class="fr-status fr-duplicate">مكرر محتمل</span>' : ''}</span></div><div class="muted">${view.role === 'parent' ? `${safe(name(view, row.learner_id))} · ` : ''}${safe(categoryName(view, {...row,category_id:row.category_id || rule?.category_id}))} · ${isolated(date(row.occurred_at || row.created_at || row.requested_at))}</div>${row.status === 'pending' && rule ? `<div class="muted">النقاط المتوقعة بحسب القاعدة الحالية عند الاعتماد:</div>${pointParts({base_points:rule.base_points,initiative_bonus_points:row.initiative?rule.initiative_bonus_points:0,adhkar_bonus_points:row.adhkar_completed?rule.adhkar_bonus_points:0,congregation_bonus_points:row.congregation_completed?rule.congregation_bonus_points:0,mosque_bonus_points:row.mosque_completed?rule.mosque_bonus_points:0,sunnah_bonus_points:row.sunnah_completed?rule.sunnah_bonus_points:0})}` : pointParts(row)}${row.initiative ? '<div class="muted">تم دون تذكير</div>' : ''}${row.congregation_completed ? '<div class="muted">تمت الصلاة جماعة</div>' : ''}${row.mosque_completed ? '<div class="muted">تمت الصلاة في المسجد</div>' : ''}${row.sunnah_completed ? '<div class="muted">تمت سنة الصلاة</div>' : ''}${row.adhkar_completed ? '<div class="muted">تمت أذكار ما بعد الصلاة</div>' : ''}${row.reason ? `<p>${safe(row.reason)}</p>` : ''}${row.review_reason ? `<p>ملاحظة الأهل: ${safe(row.review_reason)}</p>` : ''}${row.status === 'pending' ? '<div class="muted">لا تُضاف نقاط قبل موافقة الأهل.</div>' : ''}${view.role === 'parent' && row.status === 'pending' ? `<div class="actions"><button class="btn btn-primary" data-fr-behavior-approve="${safe(row.id)}">اعتماد السلوك</button><button class="btn btn-soft" data-fr-behavior-reject="${safe(row.id)}">رفض</button></div>` : ''}</article>`;
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
    const role=view.role, prefix=role==='parent'?'frOccurrence':'frSelfReport', rows=occurrenceRules(view,prefix), categories=occurrenceCategories(view,prefix);
    if(role!=='parent')return `<form id="frSelfReportForm" class="fr-form"><h3>سجّل سلوكًا قمت به</h3><p class="muted">سيصل الطلب إلى الأهل. تُضاف النقاط بعد موافقتهم.</p>${field('frSelfReportRule','السلوك',`<select id="frSelfReportRule" required>${selectOptions(rows,'اختر السلوك')}</select>`)}${[['initiative','Initiative','تم دون تذكير'],['congregation','Congregation','صليت جماعة'],['mosque','Mosque','صليت في المسجد'],['sunnah','Sunnah','صليت سنة الصلاة'],['adhkar','Adhkar','قرأت أذكار ما بعد الصلاة']].map(([key,suffix,label])=>`<div data-fr-${key}="frSelfReport" hidden>${checkbox(`frSelfReport${suffix}`,label)}<span class="muted" data-fr-${key}-points="frSelfReport"></span></div>`).join('')}${field('frSelfReportDateMode','تاريخ السلوك','<select id="frSelfReportDateMode"><option value="today" selected>اليوم</option><option value="yesterday">أمس</option><option value="custom">تاريخ آخر</option></select>')}<div data-fr-custom-date="frSelfReport" hidden>${field('frSelfReportDate','التاريخ',input('frSelfReportDate','date','dir="ltr"'))}</div><details class="fr-note"><summary>أضف ملاحظة</summary>${field('frSelfReportReason','ملاحظة (اختياري)','<textarea id="frSelfReportReason" maxlength="1000" rows="2"></textarea>')}</details>${formFooter('تم')}</form>`;
    const categoryOptions=`<option value="">اختر الفئة</option>${categories.map(category=>`<option value="${safe(category.id)}">${safe(category.title)}</option>`).join('')}`;
    return `<form id="${prefix}Form" class="fr-form"><h3>${role==='parent'?'تسجيل سلوك معتمد مباشرة':'سجّل سلوكًا قمت به'}</h3>${role==='parent'?field('frOccurrenceLearner','الطالب',`<select id="frOccurrenceLearner" required>${selectOptions(learners(view),'اختر الطالب',learner)}</select>`):'<p class="muted">سيصل الطلب إلى الأهل. تُضاف النقاط بعد موافقتهم.</p>'}${field(`${prefix}Category`,'الفئة',`<select id="${prefix}Category" required>${categoryOptions}</select>`)}${field(`${prefix}Rule`,'السلوك',`<select id="${prefix}Rule" required disabled><option value="">اختر الفئة أولًا</option></select>`)}<div data-fr-initiative="${prefix}" hidden>${checkbox(`${prefix}Initiative`,'قمت به دون تذكير (مبادرة)')}<span class="muted" data-fr-initiative-points="${prefix}"></span></div><div data-fr-congregation="${prefix}" hidden>${checkbox(`${prefix}Congregation`,'صليت الفرض جماعة')}<span class="muted" data-fr-congregation-points="${prefix}"></span></div><div data-fr-mosque="${prefix}" hidden>${checkbox(`${prefix}Mosque`,'صليت في المسجد')}<span class="muted" data-fr-mosque-points="${prefix}"></span></div><div data-fr-sunnah="${prefix}" hidden>${checkbox(`${prefix}Sunnah`,'صليت السنة المرتبطة بالصلاة')}<span class="muted" data-fr-sunnah-points="${prefix}"></span></div><div data-fr-adhkar="${prefix}" hidden>${checkbox(`${prefix}Adhkar`,'قرأت أذكار ما بعد الصلاة')}<span class="muted" data-fr-adhkar-points="${prefix}"></span></div><div class="fr-form-grid">${field(`${prefix}DateMode`,'تاريخ السلوك',`<select id="${prefix}DateMode"><option value="today" selected>اليوم</option><option value="yesterday">أمس</option><option value="custom">اختيار تاريخ</option></select>`)}<div data-fr-custom-date="${prefix}" hidden>${field(`${prefix}Date`,'التاريخ',input(`${prefix}Date`,'date','dir="ltr"'))}</div>${field(`${prefix}TimeMode`,'الوقت',`<select id="${prefix}TimeMode"><option value="now" selected>الآن</option><option value="morning">صباحًا</option><option value="afternoon">ظهرًا</option><option value="evening">مساءً</option><option value="custom">وقت محدد</option></select>`)}<div data-fr-custom-time="${prefix}" hidden>${field(`${prefix}Time`,'الوقت المحدد',input(`${prefix}Time`,'time','dir="ltr"'))}</div></div>${role==='parent'?'<div data-fr-direct-return hidden>'+returnEventControl(view,'direct',new Date().toISOString())+'</div>':''}${field(`${prefix}Reason`,'ملاحظة أو سبب (اختياري)',`<textarea id="${prefix}Reason" maxlength="1000" rows="2"></textarea>`)}${formFooter(role==='parent'?'تسجيل واعتماد السلوك':'إرسال إلى الأهل')}</form>`;
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
  function pendingApprovalGroups(view, rows) {
    if(!rows.length)return '<div class="empty">لا توجد سلوكيات بانتظار المراجعة.</div>';
    const ids=[...new Set(rows.map(row=>row.learner_id))];
    return ids.map(learnerId=>{
      const learnerRows=rows.filter(row=>row.learner_id===learnerId);
      const summary=pendingSummary(view.data.rules||[],learnerRows,row=>selectedReturnEvent(view,row));
      return `<section class="fr-approval-group" data-fr-approval-learner="${safe(learnerId)}"><div class="fr-group-head fr-pending-summary"><h3>${safe(name(view,learnerId))}</h3><div><span>بانتظار المراجعة</span><b data-fr-pending-count>${isolated(summary.count)}</b></div><div><span>تقدير غير مضاف للرصيد</span><b data-fr-pending-total>${summary.total===null?'غير متاح':`${isolated(summary.total)} نقطة`}</b></div></div>${summary.uniqueCount<summary.count?'<div class="muted">يُحتسب تقدير كل واقعة مرة واحدة؛ توجد طلبات قد تكون مكررة.</div>':''}<div class="fr-group-actions"><button class="btn btn-primary" data-fr-approve-all="${safe(learnerId)}">موافقة على الكل</button></div><div class="fr-card-grid">${learnerRows.map(row=>submissionCard(view,row,true)).join('')}</div></section>`;
    }).join('');
  }
  function reportDimensionRows(primary, historical) {
    const rows=new Map();
    for(const row of historical||[])if(row?.id)rows.set(row.id,row);
    for(const row of primary||[])if(row?.id)rows.set(row.id,row);
    return [...rows.values()];
  }
  function reportCategories(view) { return reportDimensionRows(view.data.categories,view.data.report_categories); }
  function reportRules(view) { return reportDimensionRows(view.data.rules,view.data.report_rules); }
  function syncReportRuleOptions(view) {
    const select=view.root.querySelector('#frReportRule');
    if(!select)return;
    const rows=reportRules(view);
    select.innerHTML=`<option value="">كل السلوكيات</option>${rows.map(rule=>`<option value="${safe(rule.id)}">${safe(rule.title)}</option>`).join('')}`;
    select.value=view.reportRule&&rows.some(rule=>rule.id===view.reportRule)?view.reportRule:'';
  }
  function reportRequest(view) {
    const payload={period:view.reportPeriod||'last7'};
    if(view.reportCategory)payload.category_id=view.reportCategory;
    if(view.reportRule)payload.rule_id=view.reportRule;
    if(view.role==='parent'&&view.reportLearner)payload.learner_id=view.reportLearner;
    return payload;
  }
  async function loadReport(view,{repaint=false}={}) {
    if(!current(view))return;
    if(view.role==='parent'&&!view.reportLearner){
      view.reportData={rows:[],summary:{approved_count:0,pending_count:0,total_points:0}};
      view.reportError='';
      if(repaint)paint(view);
      return;
    }
    const serial=++view.reportSerial;
    view.reportBusy=true;
    const host=view.root?.querySelector('[data-fr-report]');
    host?.setAttribute('aria-busy','true');
    try{
      const data=await call(view,`${view.role}_behavior_report`,reportRequest(view));
      if(!current(view)||serial!==view.reportSerial)return;
      view.reportData=data||{rows:[],summary:{}};
      view.reportError='';
    }catch(error){
      if(!current(view)||serial!==view.reportSerial)return;
      view.reportData={rows:[],summary:{approved_count:0,pending_count:0,total_points:0}};
      view.reportError=errorMessages[String(error?.message||'')]||'تعذر تحميل التقرير الآن.';
    }finally{
      if(serial===view.reportSerial)view.reportBusy=false;
      host?.removeAttribute('aria-busy');
    }
    if(repaint&&current(view)&&serial===view.reportSerial)paint(view);
  }
  function reportSection(view) {
    if(view.role==='parent'&&(!view.reportLearner||!learners(view).some(row=>row.id===view.reportLearner)))view.reportLearner=learners(view)[0]?.id||'';
    const rows=view.reportData?.rows||[], summary=view.reportData?.summary||{};
    const approved=number(summary.approved_count), pending=number(summary.pending_count), points=number(summary.total_points);
    const reportRuleRows=reportRules(view);
    const cards=rows.map(row=>`<article class="fr-report-item"><div class="topline"><b>${safe(ruleName(view,row))}</b>${statusBadge(row.status)}</div><div class="muted">${safe(categoryName(view,{...row,category_id:row.category_id||view.data.rules?.find(rule=>rule.id===row.rule_id)?.category_id}))} · ${isolated(date(row.occurred_at||row.requested_at))}</div>${pointParts(row)}${row.snapshot?.verified_occurred_at?`<div class="muted">وقت العودة الموثّقة: ${isolated(date(row.snapshot.verified_occurred_at))}</div>`:''}${row.initiative?'<div class="muted">مبادرة دون تذكير</div>':''}${row.congregation_completed?'<div class="muted">صلاة جماعة</div>':''}${row.mosque_completed?'<div class="muted">صلاة في المسجد</div>':''}${row.sunnah_completed?'<div class="muted">سنة الصلاة</div>':''}${row.adhkar_completed?'<div class="muted">أذكار ما بعد الصلاة</div>':''}</article>`).join('')||'<div class="empty">لا توجد سجلات ضمن هذا الاختيار.</div>';
    const error=view.reportError?`<div class="error" role="alert">${safe(view.reportError)}</div>`:'';
    return `<section class="panel fr-section" data-fr-report><h2>تقرير بسيط عن السلوك</h2><div class="fr-form-grid">${view.role==='parent'?field('frReportLearner','الطالب',`<select id="frReportLearner">${learners(view).map(learner=>`<option value="${safe(learner.id)}" ${learner.id===view.reportLearner?'selected':''}>${safe(learner.display_name)}</option>`).join('')}</select>`):''}${field('frReportCategory','الفئة',`<select id="frReportCategory"><option value="">كل الفئات</option>${reportCategories(view).map(category=>`<option value="${safe(category.id)}" ${category.id===view.reportCategory?'selected':''}>${safe(category.title)}</option>`).join('')}</select>`)}${field('frReportRule','السلوك',`<select id="frReportRule"><option value="">كل السلوكيات</option>${reportRuleRows.map(rule=>`<option value="${safe(rule.id)}" ${rule.id===view.reportRule?'selected':''}>${safe(rule.title)}</option>`).join('')}</select>`)}${field('frReportPeriod','الفترة',`<select id="frReportPeriod"><option value="last7" ${view.reportPeriod!=='last30'?'selected':''}>آخر ٧ سجلات</option><option value="last30" ${view.reportPeriod==='last30'?'selected':''}>آخر ٣٠ يومًا</option></select>`)}</div>${error}<div class="fr-report-summary"><span><b>${isolated(approved)}</b> معتمد</span><span><b>${isolated(pending)}</b> بانتظار الموافقة</span><span><b>${isolated(points)}</b> نقطة</span></div><div class="fr-list">${cards}</div></section>`;
  }
  function approvalControls(view,learnerId){
    const ids=new Set((view.data.submissions||[]).filter(row=>row.learner_id===learnerId).map(row=>row.id));
    const actions=[...view.root.querySelectorAll('[data-fr-behavior-approve],[data-fr-behavior-reject],[data-fr-approve-all]')].filter(control=>control.dataset.frApproveAll===learnerId||ids.has(control.dataset.frBehaviorApprove||control.dataset.frBehaviorReject));
    const group=[...view.root.querySelectorAll('[data-fr-approval-learner]')].find(group=>group.dataset.frApprovalLearner===learnerId);
    return actions.concat([...(group?.querySelectorAll('[data-fr-return-context] button,[data-fr-return-context] input,[data-fr-return-context] select')||[])]);
  }
  function approvalOutcome(result,row){
    const approved=result?.submission;
    if(!approved||approved.id!==row.id||approved.learner_id!==row.learner_id||approved.status!=='approved')return{state:'failed',points:0};
    if(result.already_reviewed)return{state:'skipped',points:0};
    return typeof approved.total_points==='number'&&Number.isInteger(approved.total_points)&&approved.total_points>=0?{state:'approved',points:approved.total_points}:{state:'failed',points:0};
  }
  async function approveAllForLearner(view, button, learnerId) {
    if(!current(view)||view.refreshRequired||view.approvalBusyLearners.has(learnerId))return;
    const group=[...view.root.querySelectorAll('[data-fr-approval-learner]')].find(element=>element.dataset.frApprovalLearner===learnerId);
    const visibleIds=new Set([...(group?.querySelectorAll('[data-fr-submission]')||[])].map(element=>element.dataset.frSubmission));
    const rows=(view.data.submissions||[]).filter(row=>row.status==='pending'&&row.learner_id===learnerId&&visibleIds.has(row.id));
    if(!rows.length)return;
    const estimate=pendingSummary(view.data.rules||[],rows,row=>selectedReturnEvent(view,row));
    const selectedBindings=new Map(rows.map(row=>[row.id,returnApprovalPayload(view,row)]));
    if(!window.confirm(`اعتماد طلبات ${name(view,learnerId)}؟\nعدد الطلبات: ${rows.length}\n${estimateText(estimate.total)} (تقدير غير مضاف للرصيد؛ يتحقق الخادم من حدود التكرار).`))return;
    view.approvalBusyLearners.add(learnerId);approvalControls(view,learnerId).forEach(control=>control.disabled=true);
    button.dataset.frBusy='1';button.setAttribute('aria-busy','true');
    const reason=view.root.querySelector('#frReviewReason')?.value.trim()||'';
    let approved=0,skipped=0,granted=0;const failures=[];
    try{
      for(const row of rows){
        if(!current(view))return;
        try{
          const result=await call(view,'behavior_review',{submission_id:row.id,decision:'approved',reason,...selectedBindings.get(row.id)}),outcome=approvalOutcome(result,row);
          if(outcome.state==='failed')throw new Error('SERVER_ERROR');
          view.approvalErrors.delete(row.id);
          if(outcome.state==='approved'){approved++;granted+=outcome.points;}else skipped++;
        }catch(error){const code=String(error?.message||'SERVER_ERROR');failures.push({id:row.id,error:code});view.approvalErrors.set(row.id,code);}
      }
      if(!current(view))return;
      const statusText=`تم اعتماد ${approved} من ${rows.length}. أُضيفت ${granted} نقطة بالفعل.${skipped?` ${skipped} طلب/طلبات تمت مراجعتها سابقًا دون نقاط جديدة.`:''}${failures.length?` تعذر اعتماد ${failures.length}؛ راجع العناصر المتبقية.`:''}`;
      view.approvalMessage=failures.length?{type:'error',text:statusText}:null;view.savedMessage=statusText;
      try{await refresh(view,statusText);}catch{if(current(view))savedRefreshNotice(view,view.root.querySelector('[data-fr-approvals] .fr-message'));}
    }finally{
      view.approvalBusyLearners.delete(learnerId);
      if(current(view)){approvalControls(view,learnerId).forEach(control=>control.disabled=!!view.refreshRequired);button.dataset.frBusy='0';button.removeAttribute('aria-busy');}
    }
  }
  function paint(view, success = '') {
    if (!current(view)) return;
    view.ledgerSerial++;
    view.ledgerBusy=false;
    view.ledger=view.data.ledger||[];
    view.ledgerCursor=null;
    view.fullLedger=false;
    const allSubmissions=view.data.submissions||[];
    view.duplicateSubmissionIds=duplicateSubmissionIds(allSubmissions,row=>selectedReturnEvent(view,row));
    const submissions=allSubmissions.filter(row=>!view.selectedLearner||row.learner_id===view.selectedLearner), claims=(view.data.claims||[]).filter(row=>!view.selectedLearner||row.learner_id===view.selectedLearner);
    const pendingBehaviors=allSubmissions.filter(row=>row.status==='pending');
    const parent=view.role==='parent';
    view.root.innerHTML=`${success?`<div class="success" role="status">${safe(success)}</div>`:''}${summary(view)}${parent?`<section class="panel fr-section" data-fr-approvals><h2>الطلبات والموافقات</h2>${view.approvalMessage?.type==='error'?'<div class="error" role="alert">'+safe(view.approvalMessage.text)+'</div>':''}${field('frReviewReason','سبب القرار أو ملاحظة المراجعة (اختياري)',`<textarea id="frReviewReason" maxlength="1000" rows="2"></textarea>`)}<h3>السلوكيات بانتظار المراجعة</h3><p class="fr-approval-context">النقاط المعروضة تقدير لم يُضف إلى الرصيد. يضيف الخادم النقاط بعد الاعتماد والتحقق من حدود التكرار والتكرار المحتمل.</p>${pendingApprovalGroups(view,pendingBehaviors)}<h3>طلبات الجوائز</h3><div class="fr-card-grid">${claims.filter(row=>row.status==='pending'||row.status==='approved').map(row=>claimCard(view,row)).join('')||'<div class="empty">لا توجد طلبات جوائز تحتاج إجراءً.</div>'}</div>${message('')}</section><section class="panel">${occurrenceForm(view,view.selectedLearner)}</section>${categoryForm(view)}${ruleForm(view)}${rewardForm(view)}${adjustmentForm(view,view.selectedLearner)}`:`<section class="panel fr-section"><h2>جوائزك والتقدّم نحوها</h2><div class="fr-card-grid">${(view.data.rewards||[]).map(reward=>rewardCard(view,reward)).join('')||'<div class="empty">لم يضف الأهل جوائز متاحة لك بعد.</div>'}</div>${message('')}</section><section class="panel">${occurrenceForm(view)}</section>`}${!parent?`<section class="panel fr-section"><h2>سلوكياتك بانتظار موافقة الأهل</h2><p class="muted">هذه تقديرات؛ لا تُضاف نقاط قبل موافقة الأهل.</p><div class="fr-card-grid">${submissions.filter(row=>row.status==='pending').map(row=>submissionCard(view,row)).join('')||'<div class="empty">لا توجد سلوكيات بانتظار الموافقة.</div>'}</div></section>`:''}${reportSection(view)}${ledgerSection(view)}<details class="fr-section"><summary>${parent?'سجل السلوكيات والجوائز':'سلوكياتك وطلبات جوائزك'}</summary><h3>السلوكيات</h3><div class="fr-card-grid" data-fr-submissions>${submissions.map(row=>submissionCard(view,row)).join('')||'<div class="empty">لم تُسجّل سلوكيات بعد.</div>'}</div><h3>طلبات الجوائز وسجل التسليم</h3><div class="fr-card-grid">${claims.map(row=>claimCard(view,row)).join('')||'<div class="empty">لم تُطلب جوائز بعد.</div>'}</div>${message('')}</details>`;
    bind(view);
    if(view.refreshRequired)savedRefreshNotice(view);
  }
  async function refresh(view, success = '') {
    const data = await call(view, `${view.role}_rewards_dashboard`);
    if (!current(view)) return;
    view.data = data;
    if(view.role==='parent'){
      for(const event of data.return_events||[])view.returnEvents.set(event.id,event);
      for(const row of data.submissions||[]){
        const event=view.returnEvents.get(row.return_event_id);
        if(event&&row.status==='approved')event.awarded_learner_ids=[...new Set([...(event.awarded_learner_ids||[]),row.learner_id])];
      }
      if(data.return_event_day)view.returnPages.set(data.return_event_day,{rows:data.return_events||[],cursor:data.return_event_next_cursor||null,loaded:true,busy:false});
    }
    if (view.role === 'parent' && view.selectedLearner && !learners(view).some(learner=>learner.id===view.selectedLearner)) view.selectedLearner='';
    if (view.role === 'parent' && (!view.reportLearner || !learners(view).some(learner=>learner.id===view.reportLearner))) view.reportLearner=learners(view)[0]?.id||'';
    view.refreshRequired=false;
    await loadReport(view);
    const savedMessage=success||view.savedMessage||'';delete view.savedMessage;
    paint(view,savedMessage);
  }
  async function mutation(view, element, action, payload, success, keyHolder = element) {
    if (!current(view) || view.refreshRequired || element.dataset.frBusy === '1') return;
    const approvalLearner=action==='behavior_review'?(view.data.submissions||[]).find(row=>row.id===payload.submission_id)?.learner_id:null;
    if(approvalLearner&&view.approvalBusyLearners.has(approvalLearner))return;
    if(approvalLearner)view.approvalBusyLearners.add(approvalLearner);
    const host = element.closest('form')?.querySelector('.fr-message') || element.closest('.fr-section')?.querySelector('.fr-message') || view.root.querySelector('.fr-message');
    element.dataset.frBusy = '1';
    const controls = approvalLearner?approvalControls(view,approvalLearner):element.tagName === 'FORM' ? [...element.querySelectorAll('button')] : [element];
    controls.forEach(control=>control.disabled=true);
    element.setAttribute('aria-busy','true');
    if (host) host.innerHTML='<span>جارٍ حفظ العملية…</span>';
    if (payload.idempotency_key === true) {
      keyHolder.dataset.idempotencyKey ||= crypto.randomUUID();
      payload.idempotency_key = keyHolder.dataset.idempotencyKey;
    }
    try {
      const result=await call(view,action,payload);
      if (!current(view)) return;
      if(action==='behavior_submit'&&result?.duplicate_pending)success='هذا السلوك مسجّل مسبقًا وبانتظار موافقة الأهل.';
      if(action==='behavior_review'){
        view.approvalMessage=null;view.approvalErrors.delete(payload.submission_id);view.returnSelections.delete(payload.submission_id);
        if(result?.already_reviewed)success='تمت مراجعة الطلب سابقًا؛ لم تُضف نقاط جديدة.';
        else if(payload.decision==='approved')success=`تم الاعتماد. أُضيفت ${number(result?.submission?.total_points)} نقطة بالفعل.`;
      }
      // The command succeeded; a failed dashboard read must not invite resubmission.
      delete keyHolder.dataset.idempotencyKey;
      delete keyHolder.dataset.occurredAt;delete keyHolder.dataset.occurrenceSignature;
      if(action==='reward_request')requestKeys.delete(`${view.token}:${payload.reward_id}`);
      view.savedMessage=success;
      try{await refresh(view,success);}
      catch(error){savedRefreshNotice(view,host);}
    } catch(error) {
      if(approvalLearner)view.approvalErrors.set(payload.submission_id,String(error?.message||'SERVER_ERROR'));
      if(approvalLearner&&current(view)){
        const card=[...view.root.querySelectorAll('[data-fr-approvals] [data-fr-submission]')].find(card=>card.dataset.frSubmission===payload.submission_id);
        if(card){
          let itemError=card.querySelector('.fr-item-error');
          if(!itemError){itemError=document.createElement('div');itemError.className='error fr-item-error';itemError.setAttribute('role','alert');card.append(itemError);}
          itemError.textContent=errorMessages[error?.message]||'تعذر اعتماد هذا الطلب. حدّث العرض أو أعد المحاولة.';
        }
      }
      if (current(view) && host) reportError(host,error);
    } finally {
      if(approvalLearner)view.approvalBusyLearners.delete(approvalLearner);
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
  function syncPrayerBonuses(view,prefix) {
    const select=view.root.querySelector(`#${prefix}Rule`);if(!select)return;
    const rule=(view.data.rules||[]).find(row=>row.id===select.value);
    for(const [key,suffix] of [['initiative','Initiative'],['congregation','Congregation'],['mosque','Mosque'],['sunnah','Sunnah'],['adhkar','Adhkar']]){
      const wrap=view.root.querySelector(`[data-fr-${key}="${prefix}"]`),box=view.root.querySelector(`#${prefix}${suffix}`),points=view.root.querySelector(`[data-fr-${key}-points="${prefix}"]`);
      if(!wrap||!box)continue;
      const bonus=linkedBonus(rule,key),enabled=bonus>0;
      wrap.hidden=!enabled;
      if(points)points.innerHTML=enabled?` (+${isolated(bonus)} نقطة)`:'';
      if(!enabled)box.checked=false;
    }
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
    for(const prefix of ['frOccurrence','frSelfReport']){
      const category=root.querySelector(`#${prefix}Category`), ruleSelect=root.querySelector(`#${prefix}Rule`), dateMode=root.querySelector(`#${prefix}DateMode`), timeMode=root.querySelector(`#${prefix}TimeMode`);
      category?.addEventListener('change',()=>{syncBehaviorPicker(view,prefix);if(prefix==='frOccurrence')syncDirectReturn(view);});
      ruleSelect?.addEventListener('change',()=>{syncPrayerBonuses(view,prefix);if(prefix==='frOccurrence')syncDirectReturn(view);});
      dateMode?.addEventListener('change',()=>syncOccurrenceWhen(view,prefix));
      timeMode?.addEventListener('change',()=>syncOccurrenceWhen(view,prefix));
      syncOccurrenceCategories(view,prefix);syncOccurrenceWhen(view,prefix);
    }
    root.querySelector('#frOccurrenceLearner')?.addEventListener('change',()=>{const category=root.querySelector('#frOccurrenceCategory');if(category)category.value='';syncOccurrenceCategories(view,'frOccurrence');});
    root.querySelector('#frAdjustmentReversal')?.addEventListener('input',event=>{const delta=root.querySelector('#frAdjustmentDelta'),reversal=event.target.value.trim();delta.required=!reversal;delta.disabled=!!reversal;});
    root.querySelectorAll('[data-fr-form-reset]').forEach(button=>button.onclick=()=>{const form=button.closest('form');form.reset();if(form.id==='frOccurrenceForm'){view.returnSelections.delete('direct');syncDirectReturn(view);const control=form.querySelector('[data-fr-return-context]');if(control){syncReturnControl(view,control);syncOccurrenceWhen(view,control.dataset.frReturnPrefix);}}form.querySelectorAll('[data-fr-preserved-scope]').forEach(element=>element.remove());delete form.dataset.recordId;delete form.dataset.idempotencyKey;delete form.dataset.occurredAt;delete form.dataset.occurrenceSignature;form.querySelectorAll('[data-fr-scope]').forEach(fieldset=>fieldset.hidden=true);syncCadence(form);for(const prefix of ['frOccurrence','frSelfReport'])if(form.id===`${prefix}Form`){syncOccurrenceCategories(view,prefix);syncOccurrenceWhen(view,prefix);syncPrayerBonuses(view,prefix);}const delta=form.querySelector('#frAdjustmentDelta');if(delta){delta.disabled=false;delta.required=true;}form.querySelector('.fr-message').textContent='';});
    ['category','rule','reward'].forEach(kind=>{
      root.querySelectorAll(`[data-fr-edit-${kind}]`).forEach(button=>button.onclick=()=>edit(view,kind,button.getAttribute(`data-fr-edit-${kind}`)));
      root.querySelectorAll(`[data-fr-toggle-${kind}]`).forEach(button=>button.onclick=()=>{const rows=view.data[kind==='category'?'categories':`${kind}s`]||[],row=rows.find(row=>row.id===button.getAttribute(`data-fr-toggle-${kind}`));if(!row)return;mutation(view,button,`${kind}_save`,{...row,is_active:row.is_active===false},row.is_active===false?'تم التفعيل.':'تم التعطيل.');});
    });
    bindForm(view,'frCategoryForm','category_save',form=>({title:value(form,'frCategoryTitle'),description:value(form,'frCategoryDescription'),is_active:checked(form,'frCategoryActive')}),'تم حفظ الفئة.');
    bindForm(view,'frRuleForm','rule_save',form=>({title:value(form,'frRuleTitle'),description:value(form,'frRuleDescription'),category_id:value(form,'frRuleCategory'),base_points:optionalNumber(form,'frRuleBase'),initiative_bonus_points:optionalNumber(form,'frRuleBonus'),...scopePayload(form,'frRule'),cadence:value(form,'frRuleCadence'),max_awards:value(form,'frRuleCadence')==='unlimited'?null:optionalNumber(form,'frRuleLimit'),self_report_allowed:checked(form,'frRuleSelfReport'),parent_approval_required:checked(form,'frRuleApproval'),is_active:checked(form,'frRuleActive')}),'تم حفظ السلوك.');
    bindForm(view,'frRewardForm','reward_save',form=>{const criteria={};for(const [id,key]of[['frRewardStreak','current_streak'],['frRewardLongestStreak','longest_streak'],['frRewardXp','min_xp']]){const n=optionalNumber(form,id);if(n!==null)criteria[key]=n;}const badges=[...form.querySelectorAll('[name="required_badge_codes"]:checked')].map(element=>element.value);if(badges.length)criteria.required_badge_codes=badges;return{title:value(form,'frRewardTitle'),description:value(form,'frRewardDescription'),reward_type:value(form,'frRewardType'),required_reward_points:optionalNumber(form,'frRewardPoints'),required_level:optionalNumber(form,'frRewardLevel'),criteria,...scopePayload(form,'frReward'),available_from:datetime(value(form,'frRewardFrom')),available_until:datetime(value(form,'frRewardUntil')),max_redemptions_per_learner:optionalNumber(form,'frRewardLimit'),parent_approval_required:true,is_active:checked(form,'frRewardActive')};},'تم حفظ الجائزة.');
    for(const [prefix,action]of[['frOccurrence','behavior_record'],['frSelfReport','behavior_submit']])bindForm(view,`${prefix}Form`,action,form=>({...(view.role==='parent'?{learner_id:value(form,'frOccurrenceLearner')}:{}),rule_id:value(form,`${prefix}Rule`),...(view.role==='parent'&&value(form,`${prefix}Rule`)===PARENT_RETURN_RULE?returnApprovalPayload(view,{id:'direct',rule_id:PARENT_RETURN_RULE}):{}),initiative:checked(form,`${prefix}Initiative`),congregation_completed:checked(form,`${prefix}Congregation`),mosque_completed:checked(form,`${prefix}Mosque`),sunnah_completed:checked(form,`${prefix}Sunnah`),adhkar_completed:checked(form,`${prefix}Adhkar`),occurred_at:occurrenceAt(form,prefix),reason:value(form,`${prefix}Reason`),idempotency_key:true}),view.role==='parent'?'تم اعتماد السلوك وتحديث الرصيد.':'وصل طلبك إلى الأهل. نقاطك تظل كما هي حتى الموافقة.');
    bindForm(view,'frAdjustmentForm','points_adjust',form=>({learner_id:value(form,'frAdjustmentLearner'),delta:optionalNumber(form,'frAdjustmentDelta'),reason:value(form,'frAdjustmentReason'),...(value(form,'frAdjustmentReversal')?{reversal_event_id:value(form,'frAdjustmentReversal')}:{}),idempotency_key:true}),'تم تسجيل الحركة التعويضية في السجل.');
    for(const [kind,idField,action]of[['behavior','submission_id','behavior_review'],['claim','claim_id','reward_review']])for(const [suffix,decision]of[['approve','approved'],['reject','rejected']])root.querySelectorAll(`[data-fr-${kind}-${suffix}]`).forEach(button=>button.onclick=()=>mutation(view,button,action,{[idField]:button.getAttribute(`data-fr-${kind}-${suffix}`),decision,...(kind==='behavior'&&decision==='approved'?returnApprovalPayload(view,(view.data.submissions||[]).find(row=>row.id===button.getAttribute(`data-fr-${kind}-${suffix}`))):{}),reason:root.querySelector('#frReviewReason')?.value.trim()||''},decision==='approved'?'تم الاعتماد وتحديث السجل.':'تم رفض الطلب دون تغيير النقاط.'));
    root.querySelectorAll('[data-fr-claim-redeem]').forEach(button=>button.onclick=()=>mutation(view,button,'reward_redeem',{claim_id:button.dataset.frClaimRedeem,reason:root.querySelector('#frReviewReason')?.value.trim()||''},'تم تسجيل تسليم الجائزة؛ لا يوجد خصم إضافي.'));
    root.querySelectorAll('[data-fr-request-reward]').forEach(button=>button.onclick=()=>{const id=button.dataset.frRequestReward,key=`${view.token}:${id}`;if(requestKeys.has(key))button.dataset.idempotencyKey=requestKeys.get(key);else{button.dataset.idempotencyKey=crypto.randomUUID();requestKeys.set(key,button.dataset.idempotencyKey);}mutation(view,button,'reward_request',{reward_id:id,idempotency_key:true},'طلب الجائزة بانتظار موافقة الأهل.');});
    bindReturnControls(view);syncDirectReturn(view);
    root.querySelectorAll('[data-fr-approve-all]').forEach(button=>button.onclick=()=>approveAllForLearner(view,button,button.dataset.frApproveAll));
    root.querySelector('#frReportLearner')?.addEventListener('change',async event=>{view.reportLearner=event.target.value;await loadReport(view,{repaint:true});});
    root.querySelector('#frReportCategory')?.addEventListener('change',async event=>{view.reportCategory=event.target.value;view.reportRule='';syncReportRuleOptions(view);await loadReport(view,{repaint:true});});
    root.querySelector('#frReportRule')?.addEventListener('change',async event=>{view.reportRule=event.target.value;await loadReport(view,{repaint:true});});
    root.querySelector('#frReportPeriod')?.addEventListener('change',async event=>{view.reportPeriod=event.target.value;await loadReport(view,{repaint:true});});
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
    const view={role,token,generation,data:{},selectedLearner:'',approvalMessage:null,approvalErrors:new Map(),approvalBusyLearners:new Set(),returnSelections:new Map(),returnEvents:new Map(),returnPages:new Map(),returnSerial:0,reportLearner:'',reportCategory:'',reportRule:'',reportPeriod:'last7',reportData:{rows:[],summary:{}},reportError:'',reportSerial:0,reportBusy:false,ledger:[],ledgerSerial:0,ledgerBusy:false};screen=view;
    shell(role==='parent'?'🎁 الجوائز والعادات':'🎁 جوائزي وعاداتي',role==='parent'?'نقاط واضحة، سلوكيات تشجّعها العائلة، وجوائز باعتماد الأهل.':'تقدّمك الشخصي ومصدر نقاطك، خطوة بخطوة.',`<div class="actions fr-page-actions"><a class="btn btn-soft" href="#${role==='parent'?'parents':'student'}">رجوع ${role==='parent'?'للوحة الأهل':'إلى صفحتي'}</a><button class="btn btn-soft" data-fr-refresh>تحديث</button></div><div data-family-rewards data-role="${role}"><div class="loading-card" role="status">جارٍ تحميل النقاط والجوائز…</div></div>`);
    view.root=document.querySelector('[data-family-rewards]');
    document.querySelector('[data-fr-refresh]').onclick=async()=>{try{await refresh(view);}catch(error){if(current(view)){if(view.refreshRequired)savedRefreshNotice(view);else reportError(view.root,error);}}};
    try{await refresh(view);}catch(error){if(current(view)){reportError(view.root,error);view.root.insertAdjacentHTML('beforeend','<div class="actions"><button class="btn btn-soft" data-fr-retry>إعادة المحاولة</button></div>');view.root.querySelector('[data-fr-retry]').onclick=route;}}
  }
  window.addEventListener('hashchange',()=>setTimeout(route,0));
  document.addEventListener('DOMContentLoaded',()=>setTimeout(route,0),{once:true});
  if(location.hash==='#parent-rewards'||location.hash==='#student-rewards')setTimeout(route,0);
})();
