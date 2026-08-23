import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});
const WORKSPACE_ID="55f9224c-8ba7-4cbc-9f88-713e6a6b41df";

function cors(origin:string|null){const allowed=new Set(["https://fadiaboalward.github.io","http://localhost:5173","http://localhost:4173"]);return{"Access-Control-Allow-Origin":origin&&allowed.has(origin)?origin:"https://fadiaboalward.github.io","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8","Vary":"Origin"};}
function json(data:unknown,status=200,origin:string|null=null){return new Response(JSON.stringify(data),{status,headers:cors(origin)});}
function fromB64url(s:string){const norm=s.replaceAll("-","+").replaceAll("_","/")+"===".slice((s.length+3)%4);const raw=atob(norm);return new Uint8Array([...raw].map(c=>c.charCodeAt(0)));}
function b64url(bytes:Uint8Array){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");}
async function hmac(data:string){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(SERVICE_ROLE),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return b64url(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(data))));}
async function learner(req:Request){const auth=req.headers.get("authorization")||"";if(!auth.startsWith("Bearer "))throw new Error("AUTH_REQUIRED");const [body,sig]=auth.slice(7).trim().split(".");if(!body||!sig||await hmac(body)!==sig)throw new Error("INVALID_SESSION");const p=JSON.parse(new TextDecoder().decode(fromB64url(body)));if(p.typ!=="learner"||p.workspace_id!==WORKSPACE_ID||!p.learner_id)throw new Error("INVALID_SESSION");if(!p.exp||p.exp<Math.floor(Date.now()/1000))throw new Error("SESSION_EXPIRED");return String(p.learner_id);}

async function accessibleQuiz(learnerId:string,slug:string){
  const {data:quiz}=await admin.from("quizzes").select("id,slug,title,description,quiz_kind,delivery_config,status").eq("workspace_id",WORKSPACE_ID).eq("slug",slug).eq("status","active").maybeSingle();
  if(!quiz)throw new Error("QUIZ_NOT_FOUND");

  const {data:versions}=await admin.from("quiz_versions").select("id,version_no,settings").eq("workspace_id",WORKSPACE_ID).eq("quiz_id",quiz.id).eq("state","published").order("version_no",{ascending:false}).limit(1);
  const version=versions?.[0];
  if(!version)throw new Error("VERSION_NOT_FOUND");

  const {data:enr}=await admin.from("learner_program_enrollments").select("program_id").eq("workspace_id",WORKSPACE_ID).eq("learner_id",learnerId).eq("status","active");
  const programIds=(enr||[]).map((x:any)=>x.program_id);
  let viaProgram=false;
  if(programIds.length){
    const {data:pq}=await admin.from("program_quizzes").select("id").eq("workspace_id",WORKSPACE_ID).eq("quiz_id",quiz.id).eq("availability","available").in("program_id",programIds).limit(1);
    viaProgram=Boolean(pq?.length);
  }

  const {data:assignment}=await admin.from("quiz_assignments").select("id,status,available_at,due_at").eq("workspace_id",WORKSPACE_ID).eq("learner_id",learnerId).eq("quiz_version_id",version.id).eq("status","assigned").order("created_at",{ascending:false}).limit(1).maybeSingle();
  let viaAssignment=false;
  if(assignment){
    const now=Date.now();
    viaAssignment=(!assignment.available_at||new Date(assignment.available_at).getTime()<=now)&&(!assignment.due_at||new Date(assignment.due_at).getTime()>=now);
  }
  if(!viaProgram&&!viaAssignment)throw new Error("QUIZ_NOT_AVAILABLE");
  return {quiz,version};
}

async function questionPayload(ids:string[]){
  if(!ids.length)return[];
  const [{data:qs},{data:opts}]=await Promise.all([
    admin.from("quiz_questions").select("id,position,question_type,prompt,origin,source_page_start,source_page_end,points,difficulty_level").eq("workspace_id",WORKSPACE_ID).in("id",ids),
    admin.from("quiz_question_options").select("id,question_id,position,label,content").eq("workspace_id",WORKSPACE_ID).in("question_id",ids).order("position")
  ]);
  const om=new Map<string,any[]>();for(const o of opts||[]){if(!om.has(o.question_id))om.set(o.question_id,[]);om.get(o.question_id)!.push({id:o.id,position:o.position,label:o.label,content:o.content});}
  const qm=new Map((qs||[]).map((q:any)=>[q.id,{...q,options:om.get(q.id)||[]} ]));return ids.map(id=>qm.get(id)).filter(Boolean);
}

