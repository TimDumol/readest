import { serializeDraftForAnki, validateDraftForAnki } from './draftBuilder';
import type { SelectionSnapshot, StudyCardDraft } from './types';
import type { AnkiDroidModel } from '@/utils/ankiDroidBridge';

export type AnkiDroidFieldMapping = {
  contextField: string;
  extraField?: string;
  sourceField?: string;
};

export type AnkiDroidDestination = {
  deckId: string;
  deckName: string;
  modelId: string;
  modelName: string;
  mapping: AnkiDroidFieldMapping;
};

export const validateClozeModel = (
  model: AnkiDroidModel,
  mapping: AnkiDroidFieldMapping,
): string | null => {
  if (model.type !== 1) return 'Choose a cloze note type.';
  if (!model.fieldNames.includes(mapping.contextField))
    return 'The context field no longer exists in this model.';
  const hasClozeFilter = model.clozeTemplates.some(
    (template) =>
      template.question.includes(`{{cloze:${mapping.contextField}}}`) ||
      template.answer.includes(`{{cloze:${mapping.contextField}}}`),
  );
  if (!hasClozeFilter)
    return 'The selected context field is not referenced with an Anki cloze filter.';
  for (const field of [mapping.extraField, mapping.sourceField]) {
    if (field && !model.fieldNames.includes(field))
      return `The mapped field “${field}” no longer exists.`;
  }
  return null;
};

export const buildMappedAnkiFields = (
  draft: StudyCardDraft,
  snapshot: SelectionSnapshot,
  model: AnkiDroidModel,
  mapping: AnkiDroidFieldMapping,
): string[] | null => {
  if (!validateDraftForAnki(draft).ok || validateClozeModel(model, mapping)) return null;
  const serialized = serializeDraftForAnki(draft, snapshot.source, {
    includeSourceInExtra: !mapping.sourceField,
  });
  if (!serialized) return null;
  const fields = model.fieldNames.map(() => '');
  const contextIndex = model.fieldNames.indexOf(mapping.contextField);
  fields[contextIndex] = serialized.context;
  if (mapping.extraField) {
    const extraIndex = model.fieldNames.indexOf(mapping.extraField);
    if (extraIndex >= 0) fields[extraIndex] = serialized.extra;
  }
  if (mapping.sourceField) {
    const sourceIndex = model.fieldNames.indexOf(mapping.sourceField);
    if (sourceIndex >= 0) fields[sourceIndex] = serialized.source;
  }
  return fields;
};

export const defaultFieldMapping = (model: AnkiDroidModel): AnkiDroidFieldMapping => ({
  contextField: model.fieldNames[0] ?? '',
  extraField: model.fieldNames[1],
});
