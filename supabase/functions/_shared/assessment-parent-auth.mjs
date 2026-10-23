/** Preserve the application's existing live parent identity and membership checks. */
export async function assessmentParent(admin,workspaceId,req) {
  const auth=req.headers.get('authorization')||'';
  if(!auth.startsWith('Bearer ')) throw new Error('AUTH_REQUIRED');
  const {data,error}=await admin.auth.getUser(auth.slice(7).trim());
  if(error||!data?.user) throw new Error('INVALID_PARENT_SESSION');
  const {data:membership,error:membershipError}=await admin.from('workspace_members').select('role').eq('workspace_id',workspaceId).eq('user_id',data.user.id).maybeSingle();
  if(membershipError||!membership||!['owner','admin'].includes(membership.role)) throw new Error('VIDEO_ATTACHMENT_FORBIDDEN');
  return data.user.id;
}
