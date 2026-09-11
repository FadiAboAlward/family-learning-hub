insert into public.gamification_badges (workspace_id, code, title, description, icon, criteria)
select w.id, v.code, v.title, v.description, v.icon, v.criteria
from public.workspaces w
cross join (values
  ('first-try', 'من أول محاولة', 'أجاب عن مجموعة من الأسئلة من أول محاولة.', '🎯', jsonb_build_object('signal','first_try_correct')),
  ('keep-going', 'ما استسلمت', 'استمر بالتعلم وأكمل بعد محاولات وتلميحات.', '💪', jsonb_build_object('signal','effort')),
  ('concept-master', 'أتقنت المفهوم', 'وصل إلى إتقان واضح في مفهوم تعليمي.', '🧠', jsonb_build_object('signal','mastery')),
  ('steady-learner', 'استمرارية جميلة', 'حافظ على عادة تعلم منتظمة.', '🔥', jsonb_build_object('signal','consistency'))
) as v(code,title,description,icon,criteria)
where w.slug='ayaa-school'
on conflict (workspace_id, code) do nothing;
