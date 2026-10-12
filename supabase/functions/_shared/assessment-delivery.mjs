export const ASSESSMENT_DELIVERY_ACTIONS=Object.freeze({
 prepare_assessment_delivery:'prepare',claim_assessment_delivery:'claim',
 mark_assessment_delivery_uncertain:'uncertain',reconcile_assessment_delivery:'reconcile'
});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hash=/^[a-f0-9]{64}$/;
const deny=()=>{throw new Error('ASSESSMENT_DELIVERY_EVIDENCE_INVALID');};
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');

/** Validate the actual full Gmail readback supplied by an authorized operator.
 * This records a parent-reviewed connector witness, never an independent server Gmail query.
 */
export async function gmailSentReceipt(message,envelope,parentId,observedAt) {
 if(!message||!/^[a-f0-9]{8,64}$/i.test(message.id||'')||!Array.isArray(message.labelIds)
   || !message.labelIds.includes('SENT')||message.labelIds.includes('DRAFT')||!uuid.test(parentId||'')
   ||!Number.isFinite(Date.parse(observedAt))||Date.parse(observedAt)>Date.now()+60000) deny();
 const headers=message.payload?.headers;
 if(!Array.isArray(headers)) deny();
 const one=name=>{const values=headers.filter(h=>typeof h?.name==='string'&&h.name.toLowerCase()===name);if(values.length!==1||typeof values[0].value!=='string')deny();return values[0].value;};
 const to=one('to').trim(),address=/^(?:[^<>\r\n,]+\s*)?<([^<>\r\n,]+)>$/.exec(to)?.[1]??to;
 if(address.toLowerCase()!==envelope.recipient.toLowerCase()
  ||headers.some(h=>['cc','bcc'].includes(String(h?.name).toLowerCase())&&String(h.value||'').trim()))deny();
 let subject=one('subject');
 if(/^=\?UTF-8\?B\?[a-z0-9+/=]+\?=$/i.test(subject)) {
  try{subject=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(subject.slice(10,-2)),c=>c.charCodeAt(0)));}catch{deny();}
 }
 if(subject!==envelope.subject)deny();
 let visited=0;const plain=[];
 const walk=(part,depth=0)=>{
  if(!part||depth>10||++visited>100||part.filename||part.body?.attachmentId||part.body?.attachment_id)deny();
  if(part.parts!==undefined&&!Array.isArray(part.parts))deny();
  const children=part.parts||[];
  if(children.length){if(!['multipart/mixed','multipart/alternative'].includes(part.mimeType)||part.body?.content||part.body?.data)deny();}
  else if(part.mimeType!=='text/plain')deny();
  if(part.mimeType==='text/plain'){
   if(children.length)deny();
   if(typeof part.body?.content==='string')plain.push(part.body.content);
   else if(typeof part.body?.data==='string'){
    if(part.body.data.length>350000)deny();
    try{plain.push(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(part.body.data.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))));}catch{deny();}
   }
  }
  for(const child of children)walk(child,depth+1);
 };
 walk(message.payload);
 const normalize=value=>value.replaceAll('\r\n','\n').trim();
 if(plain.length!==1||plain[0].length>250000||normalize(plain[0])!==normalize(envelope.body))deny();
 return {provider:'gmail',gmail_message_id:message.id.toLowerCase(),sent:true,
  content_sha256:await digest(normalize(envelope.body)),recipient:envelope.recipient,
  observed_at:observedAt,reviewed_by:parentId,verification_method:'parent-reviewed-connector-readback',
  source_ref:'gmail:read_email:'+message.id.toLowerCase()};
}

/** Reuse the parent API/service RPC; no network sender, Gmail token or automatic resend. */
export async function assessmentDeliveryCommand(admin,workspaceId,parentId,body,trace) {
 const action=Object.hasOwn(ASSESSMENT_DELIVERY_ACTIONS,body.action)?ASSESSMENT_DELIVERY_ACTIONS[body.action]:null;
 if(!action||!uuid.test(body.quiz_version_id||'')||!hash.test(body.candidate_sha256||''))throw new Error('ASSESSMENT_TARGET_INVALID');
 const pointer={quiz_version_id:body.quiz_version_id,candidate_sha256:body.candidate_sha256};
 const rpc=async(action,payload)=>{
  const {data,error}=await trace.measure('assessment.delivery.rpc',{dbOperations:1},()=>admin.rpc('flh_assessment_delivery_command',{
   p_workspace_id:workspaceId,p_parent_id:parentId,p_action:action,p_payload:payload
  }));
  if(error)throw new Error(/^ASSESSMENT_[A-Z_]+$/.test(error.message||'')?error.message:'ASSESSMENT_UNAVAILABLE');
  if(data?.ok!==true)throw new Error('ASSESSMENT_UNAVAILABLE');
  return data;
 };
 let payload={...pointer};
 if(action==='prepare') payload={...pointer,recipient:body.recipient,app_url:body.app_url,recipient_review_ref:body.recipient_review_ref,link_review:body.link_review};
 else {
  if(!hash.test(body.envelope_sha256||''))throw new Error('ASSESSMENT_DELIVERY_INPUT_INVALID');
  payload.envelope_sha256=body.envelope_sha256;
  if(action==='reconcile') {
   const read=await rpc('read',pointer);
   if(read.envelope_sha256!==body.envelope_sha256||!read.envelope)throw new Error('ASSESSMENT_DELIVERY_CONFLICT');
   payload.receipt=await gmailSentReceipt(body.gmail_message,read.envelope,parentId,body.observed_at);
  }
 }
 return rpc(action,payload);
}
