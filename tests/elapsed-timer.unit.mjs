import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context={};context.globalThis=context;
vm.runInNewContext(fs.readFileSync(new URL('../elapsed-timer-v1.js',import.meta.url),'utf8'),context);
const api=context.FLHElapsedTimer;
for(const [value,expected] of [[0,'00:00'],[999,'00:00'],[65000,'01:05'],[3599000,'59:59'],[3600000,'01:00:00'],[3661000,'01:01:01'],[-1,'00:00'],[Infinity,'00:00']])assert.equal(api.format(value),expected);

let clock=0,nextId=0;
const intervals=new Map();
const dependencies={now:()=>clock,setInterval:(callback,delay)=>{assert.equal(delay,1000);const id=++nextId;intervals.set(id,callback);return id;},clearInterval:id=>intervals.delete(id)};
const tick=()=>[...intervals.values()].forEach(callback=>callback());
const element=()=>({isConnected:true,textContent:''});
const learning=api.create(dependencies);
learning.activate('attempt:q1');let target=element();learning.attach(target);
assert.equal(target.textContent,'00:00');assert.equal(intervals.size,1);
clock=65000;tick();assert.equal(target.textContent,'01:05');
// Selection, hints, feedback and retries all mount the same question again.
for(const action of ['selection','hint','feedback','retry']){
  learning.activate('attempt:q1');target.isConnected=false;target=element();learning.attach(target);
  assert.equal(target.textContent,'01:05',`${action} must retain the question start`);assert.equal(intervals.size,1);
}
learning.activate('attempt:q2');learning.attach(target);assert.equal(target.textContent,'00:00');
clock=67000;tick();assert.equal(target.textContent,'00:02');
learning.stop();assert.equal(intervals.size,0);
learning.attach(target);assert.equal(target.textContent,'00:02','Temporary hiding must not rewrite the active question start');

clock=Date.parse('2026-10-08T12:02:05Z');
const exam=api.create(dependencies);assert.equal(intervals.size,0,'Starting another mode disposes the previous interval');
exam.activate('exam-attempt','2026-10-08T12:00:00Z');target=element();exam.attach(target);assert.equal(target.textContent,'02:05','Resume uses the authoritative server timestamp');
clock+=3000;exam.activate('exam-attempt','2026-10-08T12:00:00Z');target=element();exam.attach(target);assert.equal(target.textContent,'02:08','Exam navigation must retain the attempt start');
target.isConnected=false;tick();assert.equal(intervals.size,0,'Navigation out of the mode must stop detached UI work');
exam.dispose();exam.attach(element());assert.equal(intervals.size,0,'Disposed runtimes must not restart an interval');
const missing=api.create(dependencies);missing.activate('missing-server-time',null);target=element();missing.attach(target);assert.equal(target.textContent,'--:--','Missing server timing must not be invented');missing.dispose();assert.equal(intervals.size,0);
console.log('Elapsed timer unit QA passed: question identity continuity, authoritative Exam resume, clock formatting and interval disposal.');
