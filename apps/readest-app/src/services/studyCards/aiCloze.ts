import { getAIFetch } from '@/services/ai/utils/httpFetch';
import { LEARNING_INSTRUCTIONS, LEARNING_SCHEMA, parseLearningContent } from './learningContent';
import type { StudyCardLearning, TextSpan } from './types';
import {
  DEFAULT_STUDY_CARD_CLOZE_CONTEXT_CHARS,
  DEFAULT_STUDY_CARD_CLOZE_PROMPT,
  DEFAULT_STUDY_CARD_CLOZE_MAX_TOKENS,
  DEFAULT_STUDY_CARD_TARGET_LANGUAGE,
  getStudyCardPrompt,
  MAX_STUDY_CARD_CLOZE_CONTEXT_CHARS,
  MAX_STUDY_CARD_CLOZE_MAX_TOKENS,
} from '@/services/ai/constants';
import {
  createOpenRouterResponseError,
  fetchOpenRouterModels,
  formatOpenRouterModelPrice,
  supportsOpenRouterStructuredOutputs,
  type OpenRouterModelPricing,
} from '@/services/ai/providers/OpenRouterProvider';
import {
  buildStudyCardProviderRequest,
  type StudyCardProviderPreferences,
} from './providerRouting';

export type StudyCardAIDefinition = {
  sourceLabel: string;
  headword: string;
  text: string;
};

export type GenerateStudyCardClozeOptions = {
  enriched?: boolean;
  apiKey: string;
  model: string;
  baseUrl?: string;
  contextText: string;
  selectedText: string;
  selectedSpan?: TextSpan;
  definitions: StudyCardAIDefinition[];
  sourceText?: string;
  targetLanguage?: string;
  prompt?: string;
  additionalContextBefore?: string;
  additionalContextAfter?: string;
  /** Use a bounded reasoning budget for OpenRouter reasoning models. */
  reasoningEffort?: 'low' | 'medium' | 'high' | 'max';
  /** Approximate total USD budget for the request, including input and output. */
  budgetUsd?: number;
  pricing?: OpenRouterModelPricing;
  /** OpenRouter provider allowlist, blocklist, and routing priority. */
  provider?: StudyCardProviderPreferences;
  signal?: AbortSignal;
};

const STUDY_CARD_GENERATION_CACHE_LIMIT = 50;
const studyCardGenerationCache = new Map<string, Promise<StudyCardAIGeneration>>();

export type StudyCardAIUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cost: number | null;
  costSource: 'provider' | 'calculated' | 'unavailable';
};

export type StudyCardAIGeneration = {
  learning?: StudyCardLearning;
  clozeText: string;
  gloss: string;
  translation: string;
  sourceText: string;
  tags: string[];
  usage: StudyCardAIUsage | null;
  /** Wall-clock time spent completing and validating this generation request. */
  generationDurationMs: number;
};

export type CheckOpenRouterConnectionOptions = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  signal?: AbortSignal;
};

export type OpenRouterConnectionResult = {
  modelCount: number;
  structuredModelCount: number;
  selectedModelAvailable: boolean;
  selectedModelSupportsStructuredOutputs: boolean;
};

type ChatCompletionMessage = {
  content?: unknown;
  reasoning?: unknown;
  reasoning_content?: unknown;
  refusal?: unknown;
  tool_calls?: unknown;
};

type ChatCompletionResponse = {
  id?: unknown;
  choices?: Array<{
    finish_reason?: unknown;
    message?: ChatCompletionMessage;
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
    cost?: unknown;
  };
};

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

const STRUCTURED_CLOZE_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'study_card_cloze',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        cloze_hint: {
          type: 'string',
          description: 'Empty or a short hint without Anki markers.',
        },
        gloss: {
          type: 'string',
          description: 'Concise contextual meaning in the target language.',
        },
        translation: {
          type: 'string',
          description: 'Complete context translated into the target language.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 3,
        },
      },
      required: ['cloze_hint', 'gloss', 'translation', 'tags'],
      additionalProperties: false,
    },
  },
} as const;

