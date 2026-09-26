import fs from "node:fs";
import { canManageLearningRole } from "../supabase/functions/_shared/parent-authorization.mjs";

for (const role of ["owner", "admin", "teacher"]) {
  if (!canManageLearningRole(role)) throw new Error(`${role} should be allowed to use parent management endpoints`);
}
for (const role of ["viewer", "", null, undefined]) {
  if (canManageLearningRole(role)) throw new Error(`${String(role)} should be denied parent management access`);
}

const activity = fs.readFileSync("supabase/functions/activity-api/index.ts", "utf8").replace(/\s+/g, "");
const family = fs.readFileSync("supabase/functions/family-api/index.ts", "utf8").replace(/\s+/g, "");

if (!activity.includes('if(!m||!canManageLearningRole(m.role))thrownewError("NOT_A_PARENT_MEMBER")')) {
  throw new Error("activity-api does not enforce the shared parent manager role decision");
}
if (!family.includes('if(!member||!canManageLearningRole(member.role))thrownewError("NOT_A_PARENT_MEMBER")')) {
  throw new Error("family-api does not enforce the shared parent manager role decision");
}

for (const action of ["parent_session_summary", "parent_sessions_query", "parent_sessions"]) {
  if (!activity.includes(`if(a==="${action}"){awaitparentUser(req);`)) {
    throw new Error(`activity-api ${action} is not guarded by parentUser before service-role reads`);
  }
}
if (!family.includes('if(action==="parent_dashboard"){const{user,member}=awaitparentUser(req);')) {
  throw new Error("family-api parent_dashboard is not guarded by parentUser before service-role reads");
}

console.log("parent manager authorization behavior: PASS");
