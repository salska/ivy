import { readFileSync } from 'node:fs';

/**
 * Check if extracted handover text is just a placeholder or instruction.
 */
export function isMeaninglessHandover(text: string): boolean {
  if (!text || text.trim().length === 0) return true;
  const placeholders = [
    '<what you accomplished>',
    '<what still needs to be done>',
    '<any blockers>',
    '[DESCRIBE_WHAT_YOU_ACCOMPLISHED]',
    '[LIST_REMAINING_STEPS_AND_TODOIS]',
    '[LIST_ANY_BLOCKERS_OR_DEPENDENCIES]',
    'DESCRIBE_WHAT_YOU_ACCOMPLISHED',
    'LIST_REMAINING_STEPS_AND_TODOIS',
    'LIST_ANY_BLOCKERS_OR_DEPENDENCIES'
  ];
  const lower = text.toLowerCase();
  return placeholders.some(p => lower.includes(p.toLowerCase()));
}

/**
 * Parse the PHASE_REPORT block from agent output.
 * Returns the last phase reached and any facts learned.
 */
export function parsePhaseReport(logPath: string): {
  lastPhase: string;
  completed: boolean;
  factsLearned: string[];
  iscMet: string;
} {
  const defaults = { lastPhase: 'unknown', completed: false, factsLearned: [], iscMet: 'unknown' };
  try {
    const content = readFileSync(logPath, 'utf-8');
    const match = content.match(/PHASE_REPORT:\s*\n([\s\S]*?)(?:```|$)/);
    if (!match) return defaults;

    const block = match[1];
    if (!block) return defaults;
    const phaseMatch = block.match(/last_phase:\s*(\w+)/);
    const completedMatch = block.match(/completed:\s*(true|false)/);
    const iscMatch = block.match(/isc_met:\s*(\w+)/);

    // Extract facts_learned list items
    const factsSection = block.match(/facts_learned:\s*\n((?:\s+-\s+.+\n?)*)/);
    const factsLearned: string[] = [];
    if (factsSection && factsSection[1]) {
      const factLines = factsSection[1].match(/^\s+-\s+(.+)$/gm);
      if (factLines) {
        for (const line of factLines) {
          factsLearned.push(line.replace(/^\s+-\s+/, '').trim());
        }
      }
    }

    return {
      lastPhase: phaseMatch?.[1] ?? 'unknown',
      completed: completedMatch?.[1] === 'true',
      factsLearned,
      iscMet: iscMatch?.[1] ?? 'unknown',
    };
  } catch {
    return defaults;
  }
}
