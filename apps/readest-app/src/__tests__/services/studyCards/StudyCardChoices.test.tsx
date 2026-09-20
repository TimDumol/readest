import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import StudyCardChoices from '@/app/reader/components/annotator/studyCards/StudyCardChoices';
import { buildStudyCardDraft } from '@/services/studyCards/draftBuilder';
import { buildStudyNoteFields } from '@/services/studyCards/studyNote';
import { learningFixture } from './learningFixture';
import type { SelectionSnapshot, StudyCardDraft } from '@/services/studyCards/types';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (value: string) => value }));
afterEach(cleanup);
const snapshot: SelectionSnapshot = {
  id: 'selection',
  selectedText: 'compró',
  contextText: 'Ella compró un libro.',
  selectedSpan: { start: 5, end: 11 },
  status: 'ready',
  source: {},
};
function Editor() {
  const [draft, setDraft] = useState<StudyCardDraft>(() => ({
    ...buildStudyCardDraft(snapshot),
    learning: learningFixture(),
    gloss: 'bought',
  }));
  return (
    <>
      <StudyCardChoices draft={draft} disabled={false} onChange={setDraft} />
      <output data-testid='fields'>{JSON.stringify(buildStudyNoteFields(draft, snapshot))}</output>
    </>
  );
}
describe('study card choices', () => {
  it('keeps production unchecked by default and exports only chosen enable flags', () => {
    render(<Editor />);
    const recognition = screen.getByRole('checkbox', { name: 'Recognition' }) as HTMLInputElement;
    const vocabulary = screen.getByRole('checkbox', {
      name: /Vocabulary production/,
    }) as HTMLInputElement;
    expect(recognition.checked).toBe(true);
    expect(vocabulary.checked).toBe(false);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    fireEvent.click(vocabulary);
    fireEvent.click(recognition);
    const fields = JSON.parse(screen.getByTestId('fields').textContent!);
    expect(fields.EnableRecognition).toBe('');
    expect(fields.EnableVocabulary).toBe('1');
    expect(fields).not.toHaveProperty('EnableGrammar');
    expect(fields).not.toHaveProperty('GrammarAnswer');
  });

  it('preserves edited content while toggling cards', () => {
    render(<Editor />);
    const answers = screen.getAllByLabelText('Answer');
    fireEvent.change(answers[0]!, { target: { value: 'edited answer' } });
    const checkbox = screen.getByRole('checkbox', { name: /Vocabulary production/ });
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    expect(JSON.parse(screen.getByTestId('fields').textContent!).VocabularyAnswer).toBe(
      'edited answer',
    );
  });
});
