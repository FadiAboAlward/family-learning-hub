import { createClient } from "npm:@supabase/supabase-js@2";
import { authenticateLearner, dispatchExamAction, parseRequest, setFlag } from "./logic.mjs";
import { createBackendPerformanceTrace, performanceJsonResponse } from "../_shared/backend-performance.mjs";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKSPACE_ID="55f9224c-8ba7-4cbc-9f88-713e6a6b41df";
const admin=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});

/** Build CORS headers for the approved production and local origins. */
function cors(origin:string|null){
  const allowed=new Set(["https://fadiaboalward.github.io","http://localhost:5173","http://localhost:4173"]);
  return{
    "Access-Control-Allow-Origin":origin&&allowed.has(origin)?origin:"https://fadiaboalward.github.io",
    "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-region",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Access-Control-Expose-Headers":"server-timing, x-flh-backend-ms, x-flh-correlation-id, x-flh-db-operations, x-flh-edge-region, x-sb-edge-region",
    "Access-Control-Max-Age":"86400",
    "Content-Type":"application/json; charset=utf-8",
    "Vary":"Origin"
  };
}

/** Return a JSON response with the function's standard CORS headers. */
function json(data:unknown,status=200,origin:string|null=null){
  return new Response(JSON.stringify(data),{status,headers:cors(origin)});
}

/** Start one server-authoritative Exam Mode attempt. */
async function startExam(learnerId:string,slug:string){
  const{data,error}=await admin.rpc("flh_exam_start",{p_workspace_id:WORKSPACE_ID,p_learner_id:learnerId,p_quiz_slug:slug});
  if(error)throw new Error("EXAM_START_FAILED");
  if((data as any)?.error)throw new Error(String((data as any).error));
  return data;
}

/** Save one answer for the authenticated learner's active attempt. */
async function saveAnswer(learnerId:string,body:any){
  const attemptId=String(body.attempt_id||"");
  const questionId=String(body.question_id||"");
  const optionPosition=Number(body.option_position);
  if(!attemptId||!questionId||!Number.isInteger(optionPosition))throw new Error("INVALID_ANSWER");
  const{data,error}=await admin.rpc("flh_exam_save_answer",{p_workspace_id:WORKSPACE_ID,p_learner_id:learnerId,p_attempt_id:attemptId,p_question_id:questionId,p_option_position:optionPosition});
  if(error)throw new Error("ANSWER_SAVE_FAILED");
  if((data as any)?.error)throw new Error(String((data as any).error));
  return data;
}

/** Submit the authenticated learner's Exam Mode attempt for grading. */
async function submitExam(learnerId:string,body:any){
  const attemptId=String(body.attempt_id||"");
  if(!attemptId)throw new Error("ATTEMPT_NOT_ACTIVE");
  const{data,error}=await admin.rpc("flh_exam_submit",{p_workspace_id:WORKSPACE_ID,p_learner_id:learnerId,p_attempt_id:attemptId});
  if(error)throw new Error("EXAM_SUBMIT_FAILED");
  if((data as any)?.error)throw new Error(String((data as any).error));
  return data;
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("origin");
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});
  const trace=createBackendPerformanceTrace({region:Deno.env.get("SB_REGION")||"unknown"});
  if(req.method!=="POST")return performanceJsonResponse(trace,{error:"METHOD_NOT_ALLOWED"},405,cors(origin));

  let action="";
  try{
    const parsed=await parseRequest(req);
    const body=parsed.body;
    action=parsed.action;

    if(action==="warmup"){
      trace.setAction(action);
      return performanceJsonResponse(trace,{ok:true,warm:true},200,cors(origin));
    }

    const allowedActions=new Set(["start_exam","save_answer","set_flag","submit_exam"]);
    if(!allowedActions.has(action))return performanceJsonResponse(trace,{error:"UNKNOWN_ACTION"},400,cors(origin));
    trace.setAction(action);

    const learnerId=await trace.measure("authentication",{},()=>authenticateLearner(req,{serviceRole:SERVICE_ROLE,workspaceId:WORKSPACE_ID}));
    const output=await trace.measure(action==="set_flag"?"exam.flag_queries":"exam.rpc",{
      dbOperations:action==="set_flag"?3:1,
    },()=>dispatchExamAction(action,learnerId,body,{
        startExam,
        saveAnswer,
        setFlag:(lid:string,b:any)=>setFlag(admin,lid,b,WORKSPACE_ID),
        submitExam
      }));

    return performanceJsonResponse(trace,output,200,cors(origin));
  }catch(error){
    const message=error instanceof Error?error.message:"SERVER_ERROR";
    const authErrors=["AUTH_REQUIRED","INVALID_SESSION","SESSION_EXPIRED"];
    const notFoundErrors=["QUIZ_NOT_FOUND","QUIZ_NOT_AVAILABLE","VERSION_NOT_FOUND","NO_EXAM_QUESTIONS"];
    const badRequestErrors=["INVALID_ANSWER","INVALID_FLAG","ATTEMPT_NOT_ACTIVE","QUESTION_NOT_IN_EXAM","ATTEMPT_OR_QUESTION_NOT_ACTIVE","EXAM_NOT_COMPLETE","UNKNOWN_ACTION"];
    const status=authErrors.includes(message)?401:notFoundErrors.includes(message)?404:badRequestErrors.includes(message)?400:500;
    return performanceJsonResponse(trace,{error:message},status,cors(origin));
  }
});
