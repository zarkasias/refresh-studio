import type { Recipe } from '../synthetic/recipe';
import { casperPlumbing } from './casper-plumbing';
import { delawareValleyHardwoods } from './delaware-valley-hardwoods';
import { iphci } from './iphci';

/** The first three recipes (M1 T6a), keyed by manifest slug. */
export const RECIPES: readonly Recipe[] = [casperPlumbing, iphci, delawareValleyHardwoods];

export function recipeFor(slug: string): Recipe {
  const recipe = RECIPES.find((r) => r.slug === slug);
  if (recipe === undefined) throw new Error(`no synthetic-site recipe for ${slug}`);
  return recipe;
}

export { casperPlumbing, delawareValleyHardwoods, iphci };
