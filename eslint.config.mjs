import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import nextPlugin from '@next/eslint-plugin-next';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';

const BRAND_MESSAGE =
  'Studio brand tokens are for the studio UI only. Client designs must use the design tokens in packages/sections.';

// Dynamic import() and require() are not covered by no-restricted-imports.
// esquery cannot parse a literal "/" in a regex, so "\x2F" stands in for it.
// Client packages must not name a local module `brand` or `brand/...`; that name is reserved
// for the studio boundary. Use `client-brand` or `tokens` instead.
const brandPathRegexes = [
  '^@srs\\x2F(brand|web)($|\\x2F)',
  '(^|\\x2F)apps\\x2F',
  '(^|\\x2F)brand($|\\x2F)',
];
const brandSyntax = brandPathRegexes.flatMap((re) => [
  {
    selector: `ImportExpression > Literal[value=/${re}/]`,
    message: BRAND_MESSAGE,
  },
  {
    selector: `CallExpression[callee.name='require'] > Literal:first-child[value=/${re}/]`,
    message: BRAND_MESSAGE,
  },
]);

const FIXTURE_URLS_MESSAGE =
  'The fixture URL schemas accept loopback URLs and are for evals/ and *.test.ts files only (ADR-010). Production code uses the strict schemas from @srs/site-model.';
const fixtureUrlsGroup = {
  group: [
    '@srs/site-model/fixture-urls',
    '@srs/site-model/fixture-urls/*',
    '**/fixture-urls',
    '**/fixture-urls/**',
  ],
  message: FIXTURE_URLS_MESSAGE,
};
const brandPatternGroup = {
  group: [
    '@srs/brand',
    '@srs/brand/*',
    '@srs/web',
    '@srs/web/*',
    '**/apps/**',
    '**/brand',
    '**/brand/**',
  ],
  message: BRAND_MESSAGE,
};
const FACTORY_MESSAGE =
  'The schema factories and STRICT_URLS are internal to packages/site-model (ADR-010): building a schema from a custom URL schema would bypass the strict-URL rule. Use the exported schemas.';
const factoryGroup = {
  group: ['@srs/site-model'],
  importNamePattern: '^(make\\w*Schemas?|memoOnUrls|STRICT_URLS|UrlSchemas|UrlLike)$',
  message: FACTORY_MESSAGE,
};
const URL_IMPORT_MESSAGE =
  "Inside packages/site-model/src/schemas, URL fields use the factory's local `UrlSchema` / `OriginSchema` alias (ADR-010), never the strict import. Only primitives.ts may import them.";
const urlImportGroup = {
  group: ['./primitives', '../schemas/primitives'],
  importNames: ['UrlSchema', 'OriginSchema'],
  message: URL_IMPORT_MESSAGE,
};

// Dynamic import() and require() of the fixture entry point, with a string or a template literal.
// NOTE: `no-restricted-syntax` is replaced, not merged, by a later block that sets it. Any block
// below that sets `no-restricted-syntax` for non-test code must spread `...fixtureSyntax`.
const fixtureUrlsRe = '(^|\\x2F)fixture-urls($|\\x2F)';
const fixtureSyntax = [
  {
    selector: `ImportExpression > Literal[value=/${fixtureUrlsRe}/]`,
    message: FIXTURE_URLS_MESSAGE,
  },
  {
    selector: `ImportExpression > TemplateLiteral > TemplateElement[value.raw=/fixture-urls/]`,
    message: FIXTURE_URLS_MESSAGE,
  },
  {
    selector: `CallExpression[callee.name='require'] > Literal:first-child[value=/${fixtureUrlsRe}/]`,
    message: FIXTURE_URLS_MESSAGE,
  },
  {
    selector: `CallExpression[callee.name='require'] > TemplateLiteral > TemplateElement[value.raw=/fixture-urls/]`,
    message: FIXTURE_URLS_MESSAGE,
  },
];

const NETWORK_MESSAGE =
  'Network access in packages/capture and packages/audit goes through guardedFetch / guardedGoto in packages/capture/src/net.ts (consent, robots, address checks).';
const ROUTE_MESSAGE =
  'Route escape hatches (continue, fallback, unroute, routeFromHAR, connectToServer) and raw browser creation (browser.newContext, chromium.launch) are only allowed in packages/capture/src/net.ts. Use launchCaptureBrowser / newGuardedContext.';
const networkSyntax = [
  { selector: "CallExpression[callee.name='fetch']", message: NETWORK_MESSAGE },
  { selector: "CallExpression[callee.property.name='fetch']", message: NETWORK_MESSAGE },
  { selector: "CallExpression[callee.property.name='goto']", message: NETWORK_MESSAGE },
  // Any method on an object named `request`, or on a `.request` property (page.request, context.request).
  { selector: "CallExpression[callee.object.name='request']", message: NETWORK_MESSAGE },
  { selector: "CallExpression[callee.object.property.name='request']", message: NETWORK_MESSAGE },
  {
    selector:
      'CallExpression[callee.object.name=/^https?$/][callee.property.name=/^(get|request)$/]',
    message: NETWORK_MESSAGE,
  },
  // Route escape hatches and raw browser creation (M1 T9): only net.ts may use them.
  {
    selector:
      'CallExpression[callee.property.name=/^(continue|fallback|unroute|unrouteAll|routeFromHAR|connectToServer)$/]',
    message: ROUTE_MESSAGE,
  },
  {
    selector:
      'CallExpression[callee.property.name=/^(newContext|launch|launchPersistentContext|connect|connectOverCDP)$/]',
    message: ROUTE_MESSAGE,
  },
];

