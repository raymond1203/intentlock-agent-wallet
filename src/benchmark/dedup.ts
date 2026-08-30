import { canonicalIntentJson } from '../domain/intent-hash.js';
import type { BenchmarkScenario } from './scenario.js';

export interface DuplicateFinding {
  left: string;
  right: string;
  kind: 'EXACT_INTENT_AND_TEXT' | 'NEAR_TEXT_AND_STRUCTURE';
  similarity: number;
}

function normalizedTokens(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .replace(/0x[a-f0-9]{40}/g, '<address>')
    .replace(/\b\d+(?:\.\d+)?\b/g, '<number>')
    .replace(/[^\p{L}\p{N}<>]+/gu, ' ')
    .trim();
  return new Set(normalized.split(/\s+/).filter(Boolean));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / union.size;
}

function structureKey(scenario: BenchmarkScenario): string {
  return JSON.stringify({
    workflow: scenario.workflow,
    ambiguity: scenario.naturalLanguage.ambiguity,
    fields: [...scenario.naturalLanguage.criticalFieldsPresent].sort(),
    actionSelectors: scenario.trace.actions.map((action) => action.selector).sort(),
    effectKinds: scenario.trace.expectedEffects.map((effect) => effect.kind).sort(),
    goalKinds: scenario.intent.finalStateGoals.map((goal) => goal.kind).sort(),
  });
}

export function findDuplicateScenarios(
  scenarios: readonly BenchmarkScenario[],
  nearTextThreshold = 0.85,
): DuplicateFinding[] {
  const findings: DuplicateFinding[] = [];
  for (let leftIndex = 0; leftIndex < scenarios.length; leftIndex += 1) {
    const left = scenarios[leftIndex];
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < scenarios.length; rightIndex += 1) {
      const right = scenarios[rightIndex];
      if (!right) continue;
      const similarity = jaccard(
        normalizedTokens(left.naturalLanguage.text),
        normalizedTokens(right.naturalLanguage.text),
      );
      const sameIntent = canonicalIntentJson(left.intent) === canonicalIntentJson(right.intent);
      if (sameIntent && similarity === 1) {
        findings.push({
          left: left.id,
          right: right.id,
          kind: 'EXACT_INTENT_AND_TEXT',
          similarity,
        });
      } else if (structureKey(left) === structureKey(right) && similarity >= nearTextThreshold) {
        findings.push({
          left: left.id,
          right: right.id,
          kind: 'NEAR_TEXT_AND_STRUCTURE',
          similarity,
        });
      }
    }
  }
  return findings;
}
