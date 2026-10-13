/**
 * Picks the dashboard design ("theme"). Set DASHBOARD_THEME=gamer (default) or clean.
 */
import { buildCleanSvg, type RenderInput } from './svg-clean.js';
import { buildGamerSvg } from './svg-gamer.js';

export { DESIGN_HEIGHT, DESIGN_WIDTH, FONT_STACK, type RenderInput } from './svg-clean.js';

export type DashboardTheme = 'gamer' | 'clean';
export const THEMES: readonly DashboardTheme[] = ['gamer', 'clean'];

export function buildDashboardSvg(input: RenderInput & { theme?: DashboardTheme }): string {
  return input.theme === 'clean' ? buildCleanSvg(input) : buildGamerSvg(input);
}
