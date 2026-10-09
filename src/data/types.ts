export interface NumericRange {
  min: number;
  max: number;
}

/** One validated row of the Google Sheet. */
export interface DashboardItem {
  /** Stable identifier used for seeds and database records. */
  id: string;
  /** 1-based sheet row number (header = row 1). */
  rowNumber: number;
  imageName?: string;
  /** Set only when Image_Name is a real http(s) URL. */
  imageUrl?: string;
  titleEn?: string;
  titleCn?: string;
  dataSource?: string;
  region?: string;
  lastUpdated?: string;
  nextUpdate?: string;
  current: NumericRange;
  /** Optional fixed Current_Value from the sheet (used only when CURRENT_VALUE_SOURCE=sheet). */
  currentSheetValue?: number;
  baseline?: NumericRange;
  volume24h?: NumericRange;
  output24h?: NumericRange;
  eventCount24h?: NumericRange;
  /** Minutes, when the sheet gives a number. */
  timeSinceUpdateMinutes?: number;
  /** Free text such as "12 min", when the sheet gives text. */
  timeSinceUpdateText?: string;
  randomTimerSeconds?: number;
}

export interface RowIssue {
  rowNumber: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface SheetParseResult {
  items: DashboardItem[];
  issues: RowIssue[];
  totalRows: number;
}