const NET_IMPORT_MESSAGE =
  'HTTP client modules are only allowed in packages/capture/src/net.ts (and test-support.ts). Use guardedFetch / guardedGoto.';
const netModules = [
  'node:http',
  'node:https',
  'node:net',
  'node:tls',
  'node:http2',
  'http',
  'https',
  'net',
  'tls',
  'http2',
  'undici',
  'axios',
];
const netImportPaths = netModules.map((name) => ({ name, message: NET_IMPORT_MESSAGE }));
const netImportGroup = { group: ['undici/**', 'axios/**'], message: NET_IMPORT_MESSAGE };
const EVALS_MESSAGE =
  '@srs/evals is for test files only; production capture and audit code must not import it.';
const PINNED_MESSAGE =
  'pinnedGet, pinnedLookup and pinnedRequest do no address check. They are internal to net.ts; use guardedFetch.';
const pinnedGroup = {
  group: ['./net', '**/net'],
  importNames: ['pinnedGet', 'pinnedLookup', 'pinnedRequest'],
  message: PINNED_MESSAGE,
};
const evalsGroup = { group: ['@srs/evals', '@srs/evals/*'], message: EVALS_MESSAGE };

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.next-*/**',
      '**/dist/**',
      '**/coverage/**',
      'brand/**',
      'docs/**',
      // Deliberate boundary violation, linted explicitly by packages/sections/src/boundary.test.ts
      'packages/sections/test-fixtures/**',
      'packages/capture/test-fixtures/**',
      // Generated synthetic sites (M1 T6a): byte-exact output of the generator, not source.
      'evals/fixtures/sites/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      '@next/next/no-html-link-for-pages': 'off', // App Router only; no pages dir
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // ADR-010: the schema factories are internal to packages/site-model. Tests included.
    // (Later blocks replace this rule rather than merge, so each repeats the factory ban.)
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    ignores: ['evals/**', 'packages/site-model/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [factoryGroup] }] },
  },
  {
    // ADR-010: the fixture URL schemas (loopback-tolerant) are for evals/ and *.test.ts only.
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    ignores: ['evals/**', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [fixtureUrlsGroup, factoryGroup] }],
      'no-restricted-syntax': ['error', ...fixtureSyntax],
    },
  },
  {
    // Brand/client boundary (M0 T11): client-facing packages must never reach studio brand or app code.
    files: [
      'packages/sections/**',
      'packages/exporters/**',
      'packages/agents/**',
      'packages/site-model/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [brandPatternGroup, fixtureUrlsGroup, factoryGroup] },
      ],
      'no-restricted-syntax': ['error', ...brandSyntax, ...fixtureSyntax],
    },
  },
  {
    // Test files in those packages keep the brand boundary but may use the fixture URL schemas.
    files: [
      'packages/sections/**/*.test.{ts,tsx}',
      'packages/exporters/**/*.test.{ts,tsx}',
      'packages/agents/**/*.test.{ts,tsx}',
      'packages/site-model/**/*.test.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': ['error', { patterns: [brandPatternGroup, factoryGroup] }],
      'no-restricted-syntax': ['error', ...brandSyntax],
    },
  },
  {
    // Schema modules take their URL schemas from the factory argument, not the strict import.
    files: ['packages/site-model/src/schemas/*.ts'],
    ignores: [
      'packages/site-model/src/schemas/primitives.ts',
      'packages/site-model/src/schemas/index.ts',
      '**/*.test.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [brandPatternGroup, fixtureUrlsGroup, factoryGroup, urlImportGroup] },
      ],
      'no-restricted-syntax': ['error', ...brandSyntax, ...fixtureSyntax],
    },
  },
  {
    // M1 T8: only packages/capture/src/net.ts may touch the network (guardedFetch / guardedGoto).
    // Later blocks replace `no-restricted-syntax`, so the non-test block repeats the fixture-URL ban.
    files: ['packages/capture/**/*.{ts,tsx}', 'packages/audit/**/*.{ts,tsx}'],
    ignores: ['packages/capture/src/net.ts', '**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...networkSyntax, ...fixtureSyntax] },
  },
  {
    files: ['packages/capture/**/*.test.{ts,tsx}', 'packages/audit/**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...networkSyntax] },
  },
  {
    // M1 T8: HTTP client modules only in net.ts and test-support.ts; @srs/evals only in tests.
    // `no-restricted-imports` is replaced by later blocks, so each block repeats every group it needs.
    files: ['packages/capture/**/*.{ts,tsx}', 'packages/audit/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [fixtureUrlsGroup, factoryGroup, evalsGroup, pinnedGroup] },
      ],
    },
  },
  {
    files: ['packages/capture/**/*.{ts,tsx}', 'packages/audit/**/*.{ts,tsx}'],
    ignores: [
      '**/*.test.{ts,tsx}',
      'packages/capture/src/net.ts',
      'packages/capture/src/test-support.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: netImportPaths,
          patterns: [fixtureUrlsGroup, factoryGroup, evalsGroup, netImportGroup, pinnedGroup],
        },
      ],
    },
  },
  {
    files: ['packages/capture/**/*.test.{ts,tsx}', 'packages/audit/**/*.test.{ts,tsx}'],
    ignores: ['packages/capture/src/net.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: netImportPaths, patterns: [factoryGroup, netImportGroup, pinnedGroup] },
      ],
    },
  },
  {
    files: ['packages/capture/src/net.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: netImportPaths, patterns: [factoryGroup, netImportGroup] },
      ],
    },
  },
  jsxA11y.flatConfigs.recommended,
  prettier,
);
