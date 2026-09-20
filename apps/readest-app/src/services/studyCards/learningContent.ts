import { EXERCISE_TYPES, type StudyCardExercise, type StudyCardLearning } from './types';

const text = { type: 'string' } as const;
const exerciseProperties = {
  applicable: { type: 'boolean' },
  reason: text,
  prompt: text,
  answer: text,
  hint: text,
  alternatives: { type: 'array', items: text },
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
Also return learning, matching the supplied JSON schema. Generate the shared learning information
and vocabulary production content in this single response; the interface decides which cards to
create and selecting cards never makes another AI request.
gloss must explain ONLY the contextual meaning in the translation target language (English by default).
learningTarget is the exact contiguous source expression worth learning, containing the selected text;
it may expand a word to an idiom. lemma is its dictionary/base form. Keep the original selection unchanged.
grammaticalForm describes the encountered form in the translation target language.
explanation is an optional simple explanation in the source language; usageNote is a short note
in the translation target language. Do not list unrelated senses.
For the vocabulary production exercise, set applicable and provide a short reason in the
translation target language. Do not force an artificial or redundant exercise. When inapplicable,
all textual exercise fields and alternatives must be empty; reason should explain why. Vocabulary
production must teach the learner to produce the target Spanish word/form from a cue: use a different
Spanish word or phrase as the cue, or English when no suitable Spanish cue exists. The answer must
be the target word in Spanish. The prompt/front must not contain the selected word, any inflected or
other form of it, its lemma/base expression, or a recognizable fragment of any of those. Never put
the answer or the original word in the hint. Use a contextual blank only for the cue, not for the
target word itself.
The applicable exercise needs a standalone prompt, answer, and explanation; hint is optional.
Prompts must be plain text, using [...] for blanks, never Anki syntax or HTML. Include a short
English task instruction (or use the translation target language). Check whether other common
words satisfy each prompt: narrow the cue or list valid alternatives; do not claim uniqueness
when synonyms remain valid. Avoid leaking the answer in the prompt or hint. Preserve accents and
grammatical agreement. Return vocabulary production content whenever a useful exercise can be made.`;

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
