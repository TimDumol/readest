import { describe, expect, it } from 'vitest';

import {
  clearStudyCardSettings,
  loadStudyCardSettings,
  saveStudyCardSettings,
  STUDY_CARD_SETTINGS_KEY,
} from '@/services/studyCards/localSettings';

const destination = {
  deckId: '12',
  deckName: 'Spanish',
  modelId: '34',
  modelName: 'Cloze',
  mapping: { contextField: 'Text', extraField: 'Extra' },
};

describe('study card local settings', () => {
  it('persists only versioned destination identity and mapping', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    };

    saveStudyCardSettings({ version: 1, destination }, storage);
    expect(loadStudyCardSettings(storage).destination).toEqual(destination);
    expect(data.get(STUDY_CARD_SETTINGS_KEY)).not.toContain('permission');
    expect(data.get(STUDY_CARD_SETTINGS_KEY)).not.toContain('draft');
    clearStudyCardSettings(storage);
    expect(loadStudyCardSettings(storage)).toEqual({ version: 1 });
  });

  it('rejects malformed or old settings', () => {
    const storage = {
      getItem: () => JSON.stringify({ version: 0, destination }),
    };
    expect(loadStudyCardSettings(storage)).toEqual({ version: 1 });
  });
});
