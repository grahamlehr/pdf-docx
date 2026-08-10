import type {
  EstimateDocument,
  EstimateLineItem,
  EstimateMetadata,
  EstimateSection,
  EstimateSubsection,
  ParsedPdf,
  PdfLine,
  ValidationCheck,
} from "./types";

const MONEY_PATTERN = "£[\\d,]+(?:\\.\\d{2})";

function normalizeLine(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/£\s+(?=\d)/g, "£")
    .replace(/\s+/g, " ")
    .trim();
}

function moneyToNumber(value: string): number {
  return Number(value.replace(/[£,]/g, ""));
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
  if (/^Inizio Engage XD Limited$/i.test(text)) return true;
  if (/^Registered address:/i.test(text)) return true;
  return false;
}

function parseLineItem(text: string): EstimateLineItem | undefined {
  const normalized = normalizeLine(text);
  const regex = new RegExp(
    `^(.*?)\\s+(\\d+(?:\\.\\d+)?)\\s+([A-Za-z][A-Za-z /-]*)\\s+@\\s+(${MONEY_PATTERN})\\s+(${MONEY_PATTERN})$`,
    "i",
  );
  const match = normalized.match(regex);
  if (!match) return undefined;

  return {
    description: match[1].trim(),
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

export function buildEstimateDocument(parsedPdf: ParsedPdf, sourceFileName: string): EstimateDocument {
  const pageOne = parsedPdf.pages[0];
  if (!pageOne) throw new Error("The PDF has no pages.");

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
    .filter((line) => line.y > pageOne.height - 125 && line.x < pageOne.width * 0.52)
    .map((line) => normalizeLine(line.text))
    .filter(Boolean)
    .filter((line) => !/^Date:/i.test(line) && !/^Page:/i.test(line));

  const summary = [] as EstimateDocument["summary"];
  let total = 0;
  let summaryStarted = false;
  let notesStarted = false;
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
        notesStarted = true;
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

    if (notesStarted && line.y < pageOne.height - 125) {
      if (/^Budget Exclusions:?$/i.test(text)) {
        exclusionsStarted = true;
        notesStarted = false;
        continue;
      }
      if (text && !/^Project Number:/i.test(text)) {
        const previous = notes.at(-1);
        if (previous && /[,;:]$/.test(previous)) notes[notes.length - 1] = `${previous} ${text}`;
        else notes.push(text);
      }
      continue;
    }

    if (exclusionsStarted && line.y < pageOne.height - 125) {
      const cleaned = text.replace(/^[•·▪●*-]\s*/, "").trim();
      if (cleaned) exclusions.push(cleaned);
    }
  }

  const sections: EstimateSection[] = [];
  const unparsedDetailLines: string[] = [];
  let detailStarted = false;
  let currentSection: EstimateSection | undefined;
  let currentSubsection: EstimateSubsection | undefined;

  for (const page of parsedPdf.pages) {
    for (const line of page.lines) {
      const text = normalizeLine(line.text);
      if (!text) continue;

      if (/Cost Estimate Detail/i.test(text)) {
        detailStarted = true;
        continue;
      }
      if (!detailStarted) continue;
      if (isBoilerplate(line, page.height)) continue;
      if (/^£ Amount$/i.test(text)) continue;

      const subsectionHeading = parseSubsectionHeading(text);
      if (subsectionHeading) {
        if (!currentSection) {
          unparsedDetailLines.push(text);
          continue;
        }
        currentSubsection = {
          ...subsectionHeading,
          items: [],
        };
        currentSection.subsections.push(currentSubsection);
        continue;
      }

      const sectionHeading = parseSectionHeading(text);
      if (sectionHeading) {
        currentSection = {
          ...sectionHeading,
          items: [],
          subsections: [],
        };
        sections.push(currentSection);
        currentSubsection = undefined;
        continue;
      }

      const lineItem = parseLineItem(text);
      if (lineItem && currentSection) {
        if (currentSubsection) currentSubsection.items.push(lineItem);
        else currentSection.items.push(lineItem);
        continue;
      }

      if (!/^(Cost Estimate Detail|£ Amount)$/i.test(text)) {
        unparsedDetailLines.push(text);
      }
    }
  }

  return {
    sourceFileName,
    metadata,
    companyHeaderLines,
    footerLegalLines,
    summary,
    total,
    notes: notes.filter((line) => !/^Budget Exclusions/i.test(line)),
    exclusions,
    sections,
    unparsedDetailLines,
  };
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(value);
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
    label: "Summary categories",
    ok: document.summary.length > 0,
    value: String(document.summary.length),
  });

  const summarySum = document.summary.reduce((sum, row) => sum + row.amount, 0);
  checks.push({
    label: "Summary total",
    ok: document.total > 0 && near(summarySum, document.total),
    value: formatMoney(document.total),
    detail: `Rows sum to ${formatMoney(summarySum)}`,
  });

  const sectionSum = document.sections.reduce((sum, section) => sum + section.amount, 0);
  checks.push({
    label: "Detail categories",
    ok: document.sections.length > 0 && near(sectionSum, document.total),
    value: `${document.sections.length} sections`,
    detail: `Section totals sum to ${formatMoney(sectionSum)}`,
  });

  for (const section of document.sections) {
    const childTotal = section.subsections.length
      ? section.subsections.reduce((sum, subsection) => sum + subsection.amount, 0)
      : section.items.reduce((sum, item) => sum + item.amount, 0);

    checks.push({
      label: `${section.number} ${section.title}`,
      ok: near(childTotal, section.amount),
      value: formatMoney(section.amount),
      detail: `Parsed children total ${formatMoney(childTotal)}`,
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
