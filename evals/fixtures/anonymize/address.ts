/**
 * Small US address parser for the anonymizer. It only needs to find the parts that identify a
 * place (building name, street number and name, city, ZIP) so they can be replaced everywhere
 * they appear. The state is found so it can be kept.
 */
import { US_STATES } from './vocab';

export interface ParsedStreet {
  /** House number as written, e.g. `905`. */
  number: string;
  /** Leading direction as written, e.g. `N`, `SE`. */
  direction?: string;
  /** Street name words, e.g. `['San', 'Francisco']`, `['20th']`. */
  name: string[];
}

export interface ParsedAddress {
  building?: string;
  street?: ParsedStreet;
  city?: string;
  state?: string;
  zip?: string;
}

const DIRECTION = '(?:N|S|E|W|NE|NW|SE|SW|North|South|East|West)';
const SUFFIX =
  '(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Highway|Hwy|Boulevard|Blvd|Lane|Ln|Way|Court|Ct|Place|Pl|Parkway|Pkwy|Circle|Cir|Terrace|Ter|Trail|Trl|Pike|Route|Rte)';

const STREET_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(\d{1,6})\s+(?:(${DIRECTION})\.?\s+)?((?:[\p{L}\p{N}][\p{L}\p{N}'’.-]*\s+){0,3}?[\p{L}\p{N}][\p{L}\p{N}'’-]*)\s+${SUFFIX}(?![\p{L}])\.?(?:\s+${DIRECTION}(?![\p{L}]))?`,
  'iu',
);

const STATE_ALTERNATION = US_STATES.flatMap(([abbr, name]) => [name.replace(/ /g, '\\s+'), abbr])
  .sort((a, b) => b.length - a.length)
  .join('|');

const STATE_ZIP_RE = new RegExp(
  String.raw`(?<![\p{L}])(${STATE_ALTERNATION})(?![\p{L}])[\s,]*(\d{5}(?:-\d{4})?)(?!\d)`,
  'gu',
);

const UNIT_RE = /(?:\bSuite|\bSte\.?|\bUnit|#)\s*[\p{L}\p{N}-]+/giu;

/** Parse a one-line US address as written on a site. Missing parts are left undefined. */
export function parseUsAddress(address: string): ParsedAddress {
  const out: ParsedAddress = {};

  let stateMatch: RegExpExecArray | undefined;
  for (const m of address.matchAll(STATE_ZIP_RE)) stateMatch = m;
  const stateStart = stateMatch?.index ?? address.length;
  if (stateMatch) {
    out.state = stateMatch[1];
    out.zip = stateMatch[2];
  }

  const head = address.slice(0, stateStart);
  const street = STREET_RE.exec(head);
  let cityRegion = head;
  if (street) {
    const number = street[1] ?? '';
    const direction = street[2];
    const name = (street[3] ?? '').trim().split(/\s+/u);
    out.street = { number, ...(direction ? { direction } : {}), name };
    const building = head
      .slice(0, street.index)
      .replace(/^[\s|,·-]+|[\s|,·-]+$/gu, '')
      .trim();
    if (building) out.building = building;
    cityRegion = head.slice(street.index + street[0].length);
  }

  const chunks = cityRegion
    .replace(UNIT_RE, ' ')
    .split(/[,|·]/u)
    .map((c) => c.trim())
    .filter((c) => /\p{L}/u.test(c));
  const city = chunks.at(-1);
  if (city && stateMatch) out.city = city;
  return out;
}
