/**
 * Built-in demonstration rows used only by the preview command when no sheet
 * is configured. They are configuration ranges, not data, and the preview
 * image is labelled "DEMO CONFIGURATION" in addition to "SIMULATED DATA".
 */
import type { DashboardItem } from './types.js';

export const DEMO_ITEMS: DashboardItem[] = [
  {
    id: 'demo-north',
    rowNumber: 0,
    titleEn: 'Demo Dashboard Item',
    titleCn: '演示仪表板项目',
    dataSource: 'Demo configuration',
    region: 'Malaysia',
    lastUpdated: 'Daily',
    nextUpdate: 'Tomorrow',
    current: { min: 95, max: 99.5 },
    baseline: { min: 92, max: 97 },
    volume24h: { min: 120000, max: 480000 },
    output24h: { min: 90000, max: 410000 },
    eventCount24h: { min: 800, max: 3200 },
  },
];
