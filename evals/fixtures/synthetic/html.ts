/** Tiny HTML helpers for the synthetic site generator. Pure. */

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

/** Escape text for an HTML text node or a double-quoted attribute value. */
export function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c);
}

/** Digits only, e.g. for comparing a displayed phone with a `tel:` href. */
export function digitsOf(text: string): string {
  return text.replace(/\D/g, '');
}

/** A phone as the page shows it: `(302) 555-0100`, `998-555-0179`, optionally with `+1`. */
export const PHONE_IN_TEXT = /(?:\(\d{3}\)\s?|\d{3}[-. ])\d{3}[-. ]\d{4}/g;

/** Same 10 digits (a leading country code 1 is ignored). */
export function samePhone(a: string, b: string): boolean {
  const ten = (s: string): string => {
    const d = digitsOf(s);
    return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  };
  return ten(a) === ten(b);
}
