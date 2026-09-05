import { describe, expect, it, vi } from 'vitest';

import type { LlmRequest } from '../../src/baselines/llm-verifier.js';
import { OpenAiResponsesClient } from '../../src/baselines/openai-responses-client.js';

const request: LlmRequest = {
  model: 'gpt-5.4-mini-2026-03-17',
  temperature: 0,
  system: 'system',
  user: 'user',
  responseSchema: { type: 'object' },
};

describe('OpenAI Responses API baseline client', () => {
  it('sends strict structured-output configuration and returns output text', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '{"decision":"ALLOW"}' }],
            },
          ],
          usage: {
            input_tokens: 120,
            input_tokens_details: { cached_tokens: 20 },
            output_tokens: 30,
            total_tokens: 150,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = new OpenAiResponsesClient('test-key', { fetch });
    const result = await client.complete(request, new AbortController().signal);
    expect(result).toBe('{"decision":"ALLOW"}');
    expect(client.usage()).toEqual({
      inputTokens: 120,
      cachedInputTokens: 20,
      outputTokens: 30,
      totalTokens: 150,
    });
    const init = fetch.mock.calls[0]?.[1];
    if (typeof init?.body !== 'string') throw new Error('request body is not a string');
    const body = JSON.parse(init.body) as {
      model: string;
      store: boolean;
      text: { format: { type: string; strict: boolean } };
    };
    expect(body).toMatchObject({
      model: request.model,
      store: false,
      text: { format: { type: 'json_schema', strict: true } },
    });
  });

  it('does not include response bodies in HTTP errors', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('sensitive upstream detail', { status: 401 }));
    const client = new OpenAiResponsesClient('test-key', { fetch });
    await expect(client.complete(request, new AbortController().signal)).rejects.toThrow(
      'HTTP 401',
    );
  });

  it('rejects incomplete or textless responses', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ status: 'incomplete', output: [] }), { status: 200 }),
      );
    const client = new OpenAiResponsesClient('test-key', { fetch });
    await expect(client.complete(request, new AbortController().signal)).rejects.toThrow(
      'status is incomplete',
    );
  });
});
