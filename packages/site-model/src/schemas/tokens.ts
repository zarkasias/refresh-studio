import { z } from 'zod';
import { HexColorSchema } from './primitives';

/** v1 */
export const GoogleFontSchema = z.strictObject({
  family: z.string().min(1),
  weights: z.array(z.int().min(1).max(1000)).min(1),
});
export type GoogleFont = z.infer<typeof GoogleFontSchema>;

export const RadiusSchema = z.enum(['none', 'sm', 'md', 'lg']);
export type Radius = z.infer<typeof RadiusSchema>;

export const DesignTokensSchema = z.strictObject({
  color: z.strictObject({
    primary: HexColorSchema,
    secondary: HexColorSchema,
    accent: HexColorSchema,
    background: HexColorSchema,
    surface: HexColorSchema,
    text: HexColorSchema,
    mutedText: HexColorSchema,
  }),
  font: z.strictObject({
    heading: GoogleFontSchema,
    body: GoogleFontSchema,
  }),
  typeScale: z.strictObject({
    base: z.number().positive(),
    ratio: z.number().positive(),
  }),
  spacing: z.strictObject({
    unit: z.number().positive(),
  }),
  radius: RadiusSchema,
});
export type DesignTokens = z.infer<typeof DesignTokensSchema>;