export const buildStudyCardPrompt = (
  options: Pick<
    GenerateStudyCardClozeOptions,
    | 'contextText'
    | 'selectedText'
    | 'definitions'
    | 'targetLanguage'
    | 'additionalContextBefore'
    | 'additionalContextAfter'
  >,
): string => {
  const definitions = options.definitions.length
    ? options.definitions
        .map(
          (definition) => `[${definition.sourceLabel}] ${definition.headword}\n${definition.text}`,
        )
        .join('\n\n')
    : '(none)';
  return [
    '<context>',
    options.contextText,
    '</context>',
    '<surrounding-context>',
    '<before-sentence>',
    options.additionalContextBefore || '(none)',
    '</before-sentence>',
    '<after-sentence>',
    options.additionalContextAfter || '(none)',
    '</after-sentence>',
    '</surrounding-context>',
    '<selected-text>',
    options.selectedText,
    '</selected-text>',
    '<translation-target-language>',
    options.targetLanguage || DEFAULT_STUDY_CARD_TARGET_LANGUAGE,
    '</translation-target-language>',
    '<dictionary-definitions>',
    definitions,
    '</dictionary-definitions>',
  ].join('\n');
};

const normalizedContextChars = (value: number | undefined): number => {
  if (!Number.isFinite(value)) return DEFAULT_STUDY_CARD_CLOZE_CONTEXT_CHARS;
  return Math.max(0, Math.min(MAX_STUDY_CARD_CLOZE_CONTEXT_CHARS, Math.floor(value!)));
};

const MIN_PRACTICAL_CLOZE_OUTPUT_TOKENS = 256;

/**
 * Estimate a completion-token limit from the configured request budget.
 * OpenRouter prices are dollars per token. Input tokens are estimated from
 * characters because the selected model tokenizer is not available locally.
 * The result is intentionally conservative and capped even when the user
 * enters a large budget.
 */
export const calculateStudyCardMaxTokens = (options: {
  budgetUsd?: number;
  prompt: string;
  pricing?: OpenRouterModelPricing;
  fallback?: number;
}): number => {
  const fallback = Math.min(
    MAX_STUDY_CARD_CLOZE_MAX_TOKENS,
    Math.max(
      MIN_PRACTICAL_CLOZE_OUTPUT_TOKENS,
      options.fallback ?? DEFAULT_STUDY_CARD_CLOZE_MAX_TOKENS,
    ),
  );
  const budgetUsd = Number(options.budgetUsd);
  const outputPrice = Number(options.pricing?.completion ?? options.pricing?.output);
  if (
    !Number.isFinite(budgetUsd) ||
    budgetUsd <= 0 ||
    !Number.isFinite(outputPrice) ||
    outputPrice <= 0
  ) {
    return fallback;
  }
  const inputPrice = Number(options.pricing?.prompt ?? options.pricing?.input);
  const estimatedInputTokens = Math.ceil(options.prompt.length / 4);
  const estimatedInputCost =
    Number.isFinite(inputPrice) && inputPrice > 0 ? estimatedInputTokens * inputPrice : 0;
  const remainingBudget = Math.max(0, budgetUsd - estimatedInputCost);
  const budgetedTokens = Math.floor(remainingBudget / outputPrice);
  return Math.min(
    MAX_STUDY_CARD_CLOZE_MAX_TOKENS,
    Math.max(MIN_PRACTICAL_CLOZE_OUTPUT_TOKENS, budgetedTokens),
  );
};

export const buildStudyCardAdditionalContext = (options: {
  contextText: string;
  sentenceSpan?: { start: number; end: number };
  beforeChars?: number;
  afterChars?: number;
}): { before: string; after: string } => {
  const { contextText, sentenceSpan } = options;
  if (
    !sentenceSpan ||
    !Number.isInteger(sentenceSpan.start) ||
    !Number.isInteger(sentenceSpan.end) ||
    sentenceSpan.start < 0 ||
    sentenceSpan.end < sentenceSpan.start ||
    sentenceSpan.end > contextText.length
  ) {
    return { before: '', after: '' };
  }
  const beforeChars = normalizedContextChars(options.beforeChars);
  const afterChars = normalizedContextChars(options.afterChars);
  return {
    before: contextText.slice(Math.max(0, sentenceSpan.start - beforeChars), sentenceSpan.start),
    after: contextText.slice(sentenceSpan.end, sentenceSpan.end + afterChars),
  };
};

