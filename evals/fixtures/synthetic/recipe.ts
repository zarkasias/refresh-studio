/**
 * A recipe adds the patterns to a synthetic site (M1 T6a). The generator renders every section
 * generically from the anonymized label; a recipe only says what is special about this site:
 * platform markers, font names, plain-text phones, hidden copies, scripts that load content late.
 *
 * Every hook is pure: it returns strings and records what capture should find in `expect`.
 */
import type { Cta, Page, Section, SectionLeafItem, Site } from '@srs/site-model';
import type { ExpectedCapture } from './expected-capture';

/** What the recipes record while rendering; becomes part of `expected.capture.json`. */
export interface Expectations {
  markers: ExpectedCapture['platform']['markers'];
  phones: ExpectedCapture['phones'];
  plainTextPhones: ExpectedCapture['plainTextPhones'];
  hrefMismatches: ExpectedCapture['hrefMismatches'];
  emails: ExpectedCapture['emails'];
  hiddenCopies: ExpectedCapture['hiddenCopies'];
  navDropdowns: ExpectedCapture['navDropdowns'];
  deferredContent: ExpectedCapture['deferredContent'];
  mustNotRecord: string[];
}

export interface PageContext {
  readonly label: Site;
  readonly page: Page;
  readonly expect: Expectations;
}

export interface SectionContext extends PageContext {
  readonly section: Section;
}

/** Which piece of the label a displayed string came from, e.g. `body` or `item.title`. */
export type TextField = string;

/** One rendered section, in page order. */
export interface RenderedBlock {
  readonly section: Section;
  readonly html: string;
}

export interface Recipe {
  readonly slug: string;
  /** From the manifest: platform, page builder and `evidence` (signals to emit as markers). */
  readonly platform: {
    readonly platform: string;
    readonly pageBuilder?: string;
    readonly evidence: readonly { readonly signal: string; readonly where: string }[];
  };
  /** External hosts whose files are served from `platform-assets/<host>/` under lockdown. */
  readonly platformHosts: readonly string[];
  /** Computed `font-family` name for a real family (builders use internal names). */
  fontName?(family: string): string;
  /** Extra `<head>` tags. */
  headTags?(ctx: PageContext): string[];
  /** Extra classes for `<body>`. */
  bodyClasses?(ctx: PageContext): string[];
  /** Extra CSS appended to the site stylesheet. */
  css?(): string;
  /** Final say on every displayed string (return '' to leave it out). */
  text?(text: string, field: TextField, ctx: SectionContext): string;
  /** Render an email link some other way (e.g. obfuscated). Return undefined for the default. */
  emailLink?(cta: Cta, email: string, ctx: SectionContext): string | undefined;
  /** Dropdown entries for a nav item that the label doesn't list. */
  navSubmenu?(item: { title?: string; link?: string }, ctx: SectionContext): SectionLeafItem[];
  /** HTML inserted into a section after its text and before its items and buttons. */
  extraContent?(ctx: SectionContext): string;
  /** Lay out the page's sections (default: in order). Used for sliders and clones. */
  arrange?(blocks: readonly RenderedBlock[], ctx: PageContext): string;
  /** Script tags at the end of `<body>`. */
  bodyEnd?(ctx: PageContext): string[];
  /** Extra files, keyed by path under the site directory (assets, scripts, platform assets). */
  files?(label: Site): Record<string, string>;
}
