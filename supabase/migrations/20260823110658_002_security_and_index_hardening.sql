-- Manager-only access for sensitive tables while keeping them hidden from ordinary authenticated users.
grant select, insert, update, delete on public.quiz_question_answer_keys, public.learner_access_tokens to authenticated;

create policy answer_keys_manage on public.quiz_question_answer_keys
for all to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy learner_access_tokens_manage on public.learner_access_tokens
for all to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));

-- Replace overlapping ALL+SELECT policies with write-only manager policies.
drop policy if exists learners_manage on public.learners;
create policy learners_insert on public.learners for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy learners_update on public.learners for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy learners_delete on public.learners for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists quizzes_manage on public.quizzes;
create policy quizzes_insert on public.quizzes for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quizzes_update on public.quizzes for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quizzes_delete on public.quizzes for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists quiz_versions_manage on public.quiz_versions;
create policy quiz_versions_insert on public.quiz_versions for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_versions_update on public.quiz_versions for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_versions_delete on public.quiz_versions for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists quiz_questions_manage on public.quiz_questions;
create policy quiz_questions_insert on public.quiz_questions for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_questions_update on public.quiz_questions for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_questions_delete on public.quiz_questions for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists quiz_question_options_manage on public.quiz_question_options;
create policy quiz_question_options_insert on public.quiz_question_options for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_question_options_update on public.quiz_question_options for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_question_options_delete on public.quiz_question_options for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists assets_manage on public.assets;
create policy assets_insert on public.assets for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy assets_update on public.assets for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy assets_delete on public.assets for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists quiz_question_assets_manage on public.quiz_question_assets;
create policy quiz_question_assets_insert on public.quiz_question_assets for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_question_assets_update on public.quiz_question_assets for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_question_assets_delete on public.quiz_question_assets for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists quiz_assignments_manage on public.quiz_assignments;
create policy quiz_assignments_insert on public.quiz_assignments for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_assignments_update on public.quiz_assignments for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_assignments_delete on public.quiz_assignments for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists quiz_attempts_manage on public.quiz_attempts;
create policy quiz_attempts_insert on public.quiz_attempts for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_attempts_update on public.quiz_attempts for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_attempts_delete on public.quiz_attempts for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

drop policy if exists quiz_attempt_answers_manage on public.quiz_attempt_answers;
create policy quiz_attempt_answers_insert on public.quiz_attempt_answers for insert to authenticated
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_attempt_answers_update on public.quiz_attempt_answers for update to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())))
with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy quiz_attempt_answers_delete on public.quiz_attempt_answers for delete to authenticated
using (private.can_manage_learning(workspace_id, (select auth.uid())));

-- Cover foreign keys used by joins/deletes and future RLS/analytics queries.
create index if not exists workspaces_created_by_idx on public.workspaces(created_by);
create index if not exists quizzes_book_id_idx on public.quizzes(book_id);
create index if not exists quizzes_lesson_id_idx on public.quizzes(lesson_id);
create index if not exists quizzes_created_by_idx on public.quizzes(created_by);
create index if not exists quiz_versions_created_by_idx on public.quiz_versions(created_by);
create index if not exists quiz_versions_quiz_workspace_idx on public.quiz_versions(quiz_id, workspace_id);
create index if not exists quiz_questions_version_workspace_idx on public.quiz_questions(quiz_version_id, workspace_id);
create index if not exists quiz_question_options_question_workspace_idx on public.quiz_question_options(question_id, workspace_id);
create index if not exists quiz_question_answer_keys_question_workspace_idx on public.quiz_question_answer_keys(question_id, workspace_id);
create index if not exists assets_source_book_idx on public.assets(source_book_id);
create index if not exists quiz_question_assets_asset_workspace_idx on public.quiz_question_assets(asset_id, workspace_id);
create index if not exists quiz_question_assets_question_workspace_idx on public.quiz_question_assets(question_id, workspace_id);
create index if not exists quiz_assignments_assigned_by_idx on public.quiz_assignments(assigned_by);
create index if not exists quiz_assignments_learner_workspace_idx on public.quiz_assignments(learner_id, workspace_id);
create index if not exists quiz_assignments_version_workspace_idx on public.quiz_assignments(quiz_version_id, workspace_id);
create index if not exists quiz_attempts_assignment_idx on public.quiz_attempts(assignment_id);
create index if not exists quiz_attempts_learner_workspace_idx on public.quiz_attempts(learner_id, workspace_id);
create index if not exists quiz_attempts_version_workspace_idx on public.quiz_attempts(quiz_version_id, workspace_id);
create index if not exists quiz_attempt_answers_attempt_workspace_idx on public.quiz_attempt_answers(attempt_id, workspace_id);
create index if not exists quiz_attempt_answers_question_workspace_idx on public.quiz_attempt_answers(question_id, workspace_id);
create index if not exists learner_access_tokens_learner_workspace_idx on public.learner_access_tokens(learner_id, workspace_id);
