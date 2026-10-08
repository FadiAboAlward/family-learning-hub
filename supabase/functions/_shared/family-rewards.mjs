/** Transport boundary for the pinned family rewards contract. Point decisions live in SQL. */
const parentActions = new Map([
  ['parent_rewards_dashboard', 'parent_catalog'],
  ['parent_rewards_ledger', 'parent_ledger'],
  ['parent_behavior_report', 'parent_report'],
  ...['category_save', 'rule_save', 'reward_save', 'behavior_record', 'behavior_review',
    'reward_review', 'reward_redeem', 'points_adjust', 'return_event_create'].map(action => [action, action]),
]);
const learnerActions = new Map([
  ['student_rewards_dashboard', 'student_catalog'],
  ['student_rewards_ledger', 'student_ledger'],
  ['student_behavior_report', 'student_report'],
  ['behavior_submit', 'behavior_submit'],
  ['reward_request', 'reward_request'],
]);
const fields = {
  parent_catalog: ['test_only', 'return_event_day', 'return_event_before_at', 'return_event_before_id', 'return_event_page_size'],
  student_catalog: [],
  parent_ledger: ['before_id', 'page_size', 'category_id', 'source_type'],
  student_ledger: ['before_id', 'page_size', 'category_id', 'source_type'],
  parent_report: ['period', 'category_id', 'rule_id'],
  student_report: ['period', 'category_id', 'rule_id'],
  category_save: ['id', 'title', 'description', 'is_active'],
  rule_save: ['id', 'title', 'description', 'category_id', 'base_points', 'initiative_bonus_points',
    'learner_scope', 'learner_ids', 'cadence', 'max_awards', 'self_report_allowed',
    'parent_approval_required', 'is_active'],
  reward_save: ['id', 'title', 'description', 'reward_type', 'required_level', 'required_reward_points',
    'criteria', 'learner_scope', 'learner_ids', 'is_active', 'available_from', 'available_until',
    'max_redemptions_per_learner'],
  behavior_record: ['rule_id', 'initiative', 'adhkar_completed', 'congregation_completed', 'mosque_completed', 'sunnah_completed', 'occurred_at', 'reason', 'idempotency_key', 'return_event_id'],
  behavior_submit: ['rule_id', 'initiative', 'adhkar_completed', 'congregation_completed', 'mosque_completed', 'sunnah_completed', 'occurred_at', 'reason', 'idempotency_key'],
  behavior_review: ['submission_id', 'decision', 'reason', 'return_event_id'],
  return_event_create: ['occurred_at', 'idempotency_key'],
  reward_request: ['reward_id', 'note', 'idempotency_key'],
  reward_review: ['claim_id', 'decision', 'reason'],
  reward_redeem: ['claim_id'],
  points_adjust: ['delta', 'reason', 'idempotency_key', 'reversal_event_id'],
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isFamilyRewardsAction(action) {
  return parentActions.has(action) || learnerActions.has(action);
}

export function canManageRewardsRole(role) {
  return role === 'owner' || role === 'admin';
}

/** The legacy profile must honor reward scopes too, without returning scope-member IDs. */
export function learnerProfileRewards(rows, learnerId, isTest) {
  const profileFields = ['id', 'title', 'description', 'reward_type', 'required_level',
    'required_reward_points', 'parent_approval_required'];
  return (rows || []).filter(reward =>
    (reward.learner_scope === 'all' && !isTest) ||
    (reward.learner_scope === 'selected' && reward.reward_learner_scopes?.some(scope => scope.learner_id === learnerId))
  ).map(reward => Object.fromEntries(profileFields.map(field => [field, reward[field]])));
}

/** Authenticate before forwarding any payload to the privileged transactional boundary. */
export async function executeFamilyRewardsAction(action, body, dependencies) {
  const parent = parentActions.has(action);
  const command = (parent ? parentActions : learnerActions).get(action);
  if (!command) throw new Error('UNKNOWN_ACTION');
  let actorId = null;
  let learnerId = null;
  if (parent) {
    const identity = await dependencies.parentIdentity();
    if (!canManageRewardsRole(identity.member?.role)) throw new Error('NOT_REWARDS_ADMIN');
    actorId = identity.user.id;
    if (['behavior_record', 'points_adjust', 'parent_ledger', 'parent_report'].includes(command) && body.learner_id != null) {
      if (typeof body.learner_id !== 'string' || !uuid.test(body.learner_id)) throw new Error('INVALID_LEARNER_ID');
      learnerId = body.learner_id;
    }
    if (['behavior_record', 'points_adjust', 'parent_report'].includes(command) && !learnerId) throw new Error('INVALID_LEARNER_ID');
  } else {
    const identity = await dependencies.learnerIdentity();
    learnerId = identity.learner_id;
  }
  // No client workspace, actor, reviewer, learner identity or calculated point totals cross this boundary.
  const payload = Object.fromEntries(fields[command].filter(key => Object.hasOwn(body, key)).map(key => [key, body[key]]));
  const { data, error } = await dependencies.rpc('flh_family_rewards_command', {
    p_workspace_id: dependencies.workspaceId,
    p_actor_id: actorId,
    p_learner_id: learnerId,
    p_action: command,
    p_payload: payload,
  });
  if (error) throw new Error(publicRewardsError(error));
  if (data?.error) throw new Error(publicRewardsError({ message: data.error }));
  return data;
}

const publicErrors = new Set([
  'AUTH_REQUIRED', 'INVALID_SESSION', 'SESSION_EXPIRED', 'INVALID_PARENT_SESSION',
  'NOT_A_PARENT_MEMBER', 'NOT_REWARDS_ADMIN', 'INVALID_LEARNER_ID', 'UNKNOWN_ACTION',
  'LEARNER_NOT_FOUND', 'CATEGORY_NOT_FOUND', 'RULE_NOT_FOUND', 'REWARD_NOT_FOUND',
  'SUBMISSION_NOT_FOUND', 'CLAIM_NOT_FOUND', 'EVENT_NOT_FOUND',
  'INVALID_ARGUMENT', 'INVALID_TITLE', 'INVALID_POINTS', 'INVALID_SCOPE', 'INVALID_CADENCE',
  'INVALID_CRITERIA', 'INVALID_DATES', 'INVALID_DECISION', 'REASON_REQUIRED', 'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_CONFLICT', 'CADENCE_LIMIT', 'SELF_REPORT_NOT_ALLOWED', 'RULE_INACTIVE',
  'CATEGORY_INACTIVE', 'LEARNER_OUT_OF_SCOPE', 'REWARD_UNAVAILABLE', 'REWARD_INELIGIBLE',
  'INSUFFICIENT_POINTS', 'REDEMPTION_LIMIT', 'INVALID_TRANSITION', 'ALREADY_REVERSED',
  'BALANCE_OVERFLOW', 'REWARDS_PERMISSION_DENIED',
  'PARENT_MANAGE_FORBIDDEN', 'INVALID_INPUT', 'RULE_SCOPE_FORBIDDEN', 'SELF_REPORT_FORBIDDEN',
  'INVALID_OCCURRED_AT', 'CLAIM_NOT_APPROVED', 'REWARD_INACTIVE', 'REWARD_SCOPE_FORBIDDEN',
  'LEVEL_REQUIRED', 'XP_REQUIRED', 'STREAK_REQUIRED', 'BADGE_REQUIRED', 'CLAIM_ALREADY_PENDING',
  'ADJUSTMENT_REASON_REQUIRED', 'REVERSAL_EVENT_NOT_FOUND', 'INVALID_ADJUSTMENT', 'DUPLICATE_OCCURRENCE',
  'RETURN_EVENT_REQUIRED', 'RETURN_EVENT_NOT_FOUND', 'INVALID_RETURN_EVENT', 'RETURN_EVENT_IMMUTABLE',
]);

/** Never return raw SQL/PostgREST messages, details or submitted free text to the browser. */
export function publicRewardsError(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (publicErrors.has(message)) return message;
  return 'REWARDS_SERVER_ERROR';
}

export function rewardsErrorStatus(code) {
  if (['AUTH_REQUIRED', 'INVALID_SESSION', 'SESSION_EXPIRED', 'INVALID_PARENT_SESSION'].includes(code)) return 401;
  if (['NOT_A_PARENT_MEMBER', 'NOT_REWARDS_ADMIN', 'REWARDS_PERMISSION_DENIED', 'SELF_REPORT_NOT_ALLOWED', 'LEARNER_OUT_OF_SCOPE',
    'PARENT_MANAGE_FORBIDDEN', 'RULE_SCOPE_FORBIDDEN', 'SELF_REPORT_FORBIDDEN', 'REWARD_SCOPE_FORBIDDEN'].includes(code)) return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (['IDEMPOTENCY_CONFLICT', 'CADENCE_LIMIT', 'RULE_INACTIVE', 'CATEGORY_INACTIVE', 'REWARD_UNAVAILABLE',
    'REWARD_INELIGIBLE', 'INSUFFICIENT_POINTS', 'REDEMPTION_LIMIT', 'INVALID_TRANSITION', 'ALREADY_REVERSED',
    'CLAIM_NOT_APPROVED', 'REWARD_INACTIVE', 'LEVEL_REQUIRED', 'XP_REQUIRED', 'STREAK_REQUIRED', 'BADGE_REQUIRED', 'CLAIM_ALREADY_PENDING', 'DUPLICATE_OCCURRENCE', 'RETURN_EVENT_IMMUTABLE'].includes(code)) return 409;
  if (publicErrors.has(code)) return 400;
  return 500;
}
