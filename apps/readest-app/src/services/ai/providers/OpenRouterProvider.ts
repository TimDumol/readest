import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, AISettings, AIProviderName } from '../types';
import { aiLogger } from '../logger';
import { AI_TIMEOUTS } from '../utils/retry';
import { getAIFetch } from '../utils/httpFetch';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';
const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small';

/**
 * Provider for any OpenAI-compatible /v1/chat/completions endpoint, with
 * OpenRouter as the default. Users supply their own API key and base URL.
 *
 * Distinct from `AIGatewayProvider` (which is bound to Vercel AI Gateway's
 * proprietary protocol) — this one targets the OpenAI REST schema and so
 * works with OpenRouter, Together, Groq, vLLM, LiteLLM, OpenAI itself, etc.
 *
 * Transport: every outbound HTTP call from this provider is routed through
 * {@link getAIFetch} so that in the Tauri app it goes via the Rust
 * `@tauri-apps/plugin-http` transport (no CORS preflight, no Android
 * cleartext block, behaves like `curl`). In a pure web build it falls
 * back to `window.fetch` and the upstream must serve correct CORS headers.
 */
export class OpenRouterProvider implements AIProvider {
  id: AIProviderName = 'openrouter';
  name = 'OpenRouter (Custom)';
  requiresAuth = true;

  private settings: AISettings;
  private client: ReturnType<typeof createOpenAICompatible>;
  private baseUrl: string;
  private apiKey: string;
  private httpFetch: typeof fetch;

  constructor(settings: AISettings) {
    this.settings = settings;
    if (!settings.openrouterApiKey) {
      throw new Error('OpenRouter API key required');
    }
    this.apiKey = settings.openrouterApiKey;
    this.baseUrl = (settings.openrouterBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.httpFetch = getAIFetch();
    this.client = createOpenAICompatible({
      name: 'openrouter',
      baseURL: this.baseUrl,
      apiKey: this.apiKey,
      // Optional OpenRouter app attribution. Harmless for other OpenAI-
      // compatible backends (they ignore unknown headers).
      headers: {
        'HTTP-Referer': 'https://readest.com',
        'X-Title': 'Readest',
      },
      // Route chat completions / embeddings through our environment-aware
      // fetch so streaming responses bypass the renderer's CORS sandbox
      // when running inside Tauri.
      fetch: this.httpFetch,
    });
    aiLogger.provider.init('openrouter', settings.openrouterModel || DEFAULT_MODEL);
  }

  getModel(): LanguageModel {
    const modelId = this.settings.openrouterModel || DEFAULT_MODEL;
    return this.client.chatModel(modelId);
  }

  getEmbeddingModel(): EmbeddingModel {
    const modelId = this.settings.openrouterEmbeddingModel || DEFAULT_EMBEDDING_MODEL;
    return this.client.textEmbeddingModel(modelId);
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const modelId = this.settings.openrouterModel || DEFAULT_MODEL;
      aiLogger.provider.init('openrouter', `healthCheck starting with model: ${modelId}`);
      // OpenAI-compatible servers all expose /models for listing; using it
      // as a lightweight check (no token spend, fast).
      const response = await this.httpFetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(AI_TIMEOUTS.HEALTH_CHECK),
      });
      if (!response.ok) {
        throw await createOpenRouterResponseError(response);
      }
      aiLogger.provider.init('openrouter', 'healthCheck success');
      return true;
    } catch (e) {
      aiLogger.provider.error('openrouter', `healthCheck failed: ${(e as Error).message}`);
      return false;
    }
  }
}

/**
 * Lightweight model entry returned by an OpenAI-compatible `/models`
 * endpoint. Only the fields we actually consume are typed; the upstream
 * response is allowed to carry arbitrary extras (OpenRouter for example
 * returns pricing, context length, modality, etc).
 */
export interface OpenRouterModelInfo {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: OpenRouterModelPricing;
  supported_parameters?: string[];
}

export interface OpenRouterModelPricing {
  prompt?: string;
  completion?: string;
  input?: string;
  output?: string;
}

export const filterOpenRouterModels = (
  models: OpenRouterModelInfo[],
  query: string,
  selectedId?: string,
): OpenRouterModelInfo[] => {
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? models.filter((model) =>
        `${model.name ?? ''} ${model.id}`.toLowerCase().includes(normalizedQuery),
      )
    : models;
  if (selectedId && !filtered.some((model) => model.id === selectedId)) {
    const selected = models.find((model) => model.id === selectedId);
    if (selected) return [selected, ...filtered];
  }
  return filtered;
};

export const supportsOpenRouterStructuredOutputs = (
  model: Pick<OpenRouterModelInfo, 'supported_parameters'>,
): boolean => {
  const supported = new Set(model.supported_parameters ?? []);
  return supported.has('response_format') && supported.has('structured_outputs');
};

type OpenRouterErrorPayload = {
  error?: {
    code?: unknown;
    message?: unknown;
    type?: unknown;
  };
  message?: unknown;
};

const asNonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/**
 * Turn an OpenRouter error response into a user-actionable message without
 * including the request body or the user's API key.
 */
export const createOpenRouterResponseError = async (response: Response): Promise<Error> => {
  const payload = (await response.json().catch(() => null)) as OpenRouterErrorPayload | null;
  const providerError = payload?.error;
  const code = asNonEmptyString(providerError?.code);
  const message =
    asNonEmptyString(providerError?.message) ?? asNonEmptyString(payload?.message) ?? undefined;
  const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  const requestId =
    response.headers?.get?.('x-request-id') ?? response.headers?.get?.('x-openrouter-request-id');
  const details = [code, message, requestId ? `request id: ${requestId}` : undefined].filter(
    (value): value is string => !!value,
  );
  return new Error(
    `OpenRouter request failed (${status})${details.length ? `: ${details.join(' — ')}` : ''}`,
  );
};

const formatPricePerMillion = (value: string): string => {
  const price = Number(value) * 1_000_000;
  if (!Number.isFinite(price)) return '?';
  const fractionDigits = price >= 1 ? 2 : price >= 0.01 ? 4 : 6;
  return price
    .toFixed(fractionDigits)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1');
};

export const formatOpenRouterModelPrice = (pricing: OpenRouterModelPricing | undefined): string => {
  if (!pricing) return 'price unavailable';
  const input = pricing.prompt ?? pricing.input;
  const output = pricing.completion ?? pricing.output;
  if (input === undefined && output === undefined) return 'price unavailable';
  return `$${input === undefined ? '?' : formatPricePerMillion(input)}/M in · $${
    output === undefined ? '?' : formatPricePerMillion(output)
  }/M out`;
};

/**
 * Fetch the list of models exposed by an OpenAI-compatible endpoint.
 * Used by the settings UI to populate a model picker.
 *
 * Goes through {@link getAIFetch} so that in Tauri the request hits the
 * Rust HTTP transport rather than the renderer, avoiding CORS preflight
 * and Android cleartext restrictions.
 */
export async function fetchOpenRouterModels(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<OpenRouterModelInfo[]> {
  const trimmed = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const url = `${trimmed}/models`;
  const httpFetch = getAIFetch();
  const response = await httpFetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!response.ok) {
    throw await createOpenRouterResponseError(response);
  }
  const json = (await response.json().catch(() => null)) as { data?: unknown } | null;
  if (!json || !Array.isArray(json.data)) {
    throw new Error(
      'OpenRouter returned an invalid /models response. Check the endpoint and token.',
    );
  }
  return json.data.filter(
    (model): model is OpenRouterModelInfo =>
      !!model && typeof model === 'object' && typeof (model as { id?: unknown }).id === 'string',
  );
}
