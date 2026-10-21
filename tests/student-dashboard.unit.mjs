import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Run the actual pure catalog projection, without initializing the browser shell.
const source=fs.readFileSync(new URL('../student-library-v3.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('  const journeyStates='),source.indexOf('  function orderedQuizzes'))+
  source.slice(source.indexOf('  function dashboardActivities'),source.indexOf('  function renderDashboard')),context);
const collect=d=>JSON.parse(JSON.stringify(context.dashboardActivities(d)));
const result='a1000000-0000-4000-8000-000000000021';
const quiz=(id,state='NEW',action='learning',extra={})=>({id,slug:id,title:id,journey:{state,primary_action:action,
  learning:{available:true,resumed:false},exam:{available:true,resumed:false},...extra}});
const ongoing=quiz('ongoing','CONTINUE_LEARNING'),ready=quiz('ready','START_EXAM','exam');
const resumed=quiz('exam-resume','START_EXAM','exam',{exam:{available:true,resumed:true}});
const complete=quiz('complete','COMPLETE','results',{result_attempt_id:result});
const fresh=quiz('fresh'),examOnly={...quiz('exam-only','NEW','exam'),delivery_config:{learning:{enabled:false}}};
const book={title:'Book',units:[{title:'Unit',quizzes:[fresh,complete,ready,ongoing,examOnly,resumed]}],extras:[ongoing]};
const catalog={programs:[{title:'P1',books:[book]},{title:'P2',books:[book]}],standalone_books:[book],standalone_assessments:[fresh,quiz('bookless')]};
const snapshot=JSON.stringify(catalog),rows=collect(catalog);
assert.deepEqual(rows.map(x=>x.q.id),['ongoing','exam-resume','ready','fresh','exam-only','bookless','complete']);
assert.deepEqual(rows.map(x=>x.group),['continue','continue','exam','new','new','new','complete']);
assert.equal(rows[0].context,'P1 · Book · Unit','first catalog context is stable, all duplicate identities collapse');
assert.equal(collect({standalone_books:[{...book,units:[],extras:[fresh]}]})[0].q.id,'fresh','standalone book extras included');
assert.deepEqual(collect({standalone_assessments:[{id:'library-only',slug:'library'},quiz('unknown','FUTURE'),
  quiz('blocked','NEW','learning',{learning:{available:false}}),quiz('bad-result','COMPLETE','results',{result_attempt_id:'invalid'}),
  {...fresh,delivery_config:{learning:{enabled:false}}}]}),[],'no guessing from missing, unknown, invalid or disabled summaries');
const newer=quiz('newer','NEW','learning',{latest_result_attempt_id:result});
assert.equal(collect({standalone_assessments:[newer]})[0].group,'new','old result never overrides authoritative current version');
const support={...complete,id:'support',slug:'support',delivery_config:{exam:{enabled:false},support_session:true}};
assert.equal(collect({standalone_assessments:[support]})[0].group,'complete','completed Learning-only does not force Exam');
assert.equal(context.dashboardLabel({q:resumed,group:'continue'}),'تابع الامتحان');
assert.equal(context.dashboardLabel({q:examOnly,group:'new'}),'ابدأ الامتحان');
assert.deepEqual(collect({}),[]);
assert.equal(JSON.stringify(catalog),snapshot,'projection does not mutate source catalog');
assert.deepEqual(collect({standalone_assessments:[quiz('inconsistent','CONTINUE_LEARNING','exam'),quiz('inconsistent-ready','START_EXAM','learning')]}),[],'inconsistent mode summaries fail closed');
console.log('PASS student dashboard: authoritative states, all catalog paths, stable priority, quiz-ID deduplication, saved Exam, old results, unavailable summaries and Learning-only completion.');
