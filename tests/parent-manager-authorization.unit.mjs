import fs from "node:fs";

const activity = fs.readFileSync("supabase/functions/activity-api/index.ts", "utf8").replace(/\s+/g, "");
const family = fs.readFileSync("supabase/functions/family-api/index.ts", "utf8").replace(/\s+/g, "");

const activityGuard = 'if(!m||!["owner","admin","teacher"].includes(m.role))thrownewError("NOT_A_PARENT_MEMBER")';
const familyGuard = 'if(!member||!["owner","admin","teacher"].includes(member.role))thrownewError("NOT_A_PARENT_MEMBER")';

if (!activity.includes(activityGuard)) {
  throw new Error("activity-api parent endpoints are not restricted to owner/admin/teacher");
}
if (!family.includes(familyGuard)) {
  throw new Error("family-api parent_dashboard is not restricted to owner/admin/teacher");
}

for (const action of ["parent_session_summary", "parent_sessions_query", "parent_sessions"]) {
  if (!activity.includes(`if(a==="${action}"){awaitparentUser(req);`)) {
    throw new Error(`activity-api ${action} is not guarded by parentUser before service-role reads`);
  }
}
if (!family.includes('if(action==="parent_dashboard"){const{user,member}=awaitparentUser(req);')) {
  throw new Error("family-api parent_dashboard is not guarded by parentUser before service-role reads");
}

console.log("parent manager authorization guard: PASS");
