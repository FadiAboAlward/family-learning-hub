alter table public.reward_claims add constraint reward_claims_reviewed_dates_check check (reviewed_at is null or reviewed_at >= requested_at);
alter table public.reward_claims add constraint reward_claims_redeemed_dates_check check (redeemed_at is null or redeemed_at >= requested_at);