const buildClozeText = (
  contextText: string,
  selectedText: string,
  selectedSpan: TextSpan | undefined,
  hint: string,
): string => {
  const start = selectedSpan?.start ?? contextText.indexOf(selectedText);
  const end = selectedSpan?.end ?? (start >= 0 ? start + selectedText.length : -1);
  if (
    start < 0 ||
    end < start ||
    end > contextText.length ||
    contextText.slice(start, end) !== selectedText
  ) {
    throw new Error('The selected text no longer matches the captured reading context.');
  }
  const normalizedHint = hint.trim();
  const clozeHint =
    normalizedHint.includes('{{') || normalizedHint.includes('}}') ? '' : normalizedHint;
  return `${contextText.slice(0, start)}{{c1::${selectedText}${
    clozeHint ? `::${clozeHint}` : ''
  }}}${contextText.slice(end)}`;
};

const extractTextContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (
        part &&
        typeof part === 'object' &&
        typeof (part as { text?: unknown }).text === 'string'
      ) {
        return (part as { text: string }).text;
      }
      return '';
    })
    .join('');
};

const describeNoTextResponse = (data: ChatCompletionResponse): string => {
  const choice = data.choices?.[0];
  const message = choice?.message;
  const details: string[] = [];
  if (choice?.finish_reason !== undefined) {
    details.push(`finish_reason=${String(choice.finish_reason)}`);
  }
  if (!choice) {
    details.push(`choices=${Array.isArray(data.choices) ? data.choices.length : 0}`);
  } else if (!message) {
    details.push('the first choice had no message');
  } else if (message.content === undefined) {
    details.push('message.content is missing');
  } else if (message.content === null) {
    details.push('message.content is null');
  } else if (Array.isArray(message.content)) {
    details.push('message.content was an array with no text parts');
  } else {
    details.push(`message.content has type ${typeof message.content}`);
  }
  if (message?.reasoning || message?.reasoning_content) details.push('reasoning was returned');
  if (Array.isArray(message?.tool_calls)) details.push('tool calls were returned');
  if (message?.refusal) details.push('the model returned a refusal');
  return `OpenRouter returned no usable text for the cloze (${details.join('; ')}). The selected model may not support a text response; try another model or use Check connection.`;
};

const parseChatCompletionResponse = async (response: Response): Promise<ChatCompletionResponse> => {
  const data = (await response.json().catch(() => null)) as unknown;
  if (!data || typeof data !== 'object') {
    throw new Error(
      `OpenRouter returned invalid JSON (${response.status}${response.statusText ? ` ${response.statusText}` : ''}). Check connection or choose another model.`,
    );
  }
  return data as ChatCompletionResponse;
};

type StructuredStudyCard = {
  learning?: unknown;
  cloze_hint?: unknown;
  gloss?: unknown;
  translation?: unknown;
  tags?: unknown;
};

const parseStructuredStudyCard = (
  content: string,
  contextText: string,
  selectedText: string,
  selectedSpan: TextSpan | undefined,
  sourceText: string,
  enriched = false,
): Omit<StudyCardAIGeneration, 'usage' | 'generationDurationMs'> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(
      'OpenRouter returned text instead of the required structured study-card JSON object. Choose a model marked as structured-output capable.',
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(
      'OpenRouter returned structured JSON without the required study-card fields. Choose another structured-output model.',
    );
  }
  const card = parsed as StructuredStudyCard;
  if (
    typeof card.cloze_hint !== 'string' ||
    typeof card.gloss !== 'string' ||
    typeof card.translation !== 'string' ||
    !Array.isArray(card.tags) ||
    !card.tags.every((tag) => typeof tag === 'string')
  ) {
    const keys = Object.keys(card).join(', ') || 'none';
    throw new Error(
      `OpenRouter returned incomplete study-card JSON (keys: ${keys}). Expected cloze_hint, gloss, translation, and tags.`,
    );
  }
  if (!card.gloss.trim() || !card.translation.trim()) {
    throw new Error('OpenRouter returned an empty gloss or translation field. Try again.');
  }
  return {
    ...(enriched ? { learning: parseLearningContent(card.learning) } : {}),
    clozeText: buildClozeText(contextText, selectedText, selectedSpan, card.cloze_hint),
    gloss: card.gloss.trim(),
    translation: card.translation.trim(),
    sourceText,
    tags: card.tags
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 3),
  };
};

