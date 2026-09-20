import { describe, expect, it } from 'vitest';
import { buildStudyCardDraft } from '@/services/studyCards/draftBuilder';
import {
  buildStudyNoteFields,
  getNextStudyNoteName,
  isReadestStudyNoteName,
  STUDY_NOTE_FIELDS,
  STUDY_NOTE_TEMPLATES,
  validateStudyNote,
  validateStudyNoteModel,
} from '@/services/studyCards/studyNote';
import { parseLearningContent } from '@/services/studyCards/learningContent';
import type { SelectionSnapshot } from '@/services/studyCards/types';
import { learningFixture } from './learningFixture';

const snapshot: SelectionSnapshot = {
  id: 'transient-id',
  selectedText: 'compró',
  contextText: 'Ella compró un libro.',
  selectedSpan: { start: 5, end: 11 },
  status: 'ready',
  source: { bookHash: 'book', cfi: 'location' },
};

describe('enriched study notes', () => {
  it('chooses the next version for a recreated Readest note type', () => {
    expect(isReadestStudyNoteName('Readest Language v1')).toBe(true);
    expect(isReadestStudyNoteName('Readest Language v2')).toBe(true);
    expect(isReadestStudyNoteName('Readest Language')).toBe(false);
    expect(getNextStudyNoteName([])).toBe('Readest Language v2');
    expect(
      getNextStudyNoteName([
        { name: 'Readest Language v1' },
        { name: 'Readest Language v3' },
        { name: 'Readest Language v2' },
        { name: 'Basic' },
      ]),
    ).toBe('Readest Language v4');
  });

  it('defaults to recognition and retains unselected production content', () => {
    const draft = buildStudyCardDraft(snapshot);
    expect(draft.cardTypes).toEqual(['recognition']);
    draft.gloss = 'bought';
    draft.learning = learningFixture();
    const fields = buildStudyNoteFields(draft, snapshot);
    expect(fields['EnableRecognition']).toBe('1');
    expect(fields['EnableVocabulary']).toBe('');
    expect(fields['Sentence']).toBe(snapshot.contextText);
    expect(fields['SelectedText']).toBe('compró');
    expect(fields['VocabularyAnswer']).toBe('compró');
    expect(fields).not.toHaveProperty('GrammarAnswer');
    expect(fields).not.toHaveProperty('EnableGrammar');
    expect(Object.keys(fields)).toEqual(STUDY_NOTE_FIELDS);
  });

  it('uses a stable identity across lookup sessions and escapes book content', () => {
    const draft = buildStudyCardDraft(snapshot);
    draft.gloss = '<script>alert(1)</script>';
    const fields = buildStudyNoteFields(draft, snapshot);
    expect(fields['Meaning']).toContain('&lt;script&gt;');
    expect(fields['LookupId']).toBe(
      buildStudyNoteFields(buildStudyCardDraft({ ...snapshot, id: 'another-session' }), snapshot)[
        'LookupId'
      ],
    );
  });

  it('gates the entire front of every template with its enable field', () => {
    for (const template of STUDY_NOTE_TEMPLATES) {
      expect(template.question.startsWith(`{{#Enable${template.name}}}`)).toBe(true);
      expect(template.question.endsWith(`{{/Enable${template.name}}}`)).toBe(true);
      expect(template.question).toContain('readest-card-badge');
    }
    expect(STUDY_NOTE_TEMPLATES[0]?.question).toContain('Recognition');
    expect(STUDY_NOTE_TEMPLATES[0]?.question).not.toContain('What does the highlighted text mean');
    expect(STUDY_NOTE_TEMPLATES[1]?.question).toContain('Production');
    expect(STUDY_NOTE_TEMPLATES[1]?.question).toContain('readest-prompt');
  });

  it('rejects empty selection and unavailable exercises before export', () => {
    const draft = buildStudyCardDraft(snapshot);
    expect(validateStudyNote(draft)).toMatch(/meaning/);
    draft.gloss = 'bought';
    expect(validateStudyNote(draft)).toBeNull();
    draft.cardTypes = [];
    expect(validateStudyNote(draft)).toMatch(/Select/);
    draft.cardTypes = ['vocabulary'];
    expect(validateStudyNote(draft)).toMatch(/Generate/);
    draft.learning = learningFixture();
    expect(validateStudyNote(draft)).toBeNull();
  });

  it('accepts customized presentation but rejects cloze models and missing card gates', () => {
    const model = {
      id: '1',
      name: 'Custom Readest',
      type: 0,
      fieldNames: STUDY_NOTE_FIELDS,
      clozeTemplates: STUDY_NOTE_TEMPLATES,
    };
    expect(validateStudyNoteModel(model)).toBeNull();
    expect(validateStudyNoteModel({ ...model, type: 1 })).not.toBeNull();
    expect(
      validateStudyNoteModel({ ...model, fieldNames: STUDY_NOTE_FIELDS.slice(1) }),
    ).not.toBeNull();
    expect(validateStudyNoteModel({ ...model, clozeTemplates: [] })).not.toBeNull();
    expect(
      validateStudyNoteModel({
        ...model,
        clozeTemplates: STUDY_NOTE_TEMPLATES.map((template) => ({
          ...template,
          question: template.question.replace('<div>', '<div class="custom">'),
        })),
      }),
    ).toBeNull();
  });

  it('rejects malformed and incomplete learning content', () => {
    expect(() => parseLearningContent({})).toThrow();
    expect(() => parseLearningContent({ lemma: 'comprar', exercises: [] })).toThrow();
    const content = learningFixture();
    content.exercises.vocabulary.answer = '';
    expect(() => parseLearningContent(content)).toThrow();
    content.exercises.vocabulary.answer = 'compró';
    content.exercises.vocabulary.applicable = false;
    expect(parseLearningContent(content).exercises.vocabulary).toMatchObject({
      applicable: false,
      prompt: '',
      answer: '',
      hint: '',
      explanation: '',
      alternatives: [],
    });
  });
});
