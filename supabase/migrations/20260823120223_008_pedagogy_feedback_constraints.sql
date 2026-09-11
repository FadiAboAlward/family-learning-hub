alter table public.quiz_answer_attempts
  add constraint quiz_answer_attempts_hint_feedback_consistency
  check (hint_level_shown is null or hint_level_shown between 1 and 4);

alter table public.explanation_blocks
  add constraint explanation_blocks_asset_required_for_media
  check (
    block_type not in ('image','audio','video','diagram')
    or asset_id is not null
    or content ? 'url'
  );
