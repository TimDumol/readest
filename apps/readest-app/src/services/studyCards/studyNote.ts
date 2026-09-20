import type { AnkiDroidModel } from '@/utils/ankiDroidBridge';
import { getContentMd5, stubTranslation as _ } from '@/utils/misc';
import { serializeAnkiText, validateDraftForAnki } from './draftBuilder';
import {
  EXERCISE_TYPES,
  type SelectionSnapshot,
  type StudyCardDraft,
  type StudyCardType,
} from './types';

export const STUDY_NOTE_NAME = 'Readest Language v1';
export const STUDY_NOTE_NAME_PREFIX = 'Readest Language v';

const studyNoteNamePattern = /^Readest Language v([1-9]\d*)$/;

export const isReadestStudyNoteName = (name: string): boolean => studyNoteNamePattern.test(name);

export const getNextStudyNoteName = (models: Array<Pick<AnkiDroidModel, 'name'>>): string => {
  const highestVersion = models.reduce((highest, model) => {
    const version = studyNoteNamePattern.exec(model.name)?.[1];
    const parsedVersion = version ? Number(version) : 0;
    return Number.isSafeInteger(parsedVersion) ? Math.max(highest, parsedVersion) : highest;
  }, 1);
  return `${STUDY_NOTE_NAME_PREFIX}${highestVersion + 1}`;
};

export const CARD_NAMES: Record<StudyCardType, string> = {
  recognition: 'Recognition',
  vocabulary: 'Vocabulary',
};
export const STUDY_NOTE_FIELDS = [
  'LookupId',
  'SchemaVersion',
  'Sentence',
  'SelectedText',
  'SentenceBefore',
  'SentenceAfter',
  'LearningTarget',
  'Lemma',
  'GrammaticalForm',
  'Meaning',
  'Explanation',
  'Translation',
  'UsageNote',
  'Definitions',
  'SourceText',
  'Book',
  'Chapter',
  'SourceReference',
  'EnableRecognition',
  ...EXERCISE_TYPES.flatMap((kind) => {
    const name = CARD_NAMES[kind];
    return [
      `Enable${name}`,
      `${name}Prompt`,
      `${name}Answer`,
      `${name}Hint`,
      `${name}Alternatives`,
      `${name}Explanation`,
    ];
  }),
];

const reference =
  '<details class="readest-details"><summary>Source</summary><div class="readest-source-meta">{{Book}} · {{Chapter}}</div><div>{{SourceText}}</div></details>';
const recognitionFront =
  '<div class="readest-card readest-recognition"><div class="readest-card-header"><span class="readest-card-badge">Recognition</span></div><div class="readest-context">{{SentenceBefore}}<mark class="readest-target">{{SelectedText}}</mark>{{SentenceAfter}}</div></div>';
