export type GuardDecision =
  | { kind: 'ALLOW'; intentHash: `0x${string}` }
  | { kind: 'DENY'; code: string; reason: string }
  | { kind: 'ESCALATE'; code: string; prompt: string };
