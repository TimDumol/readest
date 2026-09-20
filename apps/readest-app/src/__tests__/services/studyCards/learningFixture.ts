import type { StudyCardLearning } from '@/services/studyCards/types';
export const learningFixture = (): StudyCardLearning => ({
  learningTarget: 'compró',
  lemma: 'comprar',
  grammaticalForm: 'Third-person singular preterite',
  explanation: 'Obtuvo algo pagando.',
  usageNote: 'A completed purchase.',
  exercises: {
    vocabulary: {
      applicable: true,
      reason: 'Useful everyday verb.',
      prompt: 'Ella [...] un libro. Use the Spanish synonym "adquirió".',
      answer: 'compró',
      hint: '',
      alternatives: [],
      explanation: 'Comprar in the preterite.',
    },
  },
});
