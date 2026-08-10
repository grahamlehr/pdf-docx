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
  logo?: PdfLogo;
}

export interface PdfLogo {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface EstimateCurrency {
  id: string;
  label: string;
  code: string;
  position: "prefix" | "suffix";
  spaceBetween: boolean;
  decimalSeparator: "." | ",";
  thousandsSeparator?: "," | "." | " " | "'" | "’";
  decimalPlaces: number;
}

export type CurrencyAmounts = Record<string, number>;

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
  amounts: CurrencyAmounts;
}

export interface EstimateOptionalRow {
  number: string;
  description: string;
  amount?: number;
  amounts: CurrencyAmounts;
}

export interface EstimateLineItem {
  description: string;
  notes: string[];
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  amounts: CurrencyAmounts;
}

export interface EstimateSubsection {
  number: string;
  title: string;
  amount: number;
  amounts: CurrencyAmounts;
  items: EstimateLineItem[];
  narrative: string[];
}

export interface EstimateSection {
  number: string;
  title: string;
  amount: number;
  amounts: CurrencyAmounts;
  items: EstimateLineItem[];
  narrative: string[];
  subsections: EstimateSubsection[];
}

export interface EstimateDocument {
  sourceFileName: string;
  currency: EstimateCurrency;
  currencies: EstimateCurrency[];
  metadata: EstimateMetadata;
  companyHeaderLines: string[];
  footerLegalLines: string[];
  summary: EstimateSummaryRow[];
  total: number;
  totals: CurrencyAmounts;
  optionalSummary: EstimateOptionalRow[];
  optionalTotal?: number;
  optionalTotals: CurrencyAmounts;
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
