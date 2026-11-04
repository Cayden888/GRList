/**
 * Picks the dashboard design ("theme"). Set DASHBOARD_THEME=portrait (default), pro, control, gamer or clean.
 */
import { buildCleanSvg, type RenderInput } from './svg-clean.js';
import { buildGamerSvg } from './svg-gamer.js';
import { buildControlSvg } from './svg-control.js';
import { buildProSvg } from './svg-pro.js';
import { buildPortraitSvg } from './svg-portrait.js';

export { DESIGN_HEIGHT, DESIGN_WIDTH, FONT_STACK, type RenderInput } from './svg-clean.js';

export type DashboardTheme = 'portrait' | 'control' | 'pro' | 'gamer' | 'clean';
export const THEMES: readonly DashboardTheme[] = ['portrait', 'control', 'pro', 'gamer', 'clean'];

export function buildDashboardSvg(input: RenderInput & { theme?: DashboardTheme }): string {
  if (input.theme === 'portrait' || !input.theme) return buildPortraitSvg(input);
  if (input.theme === 'clean') return buildCleanSvg(input);
  if (input.theme === 'gamer') return buildGamerSvg(input);
  if (input.theme === 'control') return buildControlSvg(input);
  return buildProSvg(input);
}
