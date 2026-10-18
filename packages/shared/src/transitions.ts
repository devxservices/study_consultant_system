import {
  applicableStages,
  nextApplicableStage,
  stageAppliesToCase,
  STAGE_DEFINITIONS,
  type Stage,
} from './stages';

export type TransitionKind = 'next' | 'skip' | 'back' | 'same' | 'not-applicable';

export interface TransitionCheck {
  allowed: boolean;
  kind: TransitionKind;
  /** True when the move needs an explanation recorded against it. */
  requiresReason: boolean;
  /** Shown to the person making the move, and used as the API error message. */
  message: string;
}

/**
 * Single source of truth for "may this case move there, and does someone have
 * to explain why". The API enforces it and the UI uses it to decide whether to
 * demand a reason, so the two can never disagree.
 */
export function checkStageTransition(
  from: Stage,
  to: Stage,
  targetCountry: string | null | undefined,
): TransitionCheck {
  if (from === to) {
    return {
      allowed: false,
      kind: 'same',
      requiresReason: false,
      message: 'The case is already at this stage.',
    };
  }

  if (!stageAppliesToCase(to, targetCountry)) {
    return {
      allowed: false,
      kind: 'not-applicable',
      requiresReason: false,
      message: `${STAGE_DEFINITIONS[to].label} does not apply to a ${targetCountry ?? 'this'} application.`,
    };
  }

  const stages = applicableStages(targetCountry);
  const fromIdx = stages.indexOf(from);
  const toIdx = stages.indexOf(to);

  if (toIdx < fromIdx) {
    return {
      allowed: true,
      kind: 'back',
      requiresReason: true,
      message: `Moving back to ${STAGE_DEFINITIONS[to].label}.`,
    };
  }

  const isImmediateNext = to === nextApplicableStage(from, targetCountry);
  if (isImmediateNext) {
    return {
      allowed: true,
      kind: 'next',
      requiresReason: false,
      message: `Moving forward to ${STAGE_DEFINITIONS[to].label}.`,
    };
  }

  return {
    allowed: true,
    kind: 'skip',
    requiresReason: true,
    message: `Skipping ${toIdx - fromIdx - 1} step(s) ahead to ${STAGE_DEFINITIONS[to].label}.`,
  };
}
