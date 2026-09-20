import type { TextSelection } from '@/utils/sel';
import type { SelectionSnapshot, StudyCardSource, TextSpan } from './types';

const MAX_CONTEXT_UNITS = 8000;
const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'dd',
  'div',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'li',
  'main',
  'nav',
  'p',
  'pre',
  'section',
  'td',
  'th',
  'tr',
]);
const EXCLUDED_TAGS = new Set(['script', 'style', 'rt', 'rp', 'annotation']);

const freshId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  return `study-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const unsupported = (
  source: StudyCardSource,
  selectedText: string,
  language: string | undefined,
  reason: string,
): SelectionSnapshot => ({
  id: freshId(),
  selectedText,
  language,
  contextText: '',
  status: 'unsupported',
  reason,
  source: { ...source },
});

const elementFor = (node: Node): Element | null =>
  node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;

const isExcluded = (node: Node): boolean => {
  let current: Node | null = node;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as Element;
      const tag = element.tagName.toLowerCase();
      if (EXCLUDED_TAGS.has(tag)) return true;
      if (
        element.matches(
          '[data-annotation-ui], [data-reader-ui], .annotation-ui, .ruby-pronunciation',
        )
      )
        return true;
    }
    current = current.parentNode;
  }
  return false;
};

const blockAncestors = (node: Node): Element[] => {
  const result: Element[] = [];
  let current = elementFor(node);
  while (current) {
    if (BLOCK_TAGS.has(current.tagName.toLowerCase())) result.push(current);
    current = current.parentElement;
  }
  return result;
};

const containsNode = (ancestor: Node, node: Node): boolean =>
  ancestor === node || ancestor.contains(node);

const findContextBlock = (range: Range): Element | null => {
  const starts = blockAncestors(range.startContainer);
  const ends = blockAncestors(range.endContainer);
  return (
    starts.find(
      (candidate) =>
        ends.includes(candidate) &&
        containsNode(candidate, range.startContainer) &&
        containsNode(candidate, range.endContainer),
    ) ?? null
  );
};

type WalkItem =
  | { kind: 'text'; node: Text; start: number; end: number; outputStart: number; outputEnd: number }
  | {
      kind: 'separator';
      node: Element;
      start: number;
      end: number;
      outputStart: number;
      outputEnd: number;
    };

const pointRange = (doc: Document, container: Node, offset: number): Range | null => {
  try {
    const range = doc.createRange();
    range.setStart(container, offset);
    range.collapse(true);
    return range;
  } catch {
    return null;
  }
};

const comparePoints = (
  doc: Document,
  aNode: Node,
  aOffset: number,
  bNode: Node,
  bOffset: number,
): number => {
  const a = pointRange(doc, aNode, aOffset);
  const b = pointRange(doc, bNode, bOffset);
  if (!a || !b) return 0;
  return a.compareBoundaryPoints(Range.START_TO_START, b);
};

const collectItems = (block: Element): { text: string; items: WalkItem[] } => {
  const items: WalkItem[] = [];
  let output = '';
  const addSeparator = (node: Element, start: number, end: number) => {
    if (output.endsWith('\n')) return;
    const outputStart = output.length;
    output += '\n';
    items.push({ kind: 'separator', node, start, end, outputStart, outputEnd: output.length });
  };
  const visit = (node: Node) => {
    if (isExcluded(node)) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      if (!textNode.data) return;
      const outputStart = output.length;
      output += textNode.data;
      items.push({
        kind: 'text',
        node: textNode,
        start: outputStart,
        end: output.length,
        outputStart,
        outputEnd: output.length,
      });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.childNodes.forEach(visit);
      return;
    }
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (tag === 'br') {
      addSeparator(element, 0, 1);
      return;
    }
    element.childNodes.forEach(visit);
    if (BLOCK_TAGS.has(tag) && element !== block) {
      const index = Array.prototype.indexOf.call(
        element.parentNode?.childNodes ?? [],
        element,
      ) as number;
      addSeparator(element, index, index + 1);
    }
  };
  // Element endpoints need the same filtering as text nodes; walking the block
  // itself lets ranges ending at an element boundary still map to an offset.
  block.childNodes.forEach(visit);
  return { text: output, items };
};

const offsetForBoundary = (
  doc: Document,
  items: WalkItem[],
  node: Node,
  offset: number,
): number | null => {
  let result = 0;
  for (const item of items) {
    if (item.kind === 'text') {
      const startComparison = comparePoints(doc, node, offset, item.node, 0);
      const endComparison = comparePoints(doc, node, offset, item.node, item.node.data.length);
      if (startComparison <= 0) continue;
      if (endComparison >= 0) {
        result = item.outputEnd;
        continue;
      }
      if (node === item.node) return item.outputStart + offset;
      return null;
    }
    const before = comparePoints(doc, node, offset, item.node, 0);
    const after = comparePoints(doc, node, offset, item.node, item.node.childNodes.length);
    if (before <= 0) continue;
    if (after >= 0) {
      result = item.outputEnd;
    }
  }
  return result;
};

const sentenceSpanFor = (
  text: string,
  selectedSpan: TextSpan,
  language?: string,
): TextSpan | undefined => {
  if (!language || typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function')
    return undefined;
  let segments: Array<{ index: number; segment: string }>;
  try {
    segments = Array.from(
      new Intl.Segmenter(language, { granularity: 'sentence' }).segment(text),
    ).map((segment) => ({
      index: segment.index,
      segment: segment.segment,
    }));
  } catch {
    return undefined;
  }
  const containing = segments.find((segment, index) => {
    const end = segment.index + segment.segment.length;
    const nextStart = segments[index + 1]?.index ?? text.length;
    return segment.index <= selectedSpan.start && selectedSpan.end <= Math.max(end, nextStart);
  });
  if (!containing) return undefined;
  const end = containing.index + containing.segment.length;
  return { start: containing.index, end };
};

export const captureSelectionSnapshot = (
  selection: Pick<TextSelection, 'text' | 'range' | 'segments' | 'popup'>,
  source: StudyCardSource,
  language?: string,
): SelectionSnapshot => {
  const selectedText = selection.text;
  if (selection.popup)
    return unsupported(
      source,
      selectedText,
      language,
      'Study cards currently support selections from the main EPUB document only.',
    );
  if (selection.segments?.length)
    return unsupported(
      source,
      selectedText,
      language,
      'Study cards currently support one EPUB section at a time.',
    );
  const range = selection.range;
  const doc = range?.startContainer.ownerDocument;
  if (!range || !doc || range.endContainer.ownerDocument !== doc) {
    return unsupported(
      source,
      selectedText,
      language,
      'This selection does not belong to one document.',
    );
  }
  if (doc.querySelector('.textLayer, [data-pdf-text-layer]')) {
    return unsupported(source, selectedText, language, 'PDF context capture is not available yet.');
  }
  const block = findContextBlock(range);
  if (!block)
    return unsupported(
      source,
      selectedText,
      language,
      'The enclosing EPUB paragraph could not be mapped.',
    );
  const walked = collectItems(block);
  if (walked.text.length > MAX_CONTEXT_UNITS) {
    return unsupported(
      source,
      selectedText,
      language,
      'The enclosing paragraph is too long to capture safely.',
    );
  }
  const selectedStart = offsetForBoundary(
    doc,
    walked.items,
    range.startContainer,
    range.startOffset,
  );
  const selectedEnd = offsetForBoundary(doc, walked.items, range.endContainer, range.endOffset);
  if (selectedStart === null || selectedEnd === null || selectedEnd < selectedStart) {
    return {
      id: freshId(),
      selectedText,
      language,
      contextText: walked.text,
      status: 'unmapped',
      reason: 'The selection could not be mapped without changing its text.',
      source: { ...source },
    };
  }
  const selectedSpan = { start: selectedStart, end: selectedEnd };
  if (walked.text.slice(selectedSpan.start, selectedSpan.end) !== selectedText) {
    return {
      id: freshId(),
      selectedText,
      language,
      contextText: walked.text,
      status: 'unmapped',
      reason:
        'The selection could not be mapped without changing accents, whitespace, or spelling.',
      source: { ...source },
    };
  }
  return {
    id: freshId(),
    selectedText,
    language,
    contextText: walked.text,
    selectedSpan,
    sentenceSpan: sentenceSpanFor(walked.text, selectedSpan, language),
    status: 'ready',
    source: { ...source },
  };
};