async function startExam(learnerId:string,slug:string){
  const {quiz,version}=await accessibleQuiz(learnerId,slug);
  const {data:existing}=await admin.from("quiz_attempts").select("id,started_at").eq("workspace_id",WORKSPACE_ID).eq("learner_id",learnerId).eq("quiz_version_id",version.id).eq("status","in_progress").eq("delivery_mode","exam").order("started_at",{ascending:false}).limit(1).maybeSingle();
  let attempt=existing;
  if(!attempt){
    const {data:created,error}=await admin.from("quiz_attempts").insert({workspace_id:WORKSPACE_ID,learner_id:learnerId,quiz_version_id:version.id,status:"in_progress",delivery_mode:"exam",metadata:{engine:"exam-v2-api",quiz_slug:slug,server_graded:true}}).select("id,started_at").single();
    if(error||!created)throw new Error("ATTEMPT_CREATE_FAILED");attempt=created;
    const {data:core}=await admin.from("quiz_questions").select("id,position,difficulty_level").eq("workspace_id",WORKSPACE_ID).eq("quiz_version_id",version.id).eq("delivery_role","core").order("position");
    const desired=Math.max(1,Number((quiz.delivery_config as any)?.exam?.question_count||10));
    const selected=(core||[]).slice(0,Math.min(desired,(core||[]).length));
    if(!selected.length)throw new Error("NO_EXAM_QUESTIONS");
    const rows=selected.map((q:any,i:number)=>({workspace_id:WORKSPACE_ID,quiz_attempt_id:attempt!.id,sequence_no:i+1,question_id:q.id,source_role:"core",difficulty_level:q.difficulty_level,status:i===0?"active":"pending",selection_reason:"exam_core_selection"}));
    const {error:qerr}=await admin.from("quiz_attempt_question_queue").insert(rows);if(qerr)throw new Error("QUEUE_CREATE_FAILED");
  }
  const {data:queue}=await admin.from("quiz_attempt_question_queue").select("sequence_no,question_id,status").eq("workspace_id",WORKSPACE_ID).eq("quiz_attempt_id",attempt.id).order("sequence_no");
  const ids=(queue||[]).map((r:any)=>r.question_id);const payload=await questionPayload(ids);const pm=new Map(payload.map((q:any)=>[q.id,q]));
  const {data:saved}=await admin.from("quiz_attempt_answers").select("question_id,response").eq("workspace_id",WORKSPACE_ID).eq("attempt_id",attempt.id);
  const sm=new Map((saved||[]).map((a:any)=>[a.question_id,a.response]));
  return {attempt_id:attempt.id,started_at:attempt.started_at,quiz:{slug:quiz.slug,title:quiz.title,description:quiz.description},questions:(queue||[]).map((r:any)=>({...r,question:pm.get(r.question_id),saved_response:sm.get(r.question_id)||null}))};
}

async function saveAnswer(learnerId:string,body:any){
  const attemptId=String(body.attempt_id||"");const questionId=String(body.question_id||"");const pos=Number(body.option_position);
  if(!attemptId||!questionId||!Number.isInteger(pos))throw new Error("INVALID_ANSWER");
  const {data:a}=await admin.from("quiz_attempts").select("id,status,delivery_mode").eq("workspace_id",WORKSPACE_ID).eq("id",attemptId).eq("learner_id",learnerId).maybeSingle();
  if(!a||a.status!=="in_progress"||a.delivery_mode!=="exam")throw new Error("ATTEMPT_NOT_ACTIVE");
  const {data:q}=await admin.from("quiz_attempt_question_queue").select("id").eq("workspace_id",WORKSPACE_ID).eq("quiz_attempt_id",attemptId).eq("question_id",questionId).maybeSingle();if(!q)throw new Error("QUESTION_NOT_IN_EXAM");
  await admin.from("quiz_attempt_answers").upsert({workspace_id:WORKSPACE_ID,attempt_id:attemptId,question_id:questionId,response:{option_position:pos},evaluation:"ungraded",is_correct:null,points_awarded:null,attempts_used:1,hints_used:0,first_try_correct:null,mastery_result:null},{onConflict:"attempt_id,question_id"});
  return {ok:true};
}

