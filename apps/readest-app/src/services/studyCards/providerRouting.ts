export const STUDY_CARD_PROVIDER_SORTS = ['price', 'throughput', 'latency'] as const;

export type StudyCardProviderSort = (typeof STUDY_CARD_PROVIDER_SORTS)[number];

/**
 * OpenRouter provider routing preferences for study-card generation.
 *
 * Provider names are the slugs returned by OpenRouter for a model endpoint.
 * `only` restricts routing to an allowlist, while `ignore` excludes specific
 * providers. When `sort` is omitted, OpenRouter keeps its default routing.
 */
export type StudyCardProviderPreferences = {
  only?: readonly string[];
  ignore?: readonly string[];
  sort?: StudyCardProviderSort;
};

export type StudyCardProviderRequest = {
  require_parameters: true;
  only?: string[];
  ignore?: string[];
  sort?: StudyCardProviderSort;
};

const normalizeProviderList = (providers: readonly string[] | undefined): string[] | undefined => {
  if (!Array.isArray(providers)) return undefined;
  const normalized = [
    ...new Set(
      providers
        .filter((provider): provider is string => typeof provider === 'string')
        .map((provider) => provider.trim())
        .filter(Boolean),
    ),
  ];
  return normalized.length ? normalized : undefined;
};

const isProviderSort = (value: unknown): value is StudyCardProviderSort =>
  typeof value === 'string' && (STUDY_CARD_PROVIDER_SORTS as readonly string[]).includes(value);

/**
 * Build the OpenRouter `provider` request object while dropping empty or
 * malformed persisted values. The cloze request always requires provider
 * support for its structured response parameters.
 */
export const buildStudyCardProviderRequest = (
  preferences?: StudyCardProviderPreferences,
): StudyCardProviderRequest => {
  const only = normalizeProviderList(preferences?.only);
  const ignore = normalizeProviderList(preferences?.ignore);
  const sort = isProviderSort(preferences?.sort) ? preferences.sort : undefined;

  return {
    require_parameters: true,
    ...(only ? { only } : {}),
    ...(ignore ? { ignore } : {}),
    ...(sort ? { sort } : {}),
  };
};
