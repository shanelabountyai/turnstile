// The engine's two refusals. Both are thrown, never returned as a command code: RULES_INVALID is a bad event
// definition (D-10, GT-13), INPUT_INVALID is a malformed command or an out-of-order apply (D-8). Each names the field.
// Shape ported from Quorum src/tally/errors.ts (task 1.3).

export class RulesInvalid extends Error {
  readonly code = 'RULES_INVALID' as const;
  constructor(readonly field: string, detail: string) {
    super(`RULES_INVALID: ${field}: ${detail}`);
    this.name = 'RulesInvalid';
  }
}

export class InputInvalid extends Error {
  readonly code = 'INPUT_INVALID' as const;
  constructor(readonly field: string, detail: string) {
    super(`INPUT_INVALID: ${field}: ${detail}`);
    this.name = 'InputInvalid';
  }
}
