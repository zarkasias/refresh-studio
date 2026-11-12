/**
 * Cloudflare email obfuscation (the `data-cfemail` scheme): one key byte, then every character
 * XOR the key, all as lowercase hex. Pure.
 */

const KEY = 0x5c;

export function encodeCfEmail(email: string, key: number = KEY): string {
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  const bytes = [...Buffer.from(email, 'utf8')].map((b) => hex(b ^ key));
  return hex(key) + bytes.join('');
}

export function decodeCfEmail(encoded: string): string {
  const key = Number.parseInt(encoded.slice(0, 2), 16);
  const out: number[] = [];
  for (let i = 2; i + 1 < encoded.length; i += 2) {
    out.push(Number.parseInt(encoded.slice(i, i + 2), 16) ^ key);
  }
  return Buffer.from(out).toString('utf8');
}

/**
 * The page script Cloudflare injects, in our own words: replaces every `.__cf_email__` element
 * with the decoded address and points the wrapping `email-protection` link at `mailto:`.
 */
export const CF_EMAIL_DECODE_SCRIPT = `(function () {
  function decode(encoded) {
    var key = parseInt(encoded.substr(0, 2), 16);
    var out = '';
    for (var i = 2; i < encoded.length; i += 2) {
      out += String.fromCharCode(parseInt(encoded.substr(i, 2), 16) ^ key);
    }
    return out;
  }
  function run() {
    var nodes = document.querySelectorAll('.__cf_email__[data-cfemail]');
    for (var i = 0; i < nodes.length; i++) {
      var email = decode(nodes[i].getAttribute('data-cfemail'));
      var link = nodes[i].closest('a');
      if (link && /email-protection/.test(link.getAttribute('href') || '')) {
        link.setAttribute('href', 'mailto:' + email);
      }
      nodes[i].replaceWith(document.createTextNode(email));
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
`;

/** Where Cloudflare serves its decode script from (a same-origin path). */
export const CF_EMAIL_SCRIPT_PATH =
  '/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js';
