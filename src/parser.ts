import type {
  CurrencyAmounts,
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

const UNSIGNED_NUMBER_PATTERN = String.raw`(?:\d{1,3}(?:[,.'’\s]\d{3})+|\d+)(?:[.,]\d{1,4})?`;
const NUMBER_PATTERN = String.raw`[-+]?${UNSIGNED_NUMBER_PATTERN}`;

function normalizeLine(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseLocaleNumber(rawValue: string): number {
  let value = rawValue.trim().replace(/[’']/g, "").replace(/\s/g, "");
  const negative = /^-/.test(value);
  value = value.replace(/^[-+]/, "");

  const lastDot = value.lastIndexOf(".");
  const lastComma = value.lastIndexOf(",");
  let decimalSeparator: "." | "," | undefined;

  if (lastDot >= 0 && lastComma >= 0) {
    decimalSeparator = lastDot > lastComma ? "." : ",";
  } else if (lastDot >= 0 || lastComma >= 0) {
    const separator = lastDot >= 0 ? "." : ",";
    const index = value.lastIndexOf(separator);
    const digitsAfter = value.length - index - 1;
    if (digitsAfter > 0 && digitsAfter <= 4 && digitsAfter !== 3) decimalSeparator = separator;
  }

  if (decimalSeparator) {
    const thousandsSeparator = decimalSeparator === "." ? "," : ".";
    value = value.split(thousandsSeparator).join("");
    if (decimalSeparator === ",") value = value.replace(",", ".");
  } else {
    value = value.replace(/[.,]/g, "");
  }

  const result = Number(value);
  return negative ? -result : result;
}

function detectNumberStyle(rawValue: string): Pick<EstimateCurrency, "decimalSeparator" | "thousandsSeparator" | "decimalPlaces"> {
  const value = rawValue.trim();
  const compact = value.replace(/[’']/g, "'");
  const lastDot = compact.lastIndexOf(".");
  const lastComma = compact.lastIndexOf(",");
  let decimalSeparator: "." | "," = ".";
  let thousandsSeparator: EstimateCurrency["thousandsSeparator"];
  let decimalPlaces = 0;

  if (lastDot >= 0 && lastComma >= 0) {
    decimalSeparator = lastDot > lastComma ? "." : ",";
    thousandsSeparator = decimalSeparator === "." ? "," : ".";
    decimalPlaces = compact.length - Math.max(lastDot, lastComma) - 1;
  } else {
    const separator: "." | "," | undefined = lastDot >= 0 ? "." : lastComma >= 0 ? "," : undefined;
    if (separator) {
      const index = compact.lastIndexOf(separator);
      const digitsAfter = compact.length - index - 1;
      if (digitsAfter > 0 && digitsAfter <= 4 && digitsAfter !== 3) {
        decimalSeparator = separator;
        decimalPlaces = digitsAfter;
      } else {
        thousandsSeparator = separator;
      }
    }
  }

  if (!thousandsSeparator) {
    if (/\d[’']\d{3}/.test(value)) thousandsSeparator = value.includes("’") ? "’" : "'";
    else if (/\d\s\d{3}/.test(value)) thousandsSeparator = " ";
  }

  return { decimalSeparator, thousandsSeparator, decimalPlaces };
}

function currencyCode(label: string): string {
  const compact = label.replace(/[^A-Za-z]/g, "").toUpperCase();
  return compact.length >= 2 && compact.length <= 5 ? compact : label;
}

function headingCurrencyLabels(text: string): string[] {
  const tail = text.replace(/^.*?Cost Estimate (?:Summary|Detail)\s*/i, "");
  return [...tail.matchAll(/(\S+)\s+Amount\b/gi)].map((match) => match[1]).filter(Boolean);
}

function findCurrencySample(lines: string[], label: string): {
  rawNumber: string;
  position: "prefix" | "suffix";
  spaceBetween: boolean;
} | undefined {
  const token = escapeRegex(label);
  const prefix = new RegExp(`${token}(\\s*)(${NUMBER_PATTERN})`, "i");
  const suffix = new RegExp(`(${NUMBER_PATTERN})(\\s*)${token}`, "i");

  for (const line of lines) {
    const prefixMatch = line.match(prefix);
    if (prefixMatch) {
      return { rawNumber: prefixMatch[2], position: "prefix", spaceBetween: Boolean(prefixMatch[1]) };
    }
    const suffixMatch = line.match(suffix);
    if (suffixMatch) {
      return { rawNumber: suffixMatch[1], position: "suffix", spaceBetween: Boolean(suffixMatch[2]) };
    }
  }
  return undefined;
}

function detectCurrencies(parsedPdf: ParsedPdf): EstimateCurrency[] {
  const lines = parsedPdf.pages.flatMap((page) => page.lines.map((line) => normalizeLine(line.text)));
  let labels: string[] = [];

  for (const text of lines) {
    if (!/Cost Estimate (?:Summary|Detail)/i.test(text)) continue;
    const found = headingCurrencyLabels(text);
    if (found.length) {
      labels = found;
      break;
    }
  }

  if (!labels.length) {
    for (const text of lines) {
      const match = text.match(new RegExp(`([\\p{Sc}]|[A-Z]{3,5})\\s*(${NUMBER_PATTERN})`, "u"));
      if (match?.[1]) {
        labels = [match[1]];
        break;
      }
    }
  }

  if (!labels.length) {
    throw new Error("I could read the estimate, but could not detect its displayed currency from the Amount heading.");
  }

  return labels.map((label, index) => {
    const sample = findCurrencySample(lines, label);
    const numberStyle = detectNumberStyle(sample?.rawNumber ?? "1,234.56");
    return {
      id: `currency-${index + 1}`,
      label,
      code: currencyCode(label),
      position: sample?.position ?? "prefix",
      spaceBetween: sample?.spaceBetween ?? false,
      ...numberStyle,
    };
  });
}

export function formatEstimateMoney(value: number, currency: EstimateCurrency): string {
  const decimals = Math.max(0, Math.min(6, currency.decimalPlaces));
  const fixed = Math.abs(value).toFixed(decimals);
  const [integerPart, decimalPart] = fixed.split(".");
  const groups: string[] = [];
  let remaining = integerPart;
  while (remaining.length > 3) {
    groups.unshift(remaining.slice(-3));
    remaining = remaining.slice(0, -3);
  }
  groups.unshift(remaining);

  const thousands = currency.thousandsSeparator ?? (currency.decimalSeparator === "," ? "." : ",");
  const numeric = `${value < 0 ? "-" : ""}${groups.join(thousands)}${decimals ? `${currency.decimalSeparator}${decimalPart}` : ""}`;
  const space = currency.spaceBetween ? " " : "";
  return currency.position === "suffix" ? `${numeric}${space}${currency.label}` : `${currency.label}${space}${numeric}`;
}

export function amountForCurrency(amounts: CurrencyAmounts, currency: EstimateCurrency): number | undefined {
  return amounts[currency.id];
}

interface MoneyOccurrence {
  currency: EstimateCurrency;
  value: number;
  rawNumber: string;
  index: number;
  end: number;
}

function moneyOccurrences(text: string, currencies: EstimateCurrency[]): MoneyOccurrence[] {
  const occurrences: MoneyOccurrence[] = [];

  for (const currency of currencies) {
    const token = escapeRegex(currency.label);
    const patterns = currency.position === "prefix"
      ? [{
        pattern: new RegExp(`([-+]?)\\s*${token}\\s*([-+]?)\\s*(${UNSIGNED_NUMBER_PATTERN})`, "giu"),
        prefix: true,
      }]
      : [{
        pattern: new RegExp(`([-+]?)\\s*(${UNSIGNED_NUMBER_PATTERN})\\s*${token}`, "giu"),
        prefix: false,
      }];

    for (const { pattern, prefix } of patterns) {
      for (const match of text.matchAll(pattern)) {
        const leadingSign = match[1] ?? "";
        const innerSign = prefix ? match[2] ?? "" : "";
        const unsignedNumber = prefix ? match[3] : match[2];
        const sign = leadingSign === "-" || innerSign === "-"
          ? "-"
          : leadingSign === "+" || innerSign === "+" ? "+" : "";
        const rawNumber = `${sign}${unsignedNumber}`;
        const index = match.index ?? 0;
        occurrences.push({
          currency,
          value: parseLocaleNumber(rawNumber),
          rawNumber,
          index,
          end: index + match[0].length,
        });
      }
    }
  }

  return occurrences
    .sort((a, b) => a.index - b.index || a.end - b.end)
    .filter((item, index, all) => index === 0 || item.index !== all[index - 1].index || item.end !== all[index - 1].end);
}

function extractAmounts(text: string, currencies: EstimateCurrency[]): { amounts: CurrencyAmounts; firstIndex: number } | undefined {
  const occurrences = moneyOccurrences(text, currencies);
  if (!occurrences.length) return undefined;

  const amounts: CurrencyAmounts = {};
  for (const occurrence of occurrences) amounts[occurrence.currency.id] = occurrence.value;
  return { amounts, firstIndex: Math.min(...occurrences.map((item) => item.index)) };
}

function primaryAmount(amounts: CurrencyAmounts, currencies: EstimateCurrency[]): number {
  return amounts[currencies[0].id] ?? 0;
}

function metadataValue(lines: PdfLine[], label: string): string {
  const escaped = escapeRegex(label);
  const regex = new RegExp(`^${escaped}\\s*:?\\s*(.+)$`, "i");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = normalizeLine(line.text).match(regex);
    if (!match?.[1]) continue;

    let value = match[1].trim();
    let parenthesisBalance = (value.match(/\(/g)?.length ?? 0) - (value.match(/\)/g)?.length ?? 0);
    let previousY = line.y;

    // Metadata values can wrap beneath the value column, sometimes without an
    // open parenthesis (for example a trailing "Costs ONLY").
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextLine = lines[nextIndex];
      if (nextLine.y - previousY > 24) break;
      const continuation = normalizeLine(nextLine.text);
      if (!continuation || /^(?:Project Number|Client Name|Project Name|Event\/Completion|Costing Version|Date)\s*:/i.test(continuation)) break;
      const isIndentedContinuation = nextLine.x > line.x + 50;
      if (parenthesisBalance <= 0 && !isIndentedContinuation) break;
      value = `${value} ${continuation}`;
      parenthesisBalance += (continuation.match(/\(/g)?.length ?? 0) - (continuation.match(/\)/g)?.length ?? 0);
      previousY = nextLine.y;
    }

    return value;
  }
  return "";
}

function isBoilerplate(line: PdfLine, pageHeight: number): boolean {
  const text = normalizeLine(line.text);
  if (line.y < 108) return true;
  // Some Procim estimates place a final detail row very close to the footer.
  // Keep that usable content while still excluding the footer band itself.
  if (line.y > pageHeight - 110) return true;
  if (/^Date:\s*\d{2}\/\d{2}\/\d{4}/i.test(text)) return true;
  if (/^Page:\s*\d+/i.test(text)) return true;
  if (/^(?:Inizio Engage XD Limited|The Creative Engagement Group Ltd|Inizio Engage)$/i.test(text)) return true;
  if (/^Registered address:/i.test(text)) return true;
  if (/Company Registration/i.test(text)) return true;
  return false;
}

function parseLineItem(text: string, currencies: EstimateCurrency[]): EstimateLineItem | undefined {
  const normalized = normalizeLine(text);
  const atIndex = normalized.indexOf(" @ ");
  if (atIndex < 0) return undefined;

  const left = normalized.slice(0, atIndex).trim();
  const right = normalized.slice(atIndex + 3).trim();
  const quantityMatches = [...left.matchAll(new RegExp(NUMBER_PATTERN, "gu"))];
  const quantityMatch = quantityMatches.at(-1);
  if (!quantityMatch || quantityMatch.index === undefined) return undefined;

  const rawQuantity = quantityMatch[0];
  const description = left.slice(0, quantityMatch.index).trim();
  const unit = left.slice(quantityMatch.index + rawQuantity.length).trim();
  if (!/^[A-Za-z][A-Za-z0-9 /&()._-]*$/i.test(unit)) return undefined;

  const occurrences = moneyOccurrences(right, currencies);
  if (!occurrences.length) return undefined;

  // A blank rate cell can render as "$ $2,069,890.00": the first marker has
  // no number, so the sole occurrence is the final amount rather than a rate.
  const rate = occurrences.length > 1 ? occurrences[0].value : undefined;
  const amountOccurrences = occurrences.length > 1 ? occurrences.slice(1) : occurrences;
  const amounts: CurrencyAmounts = {};
  for (const occurrence of amountOccurrences) amounts[occurrence.currency.id] = occurrence.value;
  if (amounts[currencies[0].id] === undefined) return undefined;

  return {
    description,
    notes: [],
    quantity: parseLocaleNumber(rawQuantity),
    unit,
    rate,
    amount: primaryAmount(amounts, currencies),
    amounts,
  };
}

function parseAmountOnlyLineItem(
  text: string,
  currencies: EstimateCurrency[],
): EstimateLineItem | undefined {
  const normalized = normalizeLine(text);
  if (normalized.includes(" @ ") || isBulletLine(normalized)) return undefined;

  const extracted = extractAmounts(normalized, currencies);
  if (!extracted) return undefined;

  const description = normalized.slice(0, extracted.firstIndex).trim();
  if (!description || extracted.amounts[currencies[0].id] === undefined) return undefined;

  return {
    description,
    notes: [],
    amount: primaryAmount(extracted.amounts, currencies),
    amounts: extracted.amounts,
  };
}

function parseHeading(text: string, currencies: EstimateCurrency[], subsection: boolean): {
  number: string;
  title: string;
  amount: number;
  amounts: CurrencyAmounts;
} | undefined {
  const normalized = normalizeLine(text);
  if (normalized.includes(" @ ")) return undefined;
  const numberMatch = normalized.match(subsection ? /^(\d+\.\d+)\s+(.+)$/ : /^(\d+)\s+(.+)$/);
  if (!numberMatch) return undefined;
  const remainder = numberMatch[2];
  const extracted = extractAmounts(remainder, currencies);
  if (!extracted) return undefined;
  const title = remainder.slice(0, extracted.firstIndex).trim();
  if (!title) return undefined;
  return {
    number: numberMatch[1],
    title,
    amount: primaryAmount(extracted.amounts, currencies),
    amounts: extracted.amounts,
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

function isBulletLine(text: string): boolean {
  return /^[•·▪●*-]\s*/.test(normalizeLine(text));
}

function flushPendingNarrative(
  pending: string[],
  currentSection: EstimateSection | undefined,
  currentSubsection: EstimateSubsection | undefined,
): void {
  if (!pending.length || !currentSection) return;
  const target = currentSubsection ? currentSubsection.narrative : currentSection.narrative;
  for (const line of pending) appendNarrative(target, line);
  pending.length = 0;
}

export function buildEstimateDocument(parsedPdf: ParsedPdf, sourceFileName: string): EstimateDocument {
  const pageOne = parsedPdf.pages[0];
  if (!pageOne) throw new Error("The PDF has no pages.");

  const currencies = detectCurrencies(parsedPdf);
  const currency = currencies[0];
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
  let totals: CurrencyAmounts = {};
  let optionalTotals: CurrencyAmounts = {};
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
      if (/^Total Cost\b/i.test(text)) {
        const extracted = extractAmounts(text.replace(/^Total Cost\s*/i, ""), currencies);
        if (extracted) {
          totals = extracted.amounts;
          summaryStarted = false;
          afterSummary = true;
          continue;
        }
      }

      const row = parseHeading(text, currencies, false);
      if (row) {
        summary.push({ number: row.number, description: row.title, amount: row.amount, amounts: row.amounts });
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
      if (/\bAmount\b/i.test(text) && currencies.some((item) => text.includes(item.label))) continue;
      if (/^Optional Total\b/i.test(text)) {
        const extracted = extractAmounts(text.replace(/^Optional Total\s*/i, ""), currencies);
        optionalTotals = extracted?.amounts ?? {};
        optionalStarted = false;
        continue;
      }

      const numberMatch = text.match(/^(\d+)\s+(.+)$/);
      if (numberMatch) {
        const extracted = extractAmounts(numberMatch[2], currencies);
        const description = extracted ? numberMatch[2].slice(0, extracted.firstIndex).trim() : numberMatch[2].trim();
        optionalSummary.push({
          number: numberMatch[1],
          description,
          amount: extracted ? primaryAmount(extracted.amounts, currencies) : undefined,
          amounts: extracted?.amounts ?? {},
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
  const pendingLines: string[] = [];
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
        pendingLines.length = 0;
        continue;
      }
      if (!detailStarted) continue;
      if (isBoilerplate(line, page.height)) continue;
      if (/^Units\s+Rate$/i.test(text)) continue;
      if (/\bAmount\b/i.test(text) && currencies.some((item) => text.includes(item.label))) continue;

      const subsectionHeading = parseHeading(text, currencies, true);
      if (subsectionHeading) {
        flushPendingNarrative(pendingLines, currentSection, currentSubsection);
        if (!currentSection) {
          unparsedDetailLines.push(text);
          continue;
        }
        currentSubsection = { ...subsectionHeading, items: [], narrative: [] };
        currentSection.subsections.push(currentSubsection);
        lastItem = undefined;
        continue;
      }

      const sectionHeading = parseHeading(text, currencies, false);
      if (sectionHeading) {
        flushPendingNarrative(pendingLines, currentSection, currentSubsection);
        currentSection = { ...sectionHeading, items: [], narrative: [], subsections: [] };
        sections.push(currentSection);
        currentSubsection = undefined;
        lastItem = undefined;
        continue;
      }

      const lineItem = parseLineItem(text, currencies) ?? parseAmountOnlyLineItem(text, currencies);
      if (lineItem && currentSection) {
        if (lineItem.description) {
          if (pendingLines.length && lastItem && pendingLines.every(isBulletLine)) {
            for (const pending of pendingLines) appendNarrative(lastItem.notes, pending);
            pendingLines.length = 0;
          } else {
            flushPendingNarrative(pendingLines, currentSection, currentSubsection);
          }
        } else if (pendingLines.length) {
          const firstTitleIndex = pendingLines.findIndex((value) => !isBulletLine(value));
          if (firstTitleIndex >= 0) {
            lineItem.description = pendingLines[firstTitleIndex];
            const notes = pendingLines.filter((_, index) => index !== firstTitleIndex);
            for (const note of notes) appendNarrative(lineItem.notes, note);
            pendingLines.length = 0;
          }
        }

        if (!lineItem.description) lineItem.description = "Line item";
        if (currentSubsection) currentSubsection.items.push(lineItem);
        else currentSection.items.push(lineItem);
        lastItem = lineItem;
        continue;
      }

      const orphanAmount = text.match(new RegExp(`^(${NUMBER_PATTERN})$`, "u"));
      if (
        orphanAmount
        && lastItem
        && Object.values(lastItem.amounts).some(
          (amount) => Math.abs(Math.abs(parseLocaleNumber(orphanAmount[1])) - Math.abs(amount)) <= 0.02,
        )
      ) {
        continue;
      }

      if (/^\d+$/.test(text) && optionalNumbers.has(text)) {
        pendingLines.length = 0;
        lastItem = undefined;
        continue;
      }

      if (currentSection) {
        appendNarrative(pendingLines, text);
        continue;
      }

      if (!/^(Cost Estimate Detail)$/i.test(text)) unparsedDetailLines.push(text);
    }
  }

  flushPendingNarrative(pendingLines, currentSection, currentSubsection);

  const total = primaryAmount(totals, currencies);
  const optionalTotal = optionalTotals[currency.id];

  return {
    sourceFileName,
    currency,
    currencies,
    metadata,
    companyHeaderLines,
    footerLegalLines,
    summary,
    total,
    totals,
    optionalSummary,
    optionalTotal,
    optionalTotals,
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
  checks.push({ label: "Project metadata", ok: metadataFound >= 5, value: `${metadataFound}/6 fields` });

  checks.push({
    label: "Displayed currencies",
    ok: document.currencies.length > 0,
    value: document.currencies.map((currency) => currency.label).join(" + "),
  });

  checks.push({ label: "Summary categories", ok: document.summary.length > 0, value: String(document.summary.length) });

  for (const displayCurrency of document.currencies) {
    const rowValues = document.summary.map((row) => row.amounts[displayCurrency.id]).filter((value) => value !== undefined);
    const summarySum = rowValues.reduce((sum, value) => sum + value, 0);
    const total = document.totals[displayCurrency.id];
    const tolerance = displayCurrency.id === document.currency.id ? 0.02 : 0.15;
    checks.push({
      label: `Summary total (${displayCurrency.label})`,
      ok: total !== undefined && rowValues.length === document.summary.length && near(summarySum, total, tolerance),
      value: total === undefined ? "Missing" : formatEstimateMoney(total, displayCurrency),
      detail: `Rows sum to ${formatEstimateMoney(summarySum, displayCurrency)}`,
    });
  }

  for (const displayCurrency of document.currencies) {
    const sectionValues = document.sections.map((section) => section.amounts[displayCurrency.id]).filter((value) => value !== undefined);
    const sectionSum = sectionValues.reduce((sum, value) => sum + value, 0);
    const total = document.totals[displayCurrency.id];
    const tolerance = displayCurrency.id === document.currency.id ? 0.02 : 0.15;
    checks.push({
      label: `Detail categories (${displayCurrency.label})`,
      ok: document.sections.length > 0 && total !== undefined && sectionValues.length === document.sections.length && near(sectionSum, total, tolerance),
      value: `${document.sections.length} sections`,
      detail: `Section totals sum to ${formatEstimateMoney(sectionSum, displayCurrency)}`,
    });
  }

  for (const section of document.sections) {
    const directItemsTotal = section.items.reduce((sum, item) => sum + item.amount, 0);
    const subsectionTotal = section.subsections.reduce((sum, subsection) => sum + subsection.amount, 0);
    const childTotal = directItemsTotal + subsectionTotal;
    checks.push({
      label: `${section.number} ${section.title}`,
      ok: near(childTotal, section.amount, 0.05),
      value: formatEstimateMoney(section.amount, document.currency),
      detail: `Parsed children total ${formatEstimateMoney(childTotal, document.currency)}`,
    });
  }

  checks.push({
    label: "Unparsed detail lines",
    ok: document.unparsedDetailLines.length === 0,
    value: String(document.unparsedDetailLines.length),
    detail: document.unparsedDetailLines.length ? document.unparsedDetailLines.slice(0, 3).join(" | ") : undefined,
  });

  return checks;
}
