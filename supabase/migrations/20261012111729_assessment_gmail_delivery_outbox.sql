-- Explicit 12 October user decision: existing Gmail operational handoff only.
-- No sender, provider credential, automatic resend, historical backfill or Production execution.
alter table public.assessment_publications
 add column delivery_envelope jsonb,
 add column delivery_envelope_sha256 text check(delivery_envelope_sha256 ~ '^[a-f0-9]{64}$'),
 add column delivery_claim_id uuid,
 add column delivery_claimed_by uuid references auth.users(id),
 add column delivery_claimed_at timestamptz;
create unique index assessment_gmail_message_once on public.assessment_publications(workspace_id,(delivery_receipt->>'gmail_message_id'))
 where delivery_state='confirmed';

create function public.flh_assessment_delivery_command(p_workspace_id uuid,p_parent_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.assessment_publications%rowtype; q public.quizzes%rowtype; l public.learners%rowtype;
 v uuid; envelope jsonb; receipt jsonb:=p_payload->'receipt'; root text:=p_payload->>'app_url';
 learning_url text; exam_url text; marker text; envelope_hash text;
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_parent_id and role in ('owner','admin')) then raise exception 'ASSESSMENT_FORBIDDEN';end if;
 if p_action is null or p_action not in ('prepare','claim','uncertain','reconcile','read') or p_payload->>'candidate_sha256' is null or p_payload->>'candidate_sha256' !~ '^[a-f0-9]{64}$' then raise exception 'ASSESSMENT_DELIVERY_INPUT_INVALID';end if;
 v:=(p_payload->>'quiz_version_id')::uuid;
 perform 1 from public.quiz_versions where workspace_id=p_workspace_id and id=v for update;
 select * into a from public.assessment_publications where workspace_id=p_workspace_id and quiz_version_id=v for update;
 if not found or a.candidate_sha256 is distinct from p_payload->>'candidate_sha256' then raise exception 'ASSESSMENT_TARGET_INVALID';end if;
 select * into q from public.quizzes where workspace_id=p_workspace_id and id=a.quiz_id;
 select * into l from public.learners where workspace_id=p_workspace_id and id=a.learner_id;
 if a.state<>'released' or q.status<>'active' or not l.is_active then raise exception 'ASSESSMENT_DELIVERY_STATE_CONFLICT';end if;
 if p_action='prepare' then
  if root is null or (root<>'https://fadiaboalward.github.io/family-learning-hub/' and
    (root not in ('http://localhost:4173/','http://localhost:4187/') or l.metadata->'is_test' is distinct from 'true'::jsonb))
    or p_payload->>'recipient' is null or length(p_payload->>'recipient')>254 or p_payload->>'recipient' !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    or length(q.title) not between 1 and 255 or q.title ~ '[\r\n]'
    or nullif(btrim(p_payload->>'recipient_review_ref'),'') is null then raise exception 'ASSESSMENT_DELIVERY_INPUT_INVALID';end if;
  learning_url:=root||'index.html?quiz='||q.slug||'&mode=learning&learner='||l.slug;
  exam_url:=root||'index.html?quiz='||q.slug||'&mode=exam&learner='||l.slug;
  if p_payload->'link_review'->>'result' is distinct from 'PASS'
    or p_payload->'link_review'->>'learning_url' is distinct from learning_url or p_payload->'link_review'->>'exam_url' is distinct from exam_url
    or nullif(btrim(p_payload->'link_review'->>'source_ref'),'') is null then raise exception 'ASSESSMENT_DELIVERY_EVIDENCE_INVALID';end if;
  marker:='FLH-027:'||p_workspace_id::text||':'||v::text||':'||a.candidate_sha256;
  envelope:=jsonb_build_object('provider','gmail','recipient',lower(p_payload->>'recipient'),'subject',q.title,
    'workspace_id',p_workspace_id,'quiz_version_id',v,'learner_id',a.learner_id,'program_id',a.program_id,'candidate_sha256',a.candidate_sha256,
    'learning_url',learning_url,'exam_url',exam_url,'marker',marker,
    'body','التعلّم: '||learning_url||chr(10)||'الاختبار: '||exam_url||chr(10)||marker);
  envelope_hash:=encode(extensions.digest(convert_to(envelope::text,'UTF8'),'sha256'),'hex');
  if a.delivery_envelope is not null and a.delivery_envelope is distinct from envelope then raise exception 'ASSESSMENT_DELIVERY_CONFLICT';end if;
  if a.delivery_envelope is null then
   update public.assessment_publications set delivery_envelope=envelope,delivery_envelope_sha256=envelope_hash,
    delivery_receipt=jsonb_build_object('recipient_review_ref',p_payload->>'recipient_review_ref','link_review',p_payload->'link_review','prepared_by',p_parent_id,'prepared_at',now())
   where workspace_id=p_workspace_id and quiz_version_id=v;
  end if;
  return jsonb_build_object('ok',true,'duplicate',a.delivery_envelope is not null,'state',a.delivery_state,'envelope',envelope,'envelope_sha256',envelope_hash,'automatic_send',false);
 end if;
 if p_action='read' then return jsonb_build_object('ok',true,'envelope',a.delivery_envelope,'envelope_sha256',a.delivery_envelope_sha256,'state',a.delivery_state,'automatic_send',false);end if;
 if a.delivery_envelope is null or a.delivery_envelope_sha256 is distinct from p_payload->>'envelope_sha256' then raise exception 'ASSESSMENT_DELIVERY_CONFLICT';end if;
 if p_action='claim' then
  if a.delivery_state<>'pending' then return jsonb_build_object('ok',true,'duplicate',true,'state',a.delivery_state,'automatic_send',false,'new_handoff',false);end if;
  update public.assessment_publications set delivery_state='claimed',delivery_claim_id=gen_random_uuid(),delivery_claimed_by=p_parent_id,delivery_claimed_at=now()
   where workspace_id=p_workspace_id and quiz_version_id=v;
  return jsonb_build_object('ok',true,'state','claimed','automatic_send',false,'new_handoff',true,'envelope',a.delivery_envelope);
 end if;
 if p_action='uncertain' then
  if a.delivery_state='uncertain' then return jsonb_build_object('ok',true,'duplicate',true,'state','uncertain');end if;
  if a.delivery_state<>'claimed' then raise exception 'ASSESSMENT_DELIVERY_STATE_CONFLICT';end if;
  update public.assessment_publications set delivery_state='uncertain',delivery_receipt=delivery_receipt||jsonb_build_object('uncertain_by',p_parent_id,'uncertain_at',now()) where workspace_id=p_workspace_id and quiz_version_id=v;
  return jsonb_build_object('ok',true,'state','uncertain','automatic_send',false);
 end if;
 if a.delivery_state not in ('claimed','uncertain','confirmed') then raise exception 'ASSESSMENT_DELIVERY_STATE_CONFLICT';end if;
 if receipt->>'provider' is distinct from 'gmail' or receipt->'sent' is distinct from 'true'::jsonb
   or receipt->>'gmail_message_id' is null or receipt->>'gmail_message_id' !~ '^[a-f0-9]{8,64}$'
   or receipt->>'recipient' is distinct from a.delivery_envelope->>'recipient'
   or receipt->>'reviewed_by' is distinct from p_parent_id::text
   or receipt->>'verification_method' is distinct from 'parent-reviewed-connector-readback'
   or receipt->>'source_ref' is distinct from 'gmail:read_email:'||(receipt->>'gmail_message_id')
   or receipt->>'content_sha256' is distinct from encode(extensions.digest(convert_to(btrim(a.delivery_envelope->>'body'),'UTF8'),'sha256'),'hex')
   or receipt->>'observed_at' is null or (receipt->>'observed_at')::timestamptz>now()+interval '1 minute'
 then raise exception 'ASSESSMENT_DELIVERY_EVIDENCE_INVALID';end if;
 if a.delivery_state='confirmed' then
  if a.delivery_receipt->>'gmail_message_id' is distinct from receipt->>'gmail_message_id' then raise exception 'ASSESSMENT_DELIVERY_CONFLICT';end if;
  return jsonb_build_object('ok',true,'duplicate',true,'state','confirmed','automatic_send',false);
 end if;
 update public.assessment_publications set delivery_state='confirmed',delivery_receipt=delivery_receipt||receipt||jsonb_build_object('recorded_at',now()) where workspace_id=p_workspace_id and quiz_version_id=v;
 return jsonb_build_object('ok',true,'state','confirmed','automatic_send',false,'verification_method','parent-reviewed-connector-readback');
exception when unique_violation then raise exception 'ASSESSMENT_DELIVERY_CONFLICT';
end;
$$;
revoke all on function public.flh_assessment_delivery_command(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.flh_assessment_delivery_command(uuid,uuid,text,jsonb) to service_role;
