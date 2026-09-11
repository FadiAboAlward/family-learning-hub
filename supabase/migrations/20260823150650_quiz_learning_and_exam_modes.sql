alter table public.quizzes add column if not exists delivery_config jsonb not null default '{"learning":{"instant_feedback":true,"hints":true,"retry":true},"exam":{"question_count":10,"instant_feedback":false,"hints":false,"retry":false,"show_results_after_submit":true}}'::jsonb;

alter table public.quiz_attempts add column if not exists delivery_mode text not null default 'learning';

do $$ begin
  if not exists (select 1 from pg_constraint where conname='quiz_attempts_delivery_mode_check') then
    alter table public.quiz_attempts add constraint quiz_attempts_delivery_mode_check check (delivery_mode in ('learning','exam'));
  end if;
end $$;

update public.quizzes set delivery_config = jsonb_build_object(
  'learning', jsonb_build_object('instant_feedback',true,'hints',true,'retry',true,'progressive_hints',true,'remediation',true),
  'exam', jsonb_build_object('question_count',10,'instant_feedback',false,'hints',false,'retry',false,'show_results_after_submit',true,'show_question_review',true)
) where slug='fractions-pages-54-57';
