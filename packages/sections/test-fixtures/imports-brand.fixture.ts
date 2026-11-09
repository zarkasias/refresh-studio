// Deliberate violation. Linted explicitly by src/boundary.test.ts; ignored by `pnpm lint`
// and outside the tsconfig include. Do not "fix".
import '@srs/brand/theme.css';
import { studioTokens } from '@srs/brand';

export const leaked = studioTokens;
