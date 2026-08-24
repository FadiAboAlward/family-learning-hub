create sequence if not exists public.question_public_code_seq;

alter table public.quiz_questions add column if not exists question_code text;

with numbered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.quiz_questions
  where question_code is null
)
update public.quiz_questions q
set question_code = 'Q-' || lpad(numbered.rn::text, 6, '0')
from numbered
where q.id = numbered.id;

select setval('public.question_public_code_seq', greatest(coalesce((select max(substring(question_code from 3)::bigint) from public.quiz_questions where question_code ~ '^Q-[0-9]+$'), 0), 1), true);

create or replace function public.assign_question_public_code()
returns trigger
language plpgsql
as $$
begin
  if new.question_code is null or btrim(new.question_code) = '' then
    new.question_code := 'Q-' || lpad(nextval('public.question_public_code_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_question_public_code on public.quiz_questions;
create trigger trg_assign_question_public_code
before insert on public.quiz_questions
for each row execute function public.assign_question_public_code();

alter table public.quiz_questions alter column question_code set not null;
create unique index if not exists quiz_questions_question_code_uidx on public.quiz_questions(question_code);

alter table public.quiz_questions drop constraint if exists quiz_questions_question_code_format;
alter table public.quiz_questions add constraint quiz_questions_question_code_format check (question_code ~ '^Q-[0-9]{6,}$');

create or replace view public.question_reference_lookup
with (security_invoker = true)
as
select
  q.question_code,
  q.id as question_id,
  q.prompt,
  q.origin,
  q.source_page_start,
  q.source_page_end,
  q.source_metadata,
  q.delivery_role,
  q.difficulty_level,
  z.slug as quiz_slug,
  z.title as quiz_title,
  b.code as book_code,
  b.title as book_title,
  u.slug as unit_slug,
  u.title as unit_title
from public.quiz_questions q
join public.quiz_versions v on v.id = q.quiz_version_id and v.workspace_id = q.workspace_id
join public.quizzes z on z.id = v.quiz_id and z.workspace_id = q.workspace_id
left join public.books b on b.id = z.book_id
left join public.units u on u.id = z.unit_id;

revoke all on public.question_reference_lookup from anon, authenticated;
grant select on public.question_reference_lookup to service_role;
