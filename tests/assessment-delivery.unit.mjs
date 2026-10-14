import assert from 'node:assert/strict';
import {gmailSentReceipt,assessmentDeliveryCommand} from '../supabase/functions/_shared/assessment-delivery.mjs';
const parent='02730000-0000-4000-8000-000000000001',version='02730000-0000-4000-8000-000000000002',workspace='02730000-0000-4000-8000-000000000003';
const envelope={recipient:'testing@example.invalid',subject:'تقييم اصطناعي',body:'التعلم: http://localhost:4187/index.html?quiz=qa&mode=learning&learner=test\nالاختبار: http://localhost:4187/index.html?quiz=qa&mode=exam&learner=test\nFLH-027:synthetic-version-hash'};
const message={id:'abc0123456789def',labelIds:['SENT'],payload:{mimeType:'text/plain',headers:[{name:'To',value:envelope.recipient},{name:'Subject',value:envelope.subject}],body:{data:Buffer.from(envelope.body).toString('base64url')}}};
const observed=new Date().toISOString();
const receipt=await gmailSentReceipt(message,envelope,parent,observed);
assert.equal(receipt.sent,true);assert.equal(receipt.gmail_message_id,message.id);
assert.equal(receipt.verification_method,'parent-reviewed-connector-readback');
assert.equal(receipt.reviewed_by,parent);
assert.ok(!JSON.stringify(receipt).includes(envelope.body),'persist minimal receipt, never raw mail');
const native=structuredClone(message);native.payload.body={content:envelope.body};
assert.deepEqual(await gmailSentReceipt(native,envelope,parent,observed),receipt);
const encoded=structuredClone(message);encoded.payload.headers[1].value='=?UTF-8?B?'+Buffer.from(envelope.subject).toString('base64')+'?=';
assert.deepEqual(await gmailSentReceipt(encoded,envelope,parent,observed),receipt);
const multipart=structuredClone(message);multipart.payload.mimeType='multipart/mixed';multipart.payload.parts=[{mimeType:'text/plain',body:message.payload.body}];delete multipart.payload.body;
assert.deepEqual(await gmailSentReceipt(multipart,envelope,parent,observed),receipt);
for(const mimeType of ['text/html','application/json','image/png']) {
 const mixed=structuredClone(multipart);mixed.payload.mimeType='multipart/alternative';
 mixed.payload.parts.push({mimeType,body:{content:'<a href="http://unreviewed.invalid/">Unreviewed link</a>'}});
 await assert.rejects(()=>gmailSentReceipt(mixed,envelope,parent,observed),/ASSESSMENT_DELIVERY_EVIDENCE_INVALID/,'unreviewed alternate rendition rejected');
}
for(const mutate of [m=>m.labelIds=['DRAFT'],m=>m.labelIds=['SENT','DRAFT'],m=>m.id='',m=>m.payload.headers[0].value='sibling@example.invalid',m=>m.payload.headers.push({name:'Cc',value:'other@example.invalid'}),m=>m.payload.headers.push({name:'To',value:envelope.recipient}),m=>m.payload.headers[1].value='Other assessment',m=>m.payload.body.data=Buffer.from(envelope.body.replace('mode=exam','mode=learning')).toString('base64url'),m=>m.payload.filename='paper.pdf',m=>m.payload.body={attachmentId:'fake'},m=>m.payload.body={content:envelope.body+'\nUnreviewed link'}]){
 const bad=structuredClone(message);mutate(bad);
 await assert.rejects(()=>gmailSentReceipt(bad,envelope,parent,observed),/ASSESSMENT_DELIVERY_EVIDENCE_INVALID/);
}
let calls=[];
const hash='1'.repeat(64),envelopeHash='2'.repeat(64);
const pointer={quiz_version_id:version,candidate_sha256:hash,envelope_sha256:envelopeHash};
const admin={rpc:async(name,args)=>{calls.push({name,args});return {data:args.p_action==='read'?{ok:true,envelope,envelope_sha256:envelopeHash}:{ok:true,state:'confirmed'},error:null};}};
const trace={measure:(_n,_d,task)=>task()};
await assessmentDeliveryCommand(admin,workspace,parent,{...pointer,action:'reconcile_assessment_delivery',gmail_message:message,observed_at:observed,parent_id:'forged'},trace);
assert.equal(calls.length,2);assert.equal(calls[1].args.p_parent_id,parent);
assert.equal(calls[1].args.p_payload.receipt.reviewed_by,parent);
assert.ok(!Object.hasOwn(calls[1].args.p_payload,'gmail_message'),'raw provider response never reaches database');
calls=[];
await assert.rejects(()=>assessmentDeliveryCommand(admin,workspace,parent,{...pointer,action:'reconcile_assessment_delivery',gmail_message:{...message,labelIds:[]},observed_at:observed},trace),/EVIDENCE_INVALID/);
assert.equal(calls.length,1,'invalid SENT witness reads scoped outbox only, performs no receipt write');
await assert.rejects(()=>assessmentDeliveryCommand(admin,workspace,parent,{...pointer,action:'constructor'},trace),/TARGET_INVALID/);
console.log('Gmail SENT identity/recipient/body/links, private operator receipts and zero-write invalid witness: PASS; no mail or provider request executed.');
