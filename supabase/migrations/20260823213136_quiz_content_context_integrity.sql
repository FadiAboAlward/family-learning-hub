-- Keep quiz curriculum/subject/book/unit/lesson context internally consistent.
create or replace function private.enforce_quiz_content_context()
returns trigger
language plpgsql
security definer
set search_path=public,private
as $$
declare
  b_subject bigint;
  b_curriculum uuid;
  u_book uuid;
  l_book uuid;
  l_unit uuid;
begin
  if new.book_id is not null then
    select subject_id,curriculum_id into b_subject,b_curriculum from public.books where id=new.book_id;
    if b_subject is null then raise exception 'QUIZ_BOOK_NOT_FOUND'; end if;
    if new.subject_id is distinct from b_subject then
      raise exception 'QUIZ_SUBJECT_BOOK_MISMATCH';
    end if;
    if new.curriculum_id is null then
      new.curriculum_id := b_curriculum;
    elsif b_curriculum is not null and new.curriculum_id is distinct from b_curriculum then
      raise exception 'QUIZ_CURRICULUM_BOOK_MISMATCH';
    end if;
  end if;

  if new.unit_id is not null then
    select book_id into u_book from public.units where id=new.unit_id;
    if u_book is null then raise exception 'QUIZ_UNIT_NOT_FOUND'; end if;
    if new.book_id is null then new.book_id := u_book;
    elsif new.book_id is distinct from u_book then raise exception 'QUIZ_UNIT_BOOK_MISMATCH'; end if;
  end if;

  if new.lesson_id is not null then
    select book_id,unit_id into l_book,l_unit from public.lessons where id=new.lesson_id;
    if l_book is null then raise exception 'QUIZ_LESSON_NOT_FOUND'; end if;
    if new.book_id is null then new.book_id := l_book;
    elsif new.book_id is distinct from l_book then raise exception 'QUIZ_LESSON_BOOK_MISMATCH'; end if;
    if new.unit_id is not null and l_unit is not null and new.unit_id is distinct from l_unit then
      raise exception 'QUIZ_LESSON_UNIT_MISMATCH';
    end if;
  end if;

  if new.book_id is not null then
    select subject_id,curriculum_id into b_subject,b_curriculum from public.books where id=new.book_id;
    if new.subject_id is distinct from b_subject then raise exception 'QUIZ_SUBJECT_BOOK_MISMATCH'; end if;
    if new.curriculum_id is null then new.curriculum_id := b_curriculum;
    elsif b_curriculum is not null and new.curriculum_id is distinct from b_curriculum then raise exception 'QUIZ_CURRICULUM_BOOK_MISMATCH'; end if;
  end if;
  return new;
end $$;

drop trigger if exists enforce_quiz_content_context on public.quizzes;
create trigger enforce_quiz_content_context
before insert or update of book_id,unit_id,lesson_id,subject_id,curriculum_id on public.quizzes
for each row execute function private.enforce_quiz_content_context();

create or replace function private.enforce_lesson_unit_book_context()
returns trigger
language plpgsql
security definer
set search_path=public,private
as $$
declare u_book uuid;
begin
  if new.unit_id is not null then
    select book_id into u_book from public.units where id=new.unit_id;
    if u_book is null then raise exception 'LESSON_UNIT_NOT_FOUND'; end if;
    if new.book_id is distinct from u_book then raise exception 'LESSON_UNIT_BOOK_MISMATCH'; end if;
  end if;
  return new;
end $$;

drop trigger if exists enforce_lesson_unit_book_context on public.lessons;
create trigger enforce_lesson_unit_book_context
before insert or update of book_id,unit_id on public.lessons
for each row execute function private.enforce_lesson_unit_book_context();

update public.quizzes q
set curriculum_id=b.curriculum_id, updated_at=now()
from public.books b
where q.book_id=b.id
  and q.curriculum_id is null
  and b.curriculum_id is not null;

insert into public.program_quizzes (workspace_id,program_id,quiz_id,program_subject_id,availability,sort_order,metadata)
select p.workspace_id,p.id,q.id,ps.id,'available',
       row_number() over (order by coalesce(u.sort_order,999),q.created_at,q.slug)::int,
       jsonb_build_object('derived_from_program_book',true)
from public.learning_programs p
join public.program_books pb on pb.program_id=p.id
join public.books b on b.id=pb.book_id
join public.quizzes q on q.workspace_id=p.workspace_id and q.book_id=b.id and q.status='active'
join public.program_subjects ps on ps.program_id=p.id and ps.subject_id=q.subject_id
left join public.units u on u.id=q.unit_id
where p.slug='syrian-g5-2025-2026'
on conflict (program_id,quiz_id) do update
set program_subject_id=excluded.program_subject_id,availability='available',updated_at=now();
