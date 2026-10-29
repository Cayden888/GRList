/**
 * Picks the dashboard design ("theme"). Set DASHBOARD_THEME=pro (default), gamer or clean.
 */
import { buildCleanSvg, type RenderInput } from './svg-clean.js';
import { buildGamerSvg } from './svg-gamer.js';
import { buildProSvg } from './svg-pro.js';

export { DESIGN_HEIGHT, DESIGN_WIDTH, FONT_STACK, type RenderInput } from './svg-clean.js';

export type DashboardTheme = 'pro' | 'gamer' | 'clean';
export const THEMES: readonly DashboardTheme[] = ['pro', 'gamer', 'clean'];

export function buildDashboardSvg(input: RenderInput & { theme?: DashboardTheme }): string {
  if (input.theme === 'clean') return buildCleanSvg(input);
  if (input.theme === 'gamer') return buildGamerSvg(input);
  return buildProSvg(input);
}
