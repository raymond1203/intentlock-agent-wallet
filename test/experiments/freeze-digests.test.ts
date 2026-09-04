import { readFileSync } from 'node:fs';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  FreezeDigestsSchema,
  ablationConfigDigest,
  computeFreezeDigests,
  protocolConfigDigest,
} from '../../src/experiments/freeze-digests.js';
import { FrozenEvalConfigSchema } from '../../src/experiments/protocol.js';

describe('evaluation freeze digests', () => {
  const config = FrozenEvalConfigSchema.parse(
    parse(readFileSync('experiments/configs/frozen-eval.yaml', 'utf8')),
  );

  it('binds protocol semantics but excludes the mutable freeze envelope', () => {
    expect(
      protocolConfigDigest({
        ...config,
        status: 'FROZEN',
        freeze: { ...config.freeze, humanReviewer: 'reviewer-a' },
      }),
    ).toBe(protocolConfigDigest(config));
    expect(
      protocolConfigDigest({
        ...config,
        failurePolicy: { ...config.failurePolicy, maxAttemptsPerCase: 1 },
      }),
    ).not.toBe(protocolConfigDigest(config));
    expect(
      protocolConfigDigest({
        ...config,
        failurePolicy: { ...config.failurePolicy, maxTotalRetryAttempts: 1_999 },
      }),
    ).not.toBe(protocolConfigDigest(config));
  });

  it('hashes the complete implementation and evaluation config surfaces', async () => {
    const digests = FreezeDigestsSchema.parse(await computeFreezeDigests(config));
    expect(digests.implementationDigestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(digests.evaluationConfigDigestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(digests.protocolConfigDigestSha256).toBe(protocolConfigDigest(config));
  });

  it('binds ablation semantics while excluding its mutable freeze envelope', () => {
    const ablation = JSON.parse(
      readFileSync('experiments/configs/ablations/manifest.json', 'utf8'),
    ) as Record<string, unknown>;
    expect(
      ablationConfigDigest({
        ...ablation,
        status: 'FROZEN',
        freeze: {
          gitCommit: 'a'.repeat(40),
          frozenAt: '2026-09-04T00:00:00.000Z',
          humanReviewer: 'reviewer-a',
        },
      }),
    ).toBe(ablationConfigDigest(ablation));
    expect(ablationConfigDigest({ ...ablation, seed: 2027 })).not.toBe(
      ablationConfigDigest(ablation),
    );
  });
});
