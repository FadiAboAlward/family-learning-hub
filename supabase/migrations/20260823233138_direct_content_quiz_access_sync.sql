create or replace function public.sync_content_assignment_quiz_access()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_quiz record;
  v_version uuid;
begin
  if new.status='active' then
    for v_quiz in
      select q.id
      from public.quizzes q
      where q.workspace_id=new.workspace_id and q.status='active'
        and (
          (new.resource_type='book' and q.book_id=new.resource_id) or
          (new.resource_type='unit' and q.unit_id=new.resource_id) or
          (new.resource_type='quiz' and q.id=new.resource_id)
        )
    loop
      select qv.id into v_version from public.quiz_versions qv
      where qv.workspace_id=new.workspace_id and qv.quiz_id=v_quiz.id and qv.state='published'
      order by qv.version_no desc limit 1;
      if v_version is not null and not exists(
        select 1 from public.quiz_assignments qa
        where qa.workspace_id=new.workspace_id and qa.learner_id=new.learner_id
          and qa.quiz_version_id=v_version and qa.status='assigned'
      ) then
        insert into public.quiz_assignments(workspace_id,learner_id,quiz_version_id,status,available_at,assigned_by,metadata)
        values(new.workspace_id,new.learner_id,v_version,'assigned',now(),new.assigned_by,
          jsonb_build_object('direct_content_access',true,'content_assignment_id',new.id::text,'resource_type',new.resource_type,'resource_id',new.resource_id::text));
      end if;
    end loop;
  else
    update public.quiz_assignments
       set status='cancelled'
     where workspace_id=new.workspace_id and learner_id=new.learner_id and status='assigned'
       and metadata->>'content_assignment_id'=new.id::text;
  end if;
  return new;
end;
$$;

drop trigger if exists content_assignment_quiz_access_sync on public.learner_content_assignments;
create trigger content_assignment_quiz_access_sync
after insert or update of status on public.learner_content_assignments
for each row execute function public.sync_content_assignment_quiz_access();

create or replace function public.sync_published_quiz_direct_access()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  q public.quizzes%rowtype;
  a record;
begin
  if new.state<>'published' then return new; end if;
  select * into q from public.quizzes where id=new.quiz_id and workspace_id=new.workspace_id;
  if q.id is null or q.status<>'active' then return new; end if;
  for a in
    select * from public.learner_content_assignments lca
    where lca.workspace_id=new.workspace_id and lca.status='active'
      and (
        (lca.resource_type='book' and q.book_id=lca.resource_id) or
        (lca.resource_type='unit' and q.unit_id=lca.resource_id) or
        (lca.resource_type='quiz' and q.id=lca.resource_id)
      )
  loop
    if not exists(select 1 from public.quiz_assignments qa where qa.workspace_id=new.workspace_id and qa.learner_id=a.learner_id and qa.quiz_version_id=new.id and qa.status='assigned') then
      insert into public.quiz_assignments(workspace_id,learner_id,quiz_version_id,status,available_at,assigned_by,metadata)
      values(new.workspace_id,a.learner_id,new.id,'assigned',now(),a.assigned_by,
        jsonb_build_object('direct_content_access',true,'content_assignment_id',a.id::text,'resource_type',a.resource_type,'resource_id',a.resource_id::text));
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists published_quiz_direct_access_sync on public.quiz_versions;
create trigger published_quiz_direct_access_sync
after insert or update of state on public.quiz_versions
for each row execute function public.sync_published_quiz_direct_access();
