import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath='supabase/migrations/20261007121049_reward_policy_calibration_v1_3.sql';
const migration=fs.readFileSync(migrationPath,'utf8').replace(/\r\n/g,'\n');

function sqlStatement(keyword, anchor, label) {
  const at=migration.indexOf(anchor);
  assert.notEqual(at,-1,`${label}: anchor must exist`);
  const start=migration.lastIndexOf(keyword,at);
  assert.notEqual(start,-1,`${label}: ${keyword} must precede anchor`);
  const end=migration.indexOf(';',at);
  assert.notEqual(end,-1,`${label}: statement must end with semicolon`);
  return migration.slice(start,end+1).replace(/\s+/g,' ').trim();
}

const prayerCases=[
  ['صلاة الفجر في وقتها',7,1,2,2,2,1],
  ['صلاة الظهر في وقتها',4,1,1,1,2,1],
  ['صلاة العصر في وقتها',6,1,1,1,0,1],
  ['صلاة المغرب في وقتها',4,1,1,1,2,1],
  ['صلاة العشاء في وقتها',4,1,1,1,2,1],
];

for(const [title,base,initiative,congregation,mosque,sunnah,adhkar] of prayerCases){
  const statement=sqlStatement('update public.behavior_rules',`where workspace_id=v_workspace and title='${title}'`,title);
  assert.match(statement,/^update public\.behavior_rules set /i,`${title} policy must be an UPDATE statement`);
  for(const [field,value] of [
    ['base_points',base],['initiative_bonus_points',initiative],
    ['congregation_bonus_points',congregation],['mosque_bonus_points',mosque],
    ['sunnah_bonus_points',sunnah],['adhkar_bonus_points',adhkar],
  ]){
    assert.match(statement,new RegExp(`\\b${field}\\s*=\\s*${value}\\b`),`${title} must set ${field}=${value}`);
  }
}

for(const [title,expected] of [
  ['ترتيب الغرفة والأغراض الشخصية',['base_points',5,'initiative_bonus_points',3]],
  ['مساعدة حقيقية في المنزل',['base_points',5]],
  ['اللعب مع الإخوة لمدة ساعة',['base_points',10,'initiative_bonus_points',5]],
]){
  const statement=sqlStatement('update public.behavior_rules',`where workspace_id=v_workspace and title='${title}'`,title);
  for(let i=0;i<expected.length;i+=2){
    assert.match(statement,new RegExp(`\\b${expected[i]}\\s*=\\s*${expected[i+1]}\\b`),`${title} must set ${expected[i]}=${expected[i+1]}`);
  }
}
assert.match(migration,/مساعدة حقيقية في عمل منزلي مفيد لمدة لا تقل عن ٣٠ دقيقة/,'household help must state the 30-minute minimum');

function assertUpdateReward(title,points,level=null) {
  const update=sqlStatement('update public.gamification_rewards',`where workspace_id=v_workspace and title='${title}'`,`${title} UPDATE`);
  assert.match(update,new RegExp(`\\brequired_reward_points\\s*=\\s*${points}\\b`),`${title} UPDATE must set required_reward_points=${points}`);
  if(level!==null) assert.match(update,new RegExp(`\\brequired_level\\s*=\\s*${level}\\b`),`${title} UPDATE must set required_level=${level}`);
}

function assertInsertReward(title,points,level=null) {
  const insert=sqlStatement('insert into public.gamification_rewards',`values(gen_random_uuid(),v_workspace,'${title}'`,`${title} INSERT`);
  if(level===null){
    assert.match(
      insert,
      new RegExp(`insert into public\\.gamification_rewards\\(id,workspace_id,title,description,reward_type,required_reward_points,parent_approval_required,is_active,learner_scope\\) values\\(gen_random_uuid\\(\\),v_workspace,'${title}'[^;]*,'[^']+',${points},true,true,'all'\\)`),
      `${title} INSERT must place ${points} in required_reward_points`
    );
  } else {
    assert.match(
      insert,
      new RegExp(`insert into public\\.gamification_rewards\\(id,workspace_id,title,description,reward_type,required_level,required_reward_points,parent_approval_required,is_active,learner_scope\\) values\\(gen_random_uuid\\(\\),v_workspace,'${title}'[^;]*,'[^']+',${level},${points},true,true,'all'\\)`),
      `${title} INSERT must place level ${level} and ${points} in their exact columns`
    );
  }
}

assertInsertReward('سهرة بالبيت',200);
assertUpdateReward('سهرة بالبيت',200);
assertInsertReward('حلوى خارج البيت',300);
assertUpdateReward('حلوى خارج البيت',300);
assertUpdateReward('بوط رياضة جديد',800);
assertInsertReward('رحلة إلى مدينة ألعاب',1500,5);
assertUpdateReward('رحلة إلى مدينة ألعاب',1500,5);
assertUpdateReward('البدء بتعلم قيادة السيارة',1500);

assert.match(migration,/if v_percentage >= 70 then\s+v_xp_award := v_xp_award \+ 20;\s+end if;\s+if v_percentage >= 80 then\s+v_reward_points_award := v_reward_points_award \+ 5;/s,'Learning XP remains at 70 while bonus Reward Points move to 80');
assert.doesNotMatch(migration,/FLH_V13_[A-Z_]+_MISSING/,'clean rebuilds must not require operational family rows that were historically created outside migrations');

console.log('Reward policy v1.3 migration contract passed.');
