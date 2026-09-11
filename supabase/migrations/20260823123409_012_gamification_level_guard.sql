alter table public.learner_gamification_state add constraint learner_gamification_streak_guard check (longest_streak >= current_streak);
