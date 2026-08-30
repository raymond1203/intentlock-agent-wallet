import { z } from 'zod';

import type { LlmClient, LlmRequest } from './llm-verifier.js';

const OpenAiResponseSchema = z
  .object({
    status: z.string().optional(),
    output: z.array(
      z
        .object({
          type: z.string(),
          content: z
            .array(
              z
                .object({
                  type: z.string(),
                  text: z.string().optional(),
                })
                .loose(),
            )
            .optional(),
        })
        .loose(),
    ),
  })
  .loose();

type FetchLike = (
  input: string | URL | globalThis.Request,
  init?: globalThis.RequestInit,
) => Promise<globalThis.Response>;

export class OpenAiResponsesClient implements LlmClient {
  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #fetch: FetchLike;

  constructor(apiKey: string, options: { endpoint?: string; fetch?: FetchLike } = {}) {
    if (!apiKey.trim()) throw new Error('OPENAI_API_KEY is empty');
    this.#apiKey = apiKey;
    this.#endpoint = options.endpoint ?? 'https://api.openai.com/v1/responses';
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async complete(request: LlmRequest, signal: AbortSignal): Promise<string> {
    const response = await this.#fetch(this.#endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        instructions: request.system,
        input: request.user,
        temperature: request.temperature,
        max_output_tokens: 512,
        store: false,
        text: {
          format: {
            type: 'json_schema',
            name: 'intentlock_baseline_verdict',
            strict: true,
            schema: request.responseSchema,
          },
          verbosity: 'low',
        },
      }),
      signal,
    });
    if (!response.ok) {
      throw new Error(`OpenAI Responses API failed with HTTP ${String(response.status)}`);
    }
    const parsed = OpenAiResponseSchema.parse(await response.json());
    if (parsed.status && parsed.status !== 'completed') {
      throw new Error(`OpenAI response status is ${parsed.status}`);
    }
    const outputText = parsed.output
      .flatMap((item) => item.content ?? [])
      .flatMap((content) => (content.type === 'output_text' && content.text ? [content.text] : []));
    if (outputText.length === 0) throw new Error('OpenAI response contained no output_text');
    return outputText.join('');
  }
}