const asFiniteNumber = (value: unknown): number | null => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const calculateTokenCost = (
  promptTokens: number | null,
  completionTokens: number | null,
  pricing: OpenRouterModelPricing | undefined,
): number | null => {
  if (promptTokens === null || completionTokens === null) return null;
  const inputPrice = Number(pricing?.prompt ?? pricing?.input);
  const outputPrice = Number(pricing?.completion ?? pricing?.output);
  if (!Number.isFinite(inputPrice) || !Number.isFinite(outputPrice)) return null;
  return promptTokens * inputPrice + completionTokens * outputPrice;
};

const normalizeUsage = (
  usage: ChatCompletionResponse['usage'],
  pricing: OpenRouterModelPricing | undefined,
): StudyCardAIUsage | null => {
  if (!usage) return null;
  const promptTokens = asFiniteNumber(usage.prompt_tokens);
  const completionTokens = asFiniteNumber(usage.completion_tokens);
  const totalTokens = asFiniteNumber(usage.total_tokens);
  const providerCost = asFiniteNumber(usage.cost);
  const calculatedCost = calculateTokenCost(promptTokens, completionTokens, pricing);
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cost: providerCost ?? calculatedCost,
    costSource:
      providerCost !== null ? 'provider' : calculatedCost !== null ? 'calculated' : 'unavailable',
  };
};

