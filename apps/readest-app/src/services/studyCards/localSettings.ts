import type { AnkiDroidDestination } from './ankiDroidDestination';

export const STUDY_CARD_SETTINGS_KEY = 'readest.studyCards.v1';

export type StudyCardLocalSettings = {
  version: 1;
  destination?: AnkiDroidDestination;
};

const emptySettings = (): StudyCardLocalSettings => ({ version: 1 });

export const loadStudyCardSettings = (
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined'
    ? null
    : localStorage,
): StudyCardLocalSettings => {
  if (!storage) return emptySettings();
  try {
    const raw = storage.getItem(STUDY_CARD_SETTINGS_KEY);
    if (!raw) return emptySettings();
    const parsed = JSON.parse(raw) as Partial<StudyCardLocalSettings>;
    if (parsed.version !== 1 || !parsed.destination) return emptySettings();
    const destination = parsed.destination;
    const mapping = destination.mapping;
    if (
      typeof destination.deckId !== 'string' ||
      typeof destination.modelId !== 'string' ||
      typeof destination.deckName !== 'string' ||
      typeof destination.modelName !== 'string' ||
      !mapping ||
      typeof mapping.contextField !== 'string' ||
      (mapping.extraField !== undefined && typeof mapping.extraField !== 'string') ||
      (mapping.sourceField !== undefined && typeof mapping.sourceField !== 'string')
    )
      return emptySettings();
    return {
      version: 1,
      destination: {
        ...destination,
        mapping: { ...mapping },
      },
    };
  } catch {
    return emptySettings();
  }
};

export const saveStudyCardSettings = (
  settings: StudyCardLocalSettings,
  storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined'
    ? null
    : localStorage,
): void => {
  if (!storage) return;
  try {
    storage.setItem(
      STUDY_CARD_SETTINGS_KEY,
      JSON.stringify({ version: 1, destination: settings.destination }),
    );
  } catch {
    // Device-local preferences are best effort; study-card copy still works.
  }
};

export const clearStudyCardSettings = (
  storage: Pick<Storage, 'removeItem'> | null = typeof localStorage === 'undefined'
    ? null
    : localStorage,
): void => {
  try {
    storage?.removeItem(STUDY_CARD_SETTINGS_KEY);
  } catch {
    // Ignore unavailable storage.
  }
};
