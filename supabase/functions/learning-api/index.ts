import { createClient } from "npm:@supabase/supabase-js@2";
import { createBackendPerformanceTrace, performanceJsonResponse } from "../_shared/backend-performance.mjs";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});
const WORKSPACE_ID="55f9224c-8ba7-4cbc-9f88-713e6a6b41df";

function cors(origin:string|null){const allowed=new Set(["https://fadiaboalward.github.io","http://localhost:5173","http://localhost:4173"]);return{"Access-Control-Allow-Origin":origin&&allowed.has(origin)?origin:"https://fadiaboalward.github.io","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-region","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Expose-Headers":"server-timing, x-flh-backend-ms, x-flh-correlation-id, x-flh-db-operations, x-flh-edge-region, x-sb-edge-region","Content-Type":"application/json; charset=utf-8","Vary":"Origin"};}
function json(data:unknown,status=200,origin:string|null=null){return new Response(JSON.stringify(data),{status,headers:cors(origin)});}
function fromB64url(s:string){const norm=s.replaceAll("-","+").replaceAll("_","/")+"===".slice((s.length+3)%4);const raw=atob(norm);return new Uint8Array([...raw].map(c=>c.charCodeAt(0)));}
function b64url(bytes:Uint8Array){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");}
async function hmac(data:string){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(SERVICE_ROLE),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return b64url(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(data))));}
async function learner(req:Request){const auth=req.headers.get("authorization")||"";if(!auth.startsWith("Bearer "))throw new Error("AUTH_REQUIRED");const[body,sig]=auth.slice(7).trim().split(".");if(!body||!sig||await hmac(body)!==sig)throw new Error("INVALID_SESSION");const p=JSON.parse(new TextDecoder().decode(fromB64url(body)));if(p.typ!=="learner"||p.workspace_id!==WORKSPACE_ID||!p.learner_id)throw new Error("INVALID_SESSION");if(!p.exp||p.exp<Math.floor(Date.now()/1000))throw new Error("SESSION_EXPIRED");return String(p.learner_id);}

async function startQuiz(learnerId:string,slug:string,trace:any){
  const{data,error}=await trace.measure("start.rpc",{dbOperations:1},()=>admin.rpc("flh_learning_start",{p_workspace_id:WORKSPACE_ID,p_learner_id:learnerId,p_quiz_slug:slug}));
  if(error){
    console.error("Learning start RPC failed",{code:error.code,message:error.message});
    throw new Error("START_QUIZ_FAILED");
  }
  if((data as any)?.error)throw new Error(String((data as any).error));
  return data;
}

async function activeLearningQuestion(learnerId:string,attemptId:string,questionId:string,trace:any){const{data:a}=await trace.measure("question.attempt",{dbOperations:1},()=>admin.from("quiz_attempts").select("id,quiz_version_id,status,delivery_mode").eq("workspace_id",WORKSPACE_ID).eq("id",attemptId).eq("learner_id",learnerId).maybeSingle());if(!a||a.status!=="in_progress"||a.delivery_mode!=="learning")throw new Error("ATTEMPT_NOT_ACTIVE");const{data:qrow}=await trace.measure("question.queue",{dbOperations:1},()=>admin.from("quiz_attempt_question_queue").select("id,sequence_no,question_id,source_role,concept_id,status,draft_option_position,hint_level_requested").eq("workspace_id",WORKSPACE_ID).eq("quiz_attempt_id",attemptId).eq("question_id",questionId).maybeSingle());if(!qrow||qrow.status!=="active")throw new Error("QUESTION_NOT_ACTIVE");return{attempt:a,queue:qrow};}
async function saveDraft(learnerId:string,b:any,trace:any){const attemptId=String(b.attempt_id||""),questionId=String(b.question_id||""),pos=Number(b.option_position);if(!attemptId||!questionId||!Number.isInteger(pos))throw new Error("INVALID_ANSWER");const{queue}=await activeLearningQuestion(learnerId,attemptId,questionId,trace);const{data:o}=await trace.measure("draft.option",{dbOperations:1},()=>admin.from("quiz_question_options").select("id").eq("workspace_id",WORKSPACE_ID).eq("question_id",questionId).eq("position",pos).maybeSingle());if(!o)throw new Error("INVALID_ANSWER");await trace.measure("draft.persist",{dbOperations:1},()=>admin.from("quiz_attempt_question_queue").update({draft_option_position:pos,interaction_metadata:{draft_saved_at:new Date().toISOString()}}).eq("id",queue.id));return{ok:true,option_position:pos};}
async function requestHint(learnerId:string,b:any,trace:any){const attemptId=String(b.attempt_id||""),questionId=String(b.question_id||"");if(!attemptId||!questionId)throw new Error("INVALID_HINT_REQUEST");const{queue}=await activeLearningQuestion(learnerId,attemptId,questionId,trace);const current=Number(queue.hint_level_requested||0);if(current>=4)return{ok:true,exhausted:true,hint:null,hint_level:current};const next=current+1;const{data:h}=await trace.measure("hint.lookup",{dbOperations:1},()=>admin.from("quiz_question_hints").select("hint_level,pedagogical_role,content,language,terminology_display_mode").eq("workspace_id",WORKSPACE_ID).eq("question_id",questionId).eq("hint_level",next).maybeSingle());if(!h)return{ok:true,exhausted:true,hint:null,hint_level:current};await trace.measure("hint.persist",{dbOperations:1},()=>admin.from("quiz_attempt_question_queue").update({hint_level_requested:next}).eq("id",queue.id));return{ok:true,exhausted:next>=4,hint:h,hint_level:next};}

