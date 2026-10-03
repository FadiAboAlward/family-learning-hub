-- FLH-FEAT-2026-019 / SPEC_VERSION 1.0
-- Forward-only hygiene hardening for the stable public question-code trigger.
-- Preserve behavior and SECURITY INVOKER semantics; only pin name resolution.

create or replace function public.assign_question_public_code()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.question_code is null or btrim(new.question_code) = '' then
    new.question_code := 'Q-' || lpad(nextval('public.question_public_code_seq')::text, 6, '0');
  end if;
  return new;
end;
$function$;