async function submitExam(learnerId:string,body:any){
  const attemptId=String(body.attempt_id||"");
  const {data:a}=await admin.from("quiz_attempts").select("id,quiz_version_id,status,started_at").eq("workspace_id",WORKSPACE_ID).eq("id",attemptId).eq("learner_id",learnerId).maybeSingle();if(!a||a.status!=="in_progress")throw new Error("ATTEMPT_NOT_ACTIVE");
  const {data:queue}=await admin.from("quiz_attempt_question_queue").select("question_id,sequence_no").eq("workspace_id",WORKSPACE_ID).eq("quiz_attempt_id",attemptId).order("sequence_no");const ids=(queue||[]).map((x:any)=>x.question_id);
  const [{data:answers},{data:keys},{data:qs},{data:v}]=await Promise.all([
    admin.from("quiz_attempt_answers").select("id,question_id,response").eq("workspace_id",WORKSPACE_ID).eq("attempt_id",attemptId).in("question_id",ids),
    admin.from("quiz_question_answer_keys").select("question_id,correct_answer,explanation,correct_explanation,final_incorrect_explanation").eq("workspace_id",WORKSPACE_ID).in("question_id",ids),
    admin.from("quiz_questions").select("id,prompt,points").eq("workspace_id",WORKSPACE_ID).in("id",ids),
    admin.from("quiz_versions").select("quiz_id").eq("workspace_id",WORKSPACE_ID).eq("id",a.quiz_version_id).single()
  ]);
  if((answers||[]).length!==ids.length)throw new Error("EXAM_NOT_COMPLETE");
  const km=new Map((keys||[]).map((k:any)=>[k.question_id,k]));const qm=new Map((qs||[]).map((q:any)=>[q.id,q]));const am=new Map((answers||[]).map((x:any)=>[x.question_id,x]));
  let score=0,max=0;const review:any[]=[];
  for(const id of ids){const ans=am.get(id),key=km.get(id),q=qm.get(id);if(!ans||!key||!q)throw new Error("EXAM_DATA_INCOMPLETE");const selected=Number(ans.response?.option_position);const correct=Number(key.correct_answer?.option_position);const ok=selected===correct;const points=Number(q.points||1);max+=points;if(ok)score+=points;await admin.from("quiz_attempt_answers").update({evaluation:ok?"correct":"incorrect",is_correct:ok,points_awarded:ok?points:0,first_try_correct:ok,mastery_result:ok?"mastered":"not_mastered"}).eq("id",ans.id);review.push({question_id:id,prompt:q.prompt,response:ans.response,is_correct:ok,correct_answer:key.correct_answer,explanation:ok?(key.correct_explanation||key.explanation):(key.final_incorrect_explanation||key.explanation)});}
  const percentage=max?Math.round(score/max*10000)/100:0;const duration=Math.max(1,Math.round((Date.now()-new Date(a.started_at).getTime())/1000));
  await admin.from("quiz_attempts").update({status:"submitted",submitted_at:new Date().toISOString(),score_points:score,max_points:max,percentage,duration_seconds:duration,metadata:{engine:"exam-v2-api",server_graded:true,question_count:ids.length}}).eq("id",attemptId);
  await admin.from("quiz_attempt_question_queue").update({status:"completed"}).eq("workspace_id",WORKSPACE_ID).eq("quiz_attempt_id",attemptId);
  const {data:quiz}=await admin.from("quizzes").select("slug,title").eq("workspace_id",WORKSPACE_ID).eq("id",v!.quiz_id).single();
  return {ok:true,attempt_id:attemptId,quiz,score_points:score,max_points:max,percentage,review};
}

Deno.serve(async(req:Request)=>{const origin=req.headers.get("origin");if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405,origin);try{const learnerId=await learner(req);const body=await req.json().catch(()=>({}));const action=String(body.action||"");if(action==="start_exam")return json(await startExam(learnerId,String(body.quiz_slug||"")),200,origin);if(action==="save_answer")return json(await saveAnswer(learnerId,body),200,origin);if(action==="submit_exam")return json(await submitExam(learnerId,body),200,origin);return json({error:"UNKNOWN_ACTION"},400,origin);}catch(e){const msg=e instanceof Error?e.message:"SERVER_ERROR";const auth=["AUTH_REQUIRED","INVALID_SESSION","SESSION_EXPIRED"];const nf=["QUIZ_NOT_FOUND","QUIZ_NOT_AVAILABLE","VERSION_NOT_FOUND","NO_EXAM_QUESTIONS"];const bad=["INVALID_ANSWER","ATTEMPT_NOT_ACTIVE","QUESTION_NOT_IN_EXAM","EXAM_NOT_COMPLETE"];return json({error:msg},auth.includes(msg)?401:nf.includes(msg)?404:bad.includes(msg)?400:500,origin);}});