const recognitionAnswer = `{{FrontSide}}<div class="readest-divider"></div><div class="readest-section"><div class="readest-label">Meaning</div><div class="readest-answer">{{Meaning}}</div></div>{{#LearningTarget}}<div class="readest-section"><div class="readest-label">Learning target</div><div>{{LearningTarget}}</div></div>{{/LearningTarget}}{{#Lemma}}<div class="readest-meta"><span>{{Lemma}}</span>{{#GrammaticalForm}}<span>{{GrammaticalForm}}</span>{{/GrammaticalForm}}</div>{{/Lemma}}{{#Explanation}}<div class="readest-section"><div class="readest-label">Explanation</div><div>{{Explanation}}</div></div>{{/Explanation}}{{#Translation}}<div class="readest-section"><div class="readest-label">Translation</div><div>{{Translation}}</div></div>{{/Translation}}{{#UsageNote}}<div class="readest-section"><div class="readest-label">Usage</div><div>{{UsageNote}}</div></div>{{/UsageNote}}{{#Definitions}}<details class="readest-details"><summary>Dictionary</summary>{{Definitions}}</details>{{/Definitions}}${reference}`;
export const STUDY_NOTE_TEMPLATES = [
  {
    name: 'Recognition',
    question: `{{#EnableRecognition}}${recognitionFront}{{/EnableRecognition}}`,
    answer: recognitionAnswer,
  },
  ...EXERCISE_TYPES.map((kind) => {
    const name = CARD_NAMES[kind];
    return {
      name,
      question: `{{#Enable${name}}}<div class="readest-card readest-production"><div class="readest-card-header"><span class="readest-card-badge readest-card-badge-production">Production</span></div><div class="readest-prompt">{{${name}Prompt}}</div>{{#${name}Hint}}<div class="readest-hint"><div class="readest-label">Hint</div><div>{{hint:${name}Hint}}</div></div>{{/${name}Hint}}</div>{{/Enable${name}}}`,
      answer: `{{FrontSide}}<div class="readest-divider"></div><div class="readest-section"><div class="readest-label">Answer</div><div class="readest-answer">{{${name}Answer}}</div></div>{{#${name}Alternatives}}<div class="readest-section"><div class="readest-label">Also accepted</div><div>{{${name}Alternatives}}</div></div>{{/${name}Alternatives}}{{#${name}Explanation}}<div class="readest-section"><div class="readest-label">Explanation</div><div>{{${name}Explanation}}</div></div>{{/${name}Explanation}}{{#Meaning}}<div class="readest-section"><div class="readest-label">Meaning</div><div>{{Meaning}}</div></div>{{/Meaning}}<div class="readest-section"><div class="readest-label">Context</div><div class="readest-context">{{Sentence}}</div></div>{{#Translation}}<div class="readest-section"><div class="readest-label">Translation</div><div>{{Translation}}</div></div>{{/Translation}}${reference}`,
    };
  }),
];
export const STUDY_NOTE_CSS =
  '.card { --readest-ink: #172033; --readest-muted: #5b667a; --readest-line: #d9e0ea; --readest-recognition: #2563eb; --readest-recognition-soft: #dbeafe; --readest-production: #15803d; --readest-production-soft: #dcfce7; background: #ffffff; color: var(--readest-ink); font-family: sans-serif; font-size: 21px; text-align: start; line-height: 1.45; padding: 18px; } .readest-card-header { margin-bottom: 16px; } .readest-card-badge { display: inline-block; padding: 4px 10px; border: 1px solid var(--readest-recognition); border-radius: 999px; color: var(--readest-recognition); background: var(--readest-recognition-soft); font-size: 0.68em; font-weight: 700; letter-spacing: 0.08em; line-height: 1.2; text-transform: uppercase; } .readest-card-badge-production { border-color: var(--readest-production); color: var(--readest-production); background: var(--readest-production-soft); } .readest-context { font-size: 1.08em; line-height: 1.55; } .readest-target { padding: 1px 4px; border-radius: 4px; color: var(--readest-recognition); background: var(--readest-recognition-soft); font-weight: 700; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; } .readest-prompt { padding: 12px 14px; border-left: 4px solid var(--readest-production); border-radius: 4px; background: var(--readest-production-soft); font-size: 1.08em; font-weight: 600; } .readest-hint { margin-top: 14px; padding: 10px 12px; border-left: 3px solid var(--readest-muted); color: var(--readest-muted); font-size: 0.9em; } .readest-divider { margin: 20px 0 16px; border-top: 2px solid var(--readest-line); } .readest-section { margin: 12px 0; } .readest-label { margin-bottom: 3px; color: var(--readest-muted); font-size: 0.65em; font-weight: 700; letter-spacing: 0.08em; line-height: 1.2; text-transform: uppercase; } .readest-answer { color: var(--readest-production); font-size: 1.2em; font-weight: 700; } .readest-meta { display: flex; flex-wrap: wrap; gap: 6px 12px; margin: 14px 0; color: var(--readest-muted); font-size: 0.82em; } .readest-meta span + span { padding-left: 12px; border-left: 1px solid var(--readest-line); } .readest-details { margin-top: 16px; color: var(--readest-muted); font-size: 0.82em; } .readest-details summary { color: var(--readest-ink); font-weight: 700; cursor: pointer; } .readest-source-meta { margin: 8px 0; } @media (prefers-color-scheme: dark) { .card { --readest-ink: #edf2f7; --readest-muted: #aab5c5; --readest-line: #3a4658; --readest-recognition-soft: #172554; --readest-production-soft: #14351f; background: #111827; } }';

export const validateStudyNoteModel = (model: AnkiDroidModel): string | null => {
  if (
    model.type !== 0 ||
    !STUDY_NOTE_FIELDS.every((field) => model.fieldNames.includes(field)) ||
    model.fieldNames[0] !== 'LookupId'
  )
    return _('Choose a Readest Language note type.');
  if (
    STUDY_NOTE_TEMPLATES.some(
      (template, index) =>
        !model.clozeTemplates[index]?.question.includes(`{{#Enable${template.name}}}`),
    )
  ) {
    return _('The Readest note type is missing a card template or its enable condition.');
  }
  if (model.clozeTemplates.length !== STUDY_NOTE_TEMPLATES.length)
    return _('The Readest note type has an unexpected number of card templates.');
  return null;
};

export const validateStudyNote = (draft: StudyCardDraft): string | null => {
  const sourceValidation = validateDraftForAnki(draft);
  if (!sourceValidation.ok) return sourceValidation.message;
  if (!draft.cardTypes.length) return _('Select at least one card type.');
  if (
    draft.cardTypes.includes('recognition') &&
    !draft.gloss.trim() &&
    !draft.definitions.some((entry) => entry.included && entry.text.trim())
  ) {
    return _('Add a contextual meaning or include a definition for recognition.');
  }
  for (const kind of draft.cardTypes) {
    if (kind === 'recognition') continue;
    const exercise = draft.learning?.exercises[kind];
    if (!exercise?.applicable || !exercise.prompt.trim() || !exercise.answer.trim())
      return _('Generate applicable content for the selected card types first.');
  }
  return null;
};

