import { EXERCISE_TYPES, type StudyCardExercise, type StudyCardLearning } from './types';

const text = { type: 'string' } as const;
const exerciseProperties = {
  applicable: { type: 'boolean' },
  reason: { type: 'string', description: 'Short reason in the translation target language.' },
  prompt: {
    type: 'string',
    description:
      'One concise source-language sentence with exactly one [...] blank; no task instruction, answer, gloss, HTML, or Anki syntax.',
  },
  answer: text,
  hint: text,
  alternatives: { type: 'array', items: text, maxItems: 3 },
  explanation: text,
};
const exerciseSchema = {
  type: 'object',
  properties: exerciseProperties,
  required: Object.keys(exerciseProperties),
  additionalProperties: false,
};
const learningProperties = {
  learningTarget: text,
  lemma: text,
  grammaticalForm: text,
  explanation: text,
  usageNote: text,
  exercises: {
    type: 'object',
    properties: Object.fromEntries(EXERCISE_TYPES.map((kind) => [kind, exerciseSchema])),
    required: [...EXERCISE_TYPES],
    additionalProperties: false,
  },
};
export const LEARNING_SCHEMA = {
  type: 'object',
  properties: learningProperties,
  required: Object.keys(learningProperties),
  additionalProperties: false,
};

export const LEARNING_INSTRUCTIONS = `
When learning is present, generate the shared learning information and vocabulary exercise in this
same response; the interface chooses which applicable cards to activate.
learningTarget must be an original contiguous source-language expression containing the selected
text; it may expand a word to an idiom. lemma is its dictionary/base form. Keep the selected text
unchanged. grammaticalForm describes the encountered source-language form. explanation is a simple
optional explanation in the source language; usageNote is a short note in the translation target
language. Do not list unrelated senses.
Set vocabulary applicable only when a useful exercise can be made, and always provide a short reason
in the translation target language. When inapplicable, use empty strings and an empty alternatives
array for the other exercise fields. The exercise must teach production of learningTarget in its
source language: use a different source-language word or phrase as the cue, or English when no
suitable cue exists. answer must be the target expression in its original form. The prompt must not
contain the selected text, any inflected or other form of it, its lemma/base expression, or a
recognizable fragment; never put the answer or original word in the hint. Use a contextual blank
only for the cue.
Applicable exercises need a standalone plain-text prompt, answer, and explanation; hint may be empty.
The prompt must be one natural source-language sentence with exactly one [...] blank. It is shown
directly on the production card, so do not add instructions such as "Fill in..." or "What word
means...?", and do not put a gloss, answer, explanation, Anki syntax, or HTML in it. The card shows
the shared Meaning field as the gloss. Account for valid synonyms with narrower cues or alternatives;
do not claim uniqueness when synonyms remain valid. Preserve accents and grammatical agreement.`;

const CLOZE_BLANK = '[...]';

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid learning content. Generate again.');
  return value as Record<string, unknown>;
};
const string = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Incomplete learning content. Generate again.');
  return value.trim();
};
export const parseLearningContent = (value: unknown): StudyCardLearning => {
  const data = object(value);
  const exercises = object(data['exercises']);
  const parsed = {} as StudyCardLearning['exercises'];
  for (const kind of EXERCISE_TYPES) {
    const exercise = object(exercises[kind]);
    if (typeof exercise['applicable'] !== 'boolean' || !Array.isArray(exercise['alternatives']))
      throw new Error('Invalid exercise content. Generate again.');
    const result: StudyCardExercise = {
      applicable: exercise['applicable'],
      reason: string(exercise['reason']),
      prompt: string(exercise['prompt']),
      answer: string(exercise['answer']),
      hint: string(exercise['hint']),
      explanation: string(exercise['explanation']),
      alternatives: exercise['alternatives'].map(string).filter(Boolean),
    };
    if (
      !result.reason ||
      (result.applicable && (!result.prompt || !result.answer || !result.explanation))
    )
      throw new Error('Incomplete exercise content. Generate again.');
    if (result.applicable) {
      const blankCount = result.prompt.split(CLOZE_BLANK).length - 1;
      if (
        blankCount !== 1 ||
        result.prompt.includes('{{') ||
        result.prompt.includes('}}') ||
        /<[^>]*>/.test(result.prompt)
      )
        throw new Error('Invalid production prompt. Generate a single cloze sentence.');
    }
    parsed[kind] = result.applicable
      ? result
      : {
          ...result,
          prompt: '',
          answer: '',
          hint: '',
          explanation: '',
          alternatives: [],
        };
  }
  const learningTarget = string(data['learningTarget']);
  const lemma = string(data['lemma']);
  if (!learningTarget || !lemma) throw new Error('Missing learning target. Generate again.');
  return {
    learningTarget,
    lemma,
    grammaticalForm: string(data['grammaticalForm']),
    explanation: string(data['explanation']),
    usageNote: string(data['usageNote']),
    exercises: parsed,
  };
};
