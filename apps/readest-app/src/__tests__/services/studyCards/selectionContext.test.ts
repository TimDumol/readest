import { beforeEach, describe, expect, it } from 'vitest';

import { captureSelectionSnapshot } from '@/services/studyCards/selectionContext';

const source = { bookTitle: 'Test book', sectionIndex: 2 };

beforeEach(() => {
  document.body.replaceChildren();
});

const capture = (range: Range, extra: Record<string, unknown> = {}) =>
  captureSelectionSnapshot(
    {
      text: range.toString(),
      range,
      segments: [],
      popup: false,
      ...extra,
    } as never,
    source,
    'es',
  );

describe('captureSelectionSnapshot', () => {
  it('maps an inline selection to the exact occurrence and JSON round-trips', () => {
    const root = document.createElement('p');
    root.innerHTML = 'La <em>compré</em> y la compré ayer.';
    document.body.append(root);
    const second = root.lastChild!;
    const range = document.createRange();
    range.setStart(second, 6);
    range.setEnd(second, 12);

    const snapshot = capture(range);
    expect(snapshot.status).toBe('ready');
    expect(snapshot.contextText).toBe('La compré y la compré ayer.');
    expect(snapshot.selectedText).toBe('compré');
    expect(
      snapshot.contextText.slice(snapshot.selectedSpan!.start, snapshot.selectedSpan!.end),
    ).toBe('compré');
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('supports element boundary endpoints and excludes ruby pronunciation text', () => {
    const root = document.createElement('p');
    root.innerHTML = '<ruby>買<rt>か</rt></ruby> う';
    document.body.append(root);
    const ruby = root.firstElementChild!;
    const range = document.createRange();
    range.setStart(ruby, 0);
    range.setEnd(ruby, 1);

    const snapshot = capture(range);
    expect(snapshot.status).toBe('ready');
    expect(snapshot.contextText).toBe('買 う');
    expect(snapshot.selectedText).toBe('買');
  });

  it('falls back to the paragraph when sentence segmentation cannot contain the selection', () => {
    const root = document.createElement('p');
    root.textContent = 'Primera oración. Segunda oración.';
    document.body.append(root);
    const range = document.createRange();
    range.setStart(root.firstChild!, 17);
    range.setEnd(root.firstChild!, 23);

    const snapshot = capture(range);
    expect(snapshot.status).toBe('ready');
    expect(snapshot.contextText).toBe(root.textContent);
    expect(snapshot.sentenceSpan).toBeDefined();
  });

  it('returns explicit unsupported snapshots for cross-section, popup, and PDF selections', () => {
    const root = document.createElement('p');
    root.textContent = 'compré';
    document.body.append(root);
    const range = document.createRange();
    range.selectNodeContents(root);

    expect(capture(range, { segments: [{ range, index: 1, text: 'compré' }] }).status).toBe(
      'unsupported',
    );
    expect(capture(range, { popup: true }).status).toBe('unsupported');

    const layer = document.createElement('div');
    layer.className = 'textLayer';
    document.body.append(layer);
    expect(capture(range).status).toBe('unsupported');
  });

  it('returns unmapped when filtering changes the selected slice', () => {
    const root = document.createElement('p');
    root.innerHTML = 'La <span data-annotation-ui>nota</span> compré.';
    document.body.append(root);
    const range = document.createRange();
    range.selectNodeContents(root);

    const snapshot = capture(range);
    expect(snapshot.status).toBe('unmapped');
  });
});
