import assert from 'node:assert/strict';
import { authenticateLearner, dispatchExamAction, parseRequest, setFlag } from '../supabase/functions/exam-v2-api/logic.mjs';

const WORKSPACE_ID='55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
const SECRET='test-service-role-secret';

async function signBody(body){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body)));
  return Buffer.from(bytes).toString('base64url');
}

async function bearerForRawJson(raw){
  const body=Buffer.from(raw).toString('base64url');
  return `Bearer ${body}.${await signBody(body)}`;
}

function makeRequest({authorization,raw='{}'}={}){
  const headers={'content-type':'application/json'};
  if(authorization)headers.authorization=authorization;
  return new Request('http://localhost/exam',{method:'POST',headers,body:raw});
}

function makeAdmin({attemptLearnerId='learner-a',attemptWorkspaceId=WORKSPACE_ID,attemptId='attempt-1',questionWorkspaceId=WORKSPACE_ID,questionAttemptId='attempt-1',questionId='q1',questionExists=true,attemptError=null,questionError=null,updateError=null,updateData={id:'queue-1'}}={}){
  const state={updateCalls:0,lastUpdate:null,lastUpdateFilters:null};
  const admin={
    from(table){
      const context={table,filters:{},updatePayload:null};
      const query={
        select(){return query;},
        update(payload){context.updatePayload=payload;return query;},
        eq(key,value){context.filters[key]=value;return query;},
        async maybeSingle(){
          if(table==='quiz_attempts'){
            if(attemptError)return{data:null,error:attemptError};
            const matches=context.filters.workspace_id===attemptWorkspaceId&&context.filters.id===attemptId&&context.filters.learner_id===attemptLearnerId;
            if(!matches)return{data:null,error:null};
            return{data:{id:attemptId,status:'in_progress',delivery_mode:'exam'},error:null};
          }
          if(table==='quiz_attempt_question_queue'){
            if(questionError)return{data:null,error:questionError};
            const matches=context.filters.workspace_id===questionWorkspaceId&&context.filters.quiz_attempt_id===questionAttemptId&&context.filters.question_id===questionId;
            return{data:questionExists&&matches?{id:'queue-1'}:null,error:null};
          }
          throw new Error(`Unexpected table ${table}`);
        },
        async single(){
          state.updateCalls+=1;
          state.lastUpdate=context.updatePayload;
          state.lastUpdateFilters={...context.filters};
          const targetsExpectedRow=table==='quiz_attempt_question_queue'&&context.filters.id==='queue-1';
          if(!targetsExpectedRow)return{data:null,error:null};
          return{data:updateData,error:updateError};
        }
      };
      return query;
    }
  };
  return{admin,state};
}

const tests=[];
const test=(name,fn)=>tests.push({name,fn});

test('malformed signed learner payload returns INVALID_SESSION',async()=>{
  const authorization=await bearerForRawJson('{');
  await assert.rejects(()=>authenticateLearner(makeRequest({authorization}),{serviceRole:SECRET,workspaceId:WORKSPACE_ID}),/INVALID_SESSION/);
});

test('signed null learner payload returns INVALID_SESSION',async()=>{
  const authorization=await bearerForRawJson('null');
  await assert.rejects(()=>authenticateLearner(makeRequest({authorization}),{serviceRole:SECRET,workspaceId:WORKSPACE_ID}),/INVALID_SESSION/);
});

test('valid signed learner payload authenticates',async()=>{
  const raw=JSON.stringify({typ:'learner',workspace_id:WORKSPACE_ID,learner_id:'learner-a',exp:Math.floor(Date.now()/1000)+60});
  const authorization=await bearerForRawJson(raw);
  assert.equal(await authenticateLearner(makeRequest({authorization}),{serviceRole:SECRET,workspaceId:WORKSPACE_ID}),'learner-a');
});

test('invalid JSON request becomes UNKNOWN_ACTION input',async()=>{
  const{body,action}=await parseRequest(makeRequest({raw:'{'}));
  assert.deepEqual(body,{});
  assert.equal(action,'');
});

test('array action is rejected instead of coercing to warmup',async()=>{
  const{action}=await parseRequest(makeRequest({raw:JSON.stringify({action:['warmup']})}));
  assert.equal(action,'');
  await assert.rejects(()=>dispatchExamAction(action,'learner-a',{},{}),/UNKNOWN_ACTION/);
});

