import { invoke } from '@tauri-apps/api/core';
import { isTauriAppPlatform } from '@/services/environment';

export type AnkiDroidPermission = 'granted' | 'denied' | 'unavailable' | 'requested';

export interface AnkiDroidStatus {
  supported: boolean;
  installed: boolean;
  apiAvailable: boolean;
  permission: AnkiDroidPermission;
}

export interface AnkiDroidDeck {
  id: string;
  name: string;
}

export interface AnkiDroidClozeTemplate {
  name: string;
  question: string;
  answer: string;
}

export interface AnkiDroidModel {
  id: string;
  name: string;
  type: number;
  fieldNames: string[];
  clozeTemplates: AnkiDroidClozeTemplate[];
}

export interface AnkiDroidAddResult {
  status: 'success' | 'definite_failure' | 'uncertain';
  noteId?: string;
  error?: string;
}

const unsupportedStatus: AnkiDroidStatus = {
  supported: false,
  installed: false,
  apiAvailable: false,
  permission: 'unavailable',
};

export const getAnkiDroidStatus = async (): Promise<AnkiDroidStatus> => {
  if (!isTauriAppPlatform()) return unsupportedStatus;
  try {
    return await invoke<AnkiDroidStatus>('plugin:native-bridge|anki_get_status');
  } catch {
    // Desktop Tauri exposes the shared command namespace but has no Android
    // implementation. Treat that the same as a missing Android capability.
    return unsupportedStatus;
  }
};

export const requestAnkiDroidPermission = async (): Promise<{ result: AnkiDroidPermission }> => {
  if (!isTauriAppPlatform()) return { result: 'unavailable' };
  return invoke<{ result: AnkiDroidPermission }>('plugin:native-bridge|anki_request_permission');
};

export const listAnkiDroidDecks = async (): Promise<AnkiDroidDeck[]> => {
  if (!isTauriAppPlatform()) return [];
  const result = await invoke<{ decks: AnkiDroidDeck[] }>('plugin:native-bridge|anki_list_decks');
  return result.decks;
};

export const listAnkiDroidModels = async (): Promise<AnkiDroidModel[]> => {
  if (!isTauriAppPlatform()) return [];
  const result = await invoke<{ models: AnkiDroidModel[] }>(
    'plugin:native-bridge|anki_list_models',
  );
  return result.models;
};

export const ensureAnkiDroidStudyModel = async (request: {
  name: string;
  fieldNames: string[];
  templates: AnkiDroidClozeTemplate[];
  css: string;
}): Promise<string> => {
  const result = await invoke<{ modelId: string }>('plugin:native-bridge|anki_ensure_study_model', {
    payload: request,
  });
  return result.modelId;
};

export const checkAnkiDroidDuplicate = async (
  modelId: string,
  firstField: string,
): Promise<boolean> => {
  if (!isTauriAppPlatform()) return false;
  const result = await invoke<{ duplicate: boolean }>('plugin:native-bridge|anki_check_duplicate', {
    payload: { modelId, firstField },
  });
  return result.duplicate;
};

export const addAnkiDroidNote = async (request: {
  modelId: string;
  deckId: string;
  fields: string[];
  tags: string[];
}): Promise<AnkiDroidAddResult> => {
  if (!isTauriAppPlatform())
    return { status: 'definite_failure', error: 'AnkiDroid is only available on Android.' };
  return invoke<AnkiDroidAddResult>('plugin:native-bridge|anki_add_note', { payload: request });
};
