// Escalation ladder: decides what happens after N unresolved rounds on one issue.
// Model ladder first (raise one tier), then authority ladder (lead), then the owner.

export function nextAction(failedRounds, currentModel, config) {
  const { modelRounds: m, authorityRounds: a, leadRounds: l } = config.escalation;
  const ladder = config.modelLadder;
  if (failedRounds >= m + a + l) return { action: 'to-owner', model: currentModel };
  if (failedRounds === m + a) return { action: 'to-lead', model: config.models['team-lead'] };
  if (failedRounds === m) {
    const i = ladder.indexOf(currentModel);
    const model = i >= 0 && i < ladder.length - 1 ? ladder[i + 1] : currentModel;
    return { action: 'raise-model', model };
  }
  return { action: 'retry', model: currentModel };
}