async function answerQuestion(learnerId:string,b:any,trace:any){
  const attemptId=String(b.attempt_id||""),questionId=String(b.question_id||""),pos=Number(b.option_position);
  if(!attemptId||!questionId||!Number.isInteger(pos))throw new Error("INVALID_ANSWER");
  const{data,error}=await trace.measure("answer.rpc",{dbOperations:1},()=>admin.rpc("flh_learning_answer",{p_workspace_id:WORKSPACE_ID,p_learner_id:learnerId,p_attempt_id:attemptId,p_question_id:questionId,p_option_position:pos}));
  if(error){
    console.error("Learning answer RPC failed",{code:error.code,message:error.message});
    throw new Error("ANSWER_SAVE_FAILED");
  }
  if((data as any)?.error)throw new Error(String((data as any).error));
  return data;
}

async function finishQuiz(learnerId:string,b:any,trace:any){
  const attemptId=String(b.attempt_id||""),duration=Math.max(0,Math.min(86400,Number(b.duration_seconds||0)));
  const{data,error}=await trace.measure("finish.rpc",{dbOperations:1},()=>admin.rpc("flh_learning_finish",{p_workspace_id:WORKSPACE_ID,p_learner_id:learnerId,p_attempt_id:attemptId,p_duration_seconds:Number.isFinite(duration)?Math.round(duration):0}));
  if(error){
    console.error("Learning finish RPC failed",{code:error.code,message:error.message});
    throw new Error("FINISH_QUIZ_FAILED");
  }
  if((data as any)?.error)throw new Error(String((data as any).error));
  return data;
}

Deno.serve(async(req:Request)=>{const origin=req.headers.get("origin");if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});const trace=createBackendPerformanceTrace({region:Deno.env.get("SB_REGION")||"unknown"});if(req.method!=="POST")return performanceJsonResponse(trace,{error:"METHOD_NOT_ALLOWED"},405,cors(origin));try{const b=await req.json().catch(()=>({})),action=String(b.action||""),allowed=new Set(["start_quiz","save_draft","request_hint","answer","finish_quiz"]);if(!allowed.has(action))return performanceJsonResponse(trace,{error:"UNKNOWN_ACTION"},400,cors(origin));trace.setAction(action);const lid=await trace.measure("authentication",{},()=>learner(req));let output;if(action==="start_quiz")output=await startQuiz(lid,String(b.quiz_slug||""),trace);else if(action==="save_draft")output=await saveDraft(lid,b,trace);else if(action==="request_hint")output=await requestHint(lid,b,trace);else if(action==="answer")output=await answerQuestion(lid,b,trace);else output=await finishQuiz(lid,b,trace);return performanceJsonResponse(trace,output,200,cors(origin));}catch(e){const m=e instanceof Error?e.message:"SERVER_ERROR",auth=["AUTH_REQUIRED","INVALID_SESSION","SESSION_EXPIRED"],nf=["QUIZ_NOT_FOUND","QUIZ_NOT_AVAILABLE","VERSION_NOT_FOUND"],bad=["INVALID_ANSWER","INVALID_HINT_REQUEST","UNSUPPORTED_QUESTION_TYPE","ATTEMPT_NOT_ACTIVE","QUESTION_NOT_ACTIVE","MAX_ATTEMPTS_REACHED","QUIZ_NOT_COMPLETE"],status=auth.includes(m)?401:nf.includes(m)?404:bad.includes(m)?400:500;return performanceJsonResponse(trace,{error:m},status,cors(origin));}});