/** Stable deduplication key, not a security hash; independent of generated content. */
export const studyLookupId = (draft: StudyCardDraft, snapshot: SelectionSnapshot): string =>
  `readest-v1-${getContentMd5([
    snapshot.source.bookHash || snapshot.source.bookTitle || '',
    snapshot.source.cfi || snapshot.source.href || '',
    snapshot.source.sectionIndex ?? '',
    snapshot.contextText,
    snapshot.selectedSpan?.start ?? '',
    draft.selectedText,
  ])}`;

export const buildStudyNoteFields = (
  draft: StudyCardDraft,
  snapshot: SelectionSnapshot,
): Record<string, string> => {
  const fields: Record<string, string> = Object.fromEntries(
    STUDY_NOTE_FIELDS.map((field) => [field, '']),
  );
  const learning = draft.learning;
  const definitions = draft.definitions
    .filter((entry) => entry.included)
    .map((entry) => `${entry.headword} — ${entry.text} (${entry.sourceLabel})`)
    .join('\n\n');
  const values: Record<string, string> = {
    LookupId: studyLookupId(draft, snapshot),
    SchemaVersion: '1',
    Sentence: draft.contextText,
    SelectedText: draft.selectedText,
    SentenceBefore: draft.contextText.slice(0, draft.selectedSpan?.start ?? 0),
    SentenceAfter: draft.contextText.slice(draft.selectedSpan?.end ?? draft.contextText.length),
    LearningTarget: learning?.learningTarget ?? draft.selectedText,
    Lemma: learning?.lemma ?? '',
    GrammaticalForm: learning?.grammaticalForm ?? '',
    Meaning: draft.gloss,
    Explanation: learning?.explanation ?? '',
    Translation: draft.translation,
    UsageNote: learning?.usageNote ?? '',
    Definitions: definitions,
    SourceText: draft.sourceText,
    Book: snapshot.source.bookTitle ?? '',
    Chapter: snapshot.source.chapterTitle ?? '',
    SourceReference: snapshot.source.cfi || snapshot.source.href || '',
    EnableRecognition: draft.cardTypes.includes('recognition') ? '1' : '',
  };
  // Dictionary-only cards remain useful without an LLM connection.
  if (!values['Meaning']) values['Meaning'] = definitions;
  for (const kind of EXERCISE_TYPES) {
    const name = CARD_NAMES[kind];
    const exercise = learning?.exercises[kind];
    values[`Enable${name}`] = draft.cardTypes.includes(kind) && exercise?.applicable ? '1' : '';
    values[`${name}Prompt`] = exercise?.prompt ?? '';
    values[`${name}Answer`] = exercise?.answer ?? '';
    values[`${name}Hint`] = exercise?.hint ?? '';
    values[`${name}Alternatives`] = exercise?.alternatives.join('; ') ?? '';
    values[`${name}Explanation`] = exercise?.explanation ?? '';
  }
  for (const [key, value] of Object.entries(values)) fields[key] = serializeAnkiText(value);
  return fields;
};

export const buildStudyNoteCopy = (draft: StudyCardDraft, snapshot: SelectionSnapshot): string => {
  const parts = [
    `Selected cards: ${draft.cardTypes.map((kind) => CARD_NAMES[kind]).join(', ')}`,
    draft.contextText,
    `Selected text: ${draft.selectedText}`,
    `Meaning: ${draft.gloss}`,
  ];
  if (draft.learning)
    parts.push(
      `Learning target: ${draft.learning.learningTarget}`,
      `Lemma: ${draft.learning.lemma}`,
      draft.learning.grammaticalForm,
      draft.learning.usageNote,
    );
  for (const kind of draft.cardTypes) {
    if (kind === 'recognition') continue;
    const exercise = draft.learning?.exercises[kind];
    if (exercise?.applicable)
      parts.push(
        CARD_NAMES[kind],
        exercise.prompt,
        `Hint: ${exercise.hint}`,
        `Answer: ${exercise.answer}`,
        `Alternatives: ${exercise.alternatives.join('; ')}`,
        exercise.explanation,
      );
  }
  parts.push(
    draft.translation,
    ...draft.definitions.filter((entry) => entry.included).map((entry) => entry.text),
    draft.sourceText,
    snapshot.source.bookTitle ?? '',
    snapshot.source.chapterTitle ?? '',
  );
  return parts.filter(Boolean).join('\n\n');
};
