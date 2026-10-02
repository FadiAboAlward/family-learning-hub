import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateAcademicPackage} from './academic-content-quality.mjs';
import {validateVideoCandidate} from '../supabase/functions/_shared/optional-learning-videos.mjs';

// Run the normal academic gate before attaching a reviewed candidate to a published version.
export function prepareVideoAttachment(pkg, reference, {warningsReviewed=false}={}) {
  const quality=validateAcademicPackage(pkg);
  if (!quality.ok) throw new Error('ACADEMIC_PACKAGE_INVALID');
  if (quality.warnings.length && !warningsReviewed) throw new Error('ACADEMIC_WARNINGS_REQUIRE_REVIEW');
  const context=pkg.academic_context;
  if (!reference || ['student_ref','grade','curriculum','subject'].some(key=>String(reference.academic_context?.[key]??'').trim()!==String(context[key]).trim())) throw new Error('VIDEO_ACADEMIC_CONTEXT_MISMATCH');
  if (!context.coverage_plan.primary_target_concepts.includes(reference.concept_code)) throw new Error('VIDEO_PRIMARY_TARGET_MISMATCH');
  const candidate=validateVideoCandidate(reference.video);
  if (candidate.grade_level!==Number(context.grade)) throw new Error('VIDEO_ACADEMIC_CONTEXT_MISMATCH');
  return {action:'attach_optional_video',video:candidate};
}

export async function attachReviewedVideo(payload, {url,accessToken,publishableKey,fetchImpl=fetch}={}) {
  let endpoint;
  try {endpoint=new URL(url);} catch {throw new Error('LEARNING_API_URL_REQUIRED');}
  if (endpoint.protocol!=='https:' && !(endpoint.protocol==='http:' && ['localhost','127.0.0.1'].includes(endpoint.hostname))) throw new Error('LEARNING_API_URL_INVALID');
  if (!accessToken || !publishableKey) throw new Error('PARENT_API_CREDENTIALS_REQUIRED');
  try {
    const response=await fetchImpl(endpoint.toString(),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+accessToken,apikey:publishableKey},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error('VIDEO_ATTACHMENT_FAILED');
    const result=await response.json();
    if (!result?.ok) throw new Error('VIDEO_ATTACHMENT_FAILED');
    return {ok:true};
  } catch {throw new Error('VIDEO_ATTACHMENT_FAILED');}
}

async function main() {
  const [packageFile,referenceFile,...flags]=process.argv.slice(2);
  if (!packageFile || !referenceFile || flags.some(flag=>!['--dry-run','--warnings-reviewed'].includes(flag))) throw new Error('USAGE: node scripts/attach-learning-video.mjs <academic-package.json> <video-reference.json> [--dry-run] [--warnings-reviewed]');
  let pkg,reference;
  try {pkg=JSON.parse(fs.readFileSync(packageFile,'utf8'));reference=JSON.parse(fs.readFileSync(referenceFile,'utf8'));} catch {throw new Error('INPUT_FILES_INVALID');}
  const payload=prepareVideoAttachment(pkg,reference,{warningsReviewed:flags.includes('--warnings-reviewed')});
  if (flags.includes('--dry-run')) {console.log('Academic package and video reference valid; no attachment or provider call performed.');return;}
  await attachReviewedVideo(payload,{url:process.env.FLH_LEARNING_API_URL,accessToken:process.env.FLH_PARENT_ACCESS_TOKEN,publishableKey:process.env.FLH_PUBLISHABLE_KEY});
  console.log('Reviewed video attached after server authorization and provider validation.');
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{console.error(error.message);process.exitCode=1;});
