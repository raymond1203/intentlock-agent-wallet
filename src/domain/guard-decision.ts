export interface DecisionEvidence {
  path: string;
  expected: string;
  actual: string;
  source: 'INTENT' | 'ACTION_IR' | 'SIMULATOR' | 'RECEIPT' | 'LEDGER';
}

interface DecisionBase {
  intentHash: `0x${string}`;
  evaluatedAt: string;
  evidence: readonly DecisionEvidence[];
}

export type GuardDecision =
  | (DecisionBase & { kind: 'ALLOW' })
  | (DecisionBase & {
      kind: 'DENY';
      code: string;
      reason: string;
      violatedInvariant: string;
    })
  | (DecisionBase & {
      kind: 'ESCALATE';
      code: string;
      prompt: string;
      violatedInvariant: string;
    });
