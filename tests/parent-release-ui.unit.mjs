import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const source=fs.readFileSync('parent-center-v3.js','utf8');
const index=fs.readFileSync('index.html','utf8');
for(const phrase of [
  "data-go=\"parent-release\"",
  "else if(h==='#parent-release')renderAssessmentRelease()",
  "if(!token()){location.hash='parents';return}",
  "const releaseUuid=",
  "const releaseHash=",
  "call(LEARNING,'read_assessment',pointer)",
  "call(ACCESS,'catalog')",
  "if(!learner)",
  "if(publication.state!=='held')",
  "window.confirm(",
  "releaseButton.disabled=true",
  "call(LEARNING,'release_assessment',pointer)",
  "checked?.publication?.state!=='released'",
  "officialAssessmentLink(released?.learning_path,'learning')",
  "officialAssessmentLink(released?.exam_path,'exam')",
  "data-release-status",
  "aria-live=\"polite\"",
]) assert.ok(source.includes(phrase),'Missing parent release requirement: '+phrase);

const start=source.indexOf('  function officialAssessmentLink(');
const end=source.indexOf('  function renderAssessmentRelease()',start);
assert.ok(start>0&&end>start,'Safe path validation helper missing');
const helper=source.slice(start,end);
const origin='https://fadiaboalward.github.io/family-learning-hub/';
const link=vm.runInNewContext(helper+'; officialAssessmentLink;',{
 URL,location:{href:origin+'#parent-release'}
});
const valid='index.html?quiz=managed-reviewed&mode=learning&learner=aya';
assert.equal(link(valid,'learning'),origin+valid);
for(const [path,mode] of [
 ['https://attacker.invalid/fake','learning'],
 ['//attacker.invalid/fake','learning'],
 ['https://fadiaboalward.github.io/family-learning-hub/other.html?quiz=a&mode=learning&learner=aya','learning'],
 ['index.html?quiz=x&mode=exam&learner=aya','learning'],
 ['index.html?quiz=x&mode=learning','learning'],
 ['index.html?mode=learning&learner=aya','learning'],
 ['index.html?quiz=x&mode=learning&learner=aya#fragment','learning'],
 ['', 'learning']
]) assert.equal(link(path,mode),null,'Unsafe/unapproved link accepted: '+path);
assert.equal(link('index.html?quiz=x&mode=exam&learner=mohammad','exam'),origin+'index.html?quiz=x&mode=exam&learner=mohammad');

assert.ok(source.indexOf("call(LEARNING,'read_assessment',pointer)")<source.indexOf("call(LEARNING,'release_assessment',pointer)"),'Read-before-release proof missing');
assert.doesNotMatch(source,/publication\.candidate\b/, 'Do not show answer keys/content');
assert.ok(!source.includes('console.log(')&&!source.includes('console.error('), 'Do not log private assessment data');
assert.ok(!source.includes('service_role')&&!source.includes('flh_assessment_command('),'Do not use service credentials/SQL in frontend');
assert.ok(!source.includes("call(LEARNING,'prepare_assessment_delivery'"),'Email actions are out of UI scope');
assert.ok(index.includes('20261016-flh031'),'Frontend cache version must reflect new UI');
console.log('FLH-031 parent release UI: static + safe-link contract PASS (authenticated browser QA pending)');
