const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'dd',
  'div',
  'dl',
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
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);
const IGNORED_TAGS = new Set([
  'audio',
  'embed',
  'iframe',
  'img',
  'object',
  'script',
  'source',
  'style',
  'video',
]);

const decodeBasicEntities = (value: string): string =>
  value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#x[0-9a-f]+|#\d+);/giu, (entity) => {
    const body = entity.slice(1, -1).toLowerCase();
    if (body === 'amp') return '&';
    if (body === 'lt') return '<';
    if (body === 'gt') return '>';
    if (body === 'quot') return '"';
    if (body === 'apos') return "'";
    if (body === 'nbsp') return ' ';
    const code = body.startsWith('#x')
      ? Number.parseInt(body.slice(2), 16)
      : Number.parseInt(body.slice(1), 10);
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : entity;
  });

const normalizeText = (value: string): string =>
  value
    .replace(/\r\n?/gu, '\n')
    .replace(/\u00a0/gu, ' ')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n[ \t]+/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

/**
 * Turn provider HTML into inert, portable text. Only text nodes and explicit
 * structural boundaries are visited; provider scripts, handlers, URLs, and
 * resources never get mounted or fetched.
 */
export const entryHtmlToText = (html: string): string => {
  if (!html) return '';
  if (typeof document === 'undefined') {
    const fallback = html
      .replace(
        /<(?:audio|embed|iframe|img|object|script|source|style|video)\b[^>]*>[\s\S]*?<\/(?:audio|embed|iframe|img|object|script|source|style|video)>/giu,
        '',
      )
      .replace(/<(?:br|hr)\s*\/?>/giu, '\n')
      .replace(/<li\b[^>]*>/giu, '- ')
      .replace(
        /<\/(?:address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)>/giu,
        '\n',
      )
      .replace(/<[^>]*>/gu, '');
    return normalizeText(decodeBasicEntities(fallback));
  }

  const template = document.createElement('template');
  template.innerHTML = html;
  const output: string[] = [];
  const append = (text: string) => {
    if (text) output.push(text);
  };
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      append(node.nodeValue ?? '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.childNodes.forEach(visit);
      return;
    }
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (IGNORED_TAGS.has(tag)) return;
    if (tag === 'br' || tag === 'hr') {
      append('\n');
      return;
    }
    if (tag === 'li') append('- ');
    element.childNodes.forEach(visit);
    if (BLOCK_TAGS.has(tag)) append('\n');
  };
  template.content.childNodes.forEach(visit);
  return normalizeText(output.join(''));
};
