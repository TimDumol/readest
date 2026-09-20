import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();

const structuredCard = (clozeText: string, overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    cloze_text: clozeText,
    gloss: 'to buy',
    translation: 'Ella bought a book.',
    source_text: 'Ella compró un libro.',
    tags: ['verb'],
    ...overrides,
  });

vi.mock('@/services/ai/utils/httpFetch', () => ({
  getAIFetch: () => mockFetch,
}));

import {
  buildStudyCardAdditionalContext,
  calculateStudyCardMaxTokens,
  checkOpenRouterConnection,
  formatOpenRouterModelPrice,
  generateStudyCardCloze,
  generateStudyCardClozeCached,
} from '@/services/studyCards/aiCloze';
import {
  DEFAULT_STUDY_CARD_CLOZE_PROMPT,
  LEGACY_STUDY_CARD_CLOZE_PROMPT,
} from '@/services/ai/constants';
import { supportsOpenRouterStructuredOutputs } from '@/services/ai/providers/OpenRouterProvider';
import { learningFixture } from './learningFixture';

describe('study card AI cloze generation', () => {
  beforeEach(() => mockFetch.mockReset());

  it('generates recognition and production content in one cached request without choosing cards', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: structuredCard('Ella {{c1::compró}} un libro.', {
                learning: learningFixture(),
              }),
            },
          },
        ],
      }),
    });
    const options = {
      enriched: true,
      apiKey: 'enriched-cache-test',
      model: 'model',
      contextText: 'Ella compró un libro.',
      selectedText: 'compró',
      definitions: [],
    };
    const first = await generateStudyCardClozeCached(options);
    expect(first.learning).toEqual(learningFixture());
    expect(await generateStudyCardClozeCached(options)).toBe(first);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const request = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
    expect(request.response_format.json_schema.schema.required).toContain('learning');
    expect(
      request.response_format.json_schema.schema.properties.learning.properties.exercises.required,
    ).toEqual(['vocabulary']);
    expect(
      request.response_format.json_schema.schema.properties.learning.properties.exercises
        .properties,
    ).not.toHaveProperty('grammar');
    expect(
      request.response_format.json_schema.schema.properties.learning.properties.exercises.properties
        .vocabulary.properties,
    ).not.toHaveProperty('recommended');
    expect(request.messages[0].content).toContain(
      'Do not force an artificial or redundant exercise',
    );
    expect(request.messages[0].content).toContain(
      'The prompt/front must not contain the selected word',
    );
    expect(request.messages[0].content).not.toContain('Recommendations');
    expect(request.messages[0].content).not.toContain('phrase/preposition');
  });

  it('rejects missing enrichment and invented learning targets', async () => {
    const options = {
      enriched: true,
      apiKey: 'test',
      model: 'model',
      contextText: 'Ella compró un libro.',
      selectedText: 'compró',
      definitions: [],
    };
    for (const learning of [undefined, { ...learningFixture(), learningTarget: 'vendió' }]) {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: structuredCard('Ella {{c1::compró}} un libro.', { learning }),
              },
            },
          ],
        }),
      });
      await expect(generateStudyCardCloze(options)).rejects.toThrow();
    }
  });

  it('requests a cloze using the context and selected definitions', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: { content: structuredCard('Ella {{c1::compró}} un libro.') },
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 40,
          total_tokens: 140,
          cost: 0.000123,
        },
      }),
    });

    await expect(
      generateStudyCardCloze({
        apiKey: 'sk-or-test',
        model: 'openai/gpt-4o-mini',
        contextText: 'Ella compró un libro.',
        selectedText: 'compró',
        definitions: [{ sourceLabel: 'Spanish dictionary', headword: 'comprar', text: 'to buy' }],
        pricing: { prompt: '0.01', completion: '0.02' },
      }),
    ).resolves.toMatchObject({
      clozeText: 'Ella {{c1::compró}} un libro.',
      gloss: 'to buy',
      translation: 'Ella bought a book.',
      sourceText: 'Ella compró un libro.',
      tags: ['verb'],
      usage: {
        promptTokens: 100,
        completionTokens: 40,
        totalTokens: 140,
        cost: 0.000123,
        costSource: 'provider',
      },
      generationDurationMs: expect.any(Number),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-or-test' }),
      }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string) as {
      model: string;
      messages: Array<{ content: string }>;
      provider: {
        require_parameters: boolean;
        only?: string[];
        ignore?: string[];
        sort?: string;
      };
      max_tokens: number;
      response_format: { type: string; json_schema: { name: string; strict: boolean } };
    };
    expect(body.model).toBe('openai/gpt-4o-mini');
    expect(body.messages[0]!.content).toContain('same tense, plurality');
    expect(body.messages[0]!.content).toContain('gender, and part of speech');
    expect(body.messages[0]!.content).toContain('Do not stop');
    expect(body.messages[1]!.content).toContain('to buy');
    expect(body.messages[1]!.content).toContain('Ella compró un libro.');
    expect(body.provider.require_parameters).toBe(true);
    expect(body.max_tokens).toBe(4000);
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'study_card_cloze', strict: true },
    });
  });

  it('passes provider selection, blacklist, and routing priority to OpenRouter', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: { content: structuredCard('Ella {{c1::compró}} un libro.') },
          },
        ],
      }),
    });

    await generateStudyCardCloze({
      apiKey: 'token',
      model: 'openai/gpt-4o-mini',
      contextText: 'Ella compró un libro.',
      selectedText: 'compró',
      definitions: [],
      provider: {
        only: [' google-ai-studio ', 'google-ai-studio'],
        ignore: ['deepinfra'],
        sort: 'throughput',
      },
    });

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string) as {
      provider: Record<string, unknown>;
    };
    expect(body.provider).toEqual({
      require_parameters: true,
      only: ['google-ai-studio'],
      ignore: ['deepinfra'],
      sort: 'throughput',
    });
  });

  it('sends configurable surrounding context and a custom prompt', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: structuredCard('The answer is {{c1::clear}}.', {
                source_text: 'The answer is clear.',
              }),
            },
          },
        ],
      }),
    });

    await generateStudyCardCloze({
      apiKey: 'token',
      model: 'model',
      contextText: 'The answer is clear.',
      selectedText: 'clear',
      definitions: [],
      prompt: 'Use my custom study-card instructions.',
      additionalContextBefore: 'The previous sentence. ',
      additionalContextAfter: ' The next sentence.',
    });

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages[0]).toEqual({
      role: 'system',
      content: 'Use my custom study-card instructions.',
    });
    expect(body.messages[1]!.content).toContain('The previous sentence. ');
    expect(body.messages[1]!.content).toContain('The next sentence.');
  });

  it('refreshes the legacy prompt template before sending a generation request', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: { content: structuredCard('Ella {{c1::compró}} un libro.') },
          },
        ],
      }),
    });

    await generateStudyCardCloze({
      apiKey: 'token',
      model: 'model',
      contextText: 'Ella compró un libro.',
      selectedText: 'compró',
      definitions: [],
      prompt: LEGACY_STUDY_CARD_CLOZE_PROMPT,
    });

    const request = JSON.parse(mockFetch.mock.calls[0]![1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(request.messages[0]).toEqual({
      role: 'system',
      content: DEFAULT_STUDY_CARD_CLOZE_PROMPT,
    });
  });

  it('limits reasoning effort when requested for reasoning models', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: structuredCard('The answer is {{c1::clear}}.', {
                source_text: 'The answer is clear.',
              }),
            },
          },
        ],
      }),
    });

    await generateStudyCardCloze({
      apiKey: 'token',
      model: '~z-ai/glm-flash-latest',
      contextText: 'The answer is clear.',
      selectedText: 'clear',
      definitions: [],
      reasoningEffort: 'low',
    });

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string) as {
      reasoning_effort?: string;
    };
    expect(body.reasoning_effort).toBe('low');
  });

  it('limits surrounding context to the configured character counts', () => {
    expect(
      buildStudyCardAdditionalContext({
        contextText: '0123456789Sentence here.abcdefghij',
        sentenceSpan: { start: 10, end: 24 },
        beforeChars: 4,
        afterChars: 5,
      }),
    ).toEqual({ before: '6789', after: 'abcde' });
  });

  it('derives the completion limit from the request budget and model pricing', () => {
    expect(
      calculateStudyCardMaxTokens({
        budgetUsd: 0.001,
        prompt: 'x'.repeat(400),
        pricing: { prompt: '0.0000001', completion: '0.00000025' },
      }),
    ).toBe(3960);
    expect(
      calculateStudyCardMaxTokens({
        budgetUsd: 1,
        prompt: 'short',
        pricing: { completion: '0.00000001' },
      }),
    ).toBe(16384);
  });

  it('reuses an in-flight automatic generation for the same card inputs', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: { content: structuredCard('Ella {{c1::compró}} un libro.') },
          },
        ],
      }),
    });

    const options = {
      apiKey: 'cached-token',
      model: 'cached-model',
      contextText: 'Ella compró un libro.',
      selectedText: 'compró',
      definitions: [],
    };
    const first = generateStudyCardClozeCached(options);
    const second = generateStudyCardClozeCached(options);

    expect(first).toBe(second);
    await expect(first).resolves.toMatchObject({
      clozeText: 'Ella {{c1::compró}} un libro.',
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a cached generation when provider routing changes', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: { content: structuredCard('Ella {{c1::compró}} un libro.') },
          },
        ],
      }),
    });

    const options = {
      apiKey: 'routing-cache-token',
      model: 'routing-cache-model',
      contextText: 'Ella compró un libro.',
      selectedText: 'compró',
      definitions: [],
    };
    await generateStudyCardClozeCached({ ...options, provider: { sort: 'price' } });
    await generateStudyCardClozeCached({ ...options, provider: { sort: 'throughput' } });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a cached generation when the prompt template changes', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: { content: structuredCard('Ella {{c1::compró}} un libro.') },
          },
        ],
      }),
    });

    const options = {
      apiKey: 'prompt-cache-token',
      model: 'prompt-cache-model',
      contextText: 'Ella compró un libro.',
      selectedText: 'compró',
      definitions: [],
    };
    await generateStudyCardClozeCached({ ...options, prompt: 'Old study-card template' });
    await generateStudyCardClozeCached({ ...options, prompt: 'New study-card template' });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(
      mockFetch.mock.calls.map((call) => {
        const request = JSON.parse(call[1].body as string) as {
          messages: Array<{ content: string }>;
        };
        return request.messages[0]!.content;
      }),
    ).toEqual(['Old study-card template', 'New study-card template']);
  });

  it('rejects output that changes the selected answer or contains multiple clozes', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: structuredCard('Ella {{c1::compró}} y {{c1::leyó}}.', {
                source_text: 'Ella compró un libro.',
              }),
            },
          },
        ],
      }),
    });
    await expect(
      generateStudyCardCloze({
        apiKey: 'token',
        model: 'model',
        contextText: 'Ella compró un libro.',
        selectedText: 'compró',
        definitions: [],
      }),
    ).rejects.toThrow('one cloze');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: structuredCard('Ella {{c1::compraría}} un libro.'),
            },
          },
        ],
      }),
    });
    await expect(
      generateStudyCardCloze({
        apiKey: 'token',
        model: 'model',
        contextText: 'Ella compró un libro.',
        selectedText: 'compró',
        definitions: [],
      }),
    ).rejects.toThrow('selected text');
  });

  it('accepts text content returned as OpenAI content parts', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: [
                {
                  type: 'text',
                  text: structuredCard('Ella {{c1::compró}} un libro.'),
                },
              ],
            },
          },
        ],
      }),
    });

    await expect(
      generateStudyCardCloze({
        apiKey: 'token',
        model: 'model',
        contextText: 'Ella compró un libro.',
        selectedText: 'compró',
        definitions: [],
      }),
    ).resolves.toMatchObject({ clozeText: 'Ella {{c1::compró}} un libro.' });
  });

  it('explains the response shape when OpenRouter returns no text', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'length',
            message: { content: null, reasoning: 'The model reasoned but produced no answer.' },
          },
        ],
      }),
    });

    await expect(
      generateStudyCardCloze({
        apiKey: 'token',
        model: 'model',
        contextText: 'Ella compró un libro.',
        selectedText: 'compró',
        definitions: [],
      }),
    ).rejects.toThrow(/no usable text.*finish_reason=length.*reasoning/i);
  });

  it('reports the OpenRouter API error details', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers({ 'x-request-id': 'req_test_123' }),
      json: async () => ({ error: { code: 'invalid_api_key', message: 'The API key is invalid' } }),
    });

    await expect(
      generateStudyCardCloze({
        apiKey: 'token',
        model: 'model',
        contextText: 'Ella compró un libro.',
        selectedText: 'compró',
        definitions: [],
      }),
    ).rejects.toThrow(/HTTP 401.*invalid_api_key.*The API key is invalid.*req_test_123/);
  });

  it('checks the OpenRouter connection without making a completion request', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'openai/gpt-4o-mini',
            pricing: { prompt: '0.01' },
            supported_parameters: ['response_format', 'structured_outputs'],
          },
        ],
      }),
    });

    await expect(
      checkOpenRouterConnection({
        apiKey: 'token',
        model: 'openai/gpt-4o-mini',
      }),
    ).resolves.toEqual({
      modelCount: 1,
      structuredModelCount: 1,
      selectedModelAvailable: true,
      selectedModelSupportsStructuredOutputs: true,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('only considers models with both structured-output capabilities eligible', () => {
    expect(
      supportsOpenRouterStructuredOutputs({
        supported_parameters: ['response_format', 'structured_outputs'],
      }),
    ).toBe(true);
    expect(supportsOpenRouterStructuredOutputs({ supported_parameters: ['response_format'] })).toBe(
      false,
    );
    expect(supportsOpenRouterStructuredOutputs({})).toBe(false);
  });

  it('formats OpenRouter prompt and completion prices per million tokens', () => {
    expect(formatOpenRouterModelPrice({ prompt: '0.000001', completion: '0.000002' })).toBe(
      '$1/M in · $2/M out',
    );
    expect(formatOpenRouterModelPrice(undefined)).toBe('price unavailable');
  });
});
