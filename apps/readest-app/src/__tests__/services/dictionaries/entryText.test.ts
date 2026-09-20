import { describe, expect, it } from 'vitest';

import { entryHtmlToText } from '@/services/dictionaries/entryText';

describe('entryHtmlToText', () => {
  it('preserves text, entities, block/list boundaries, and omits resources/scripts', () => {
    const text = entryHtmlToText(
      '<h1>comprar&nbsp;</h1><p>adquirir &amp; pagar<br>ejemplo</p><ul><li>uno</li><li>dos</li></ul><script>steal()</script><img src="https://example.test/x">',
    );

    expect(text).toBe('comprar\nadquirir & pagar\nejemplo\n- uno\n- dos');
    expect(text).not.toContain('steal');
    expect(text).not.toContain('https://');
  });

  it('does not mount provider markup into the document', () => {
    const before = document.body.innerHTML;
    entryHtmlToText('<button onclick="evil()">Safe</button>');
    expect(document.body.innerHTML).toBe(before);
  });
});