test('unknown string action is rejected',async()=>{
  const{action}=await parseRequest(makeRequest({raw:JSON.stringify({action:'not-real'})}));
  await assert.rejects(()=>dispatchExamAction(action,'learner-a',{},{}),/UNKNOWN_ACTION/);
});

test('valid action dispatches to its handler',async()=>{
  const result=await dispatchExamAction('submit_exam','learner-a',{attempt_id:'attempt-1'},{
    startExam:()=>assert.fail('wrong handler'),
    saveAnswer:()=>assert.fail('wrong handler'),
    setFlag:()=>assert.fail('wrong handler'),
    submitExam:(learnerId,body)=>({learnerId,attemptId:body.attempt_id})
  });
  assert.deepEqual(result,{learnerId:'learner-a',attemptId:'attempt-1'});
});

test('non-boolean flag is rejected',async()=>{
  const{admin}=makeAdmin();
  await assert.rejects(()=>setFlag(admin,'learner-a',{attempt_id:'attempt-1',question_id:'q1',is_flagged:'false'},WORKSPACE_ID),/INVALID_FLAG/);
});

test('array attempt_id is rejected as INVALID_FLAG',async()=>{
  const{admin,state}=makeAdmin();
  await assert.rejects(()=>setFlag(admin,'learner-a',{attempt_id:['attempt-1'],question_id:'q1',is_flagged:true},WORKSPACE_ID),/INVALID_FLAG/);
  assert.equal(state.updateCalls,0);
});

test('learner-content isolation blocks another learner attempt',async()=>{
  const{admin,state}=makeAdmin({attemptLearnerId:'learner-a'});
  await assert.rejects(()=>setFlag(admin,'learner-b',{attempt_id:'attempt-1',question_id:'q1',is_flagged:true},WORKSPACE_ID),/ATTEMPT_NOT_ACTIVE/);
  assert.equal(state.updateCalls,0);
});

test('mismatched queue workspace is treated as outside the exam scope',async()=>{
  const{admin,state}=makeAdmin({questionWorkspaceId:'other-workspace'});
  await assert.rejects(()=>setFlag(admin,'learner-a',{attempt_id:'attempt-1',question_id:'q1',is_flagged:true},WORKSPACE_ID),/QUESTION_NOT_IN_EXAM/);
  assert.equal(state.updateCalls,0);
});

test('attempt lookup database error is surfaced without update',async()=>{
  const{admin,state}=makeAdmin({attemptError:new Error('attempt lookup failed')});
  await assert.rejects(()=>setFlag(admin,'learner-a',{attempt_id:'attempt-1',question_id:'q1',is_flagged:true},WORKSPACE_ID),/ATTEMPT_LOOKUP_FAILED/);
  assert.equal(state.updateCalls,0);
});

test('question lookup database error is surfaced without update',async()=>{
  const{admin,state}=makeAdmin({questionError:new Error('question lookup failed')});
  await assert.rejects(()=>setFlag(admin,'learner-a',{attempt_id:'attempt-1',question_id:'q1',is_flagged:true},WORKSPACE_ID),/QUESTION_LOOKUP_FAILED/);
  assert.equal(state.updateCalls,0);
});

test('flag update database error is surfaced',async()=>{
  const{admin}=makeAdmin({updateError:new Error('db failed'),updateData:null});
  await assert.rejects(()=>setFlag(admin,'learner-a',{attempt_id:'attempt-1',question_id:'q1',is_flagged:true},WORKSPACE_ID),/FLAG_UPDATE_FAILED/);
});

test('zero-row flag update is not reported as success',async()=>{
  const{admin}=makeAdmin({updateData:null});
  await assert.rejects(()=>setFlag(admin,'learner-a',{attempt_id:'attempt-1',question_id:'q1',is_flagged:true},WORKSPACE_ID),/FLAG_UPDATE_FAILED/);
});

test('valid boolean flag persists and returns success',async()=>{
  const{admin,state}=makeAdmin();
  const result=await setFlag(admin,'learner-a',{attempt_id:'attempt-1',question_id:'q1',is_flagged:false},WORKSPACE_ID);
  assert.deepEqual(result,{ok:true,is_flagged:false});
  assert.equal(state.updateCalls,1);
  assert.deepEqual(state.lastUpdate,{is_flagged:false});
  assert.deepEqual(state.lastUpdateFilters,{id:'queue-1'});
});

for(const{ name,fn }of tests){
  try{await fn();console.log(`PASS ${name}`);}
  catch(error){console.error(`FAIL ${name}`);throw error;}
}
console.log(`Exam API tests passed: ${tests.length}`);