export const generateStudyCardCloze = async ({
  enriched = false,
  apiKey,
  model,
  baseUrl = DEFAULT_BASE_URL,
  contextText,
  selectedText,
  selectedSpan,
  definitions,
  sourceText,
  targetLanguage,
  prompt,
  additionalContextBefore,
  additionalContextAfter,
  reasoningEffort,
  budgetUsd,
  pricing,
  provider,
  signal,
}: GenerateStudyCardClozeOptions): Promise<StudyCardAIGeneration> => {
  if (!apiKey.trim()) throw new Error('Enter an OpenRouter token first.');
  if (!model.trim()) throw new Error('Choose an OpenRouter model first.');
  const generationStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const systemPrompt =
    getStudyCardPrompt(prompt || DEFAULT_STUDY_CARD_CLOZE_PROMPT) +
    (enriched
      ? '\nThe response includes one additional required property: learning.\n' +
        LEARNING_INSTRUCTIONS
      : '');
  const userPrompt = buildStudyCardPrompt({
    contextText,
    selectedText,
    definitions,
    targetLanguage,
    additionalContextBefore,
    additionalContextAfter,
  });
  const maxTokens = calculateStudyCardMaxTokens({
    budgetUsd,
    prompt: `${systemPrompt}\n${userPrompt}`,
    pricing,
  });
  let response: Response;
  try {
    response = await getAIFetch()(
      `${(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://readest.com',
          'X-Title': 'Readest',
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          // Reasoning tokens count against the completion limit. 1,000 tokens
          // is too small for models such as GLM Flash and can yield a response
          // with reasoning but no assistant content.
          max_tokens: maxTokens,
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
          provider: buildStudyCardProviderRequest(provider),
          response_format: enriched
            ? {
                ...STRUCTURED_CLOZE_RESPONSE_FORMAT,
                json_schema: {
                  ...STRUCTURED_CLOZE_RESPONSE_FORMAT.json_schema,
                  name: 'study_card_learning',
                  schema: {
                    ...STRUCTURED_CLOZE_RESPONSE_FORMAT.json_schema.schema,
                    properties: {
                      ...STRUCTURED_CLOZE_RESPONSE_FORMAT.json_schema.schema.properties,
                      learning: LEARNING_SCHEMA,
                    },
                    required: [
                      ...STRUCTURED_CLOZE_RESPONSE_FORMAT.json_schema.schema.required,
                      'learning',
                    ],
                  },
                },
              }
            : STRUCTURED_CLOZE_RESPONSE_FORMAT,
          usage: { include: true },
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: userPrompt,
            },
          ],
        }),
        signal,
      },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error(
      `Could not connect to OpenRouter: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) throw await createOpenRouterResponseError(response);
  const data = await parseChatCompletionResponse(response);
  const content = extractTextContent(data.choices?.[0]?.message?.content);
  if (!content.trim()) throw new Error(describeNoTextResponse(data));
  const generated = parseStructuredStudyCard(
    content,
    contextText,
    selectedText,
    selectedSpan,
    sourceText || contextText,
    enriched,
  );
  if (
    generated.learning &&
    (!contextText.includes(generated.learning.learningTarget) ||
      !generated.learning.learningTarget.includes(selectedText))
  ) {
    throw new Error(
      'The learning target must be an original expression containing the selection. Generate again.',
    );
  }
  return {
    ...generated,
    usage: normalizeUsage(data.usage, pricing),
    generationDurationMs: Math.max(
      0,
      Math.round(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - generationStartedAt,
      ),
    ),
  };
};

const studyCardGenerationCacheKey = ({
  enriched,
  apiKey,
  model,
  baseUrl,
  contextText,
  selectedText,
  selectedSpan,
  definitions,
  sourceText,
  targetLanguage,
  prompt,
  additionalContextBefore,
  additionalContextAfter,
  reasoningEffort,
  budgetUsd,
  provider,
}: GenerateStudyCardClozeOptions): string =>
  JSON.stringify({
    enriched: !!enriched,
    apiKey,
    model,
    baseUrl,
    contextText,
    selectedText,
    selectedSpan,
    definitions,
    sourceText,
    targetLanguage,
    prompt,
    additionalContextBefore,
    additionalContextAfter,
    reasoningEffort,
    budgetUsd,
    provider,
  });

/**
 * Reuses an in-flight or completed generation for automatic study-card
 * generation. Manual generation deliberately calls `generateStudyCardCloze`
 * directly so the user can request a fresh result.
 */
export const generateStudyCardClozeCached = (
  options: GenerateStudyCardClozeOptions,
): Promise<StudyCardAIGeneration> => {
  if (options.signal) return generateStudyCardCloze(options);
  const key = studyCardGenerationCacheKey(options);
  const cached = studyCardGenerationCache.get(key);
  if (cached) return cached;

  const generation = generateStudyCardCloze(options);
  studyCardGenerationCache.set(key, generation);
  while (studyCardGenerationCache.size > STUDY_CARD_GENERATION_CACHE_LIMIT) {
    const oldestKey = studyCardGenerationCache.keys().next().value;
    if (!oldestKey) break;
    studyCardGenerationCache.delete(oldestKey);
  }
  void generation.catch(() => {
    if (studyCardGenerationCache.get(key) === generation) studyCardGenerationCache.delete(key);
  });
  return generation;
};

export const checkOpenRouterConnection = async ({
  apiKey,
  model,
  baseUrl = DEFAULT_BASE_URL,
  signal,
}: CheckOpenRouterConnectionOptions): Promise<OpenRouterConnectionResult> => {
  if (!apiKey.trim()) throw new Error('Enter an OpenRouter token first.');
  const models = await fetchOpenRouterModels(baseUrl, apiKey, signal);
  const structuredModels = models.filter(supportsOpenRouterStructuredOutputs);
  const selectedModelAvailable =
    !model?.trim() || models.some((candidate) => candidate.id === model);
  return {
    modelCount: models.length,
    structuredModelCount: structuredModels.length,
    selectedModelAvailable,
    selectedModelSupportsStructuredOutputs:
      !model?.trim() || structuredModels.some((candidate) => candidate.id === model),
  };
};

export const estimateStudyCardCost = (
  prompt: string,
  pricing: OpenRouterModelPricing | undefined,
  expectedOutputTokens = 80,
): number | null => {
  const inputPrice = Number(pricing?.prompt ?? pricing?.input);
  const outputPrice = Number(pricing?.completion ?? pricing?.output);
  if (!Number.isFinite(inputPrice) || !Number.isFinite(outputPrice)) return null;
  const inputTokens = Math.ceil(prompt.length / 4);
  return inputTokens * inputPrice + expectedOutputTokens * outputPrice;
};

export { formatOpenRouterModelPrice };
