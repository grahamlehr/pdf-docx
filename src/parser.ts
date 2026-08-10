import type {
  EstimateCurrency,
  EstimateDocument,
  EstimateLineItem,
  EstimateMetadata,
  EstimateSection,
  EstimateSubsection,
  ParsedPdf,
  PdfLine,
  ValidationCheck,
} from "./types";

const CURRENCY_SYMBOL_PATTERN = "(?:£|\\$|€)";
const MONEY_PATTERN = `${CURRENCY_SYMBOL_PATTERN}\\s*[\\d,]+(?:\\.\\d{2})`;

function normalizeLine(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function moneyToNumber(value: string): number {
  return Number(value.replace(/[^\d.-]/g, ""));
}

function currencyCode(symbol: string): string {
  if (symbol === "£") return "GBP";
  if (symbol === "$") return "USD";
  if (symbol === "€") return "EUR";
  return symbol;
}

function detectCurrency(parsedPdf: ParsedPdf): EstimateCurrency {
  const lines = parsedPdf.pages.flatMap((page) => page.lines.map((line) => normalizeLine(line.text)));

  for (const text of lines) {
    const headingMatch = text.match(/(?:Cost Estimate Summary|Cost Estimate Detail)\s+([£$€])\s*Amount/i);
    if (headingMatch?.[1]) {
      const symbol = headingMatch[1];
      const firstAmount = lines
        .map((candidate) => candidate.match(new RegExp(`(${CURRENCY_SYMBOL_PATTERN})(\\s*)[\\d,]+(?:\\.\\d{2})`)))
        .find((match) => match?.[1] === symbol);
      return {
        symbol,
        code: currencyCode(symbol),
        spaceAfterSymbol: Boolean(firstAmount?.[2]),
      };
    }
  }

  for (const text of lines) {
    const match = text.match(new RegExp(`(${CURRENCY_SYMBOL_PATTERN})(\\s*)[\\d,]+(?:\\.\\d{2})`));
    if (match?.[1]) {
      return {
        symbol: match[1],
        code: currencyCode(match[1]),
        spaceAfterSymbol: Boolean(match[2]),
      };
    }
  }

  return { symbol: "£", code: "GBP", spaceAfterSymbol: false };
}

export function formatEstimateMoney(value: number, currency: EstimateCurrency): string {
  const number = new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `${currency.symbol}${currency.spaceAfterSymbol ? " " : ""}${number}`;
}

function metadataValue(lines: PdfLine[], label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escaped}\\s*:?\\s*(.+)$`, "i");
  for (const line of lines) {
    const match = normalizeLine(line.text).match(regex);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function isBoilerplate(line: PdfLine, pageHeight: number): boolean {
  const text = normalizeLine(line.text);
  if (line.y < 108) return true;
  if (line.y > pageHeight - 125) return true;
  if (/^Date:\s*\d{2}\/\d{2}\/\d{4}/i.test(text)) return true;
  if (/^Page:\s*\d+/i.test(text)) return true;
  if (/^(?:Inizio Engage XD Limited|The Creative Engagement Group Ltd)$/i.test(text)) return true;
  if (/^Registered address:/i.test(text)) return true;
  if (/Company Registration 01244084/i.test(text)) return true;
  return false;
}

function parseLineItem(text: string): EstimateLineItem | undefined {
  const normalized = normalizeLine(text);
  const regex = new RegExp(
    `^(.*?)\\s+(\\d+(?:\\.\\d+)?)\\s+([A-Za-z][A-Za-z /&-]*)\\s+@\\s+(${MONEY_PATTERN})\\s+(${MONEY_PATTERN})$`,
    "i",
  );
  const match = normalized.match(regex);
  if (!match) return undefined;

  return {
    description: match[1].trim(),
    notes: [],
    quantity: Number(match[2]),
    unit: match[3].trim(),
    rate: moneyToNumber(match[4]),
    amount: moneyToNumber(match[5]),
  };
}

function parseSectionHeading(text: string): { number: string; title: string; amount: number } | undefined {
  const normalized = normalizeLine(text);
  const regex = new RegExp(`^(\\d+)\\s+(.+?)\\s+(${MONEY_PATTERN})$`);
  const match = normalized.match(regex);
  if (!match) return undefined;
  return {
    number: match[1],
    title: match[2].trim(),
    amount: moneyToNumber(match[3]),
  };
}

function parseSubsectionHeading(text: string): { number: string; title: string; amount: number } | undefined {
  const normalized = normalizeLine(text);
  const regex = new RegExp(`^(\\d+\\.\\d+)\\s+(.+?)\\s+(${MONEY_PATTERN})$`);
  const match = normalized.match(regex);
  if (!match) return undefined;
  return {
    number: match[1],
    title: match[2].trim(),
    amount: moneyToNumber(match[3]),
  };
}

function appendNarrative(target: string[], text: string): void {
  const normalized = normalizeLine(text);
  if (!normalized) return;

  const previous = target.at(-1);
  const startsBullet = /^[•·▪●*-]\s*/.test(normalized);
  const previousStartsBullet = previous ? /^[•·▪●*-]\s*/.test(previous) : false;
  const previousLooksOpen = previous ? !/[.!?:;]$/.test(previous) : false;

  if (previous && !startsBullet && previousStartsBullet && previousLooksOpen) {
    target[target.length - 1] = `${previous} ${normalized}`;
    return;
  }

  target.push(normalized);
}

export function buildEstimateDocument(parsedPdf: ParsedPdf, sourceFileName: string): EstimateDocument {
  const pageOne = parsedPdf.pages[0];
  if (!pageOne) throw new Error("The PDF has no pages.");

  const currency = detectCurrency(parsedPdf);
  const metadata: EstimateMetadata = {
    projectNumber: metadataValue(pageOne.lines, "Project Number"),
    clientName: metadataValue(pageOne.lines, "Client Name"),
    projectName: metadataValue(pageOne.lines, "Project Name"),
    completionDate: metadataValue(pageOne.lines, "Event/Completion"),
    costingVersion: metadataValue(pageOne.lines, "Costing Version"),
    estimateDate: metadataValue(pageOne.lines, "Date"),
  };

  const companyHeaderLines = pageOne.lines
    .filter((line) => line.y < 108 && line.x < pageOne.width * 0.42)
    .map((line) => normalizeLine(line.text))
    .filter(Boolean)
    .filter((line) => !/^Date:/i.test(line) && !/^Page:/i.test(line));

  const footerLegalLines = pageOne.lines
    .filter((line) => line.y > pageOne.height - 125 && line.x < pageOne.width * 0.75)
    .map((line) => normalizeLine(line.text))
    .filter(Boolean)
    .filter((line) => !/^Date:/i.test(line) && !/^Page:/i.test(line));

  const summary: EstimateDocument["summary"] = [];
  const optionalSummary: EstimateDocument["optionalSummary"] = [];
  let total = 0;
  let optionalTotal: number | undefined;
  let summaryStarted = false;
  let afterSummary = false;
  let optionalStarted = false;
  let exclusionsStarted = false;
  const notes: string[] = [];
  const exclusions: string[] = [];

  for (const line of pageOne.lines) {
    const text = normalizeLine(line.text);
    if (!text) continue;

    if (/Cost Estimate Summary/i.test(text)) {
      summaryStarted = true;
      continue;
    }

    if (summaryStarted) {
      const totalMatch = text.match(new RegExp(`^Total Cost\\s+(${MONEY_PATTERN})$`, "i"));
      if (totalMatch) {
        total = moneyToNumber(totalMatch[1]);
        summaryStarted = false;
        afterSummary = true;
        continue;
      }

      const rowMatch = text.match(new RegExp(`^(\\d+)\\s+(.+?)\\s+(${MONEY_PATTERN})$`));
      if (rowMatch) {
        summary.push({
          number: rowMatch[1],
          description: rowMatch[2].trim(),
          amount: moneyToNumber(rowMatch[3]),
        });
      }
      continue;
    }

    if (!afterSummary || line.y >= pageOne.height - 125) continue;

    if (/^Optional \(not included in Project Total\)/i.test(text)) {
      optionalStarted = true;
      exclusionsStarted = false;
      continue;
    }

    if (optionalStarted) {
      if (new RegExp(`^${CURRENCY_SYMBOL_PATTERN}\\s*Amount$`, "i").test(text)) continue;

      const optionalTotalMatch = text.match(new RegExp(`^Optional Total(?:\\s+(${MONEY_PATTERN}))?$`, "i"));
      if (optionalTotalMatch) {
        optionalTotal = optionalTotalMatch[1] ? moneyToNumber(optionalTotalMatch[1]) : undefined;
        optionalStarted = false;
        continue;
      }

      const optionalRowMatch = text.match(new RegExp(`^(\\d+)\\s+(.+?)(?:\\s+(${MONEY_PATTERN}))?$`));
      if (optionalRowMatch) {
        optionalSummary.push({
          number: optionalRowMatch[1],
          description: optionalRowMatch[2].trim(),
          amount: optionalRowMatch[3] ? moneyToNumber(optionalRowMatch[3]) : undefined,
        });
        continue;
      }

      optionalStarted = false;
    }

    if (/^Budget Exclusions:?$/i.test(text)) {
      exclusionsStarted = true;
      continue;
    }

    if (exclusionsStarted) {
      const cleaned = text.replace(/^[•·▪●*-]\s*/, "").trim();
      if (cleaned) exclusions.push(cleaned);
      continue;
    }

    appendNarrative(notes, text);
  }

  const sections: EstimateSection[] = [];
  const unparsedDetailLines: string[] = [];
  let detailStarted = false;
  let currentSection: EstimateSection | undefined;
  let currentSubsection: EstimateSubsection | undefined;
  let lastItem: EstimateLineItem | undefined;
  const optionalNumbers = new Set(optionalSummary.map((row) => row.number));

  for (const page of parsedPdf.pages) {
    for (const line of page.lines) {
      const text = normalizeLine(line.text);
      if (!text) continue;

      if (/Cost Estimate Detail/i.test(text)) {
        detailStarted = true;
        currentSection = undefined;
        currentSubsection = undefined;
        lastItem = undefined;
        continue;
      }
      if (!detailStarted) continue;
      if (isBoilerplate(line, page.height)) continue;
      if (new RegExp(`^${CURRENCY_SYMBOL_PATTERN}\\s*Amount$`, "i").test(text)) continue;

      const subsectionHeading = parseSubsectionHeading(text);
      if (subsectionHeading) {
        if (!currentSection) {
          unparsedDetailLines.push(text);
          continue;
        }
        currentSubsection = {
          ...subsectionHeading,
          items: [],
          narrative: [],
        };
        currentSection.subsections.push(currentSubsection);
        lastItem = undefined;
        continue;
      }

      const sectionHeading = parseSectionHeading(text);
      if (sectionHeading) {
        currentSection = {
          ...sectionHeading,
          items: [],
          narrative: [],
          subsections: [],
        };
        sections.push(currentSection);
        currentSubsection = undefined;
        lastItem = undefined;
        continue;
      }

      const lineItem = parseLineItem(text);
      if (lineItem && currentSection) {
        if (currentSubsection) currentSubsection.items.push(lineItem);
        else currentSection.items.push(lineItem);
        lastItem = lineItem;
        continue;
      }

      if (/^\d+$/.test(text) && optionalNumbers.has(text)) {
        lastItem = undefined;
        continue;
      }

      if (currentSection) {
        if (lastItem) {
          appendNarrative(lastItem.notes, text);
        } else if (currentSubsection) {
          appendNarrative(currentSubsection.narrative, text);
        } else {
          appendNarrative(currentSection.narrative, text);
        }
        continue;
      }

      if (!/^(Cost Estimate Detail)$/i.test(text)) {
        unparsedDetailLines.push(text);
      }
    }
  }

  return {
    sourceFileName,
    currency,
    metadata,
    companyHeaderLines,
    footerLegalLines,
    summary,
    total,
    optionalSummary,
    optionalTotal,
    notes,
    exclusions,
    sections,
    unparsedDetailLines,
  };
}

function near(a: number, b: number, tolerance = 0.02): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function validateEstimate(document: EstimateDocument): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const metadataFound = Object.values(document.metadata).filter(Boolean).length;
  checks.push({
    label: "Project metadata",
    ok: metadataFound >= 5,
    value: `${metadataFound}/6 fields`,
  });

  checks.push({
    label: "Currency",
    ok: Boolean(document.currency.symbol),
    value: document.currency.code,
  });

  checks.push({
    label: "Summary categories",
    ok: document.summary.length > 0,
    value: String(document.summary.length),
  });

  const summarySum = document.summary.reduce((sum, row) => sum + row.amount, 0);
  checks.push({
    label: "Summary total",
    ok: document.total > 0 && near(summarySum, document.total),
    value: formatEstimateMoney(document.total, document.currency),
    detail: `Rows sum to ${formatEstimateMoney(summarySum, document.currency)}`,
  });

  const sectionSum = document.sections.reduce((sum, section) => sum + section.amount, 0);
  checks.push({
    label: "Detail categories",
    ok: document.sections.length > 0 && near(sectionSum, document.total),
    value: `${document.sections.length} sections`,
    detail: `Section totals sum to ${formatEstimateMoney(sectionSum, document.currency)}`,
  });

  for (const section of document.sections) {
    const directItemsTotal = section.items.reduce((sum, item) => sum + item.amount, 0);
    const subsectionTotal = section.subsections.reduce((sum, subsection) => sum + subsection.amount, 0);
    const childTotal = directItemsTotal + subsectionTotal;

    checks.push({
      label: `${section.number} ${section.title}`,
      ok: near(childTotal, section.amount),
      value: formatEstimateMoney(section.amount, document.currency),
      detail: `Parsed children total ${formatEstimateMoney(childTotal, document.currency)}`,
    });
  }

  checks.push({
    label: "Unparsed detail lines",
    ok: document.unparsedDetailLines.length === 0,
    value: String(document.unparsedDetailLines.length),
    detail:
      document.unparsedDetailLines.length > 0
        ? document.unparsedDetailLines.slice(0, 3).join(" | ")
        : undefined,
  });

  return checks;
}
