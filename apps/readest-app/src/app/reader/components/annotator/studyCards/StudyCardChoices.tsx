'use client';

import { useTranslation } from '@/hooks/useTranslation';
import {
  EXERCISE_TYPES,
  type StudyCardDraft,
  type StudyCardType,
} from '@/services/studyCards/types';

type Props = {
  draft: StudyCardDraft;
  disabled: boolean;
  onChange: (updater: (current: StudyCardDraft) => StudyCardDraft) => void;
};

export default function StudyCardChoices({ draft, disabled, onChange }: Props) {
  const _ = useTranslation();
  const labels: Record<StudyCardType, string> = {
    recognition: _('Recognition'),
    vocabulary: _('Vocabulary production'),
  };
  return (
    <section className='flex flex-col gap-3'>
      <div>
        <h3 className='font-semibold'>{_('Cards to create')}</h3>
        <p className='text-sm'>
          {_(
            'Only recognition is selected by default. Selecting cards does not make another AI request.',
          )}
        </p>
      </div>
      {(['recognition', ...EXERCISE_TYPES] as const).map((kind) => {
        const exercise = kind === 'recognition' ? undefined : draft.learning?.exercises[kind];
        const available = kind === 'recognition' || !!exercise?.applicable;
        return (
          <div key={kind} className='eink-bordered rounded-lg border border-base-200 p-3'>
            <label className='flex min-h-10 items-center gap-3'>
              <input
                type='checkbox'
                checked={draft.cardTypes.includes(kind)}
                disabled={disabled || !available}
                onChange={(event) => {
                  const checked = event.target.checked;
                  onChange((current) => ({
                    ...current,
                    cardTypes: checked
                      ? [...current.cardTypes.filter((item) => item !== kind), kind]
                      : current.cardTypes.filter((item) => item !== kind),
                  }));
                }}
              />
              <span className='font-medium'>{labels[kind]}</span>
              {!available && (
                <span className='text-xs'>
                  {draft.learning ? _('Not applicable') : _('Generate content first')}
                </span>
              )}
            </label>
            {exercise?.reason && <p className='text-sm'>{exercise.reason}</p>}
            {kind === 'recognition' && (
              <details className='mt-2 text-sm'>
                <summary>{_('Preview')}</summary>
                <p>
                  {draft.contextText.slice(0, draft.selectedSpan?.start ?? 0)}
                  <strong className='underline'>{draft.selectedText}</strong>
                  {draft.contextText.slice(draft.selectedSpan?.end ?? draft.contextText.length)}
                </p>
                <p>{_('What does the highlighted text mean here?')}</p>
                <details>
                  <summary>{_('Show answer')}</summary>
                  <p>
                    {draft.gloss ||
                      draft.definitions
                        .filter((entry) => entry.included)
                        .map((entry) => entry.text)
                        .join('\n')}
                  </p>
                  <p>{draft.learning?.learningTarget}</p>
                  <p>{draft.learning?.lemma}</p>
                  <p>{draft.learning?.grammaticalForm}</p>
                  <p>{draft.learning?.explanation}</p>
                  <p>{draft.translation}</p>
                  <p>{draft.learning?.usageNote}</p>
                </details>
              </details>
            )}
            {exercise?.applicable && kind !== 'recognition' && (
              <details className='mt-2 text-sm'>
                <summary>{_('Preview and edit')}</summary>
                <p className='whitespace-pre-wrap'>{exercise.prompt}</p>
                {draft.gloss && (
                  <p className='text-sm italic opacity-70'>
                    {_('Gloss')}: {draft.gloss}
                  </p>
                )}
                {exercise.hint && (
                  <details>
                    <summary>{_('Hint')}</summary>
                    {exercise.hint}
                  </details>
                )}
                <details>
                  <summary>{_('Show answer')}</summary>
                  <p>{exercise.answer}</p>
                  <p>{exercise.explanation}</p>
                  {exercise.alternatives.length > 0 && (
                    <p>
                      {_('Also acceptable')}: {exercise.alternatives.join('; ')}
                    </p>
                  )}
                </details>
                {(['prompt', 'answer', 'hint', 'explanation', 'alternatives'] as const).map(
                  (field) => {
                    const fieldLabels = {
                      prompt: _('Prompt'),
                      answer: _('Answer'),
                      hint: _('Hint'),
                      explanation: _('Explanation'),
                      alternatives: _('Alternatives (one per line)'),
                    };
                    return (
                      <label key={field} className='mt-2 flex flex-col gap-1'>
                        <span>{fieldLabels[field]}</span>
                        <textarea
                          className='textarea textarea-bordered eink-bordered w-full'
                          disabled={disabled}
                          value={
                            field === 'alternatives'
                              ? exercise.alternatives.join('\n')
                              : exercise[field]
                          }
                          onChange={(event) => {
                            const value = event.target.value;
                            onChange((current) =>
                              current.learning
                                ? {
                                    ...current,
                                    learning: {
                                      ...current.learning,
                                      exercises: {
                                        ...current.learning.exercises,
                                        [kind]: {
                                          ...current.learning.exercises[kind],
                                          [field]:
                                            field === 'alternatives' ? value.split('\n') : value,
                                        },
                                      },
                                    },
                                  }
                                : current,
                            );
                          }}
                        />
                      </label>
                    );
                  },
                )}
              </details>
            )}
          </div>
        );
      })}
      {draft.learning && (
        <details className='text-sm'>
          <summary>{_('Edit shared learning information')}</summary>
          {(
            ['learningTarget', 'lemma', 'grammaticalForm', 'explanation', 'usageNote'] as const
          ).map((field) => {
            const fieldLabels = {
              learningTarget: _('Learning target'),
              lemma: _('Lemma / base expression'),
              grammaticalForm: _('Grammatical form'),
              explanation: _('Source-language explanation'),
              usageNote: _('Usage note'),
            };
            return (
              <label key={field} className='mt-2 flex flex-col gap-1'>
                <span>{fieldLabels[field]}</span>
                <textarea
                  className='textarea textarea-bordered eink-bordered w-full'
                  disabled={disabled}
                  value={draft.learning![field]}
                  onChange={(event) => {
                    const value = event.target.value;
                    onChange((current) =>
                      current.learning
                        ? { ...current, learning: { ...current.learning, [field]: value } }
                        : current,
                    );
                  }}
                />
              </label>
            );
          })}
        </details>
      )}
    </section>
  );
}
