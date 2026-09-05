const DEFAULT_WORKSPACE_ID="55f9224c-8ba7-4cbc-9f88-713e6a6b41df";

/** Decode a base64url token body to bytes. */
function fromBase64Url(value){
  const normalized=value.replaceAll("-","+").replaceAll("_","/")+"===".slice((value.length+3)%4);
  const raw=atob(normalized);
  return new Uint8Array([...raw].map(char=>char.charCodeAt(0)));
}

/** Encode bytes as unpadded base64url. */
function toBase64Url(bytes){
  let raw="";
  for(const byte of bytes)raw+=String.fromCharCode(byte);
  return btoa(raw).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
}

/** Sign a learner-token body using the service-role secret. */
async function hmac(body,secret){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(body))));
}

/** Parse the request body without allowing arrays, null, or non-string actions to masquerade as valid actions. */
export async function parseRequest(req){
  const parsed=await req.json().catch(()=>({}));
  const body=parsed!==null&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed:{};
  const action=typeof body.action==="string"?body.action:"";
  return{body,action};
}

/** Authenticate a signed learner session and return only the validated learner id. */
export async function authenticateLearner(req,{serviceRole,workspaceId=DEFAULT_WORKSPACE_ID}){
  const authorization=req.headers.get("authorization")||"";
  if(!authorization.startsWith("Bearer "))throw new Error("AUTH_REQUIRED");
  const[body,signature]=authorization.slice(7).trim().split(".");
  if(!body||!signature||await hmac(body,serviceRole)!==signature)throw new Error("INVALID_SESSION");
  let payload;
  try{payload=JSON.parse(new TextDecoder().decode(fromBase64Url(body)));}
  catch{throw new Error("INVALID_SESSION");}
  if(payload===null||typeof payload!=="object"||Array.isArray(payload))throw new Error("INVALID_SESSION");
  if(payload.typ!=="learner"||payload.workspace_id!==workspaceId||!payload.learner_id)throw new Error("INVALID_SESSION");
  if(!payload.exp||payload.exp<Math.floor(Date.now()/1000))throw new Error("SESSION_EXPIRED");
  return String(payload.learner_id);
}

/** Persist one Exam Mode review flag only inside the authenticated learner's active attempt. */
export async function setFlag(admin,learnerId,body,workspaceId=DEFAULT_WORKSPACE_ID){
  const attemptId=String(body.attempt_id||"");
  const questionId=String(body.question_id||"");
  if(!attemptId||!questionId||typeof body.is_flagged!=="boolean")throw new Error("INVALID_FLAG");
  const flag=body.is_flagged;

  const{data:attempt,error:attemptError}=await admin.from("quiz_attempts").select("id,status,delivery_mode").eq("workspace_id",workspaceId).eq("id",attemptId).eq("learner_id",learnerId).maybeSingle();
  if(attemptError)throw new Error("ATTEMPT_LOOKUP_FAILED");
  if(!attempt||attempt.status!=="in_progress"||attempt.delivery_mode!=="exam")throw new Error("ATTEMPT_NOT_ACTIVE");

  const{data:queueRow,error:queueError}=await admin.from("quiz_attempt_question_queue").select("id").eq("workspace_id",workspaceId).eq("quiz_attempt_id",attemptId).eq("question_id",questionId).maybeSingle();
  if(queueError)throw new Error("QUESTION_LOOKUP_FAILED");
  if(!queueRow)throw new Error("QUESTION_NOT_IN_EXAM");

  const{data:updated,error:updateError}=await admin.from("quiz_attempt_question_queue").update({is_flagged:flag}).eq("id",queueRow.id).select("id").single();
  if(updateError||!updated)throw new Error("FLAG_UPDATE_FAILED");
  return{ok:true,is_flagged:flag};
}

/** Route an already-authenticated Exam Mode action to its handler. */
export async function dispatchExamAction(action,learnerId,body,handlers){
  if(action==="start_exam")return handlers.startExam(learnerId,String(body.quiz_slug||""));
  if(action==="save_answer")return handlers.saveAnswer(learnerId,body);
  if(action==="set_flag")return handlers.setFlag(learnerId,body);
  if(action==="submit_exam")return handlers.submitExam(learnerId,body);
  throw new Error("UNKNOWN_ACTION");
}
