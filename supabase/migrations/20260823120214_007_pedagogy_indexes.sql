create index if not exists learner_instruction_profiles_workspace_idx on public.learner_instruction_profiles(workspace_id);
create index if not exists feedback_templates_workspace_idx on public.feedback_templates(workspace_id);
create index if not exists explanation_sets_workspace_idx on public.explanation_sets(workspace_id);
create index if not exists explanation_blocks_workspace_idx on public.explanation_blocks(workspace_id);
create index if not exists explanation_blocks_asset_idx on public.explanation_blocks(asset_id);
