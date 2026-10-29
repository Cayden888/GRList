/**
 * Picks the dashboard design ("theme"). Set DASHBOARD_THEME=control (default), pro, gamer or clean.
 */
import { buildCleanSvg, type RenderInput } from './svg-clean.js';
import { buildGamerSvg } from './svg-gamer.js';
import { buildControlSvg } from './svg-control.js';
import { buildProSvg } from './svg-pro.js';

export { DESIGN_HEIGHT, DESIGN_WIDTH, FONT_STACK, type RenderInput } from './svg-clean.js';

export type DashboardTheme = 'control' | 'pro' | 'gamer' | 'clean';
export const THEMES: readonly DashboardTheme[] = ['control', 'pro', 'gamer', 'clean'];

export function buildDashboardSvg(input: RenderInput & { theme?: DashboardTheme }): string {
  if (input.theme === 'clean') return buildCleanSvg(input);
  if (input.theme === 'gamer') return buildGamerSvg(input);
  if (input.theme === 'pro') return buildProSvg(input);
  return buildControlSvg(input);
}
