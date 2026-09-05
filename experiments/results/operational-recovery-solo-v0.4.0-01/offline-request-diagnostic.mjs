/** SYNTHETIC DIAGNOSTIC ONLY: no real network, no model evidence, no primary/recovery rows. */
import { readFile, readdir, stat } from 'node:fs/promises';
import { parse } from 'yaml';
import { OpenAiResponsesClient } from '../../../dist/src/baselines/openai-responses-client.js';
import { LlmVerifierConfigSchema, LLM_VERIFIER_PROMPT_VERSION } from '../../../dist/src/baselines/llm-verifier.js';
import { BenchmarkScenarioSchema } from '../../../dist/src/benchmark/scenario.js';
import { createEvaluationCaseMatrix } from '../../../dist/src/experiments/case-matrix.js';
import { evaluateCase } from '../../../dist/src/experiments/evaluate-case.js';
const directory = 'experiments/results/operational-recovery-solo-v0.4.0-01';
const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'));
const config = parse(await readFile('experiments/configs/frozen-eval.yaml', 'utf8'));
const base = [];
for (const child of (await readdir('benchmark/scenarios/base')).sort()) {
  const path = `benchmark/scenarios/base/${child}`;
  if (!(await stat(path)).isDirectory()) continue;
  for (const name of (await readdir(path)).filter((name) => name.endsWith('.json')).sort()) {
    base.push(BenchmarkScenarioSchema.parse(JSON.parse(await readFile(`${path}/${name}`, 'utf8'))));
  }
}
const matrix = createEvaluationCaseMatrix(base);
const llmConfig = LlmVerifierConfigSchema.parse({ ...manifest.llmConfig, promptVersion: LLM_VERIFIER_PROMPT_VERSION });
let constructedRequests = 0;
const failures = [];
for (const target of manifest.targets) {
  const index = matrix.entries.findIndex((entry) => entry.caseId === target.caseId);
  const entry = matrix.entries[index];
  const scenario = matrix.scenarios[index];
  if (!scenario || entry.scenarioSha256 !== target.scenarioSha256) throw new Error('Diagnostic source mismatch.');
  const result = await evaluateCase({
    runId: 'SYNTHETIC-OFFLINE-REQUEST-DIAGNOSTIC-NOT-EVIDENCE', system: 'LLM_VERIFIER',
    scenario, entry, evaluatedAt: config.caseMatrix.evaluatedAt,
    llm: { config: llmConfig, pricing: manifest.pricingUsdPerMillionTokens,
      createClient: () => new OpenAiResponsesClient('synthetic-offline-placeholder-not-a-key', {
        fetch: async (input, init) => {
          const request = new Request(input, init);
          const body = JSON.parse(await request.text());
          if (body.model !== manifest.llmConfig.model || body.temperature !== 0 || body.store !== false) throw new Error('Request configuration differs.');
          constructedRequests += 1;
          return new Response(JSON.stringify({ status: 'completed',
            output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ decision: 'ABSTAIN', rationale: 'SYNTHETIC OFFLINE DIAGNOSTIC ONLY', violatedFields: [] }) }] }],
            usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } }),
          { status: 200, headers: { 'content-type': 'application/json' } });
        },
      }),
    },
  });
  if (result.record.executionStatus !== 'NOT_ATTEMPTED' || !result.verdict.rationale.includes('SYNTHETIC')) failures.push(target.caseId);
}
console.log(JSON.stringify({ diagnosticType: 'SYNTHETIC_OFFLINE_REQUEST_CONSTRUCTION', liveNetworkCalls: 0,
  targetCases: manifest.targets.length, validConstructedRequests: constructedRequests, failures,
  limitation: 'Rules out local request construction/schema issues for these inputs; does not retrospectively recover missing network cause codes.' }));
if (failures.length || constructedRequests !== 47) process.exitCode = 1;
