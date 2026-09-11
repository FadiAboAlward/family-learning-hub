insert into public.workspace_settings (workspace_id,key,value)
select id,'quiz.exam_defaults','{"question_count":10,"instant_feedback":false,"hints":false,"retry":false,"show_results_after_submit":true,"show_question_review":true}'::jsonb
from public.workspaces where slug='ayaa-school'
on conflict (workspace_id,key) do update set value=excluded.value;
