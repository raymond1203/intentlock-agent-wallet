import { z } from 'zod';

import type { LlmClient, LlmRequest } from './llm-verifier.js';

const OpenAiResponseSchema = z
  .object({
    status: z.string().optional(),
    usage: z
      .object({
        input_tokens: z.number().int().nonnegative(),
        input_tokens_details: z
          .object({
            cached_tokens: z.number().int().nonnegative().optional(),
          })
          .loose()
          .optional(),
        output_tokens: z.number().int().nonnegative(),
        total_tokens: z.number().int().nonnegative(),
      })
      .loose()
      .optional(),
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

export interface OpenAiTokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export class OpenAiResponsesClient implements LlmClient {
  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #fetch: FetchLike;
  #usage: OpenAiTokenUsage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

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
    if (parsed.usage) {
      this.#usage.inputTokens += parsed.usage.input_tokens;
      this.#usage.cachedInputTokens += parsed.usage.input_tokens_details?.cached_tokens ?? 0;
      this.#usage.outputTokens += parsed.usage.output_tokens;
      this.#usage.totalTokens += parsed.usage.total_tokens;
    }
    return outputText.join('');
  }

  /** Aggregated over retries made through this client instance. */
  usage(): OpenAiTokenUsage {
    return { ...this.#usage };
  }
}
