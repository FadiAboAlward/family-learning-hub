-- Allow learner PIN verifiers to accept 8–10 numeric digits while preserving
-- existing 8-digit credentials. The frontend may normalize a 10-digit family
-- phone number to the existing 8-digit verifier format for backward compatibility.
create or replace function public.verify_and_upgrade_learner_pin(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_pin text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r public.learner_access_tokens%rowtype;
  legacy_sha text;
begin
  if p_pin is null or p_pin !~ '^\d{8,10}$' then return null; end if;
  legacy_sha := encode(extensions.digest(convert_to(p_pin, 'UTF8'), 'sha256'), 'hex');
  for r in
    select * from public.learner_access_tokens
    where workspace_id=p_workspace_id and learner_id=p_learner_id and revoked_at is null
      and (expires_at is null or expires_at>now())
    order by created_at desc
  loop
    if r.token_hash like '$2%' then
      if extensions.crypt(p_pin,r.token_hash)=r.token_hash then
        update public.learner_access_tokens set last_used_at=now() where id=r.id;
        return r.id;
      end if;
    elsif r.token_hash=legacy_sha then
      update public.learner_access_tokens
      set token_hash=extensions.crypt(p_pin,extensions.gen_salt('bf',10)),last_used_at=now()
      where id=r.id;
      return r.id;
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.verify_and_upgrade_learner_pin(uuid,uuid,text) from public;
revoke all on function public.verify_and_upgrade_learner_pin(uuid,uuid,text) from anon,authenticated;
grant execute on function public.verify_and_upgrade_learner_pin(uuid,uuid,text) to service_role;

insert into public.workspace_settings(workspace_id,key,value,description)
select id,'security.learner_pin_hashing','{"current":"bcrypt","cost":10,"legacy":"sha256","upgrade_strategy":"upgrade_on_successful_login","pin_format":"8_to_10_digits"}'::jsonb,
'Learner PIN hashes use bcrypt; login accepts 8 to 10 numeric digits so a memorized family phone number can be used when desired.'
from public.workspaces where slug='family-learning-hub'
on conflict(workspace_id,key) do update set value=excluded.value,description=excluded.description,updated_at=now();
