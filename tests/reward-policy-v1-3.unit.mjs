import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath='supabase/migrations/20261007121049_reward_policy_calibration_v1_3.sql';
const migration=fs.readFileSync(migrationPath,'utf8').replace(/\r\n/g,'\n');

const prayerCases=[
  ['صلاة الفجر في وقتها',7,1,2,2,2,1],
  ['صلاة الظهر في وقتها',4,1,1,1,2,1],
  ['صلاة العصر في وقتها',6,1,1,1,0,1],
  ['صلاة المغرب في وقتها',4,1,1,1,2,1],
  ['صلاة العشاء في وقتها',4,1,1,1,2,1],
];

for(const [title,base,initiative,congregation,mosque,sunnah,adhkar] of prayerCases){
  const titleIndex=migration.indexOf(`title='${title}'`);
  assert.notEqual(titleIndex,-1,`migration must target ${title}`);
  const window=migration.slice(Math.max(0,titleIndex-650),titleIndex+100);
  for(const [field,value] of [
    ['base_points',base],['initiative_bonus_points',initiative],
    ['congregation_bonus_points',congregation],['mosque_bonus_points',mosque],
    ['sunnah_bonus_points',sunnah],['adhkar_bonus_points',adhkar],
  ]){
    assert.match(window,new RegExp(`${field}\\s*=\\s*${value}\\b`),`${title} must set ${field}=${value}`);
  }
}

for(const [title,expected] of [
  ['ترتيب الغرفة والأغراض الشخصية','base_points=5, initiative_bonus_points=3'],
  ['مساعدة حقيقية في المنزل','base_points=5'],
  ['اللعب مع الإخوة لمدة ساعة','base_points=10, initiative_bonus_points=5'],
]){
  const titleIndex=migration.indexOf(`title='${title}'`);
  assert.notEqual(titleIndex,-1,`migration must target ${title}`);
  const window=migration.slice(Math.max(0,titleIndex-450),titleIndex+100).replace(/\s+/g,' ');
  assert.ok(window.includes(expected),`${title} must preserve the approved point policy`);
}
assert.match(migration,/مساعدة حقيقية في عمل منزلي مفيد لمدة لا تقل عن ٣٠ دقيقة/,'household help must state the 30-minute minimum');

for(const [title,points,level] of [
  ['سهرة بالبيت',200,null],
  ['حلوى خارج البيت',300,null],
  ['بوط رياضة جديد',800,null],
  ['رحلة إلى مدينة ألعاب',1500,5],
  ['البدء بتعلم قيادة السيارة',1500,null],
]){
  const idx=migration.indexOf(`title='${title}'`);
  const alt=migration.indexOf(`,'${title}'`);
  assert.ok(idx>=0 || alt>=0,`migration must target reward ${title}`);
  const at=Math.max(idx,alt);
  const window=migration.slice(Math.max(0,at-700),at+700);
  assert.match(window,new RegExp(`required_reward_points\\s*=\\s*${points}\\b|'${title.replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&')}'[^;]{0,350}\\b${points}\\b`),`${title} must cost ${points}`);
  if(level!==null) assert.match(window,/required_level\s*=\s*5\b|رحلة إلى مدينة ألعاب[^;]{0,350}'outing',5,1500/,'amusement park must require level 5');
}

assert.match(migration,/if v_percentage >= 70 then\s+v_xp_award := v_xp_award \+ 20;\s+end if;\s+if v_percentage >= 80 then\s+v_reward_points_award := v_reward_points_award \+ 5;/s,'Learning XP remains at 70 while bonus Reward Points move to 80');
assert.doesNotMatch(migration,/FLH_V13_[A-Z_]+_MISSING/,'clean rebuilds must not require operational family rows that were historically created outside migrations');

console.log('Reward policy v1.3 migration contract passed.');
