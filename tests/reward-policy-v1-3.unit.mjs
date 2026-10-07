import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath='supabase/migrations/20261007121049_reward_policy_calibration_v1_3.sql';
const migration=fs.readFileSync(migrationPath,'utf8').replace(/\r\n/g,'\n');

function sqlStatement(keyword, anchor, label) {
  let cursor=0;
  while (true) {
    const at=migration.indexOf(anchor,cursor);
    assert.notEqual(at,-1,`${label}: anchor must exist in a ${keyword} statement`);
    const boundary=migration.lastIndexOf(';',at)+1;
    const start=migration.lastIndexOf(keyword,at);
    if(start>=boundary){
      const end=migration.indexOf(';',at);
      assert.notEqual(end,-1,`${label}: statement must end with semicolon`);
      return migration.slice(start,end+1).replace(/\s+/g,' ').trim();
    }
    cursor=at+anchor.length;
  }
}

function assertStableId(varName,id,label){
  assert.match(
    migration,
    new RegExp(`\\b${varName}\\s+constant\\s+uuid\\s*:=\\s*'${id}'`),
    `${label} must pin its production identity`
  );
}

const prayerCases=[
  ['v_fajr_rule','93174762-2abd-4e69-be49-9ac6eeb7fb01','صلاة الفجر في وقتها',7,1,2,2,2,1],
  ['v_dhuhr_rule','8cd3abe7-6f22-4aad-abad-764fe635eec0','صلاة الظهر في وقتها',4,1,1,1,2,1],
  ['v_asr_rule','0a574bed-ff67-48c0-95d3-b4c6d42c2595','صلاة العصر في وقتها',6,1,1,1,0,1],
  ['v_maghrib_rule','80f5ab8a-3e3f-4514-98e2-db3587cf88fc','صلاة المغرب في وقتها',4,1,1,1,2,1],
  ['v_isha_rule','23d16dab-42e7-4e7e-85ce-d250eff71dac','صلاة العشاء في وقتها',4,1,1,1,2,1],
];

for(const [varName,id,title,base,initiative,congregation,mosque,sunnah,adhkar] of prayerCases){
  assertStableId(varName,id,title);
  const statement=sqlStatement('update public.behavior_rules',`where workspace_id=v_workspace and id=${varName}`,title);
  assert.doesNotMatch(statement,/\btitle\s*=/i,`${title} must not be calibrated by editable title`);
  for(const [field,value] of [
    ['base_points',base],['initiative_bonus_points',initiative],
    ['congregation_bonus_points',congregation],['mosque_bonus_points',mosque],
    ['sunnah_bonus_points',sunnah],['adhkar_bonus_points',adhkar],
  ]){
    assert.match(statement,new RegExp(`\\b${field}\\s*=\\s*${value}\\b`),`${title} must set ${field}=${value}`);
  }
}

for(const [varName,id,title,expected] of [
  ['v_room_rule','f74ae65c-468c-40d7-92cc-37aedcfc875f','ترتيب الغرفة والأغراض الشخصية',['base_points',5,'initiative_bonus_points',3]],
  ['v_household_rule','4f5e3b2f-5e03-4ff0-b099-02ece41f4eba','مساعدة حقيقية في المنزل',['base_points',5]],
  ['v_sibling_rule','5ab92e73-d64f-4158-ad92-62861c5c217e','اللعب مع الإخوة لمدة ساعة',['base_points',10,'initiative_bonus_points',5]],
]){
  assertStableId(varName,id,title);
  const statement=sqlStatement('update public.behavior_rules',`where workspace_id=v_workspace and id=${varName}`,title);
  assert.doesNotMatch(statement,/\btitle\s*=/i,`${title} must not be calibrated by editable title`);
  for(let i=0;i<expected.length;i+=2){
    assert.match(statement,new RegExp(`\\b${expected[i]}\\s*=\\s*${expected[i+1]}\\b`),`${title} must set ${expected[i]}=${expected[i+1]}`);
  }
}
assert.match(migration,/مساعدة حقيقية في عمل منزلي مفيد لمدة لا تقل عن ٣٠ دقيقة/,'household help must state the 30-minute minimum');

for(const [varName,id,title,points] of [
  ['v_boots_reward','109806d9-7411-49c8-97e3-85106a38970f','بوط رياضة جديد',800],
  ['v_driving_reward','4d348f05-a1e1-4ba6-afa8-9146d25817ce','البدء بتعلم قيادة السيارة',1500],
]){
  assertStableId(varName,id,title);
  const update=sqlStatement('update public.gamification_rewards',`where workspace_id=v_workspace and id=${varName}`,title);
  assert.match(update,new RegExp(`\\brequired_reward_points\\s*=\\s*${points}\\b`),`${title} must cost ${points}`);
  assert.doesNotMatch(update,/\btitle\s*=/i,`${title} must not be calibrated by editable title`);
}

function assertCanonicalReward(varName,id,title,points,level=null){
  assertStableId(varName,id,title);
  assert.match(
    migration,
    new RegExp(`title='${title}'\\s+and\\s+id<>${varName}`),
    `${title} must fail closed on a title collision with another identity`
  );
  const insert=sqlStatement('insert into public.gamification_rewards',`${varName},v_workspace,'${title}'`,`${title} INSERT`);
  if(level===null){
    assert.match(
      insert,
      new RegExp(`values\\( ${varName},v_workspace,'${title}'[^;]*,'[^']+',${points},true,true,'all' \\)`),
      `${title} INSERT must place ${points} in required_reward_points`
    );
  } else {
    assert.match(
      insert,
      new RegExp(`values\\( ${varName},v_workspace,'${title}'[^;]*,'[^']+',${level},${points},true,true,'all' \\)`),
      `${title} INSERT must place level ${level} and ${points} in their exact columns`
    );
  }
  const update=sqlStatement('update public.gamification_rewards',`where id=${varName} and workspace_id=v_workspace`,`${title} UPDATE`);
  assert.match(update,new RegExp(`\\brequired_reward_points\\s*=\\s*${points}\\b`),`${title} UPDATE must set required_reward_points=${points}`);
  if(level!==null) assert.match(update,new RegExp(`\\brequired_level\\s*=\\s*${level}\\b`),`${title} UPDATE must set required_level=${level}`);
}

assertCanonicalReward('v_home_evening_reward','c2b25b3c-26b8-43ee-9aaa-65a514d65bad','سهرة بالبيت',200);
assertCanonicalReward('v_outside_treat_reward','627d7df4-f9fb-4894-b335-994bbef24073','حلوى خارج البيت',300);
assertCanonicalReward('v_amusement_reward','18f87875-4092-4ee3-a885-da5c6e348142','رحلة إلى مدينة ألعاب',1500,5);

assert.match(migration,/if v_percentage >= 70 then\s+v_xp_award := v_xp_award \+ 20;\s+end if;\s+if v_percentage >= 80 then\s+v_reward_points_award := v_reward_points_award \+ 5;/s,'Learning XP remains at 70 while bonus Reward Points move to 80');
assert.doesNotMatch(migration,/FLH_V13_[A-Z_]+_MISSING/,'clean rebuilds must not require operational family rows that were historically created outside migrations');

console.log('Reward policy v1.3 migration contract passed.');
