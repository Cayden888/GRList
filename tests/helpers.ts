import { loadConfig, type AppConfig } from '../src/config/env.js';
import type { DashboardItem } from '../src/data/types.js';

export function testConfig(env: Record<string, string> = {}): AppConfig {
  return loadConfig({ DASHBOARD_OUTPUT_DIR: 'output/test', ...env });
}

export function sampleItem(overrides: Partial<DashboardItem> = {}): DashboardItem {
  return {
    id: 'item-a',
    rowNumber: 2,
    titleEn: 'Sample Item',
    titleCn: '示例项目',
    dataSource: 'Unit test',
    region: 'Malaysia',
    current: { min: 95, max: 99.5 },
    baseline: { min: 92, max: 97 },
    volume24h: { min: 1000, max: 50000 },
    output24h: { min: 10.5, max: 80.25 },
    eventCount24h: { min: 3, max: 40 },
    ...overrides,
  };
}
