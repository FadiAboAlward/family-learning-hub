import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sdk=fs.readFileSync(new URL('../posthog-telemetry-v1.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const learning=fs.readFileSync(new URL('../learning-launcher-v2.js',import.meta.url),'utf8');
const exam=fs.readFileSync(new URL('../program-exam-v3.js',import.meta.url),'utf8');

function boot(origin='https://fadiaboalward.github.io',pathname='/family-learning-hub/',hash='#student') {
  const scripts=[];
  const calls={};
  const location={origin,pathname,hash};
  const window={addEventListener(event,callback){calls[event]=callback;}};
  const doc={
    createElement(){return {};},
    getElementsByTagName(){return [{parentNode:{insertBefore(node){scripts.push(node);}}}];}
  };
  vm.runInNewContext(sdk,{window,document:doc,location,URL},{timeout:2000});
  return {window,location,scripts,calls};
}
const outside=boot('https://example.com');
assert.equal(outside.window.FLHTelemetry,undefined,'never instrument third-party sites');
assert.equal(outside.scripts.length,0,'no external SDK request on non-FLH origin');
const otherPath=boot('https://fadiaboalward.github.io','/other-app/');
assert.equal(otherPath.window.FLHTelemetry,undefined,'never instrument other GitHub Pages projects');
const preview=boot('https://fadiaboalward.github.io','/family-learning-hub/pr-preview/pr-184/');
assert.equal(preview.window.FLHTelemetry,undefined,'PR previews must not report synthetic QA to Production PostHog');

const {window,scripts,calls,location}=boot();
assert.equal(scripts.length,1,'load SDK just once');
assert.equal(scripts[0].src,'https://eu-assets.i.posthog.com/static/array.js');
assert.equal(window.FLHTelemetry.enabled,true);
assert.equal(window.posthog._i.length,1);
const [publicKey,config]=window.posthog._i[0];
assert.match(publicKey,/^phc_[A-Za-z0-9]+$/);
assert.equal(config.api_host,'https://eu.i.posthog.com');
assert.equal(config.session_recording.maskAllInputs,true,'never replay PIN/input contents');
assert.match(config.session_recording.blockSelector,/ph-no-capture/);
assert.equal(config.capture_pageview,true);
assert.equal(config.autocapture,true);
assert.equal(typeof config.before_send,'function');

const evt={event:'$pageview',properties:{$current_url:'https://example.com/x?auth=one#two',authorization:'Bearer sensitive',pin:'1234',user_token:'secret',$pathname:'/x',note:'Bearer opaque-session'}};
config.before_send(evt);
assert.equal(evt.properties.$current_url,'https://example.com/x');
assert.equal(evt.properties.authorization,undefined);
assert.equal(evt.properties.pin,undefined);
assert.equal(evt.properties.user_token,undefined);
assert.equal(evt.properties.note,'[redacted]');
const ingestion={event:'$pageview',properties:{token:publicKey,authorization:'Bearer sensitive',client_token:'another-key'}};
config.before_send(ingestion);
assert.equal(ingestion.properties.token,publicKey,'PostHog ingestion must keep its own public project token');
assert.equal(ingestion.properties.authorization,undefined,'auth credential cannot be ingested');
assert.equal(ingestion.properties.client_token,undefined,'only exact PostHog transport token may survive');


const log=window.posthog;
let count=log.length;
window.FLHTelemetry.capture('flh_exam_answer_saved',{mode:'exam',attempt_id:'test-uuid',question_index:2,option_position:3,password:'bad',pin:'1234',extra_secret:'bad'});
assert.equal(log.length,count+1);
const last=log.at(-1);
assert.equal(last[0],'capture');
assert.equal(last[1],'flh_exam_answer_saved');
assert.equal(last[2].question_index,2);
assert.equal(last[2].password,undefined);
assert.equal(last[2].extra_secret,undefined);
count=log.length;
window.FLHTelemetry.capture('rogue_event',{password:'bad'});
assert.equal(log.length,count,'reject unapproved events');
window.FLHTelemetry.capture('flh_learning_answer',{response_text:'5/8',is_correct:true});
assert.equal(log.at(-1)[2].response_text,'5/8','explicit academic answer visible');

window.FLHTelemetry.identifyLearner({id:'test-learner',slug:'testing'});
assert.equal(log.at(-1)[0],'identify');
assert.equal(log.at(-1)[1],'flh-learner:test-learner');
count=log.length;
window.FLHTelemetry.identifyLearner({id:'test-learner',slug:'testing'});
assert.equal(log.length,count,'same learner does not repeat identify');
window.FLHTelemetry.identifyLearner({id:'other-learner',slug:'other'});
assert.equal(log.at(-2)[0],'reset','distinct student cannot inherit prior identity');
window.FLHTelemetry.resetLearner();
assert.equal(log.at(-1)[0],'reset');

count=log.length;
location.hash='#parents';
calls.hashchange();
assert.equal(log.length,count+1,'route changes observable');
assert.equal(log.at(-1)[1],'flh_route_view');

assert.match(html,/posthog-telemetry-v1\.js/);
assert.ok(html.indexOf('posthog-telemetry-v1.js')<html.indexOf('app.js'),'SDK bridge must precede app');
assert.match(app,/id="studentPin" type="password" class="ph-no-capture"/,'PIN must never be plain text');
assert.match(app,/FLHTelemetry\?\.identifyLearner/);
assert.ok(exam.includes('question_index:questionNo'), 'async exam save must preserve selected question index');
for(const event of ['flh_learning_started','flh_learning_question_viewed','flh_learning_answer','flh_learning_hint','flh_learning_completed']) {
  assert.ok(learning.includes(event), 'Learning event missing: '+event);
}
for(const event of ['flh_exam_started','flh_exam_question_viewed','flh_exam_answer_saved','flh_exam_flag_changed','flh_exam_completed']) {
  assert.ok(exam.includes(event),'Exam event missing: '+event);
}
console.log('FLH PostHog telemetry: PASS (EU host, origin isolation, sensitive field guards, learner switching, academic events, PIN protection).');
