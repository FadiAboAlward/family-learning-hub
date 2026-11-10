import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REF='gkpoylfozvuwuwqeoduc';
const VERSION='20261109190258', NAME='legacy_visual_authoring_eligibility';
const BEFORE_COUNT=133, PREVIOUS_VERSION='20261105134103';
const BEFORE_SHA='a881da0b3a2ed9c73506eea1bc646637678bbe4f4035d6fdf379e99474d911e3';
const SQL_LEDGER_COUNT='(SELECT count(*) FROM supabase_migrations.schema_migrations)';
const SQL_LEDGER_DIGEST="(SELECT encode(extensions.digest(convert_to(coalesce(string_agg(version || E'\\t' || name || E'\\n','' ORDER BY version),''),'UTF8'),'sha256'),'hex') FROM supabase_migrations.schema_migrations)";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SOURCE='supabase/migrations/'+VERSION+'_'+NAME+'.sql';
const API='https://api.supabase.com/v1/projects/'+REF;
const TAG='$flh046_source_sql$';
const EXPECTED_EDGE=Object.freeze({'assessment-mcp':8,'learning-api':24,'exam-v2-api':14,'attempt-history-api':8});
export function ledgerDigest(rows){
 return createHash('sha256').update(rows.map(x=>x.version+'\t'+x.name+'\n').join(''),'utf8').digest('hex');
}
export function guardLedger(rows,{after=false,expectedCount=BEFORE_COUNT,expectedDigest=BEFORE_SHA,previousVersion=PREVIOUS_VERSION}={}){
 assert.ok(Array.isArray(rows),'Missing migration ledger');
 const list=rows.map(x=>({version:x.version,name:x.name})).sort((a,b)=>a.version.localeCompare(b.version));
 assert.ok(list.every(x=>/^\d{14}$/.test(x.version)&&/^[a-zA-Z0-9_]+$/.test(x.name)),'Unexpected migration metadata');
 assert.equal(new Set(list.map(x=>x.version)).size,list.length,'Duplicate migration version');
 assert.equal(list.length,expectedCount+Number(after),'Production ledger count drift');
 if(after) assert.deepEqual(list.pop(),{version:VERSION,name:NAME},'Canonical version/name not applied');
 else assert.equal(list.at(-1)?.version,previousVersion,'Wrong baseline latest version');
 assert.equal(ledgerDigest(list),expectedDigest,'Production ledger baseline drift');
 return list;
}
export function buildTransaction(bytes){
 const sql=Buffer.isBuffer(bytes)?bytes.toString('utf8'):String(bytes);
 assert.ok(sql.trim().startsWith('-- FLH-FEAT-2026-046'),'Incorrect migration source');
 assert.ok(!sql.includes(TAG),'Reserved SQL delimiter in source');
 assert.ok(!/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(sql),'Migration controls transaction');
 const guard=[
  'BEGIN;',
  'SELECT pg_advisory_xact_lock(460462026);',
  'DO $flh046_guard$',
  'BEGIN',
  ' IF '+SQL_LEDGER_COUNT+' <> '+BEFORE_COUNT+' THEN',
  "  RAISE EXCEPTION 'FLH046_PRODUCTION_LEDGER_COUNT_DRIFT';",
  ' END IF;',
  " IF "+SQL_LEDGER_DIGEST+" <> '"+BEFORE_SHA+"' THEN",
  "  RAISE EXCEPTION 'FLH046_PRODUCTION_LEDGER_DIGEST_DRIFT';",
  ' END IF;',
  " IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"') THEN",
  "  RAISE EXCEPTION 'FLH046_ALREADY_APPLIED';",
  ' END IF;',
  'END',
  '$flh046_guard$;'
 ].join('\n');
 const stamp="INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('"+VERSION+"','"+NAME+"',ARRAY["+TAG+sql+TAG+"]::text[]);";
 return guard+'\n'+sql+'\n'+stamp+'\nCOMMIT;\n';
}
async function management(token,suffix,{query,read_only}={}){
 const isSQL=query!==undefined;
 const resp=await fetch(API+suffix,{
  method:isSQL?'POST':'GET',
  headers:{Authorization:'Bearer '+token,Accept:'application/json',...(isSQL?{'Content-Type':'application/json'}:{})},
  ...(isSQL?{body:JSON.stringify({query,read_only:Boolean(read_only)})}:{}),
  signal:AbortSignal.timeout(isSQL&&!read_only?150000:30000)
 });
 if(resp.status!==(isSQL?201:200)){
  const error=new Error('Supabase Management HTTP '+resp.status);
  error.httpStatus=resp.status;throw error;
 }
 return resp.json();
}
async function readLedger(token,api=management){
 const rows=await api(token,'/database/query',{query:'select version,name from supabase_migrations.schema_migrations order by version',read_only:true});
 assert.ok(Array.isArray(rows),'Unexpected migration response');return rows;
}
async function assertFlagOff(token,api=management){
 const rows=await api(token,'/database/query',{query:"select count(*) filter(where value->>'enabled'='true')::int as enabled from public.workspace_settings where key='visual_assessments'",read_only:true});
 assert.ok(Array.isArray(rows)&&rows.length===1,'Unexpected visual flag response');
 assert.equal(Number(rows[0].enabled),0,'Production visual feature was enabled; abort');
}
export async function assertSqlBaseline(token,api=management){
 const rows=await api(token,'/database/query',{query:'select '+SQL_LEDGER_COUNT+' as count, '+SQL_LEDGER_DIGEST+' as digest',read_only:true});
 assert.ok(Array.isArray(rows)&&rows.length===1,'Unexpected SQL ledger digest response');
 assert.equal(Number(rows[0].count),BEFORE_COUNT,'SQL ledger count drift');
 assert.equal(rows[0].digest,BEFORE_SHA,'SQL ledger digest drift');
}
export async function migrate(token,{api=management,checkLedger=guardLedger,sourceBytes}={}){
 checkLedger(await readLedger(token,api));await assertFlagOff(token,api);await assertSqlBaseline(token,api);
 const tx=buildTransaction(sourceBytes??fs.readFileSync(path.join(ROOT,SOURCE)));
 let writeError;
 try{await api(token,'/database/query',{query:tx,read_only:false});}
 catch(error){writeError=error;}
 try{checkLedger(await readLedger(token,api),{after:true});}
 catch(postError){
  // A gateway 4xx (notably HTTP 408) is not proof that the database
  // transaction did not commit. No write retry without authoritative ledger.
  const reason='Migration outcome unverified; do NOT repeat an ambiguous write';
  throw new Error(reason+(writeError?' | Write: '+writeError.message:'')+' | Post-state: '+postError.message);
 }
 await assertFlagOff(token,api);
 console.log(writeError?'PASS: canonical migration verified after ambiguous response':'PASS: canonical Production migration verified');
}
async function verifyEdge(token){
 guardLedger(await readLedger(token),{after:true});await assertFlagOff(token);
 const functions=await management(token,'/functions');
 assert.ok(Array.isArray(functions),'Unexpected function metadata');
 for(const [slug,previous] of Object.entries(EXPECTED_EDGE)){
  const f=functions.find(x=>x.slug===slug);
  assert.ok(f&&f.status==='ACTIVE','Edge unavailable: '+slug);
  assert.equal(f.verify_jwt,false,'JWT policy drift: '+slug);
  assert.ok(Number(f.version)>previous,'Bundle not redeployed: '+slug);
 }
 console.log('PASS: 4 reviewed Edge bundles active; visual flag OFF');
}
async function main(){
 const phase=process.argv[2];
 assert.ok(['preflight','deploy','resume-edge','verify-edge'].includes(phase),'Invalid phase');
 const token=process.env.SUPABASE_ACCESS_TOKEN;
 assert.ok(token,'Missing approved Production management token');
 if(phase==='preflight'){guardLedger(await readLedger(token));await assertSqlBaseline(token);await assertFlagOff(token);buildTransaction(fs.readFileSync(path.join(ROOT,SOURCE)));console.log('PASS: JS and SQL ledger count/digest pinned; visual flag OFF');return;}
 if(phase==='deploy'){await migrate(token);return;}
 if(phase==='resume-edge'){guardLedger(await readLedger(token),{after:true});await assertFlagOff(token);console.log('PASS: canonical migration exists; continue Edge resume');return;}
 await verifyEdge(token);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(error=>{console.error('FLH046 controlled Production release stopped: '+error.message);process.exitCode=1;});
}
