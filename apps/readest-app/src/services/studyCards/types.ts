export type TextSpan = { start: number; end: number };

export type StudyCardSource = {
  bookTitle?: string;
  chapterTitle?: string;
  bookHash?: string;
  sectionIndex?: number;
  cfi?: string;
  href?: string;
};

export type SelectionSnapshot = {
  id: string;
  selectedText: string;
  language?: string;
  /** The enclosing paragraph/block captured at lookup time. */
  contextText: string;
  selectedSpan?: TextSpan;
  /** Sentence offsets are relative to contextText. */
  sentenceSpan?: TextSpan;
  status: 'ready' | 'unsupported' | 'unmapped';
  reason?: string;
  source: StudyCardSource;
};

export type StudyCardDefinition = {
  entryId: string;
  providerId: string;
  sourceLabel: string;
  headword: string;
  text: string;
  included: boolean;
};

export type StudyCardDraft = {
  snapshotId: string;
  selectedText: string;
  contextText: string;
  selectedSpan?: TextSpan;
  definitions: StudyCardDefinition[];
  gloss: string;
  translation: string;
  sourceText: string;
  tags: string[];
  /** Optional validated cloze returned by the user's LLM provider. */
  clozeText?: string;
  cardTypes: StudyCardType[];
  learning?: StudyCardLearning;
};

export const EXERCISE_TYPES = ['vocabulary'] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];
export type StudyCardType = 'recognition' | ExerciseType;
export type StudyCardExercise = {
  applicable: boolean;
  reason: string;
  prompt: string;
  answer: string;
  hint: string;
  alternatives: string[];
  explanation: string;
};
export type StudyCardLearning = {
  learningTarget: string;
  lemma: string;
  grammaticalForm: string;
  explanation: string;
  usageNote: string;
  exercises: Record<ExerciseType, StudyCardExercise>;
};

export type StudyCardContextMode = 'sentence' | 'paragraph';

export type AnkiSerializedFields = {
  context: string;
  extra: string;
  source: string;
  tags: string[];
};

export type DraftValidation = { ok: true } | { ok: false; message: string };
