update public.program_quizzes pq
set availability='archived', updated_at=now(), metadata=pq.metadata || '{"legacy_exam_retired":true}'::jsonb
from public.quizzes q
where q.id=pq.quiz_id
  and q.workspace_id=pq.workspace_id
  and q.slug='fractions-pages-54-57-exam';

update public.quiz_versions qv
set state='retired', updated_at=now()
from public.quizzes q
where q.id=qv.quiz_id
  and q.workspace_id=qv.workspace_id
  and q.slug='fractions-pages-54-57-exam'
  and qv.state='published';

update public.quizzes
set status='archived', updated_at=now()
where slug='fractions-pages-54-57-exam';

insert into public.workspace_settings (workspace_id,key,value,description)
select id,
       'architecture.legacy_exam_retired',
       '{"quiz_slug":"fractions-pages-54-57-exam","replacement":"exam-v2-api","retired":true}'::jsonb,
       'Legacy hard-coded fractions exam is archived; Exam V2 is the supported program-scoped exam path.'
from public.workspaces
where slug='family-learning-hub'
on conflict (workspace_id,key) do update
set value=excluded.value,description=excluded.description,updated_at=now();
