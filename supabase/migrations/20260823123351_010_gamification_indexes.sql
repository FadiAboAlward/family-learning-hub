create index if not exists gamification_levels_workspace_fk_idx on public.gamification_levels(workspace_id);
create index if not exists gamification_events_learner_workspace_fk_idx on public.gamification_events(learner_id, workspace_id);
create index if not exists learner_badges_learner_workspace_fk_idx on public.learner_badges(learner_id, workspace_id);
create index if not exists gamification_rewards_image_asset_idx on public.gamification_rewards(image_asset_id);
create index if not exists reward_claims_learner_workspace_fk_idx on public.reward_claims(learner_id, workspace_id);
create index if not exists reward_claims_reviewed_by_idx on public.reward_claims(reviewed_by);
