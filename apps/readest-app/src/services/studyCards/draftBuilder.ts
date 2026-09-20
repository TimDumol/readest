import type {
  AnkiSerializedFields,
  DraftValidation,
  SelectionSnapshot,
  StudyCardContextMode,
  StudyCardDefinition,
  StudyCardDraft,
  TextSpan,
} from './types';

const ANKI_CLOZE_RX = /\{\{c\d+::/i;
const GENERATED_CLOZE_RX = /^(.*?)\{\{c1::(.*?)(?:::((?:.|\n)*?))?\}\}(.*)$/s;

type GeneratedClozeParts = {
  prefix: string;
  answer: string;
  hint?: string;
  suffix: string;
};

const parseGeneratedCloze = (value: string): GeneratedClozeParts | null => {
  const match = value.match(GENERATED_CLOZE_RX);
  if (!match) return null;
  const [, prefix, answer, hint, suffix] = match;
  if ([prefix, hint, suffix].some((part) => part?.includes('{{') || part?.includes('}}'))) {
    return null;
  }
  return {
    prefix: prefix ?? '',
    answer: answer ?? '',
    hint: hint || undefined,
    suffix: suffix ?? '',
  };
};

const isValidSpan = (span: TextSpan | undefined, text: string): span is TextSpan =>
  !!span &&
  Number.isInteger(span.start) &&
  Number.isInteger(span.end) &&
  span.start >= 0 &&
  span.end >= span.start &&
  span.end <= text.length;

export const validateSelectionSnapshot = (snapshot: SelectionSnapshot): DraftValidation => {
  if (!snapshot.contextText) {
    return { ok: false, message: 'The captured reading context is empty.' };
  }
  if (snapshot.status !== 'ready') {
    return {
      ok: false,
      message: snapshot.reason ?? 'This selection cannot be sent as a cloze card.',
    };
  }
  if (!isValidSpan(snapshot.selectedSpan, snapshot.contextText)) {
    return {
      ok: false,
      message: 'The selected text has no valid position in the captured context.',
    };
  }
  if (
    snapshot.contextText.slice(snapshot.selectedSpan.start, snapshot.selectedSpan.end) !==
    snapshot.selectedText
  ) {
    return { ok: false, message: 'The selected text no longer matches the captured context.' };
  }
  if (snapshot.sentenceSpan && !isValidSpan(snapshot.sentenceSpan, snapshot.contextText)) {
    return { ok: false, message: 'The captured sentence boundaries are invalid.' };
  }
  if (
    snapshot.sentenceSpan &&
    (snapshot.sentenceSpan.start > snapshot.selectedSpan.start ||
      snapshot.sentenceSpan.end < snapshot.selectedSpan.end)
  ) {
    return { ok: false, message: 'The captured sentence does not contain the selection.' };
  }
  return { ok: true };
};

const contextForSnapshot = (
  snapshot: SelectionSnapshot,
  mode: StudyCardContextMode,
): { text: string; span?: TextSpan } => {
  if (
    mode === 'sentence' &&
    snapshot.sentenceSpan &&
    isValidSpan(snapshot.sentenceSpan, snapshot.contextText)
  ) {
    const sentence = snapshot.sentenceSpan;
    return {
      text: snapshot.contextText.slice(sentence.start, sentence.end),
      span: {
        start: snapshot.selectedSpan!.start - sentence.start,
        end: snapshot.selectedSpan!.end - sentence.start,
      },
    };
  }
  return { text: snapshot.contextText, span: snapshot.selectedSpan };
};

export const deriveClozeText = (
  draft: Pick<StudyCardDraft, 'contextText' | 'selectedSpan'> & { clozeText?: string },
): string | null => {
  const generated = draft.clozeText ? parseGeneratedCloze(draft.clozeText) : null;
  if (
    generated &&
    generated.prefix + generated.answer + generated.suffix === draft.contextText &&
    generated.answer
  ) {
    return draft.clozeText!;
  }
  if (!isValidSpan(draft.selectedSpan, draft.contextText)) return null;
  const { start, end } = draft.selectedSpan;
  return `${draft.contextText.slice(0, start)}{{c1::${draft.contextText.slice(start, end)}}}${draft.contextText.slice(end)}`;
};

export const buildStudyCardDraft = (
  snapshot: SelectionSnapshot,
  definitions: StudyCardDefinition[] = [],
  options: {
    contextMode?: StudyCardContextMode;
    gloss?: string;
    translation?: string;
    sourceText?: string;
    tags?: string[];
  } = {},
): StudyCardDraft => {
  const validation = validateSelectionSnapshot(snapshot);
  const mode = options.contextMode ?? 'sentence';
  const context = validation.ok
    ? contextForSnapshot(snapshot, mode)
    : { text: snapshot.contextText };
  const selectedSpan = context.span;
  const definitionsCopy = definitions.map((definition) => ({ ...definition }));
  return {
    snapshotId: snapshot.id,
    selectedText: snapshot.selectedText,
    contextText: context.text,
    selectedSpan,
    definitions: definitionsCopy,
    gloss: options.gloss ?? '',
    translation: options.translation ?? '',
    sourceText: options.sourceText ?? snapshot.contextText,
    tags: [...(options.tags ?? [])],
    cardTypes: ['recognition'],
  };
};

export const validateDraftForAnki = (draft: StudyCardDraft): DraftValidation => {
  const snapshotLike: SelectionSnapshot = {
    id: draft.snapshotId,
    selectedText: draft.selectedText,
    contextText: draft.contextText,
    selectedSpan: draft.selectedSpan,
    status: 'ready',
    source: {},
  };
  const selectionValidation = validateSelectionSnapshot(snapshotLike);
  if (!selectionValidation.ok) return selectionValidation;

  if (draft.clozeText) {
    const generated = parseGeneratedCloze(draft.clozeText);
    if (
      !generated ||
      generated.prefix + generated.answer + generated.suffix !== draft.contextText ||
      generated.answer !== draft.selectedText
    ) {
      return {
        ok: false,
        message: 'The generated cloze must preserve the context and selected text exactly.',
      };
    }
  }

  const components = [
    draft.contextText,
    draft.selectedText,
    draft.gloss,
    draft.translation,
    draft.sourceText,
    ...draft.tags,
    ...draft.definitions.flatMap((definition) => [
      definition.text,
      definition.headword,
      definition.sourceLabel,
    ]),
  ];
  if (components.some((component) => ANKI_CLOZE_RX.test(component))) {
    return {
      ok: false,
      message:
        'Remove existing Anki cloze syntax (for example {{c1::...}}) before sending this card.',
    };
  }
  return { ok: true };
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export const serializeAnkiText = (value: string): string =>
  escapeHtml(value.replaceAll('\r\n', '\n').replaceAll('\r', '\n')).replaceAll('\n', '<br>');

export const serializeAnkiContext = (draft: StudyCardDraft): string | null => {
  if (!validateDraftForAnki(draft).ok || !isValidSpan(draft.selectedSpan, draft.contextText))
    return null;
  const generated = draft.clozeText ? parseGeneratedCloze(draft.clozeText) : null;
  if (generated) {
    return `${serializeAnkiText(generated.prefix)}{{c1::${serializeAnkiText(generated.answer)}${
      generated.hint ? `::${serializeAnkiText(generated.hint)}` : ''
    }}}${serializeAnkiText(generated.suffix)}`;
  }
  const { start, end } = draft.selectedSpan;
  return `${serializeAnkiText(draft.contextText.slice(0, start))}{{c1::${serializeAnkiText(
    draft.contextText.slice(start, end),
  )}}}${serializeAnkiText(draft.contextText.slice(end))}`;
};

export const buildPortableCopyText = (
  draft: StudyCardDraft,
  source?: SelectionSnapshot['source'],
): string => {
  const lines: string[] = [];
  const cloze = deriveClozeText(draft);
  if (cloze) lines.push(cloze);
  else if (draft.selectedText) lines.push(draft.selectedText);
  const selectedDefinitions = draft.definitions.filter((definition) => definition.included);
  if (selectedDefinitions.length) {
    lines.push('', 'Definitions:');
    for (const definition of selectedDefinitions) {
      lines.push(`[${definition.sourceLabel}] ${definition.headword}`, definition.text);
    }
  } else {
    lines.push('', 'Definitions: none included');
  }
  if (draft.gloss.trim()) lines.push('', `Gloss: ${draft.gloss.trim()}`);
  if (draft.translation.trim()) lines.push('', `Translation: ${draft.translation.trim()}`);
  if (draft.sourceText.trim()) lines.push('', `Source: ${draft.sourceText.trim()}`);
  const sourceParts = [source?.bookTitle, source?.chapterTitle].filter(Boolean);
  if (sourceParts.length) lines.push(`Book: ${sourceParts.join(' — ')}`);
  if (draft.tags.length) lines.push(`Tags: ${draft.tags.join(', ')}`);
  return lines.join('\n');
};

export const serializeDraftForAnki = (
  draft: StudyCardDraft,
  source?: SelectionSnapshot['source'],
  options: { includeSourceInExtra?: boolean } = {},
): AnkiSerializedFields | null => {
  if (!validateDraftForAnki(draft).ok) return null;
  const context = serializeAnkiContext(draft);
  if (!context) return null;
  const extraParts = draft.definitions
    .filter((definition) => definition.included)
    .map((definition) => `[${definition.sourceLabel}] ${definition.headword}\n${definition.text}`);
  if (draft.gloss.trim()) extraParts.push(`Gloss: ${draft.gloss.trim()}`);
  if (draft.translation.trim()) extraParts.push(`Translation: ${draft.translation.trim()}`);
  if (options.includeSourceInExtra !== false && draft.sourceText.trim()) {
    extraParts.push(`Source: ${draft.sourceText.trim()}`);
  }
  const sourceText = [
    draft.sourceText.trim(),
    [source?.bookTitle, source?.chapterTitle, source?.href].filter(Boolean).join(' — '),
  ]
    .filter(Boolean)
    .join('\n');
  return {
    context,
    extra: serializeAnkiText(extraParts.join('\n\n')),
    source: serializeAnkiText(sourceText),
    tags: draft.tags.map((tag) => tag.trim()).filter(Boolean),
  };
};
