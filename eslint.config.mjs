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
        {
          patterns: [
            {
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
            },
          ],
        },
      ],
      'no-restricted-syntax': ['error', ...brandSyntax],
    },
  },
  jsxA11y.flatConfigs.recommended,
  prettier,
);
