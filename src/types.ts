export interface PdfTextFragment {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
}

export interface PdfLine {
  page: number;
  y: number;
  x: number;
  text: string;
  fragments: PdfTextFragment[];
}

export interface PdfPageData {
  page: number;
  width: number;
  height: number;
  lines: PdfLine[];
  previewUrl: string;
}

export interface ParsedPdf {
  pages: PdfPageData[];
  logoPng?: Uint8Array;
}

export interface EstimateCurrency {
  symbol: string;
  code: string;
  spaceAfterSymbol: boolean;
}

export interface EstimateMetadata {
  projectNumber: string;
  clientName: string;
  projectName: string;
  completionDate: string;
  costingVersion: string;
  estimateDate: string;
}

export interface EstimateSummaryRow {
  number: string;
  description: string;
  amount: number;
}

export interface EstimateOptionalRow {
  number: string;
  description: string;
  amount?: number;
}

export interface EstimateLineItem {
  description: string;
  notes: string[];
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
}

export interface EstimateSubsection {
  number: string;
  title: string;
  amount: number;
  items: EstimateLineItem[];
  narrative: string[];
}

export interface EstimateSection {
  number: string;
  title: string;
  amount: number;
  items: EstimateLineItem[];
  narrative: string[];
  subsections: EstimateSubsection[];
}

export interface EstimateDocument {
  sourceFileName: string;
  currency: EstimateCurrency;
  metadata: EstimateMetadata;
  companyHeaderLines: string[];
  footerLegalLines: string[];
  summary: EstimateSummaryRow[];
  total: number;
  optionalSummary: EstimateOptionalRow[];
  optionalTotal?: number;
  notes: string[];
  exclusions: string[];
  sections: EstimateSection[];
  unparsedDetailLines: string[];
}

export interface ValidationCheck {
  label: string;
  ok: boolean;
  value?: string;
  detail?: string;
}
