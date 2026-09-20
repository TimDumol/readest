import { describe, expect, it } from 'vitest';

import {
  buildPortableCopyText,
  buildStudyCardDraft,
  deriveClozeText,
  serializeAnkiContext,
  serializeAnkiText,
  validateDraftForAnki,
} from '@/services/studyCards/draftBuilder';
import type { SelectionSnapshot, StudyCardDefinition } from '@/services/studyCards/types';

const source = { bookTitle: 'Libro', chapterTitle: 'Capítulo 1' };
const definition: StudyCardDefinition = {
  entryId: 'mdict:es',
  providerId: 'mdict:es',
  sourceLabel: 'Español',
  headword: 'comprar',
  text: 'adquirir algo mediante pago',
  included: true,
};

const snapshot = (contextText: string, selectedText: string, start: number): SelectionSnapshot => ({
  id: 'snapshot-1',
  selectedText,
  contextText,
  selectedSpan: { start, end: start + selectedText.length },
  sentenceSpan: { start: 0, end: contextText.length },
  status: 'ready',
  source,
});

describe('study card draft builder', () => {
  it('clozes only the selected repeated occurrence', () => {
    const text = 'I read read every evening.';
    const draft = buildStudyCardDraft(snapshot(text, 'read', text.lastIndexOf('read')));

    expect(deriveClozeText(draft)).toBe('I read {{c1::read}} every evening.');
    expect(draft.contextText).toBe(text);
  });

  it('rebases a selected span when a containing sentence is chosen', () => {
    const text = 'Antes. La compré ayer. Después.';
    const selectedStart = text.indexOf('compré');
    const captured = snapshot(text, 'compré', selectedStart);
    captured.sentenceSpan = { start: 7, end: 22 };
    const draft = buildStudyCardDraft(captured);

    expect(draft.contextText).toBe('La compré ayer.');
    expect(draft.selectedSpan).toEqual({ start: 3, end: 9 });
    expect(deriveClozeText(draft)).toBe('La {{c1::compré}} ayer.');
  });

  it('preserves accents and UTF-16 offsets around non-BMP characters', () => {
    const text = '😀 español: compré';
    const start = text.indexOf('compré');
    const draft = buildStudyCardDraft(snapshot(text, 'compré', start));

    expect(draft.selectedSpan).toEqual({ start, end: start + 'compré'.length });
    expect(deriveClozeText(draft)).toBe('😀 español: {{c1::compré}}');
  });

  it('escapes HTML-looking content and preserves multiline fields', () => {
    const draft = buildStudyCardDraft(snapshot('<b>compré</b>\nayer', 'compré', 3), [definition]);

    expect(serializeAnkiText('<b>uno</b>\n& dos')).toBe('&lt;b&gt;uno&lt;/b&gt;<br>&amp; dos');
    expect(serializeAnkiContext(draft)).toBe('&lt;b&gt;{{c1::compré}}&lt;/b&gt;<br>ayer');
  });

  it('uses a validated AI cloze in the preview and Anki serialization', () => {
    const draft = {
      ...buildStudyCardDraft(snapshot('Ella compró un libro.', 'compró', 5)),
      clozeText: 'Ella {{c1::compró::to buy}} un libro.',
    };

    expect(deriveClozeText(draft)).toBe('Ella {{c1::compró::to buy}} un libro.');
    expect(serializeAnkiContext(draft)).toBe('Ella {{c1::compró::to buy}} un libro.');
    expect(validateDraftForAnki(draft)).toEqual({ ok: true });
  });

  it('rejects invalid offsets and embedded cloze syntax', () => {
    const bad = buildStudyCardDraft(snapshot('compré', 'compré', 0));
    bad.selectedSpan = { start: 9, end: 15 };
    expect(validateDraftForAnki(bad).ok).toBe(false);
    expect(serializeAnkiContext(bad)).toBeNull();

    const unsafe = buildStudyCardDraft(snapshot('Yo compré.', 'compré', 3), [
      { ...definition, text: 'contains {{c1::unsafe}}' },
    ]);
    const result = validateDraftForAnki(unsafe);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Remove existing Anki cloze syntax');
  });

  it('copies labelled definitions and source metadata', () => {
    const draft = buildStudyCardDraft(snapshot('Yo compré.', 'compré', 3), [definition], {
      gloss: 'to buy',
      translation: 'I bought it.',
      sourceText: 'Yo compré.',
    });
    const copied = buildPortableCopyText(draft, source);

    expect(copied).toContain('Yo {{c1::compré}}.');
    expect(copied).toContain('[Español] comprar');
    expect(copied).toContain('Gloss: to buy');
    expect(copied).toContain('Translation: I bought it.');
    expect(copied).toContain('Book: Libro — Capítulo 1');
  });
});
