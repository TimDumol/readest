import { describe, expect, it } from 'vitest';

import {
  buildMappedAnkiFields,
  defaultFieldMapping,
  validateClozeModel,
} from '@/services/studyCards/ankiDroidDestination';
import { buildStudyCardDraft } from '@/services/studyCards/draftBuilder';
import type { AnkiDroidModel } from '@/utils/ankiDroidBridge';
import type { SelectionSnapshot } from '@/services/studyCards/types';

const model: AnkiDroidModel = {
  id: '1234567890123',
  name: 'Spanish Cloze',
  type: 1,
  fieldNames: ['Text', 'Extra', 'Source'],
  clozeTemplates: [{ name: 'Card 1', question: '{{cloze:Text}}', answer: '{{Back}}' }],
};
const snapshot: SelectionSnapshot = {
  id: 's1',
  selectedText: 'compré',
  contextText: 'Yo compré pan.',
  selectedSpan: { start: 3, end: 9 },
  status: 'ready',
  source: { bookTitle: 'Libro' },
};

describe('AnkiDroid destination mapping', () => {
  it('requires a real cloze model and cloze filter', () => {
    expect(validateClozeModel(model, defaultFieldMapping(model))).toBeNull();
    expect(validateClozeModel({ ...model, type: 0 }, defaultFieldMapping(model))).toContain(
      'cloze note type',
    );
    expect(
      validateClozeModel({ ...model, clozeTemplates: [] }, defaultFieldMapping(model)),
    ).toContain('cloze filter');
  });

  it('constructs fields in current model order and keeps Long IDs as strings', () => {
    const draft = buildStudyCardDraft(snapshot);
    const fields = buildMappedAnkiFields(draft, snapshot, model, {
      contextField: 'Text',
      extraField: 'Extra',
      sourceField: 'Source',
    });
    expect(fields?.[0]).toBe('Yo {{c1::compré}} pan.');
    expect(fields?.[1]).toBe('');
    expect(fields?.[2]).toContain('Libro');
    expect(model.id).toBe('1234567890123');
  });
});
