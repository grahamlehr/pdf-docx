import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { formatEstimateMoney } from "./parser";
import type { EstimateCurrency, EstimateDocument, EstimateLineItem, PdfLogo } from "./types";

const PAGE_WIDTH = 11906;
const PAGE_HEIGHT = 16838;
const LEFT_RIGHT_MARGIN = 580;
const CONTENT_WIDTH = PAGE_WIDTH - LEFT_RIGHT_MARGIN * 2;
const BLACK = "000000";
const GREY = "C9C9C9";
const WHITE = "FFFFFF";
const BODY_FONT = "Arial";

const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: WHITE },
  bottom: { style: BorderStyle.NONE, size: 0, color: WHITE },
  left: { style: BorderStyle.NONE, size: 0, color: WHITE },
  right: { style: BorderStyle.NONE, size: 0, color: WHITE },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: WHITE },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: WHITE },
};

function money(document: EstimateDocument, value: number, currency: EstimateCurrency = document.currency): string {
  return formatEstimateMoney(value, currency);
}

function text(
  value: string,
  options: { bold?: boolean; color?: string; size?: number } = {},
): TextRun {
  return new TextRun({
    text: value,
    font: BODY_FONT,
    size: options.size ?? 17,
    bold: options.bold ?? false,
    color: options.color ?? BLACK,
  });
}

function paragraph(
  value = "",
  options: {
    bold?: boolean;
    color?: string;
    size?: number;
    alignment?: any;
    before?: number;
    after?: number;
  } = {},
): Paragraph {
  return new Paragraph({
    alignment: options.alignment ?? AlignmentType.LEFT,
    spacing: {
      before: options.before ?? 0,
      after: options.after ?? 0,
      line: 220,
    },
    children: value ? [text(value, options)] : [],
  });
}

function cell(
  children: Paragraph[],
  width: number,
  options: {
    fill?: string;
    verticalAlign?: any;
  } = {},
): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: options.verticalAlign ?? VerticalAlign.CENTER,
    shading: options.fill
      ? { type: ShadingType.CLEAR, color: "auto", fill: options.fill }
      : undefined,
    margins: { top: 70, bottom: 70, left: 85, right: 85 },
    children,
  });
}

function table(rows: TableRow[], columnWidths: number[]): Table {
  return new Table({
    rows,
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths,
    borders: NO_BORDERS,
  });
}

function logoSize(logo: PdfLogo): { width: number; height: number } {
  const maxWidth = 190;
  const maxHeight = 76;
  const scale = Math.min(maxWidth / logo.width, maxHeight / logo.height);
  return {
    width: Math.max(1, Math.round(logo.width * scale)),
    height: Math.max(1, Math.round(logo.height * scale)),
  };
}

function createHeader(document: EstimateDocument, logo?: PdfLogo): Header {
  const leftWidth = 6200;
  const rightWidth = CONTENT_WIDTH - leftWidth;

  const addressParagraphs = document.companyHeaderLines.length
    ? document.companyHeaderLines.slice(0, 9).map((line) => paragraph(line, { size: 14 }))
    : [paragraph("Inizio Engage XD Limited", { bold: true, size: 14 })];

  let logoParagraphs: Paragraph[];
  if (logo?.data.length) {
    const transformation = logoSize(logo);
    logoParagraphs = [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { after: 0 },
        children: [
          new ImageRun({
            type: "png",
            data: logo.data,
            transformation,
          }),
        ],
      }),
    ];
  } else {
    logoParagraphs = [
      paragraph("INIZIO", { bold: true, size: 34, alignment: AlignmentType.RIGHT }),
      paragraph("ENGAGE", { size: 18, alignment: AlignmentType.RIGHT }),
    ];
  }

  return new Header({
    children: [
      new Table({
        rows: [
          new TableRow({
            children: [
              cell(addressParagraphs, leftWidth, { verticalAlign: VerticalAlign.TOP }),
              cell(logoParagraphs, rightWidth, { verticalAlign: VerticalAlign.TOP }),
            ],
          }),
        ],
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        columnWidths: [leftWidth, rightWidth],
        borders: NO_BORDERS,
      }),
    ],
  });
}

function createFooter(document: EstimateDocument): Footer {
  const legalLines = document.footerLegalLines.length
    ? document.footerLegalLines
    : [document.companyHeaderLines[0] || "Inizio Engage XD Limited"];

  const legalChildren: TextRun[] = [];
  legalLines.slice(0, 16).forEach((line, index) => {
    legalChildren.push(
      new TextRun({
        text: line,
        font: BODY_FONT,
        size: index === 0 ? 12 : 11,
        bold: index === 0,
        break: index === 0 ? 0 : 1,
      }),
    );
  });

  const dateLabel = document.metadata.estimateDate
    ? `Date: ${document.metadata.estimateDate}`
    : "Date:";

  return new Footer({
    children: [
      new Table({
        rows: [
          new TableRow({
            children: [
              cell([paragraph(dateLabel, { bold: true, size: 12 })], CONTENT_WIDTH / 2),
              cell(
                [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    spacing: { after: 0 },
                    children: [
                      new TextRun({
                        font: BODY_FONT,
                        size: 12,
                        children: ["Page: ", PageNumber.CURRENT],
                      }),
                    ],
                  }),
                ],
                CONTENT_WIDTH / 2,
              ),
            ],
          }),
        ],
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        columnWidths: [CONTENT_WIDTH / 2, CONTENT_WIDTH / 2],
        borders: NO_BORDERS,
      }),
      new Paragraph({ spacing: { before: 180, after: 0, line: 150 }, children: legalChildren }),
    ],
  });
}

function metadataTable(document: EstimateDocument): Table {
  const labelWidth = 2750;
  const valueWidth = CONTENT_WIDTH - labelWidth;
  const rows: Array<[string, string]> = [
    ["Project Number:", document.metadata.projectNumber],
    ["Client Name:", document.metadata.clientName],
    ["Project Name:", document.metadata.projectName],
    ["Event/Completion:", document.metadata.completionDate],
    ["Costing Version:", document.metadata.costingVersion],
    ["Date:", document.metadata.estimateDate],
  ];

  return new Table({
    rows: rows.map(
      ([label, value]) =>
        new TableRow({
          children: [
            cell([paragraph(label, { size: 17 })], labelWidth),
            cell([paragraph(value, { size: 17 })], valueWidth),
          ],
        }),
    ),
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [labelWidth, valueWidth],
    borders: NO_BORDERS,
  });
}

function currencyColumnWidths(document: EstimateDocument, totalWidth: number): number[] {
  const count = Math.max(1, document.currencies.length);
  const each = Math.floor(totalWidth / count);
  const widths = Array.from({ length: count }, () => each);
  widths[widths.length - 1] += totalWidth - widths.reduce((sum, value) => sum + value, 0);
  return widths;
}

function currencyHeaderCells(document: EstimateDocument, widths: number[], fill: string): TableCell[] {
  return document.currencies.map((currency, index) =>
    cell(
      [paragraph(`${currency.label} Amount`, { color: fill === BLACK ? WHITE : BLACK, bold: true, size: 15, alignment: AlignmentType.RIGHT })],
      widths[index],
      { fill },
    ),
  );
}

function currencyAmountCells(
  document: EstimateDocument,
  amounts: Record<string, number>,
  widths: number[],
  options: { fill?: string; bold?: boolean; color?: string } = {},
): TableCell[] {
  return document.currencies.map((currency, index) => {
    const value = amounts[currency.id];
    return cell(
      [paragraph(value === undefined ? "" : money(document, value, currency), {
        size: 15,
        bold: options.bold,
        color: options.color,
        alignment: AlignmentType.RIGHT,
      })],
      widths[index],
      options.fill ? { fill: options.fill } : {},
    );
  });
}

function summaryTable(document: EstimateDocument): Table {
  const numberWidth = 650;
  const totalCurrencyWidth = Math.min(3600, 1450 * document.currencies.length);
  const amountWidths = currencyColumnWidths(document, totalCurrencyWidth);
  const descriptionWidth = CONTENT_WIDTH - numberWidth - totalCurrencyWidth;
  const widths = [numberWidth, descriptionWidth, ...amountWidths];
  const rows: TableRow[] = [];

  rows.push(
    new TableRow({
      children: [
        cell([paragraph("", { color: WHITE })], numberWidth, { fill: BLACK }),
        cell([paragraph("Cost Estimate Summary", { color: WHITE, bold: true, size: 15 })], descriptionWidth, { fill: BLACK }),
        ...currencyHeaderCells(document, amountWidths, BLACK),
      ],
    }),
  );

  for (const row of document.summary) {
    rows.push(
      new TableRow({
        children: [
          cell([paragraph(row.number, { size: 15 })], numberWidth),
          cell([paragraph(row.description, { size: 15 })], descriptionWidth),
          ...currencyAmountCells(document, row.amounts, amountWidths),
        ],
      }),
    );
  }

  rows.push(
    new TableRow({
      children: [
        cell([paragraph("", { color: WHITE })], numberWidth, { fill: BLACK }),
        cell([paragraph("Total Cost", { color: WHITE, bold: true, size: 15 })], descriptionWidth, { fill: BLACK }),
        ...currencyAmountCells(document, document.totals, amountWidths, { fill: BLACK, bold: true, color: WHITE }),
      ],
    }),
  );

  return table(rows, widths);
}

function optionalSummaryTable(document: EstimateDocument): Table | undefined {
  if (!document.optionalSummary.length) return undefined;

  const numberWidth = 650;
  const totalCurrencyWidth = Math.min(3600, 1450 * document.currencies.length);
  const amountWidths = currencyColumnWidths(document, totalCurrencyWidth);
  const descriptionWidth = CONTENT_WIDTH - numberWidth - totalCurrencyWidth;
  const widths = [numberWidth, descriptionWidth, ...amountWidths];
  const rows: TableRow[] = [
    new TableRow({
      children: [
        cell([paragraph("", { color: WHITE })], numberWidth, { fill: BLACK }),
        cell([paragraph("Optional (not included in Project Total)", { color: WHITE, bold: true, size: 15 })], descriptionWidth, { fill: BLACK }),
        ...currencyHeaderCells(document, amountWidths, BLACK),
      ],
    }),
  ];

  for (const row of document.optionalSummary) {
    rows.push(
      new TableRow({
        children: [
          cell([paragraph(row.number, { size: 15 })], numberWidth),
          cell([paragraph(row.description, { size: 15 })], descriptionWidth),
          ...currencyAmountCells(document, row.amounts, amountWidths),
        ],
      }),
    );
  }

  rows.push(
    new TableRow({
      children: [
        cell([paragraph("", { color: WHITE })], numberWidth, { fill: BLACK }),
        cell([paragraph("Optional Total", { color: WHITE, bold: true, size: 15 })], descriptionWidth, { fill: BLACK }),
        ...currencyAmountCells(document, document.optionalTotals, amountWidths, { fill: BLACK, bold: true, color: WHITE }),
      ],
    }),
  );

  return table(rows, widths);
}

function detailWidths(document: EstimateDocument): { all: number[]; number: number; description: number; rate: number; amounts: number[] } {
  const number = 650;
  const rate = document.currencies.length > 1 ? 2050 : 2650;
  const amountTotal = Math.min(3300, 1350 * document.currencies.length);
  const amounts = currencyColumnWidths(document, amountTotal);
  const description = CONTENT_WIDTH - number - rate - amountTotal;
  return { all: [number, description, rate, ...amounts], number, description, rate, amounts };
}

function detailHeaderRow(document: EstimateDocument, widths = detailWidths(document)): TableRow {
  return new TableRow({
    children: [
      cell([paragraph("", { color: WHITE })], widths.number, { fill: BLACK }),
      cell([paragraph("Cost Estimate Detail", { color: WHITE, bold: true, size: 15 })], widths.description, { fill: BLACK }),
      cell([paragraph("", { color: WHITE })], widths.rate, { fill: BLACK }),
      ...currencyHeaderCells(document, widths.amounts, BLACK),
    ],
  });
}

function detailLineItemRow(
  document: EstimateDocument,
  item: EstimateLineItem,
  widths: ReturnType<typeof detailWidths>,
): TableRow {
  const descriptionParagraphs = [paragraph(item.description, { size: 15 })];
  for (const note of item.notes) descriptionParagraphs.push(paragraph(note, { size: 14 }));

  return new TableRow({
    children: [
      cell([paragraph("")], widths.number),
      cell(descriptionParagraphs, widths.description),
      cell(
        [paragraph(`${item.quantity.toFixed(2)} ${item.unit} @ ${money(document, item.rate)}`, { size: 15, alignment: AlignmentType.RIGHT })],
        widths.rate,
        { verticalAlign: VerticalAlign.TOP },
      ),
      ...document.currencies.map((currency, index) =>
        cell(
          [paragraph(item.amounts[currency.id] === undefined ? "" : money(document, item.amounts[currency.id], currency), {
            size: 15,
            alignment: AlignmentType.RIGHT,
          })],
          widths.amounts[index],
          { verticalAlign: VerticalAlign.TOP },
        ),
      ),
    ],
  });
}

function detailNarrativeRow(document: EstimateDocument, value: string, widths: ReturnType<typeof detailWidths>): TableRow {
  return new TableRow({
    children: [
      cell([paragraph("")], widths.number),
      cell([paragraph(value, { size: 14 })], widths.description),
      cell([paragraph("")], widths.rate),
      ...document.currencies.map((_, index) => cell([paragraph("")], widths.amounts[index])),
    ],
  });
}

function detailTable(document: EstimateDocument): Table {
  const widths = detailWidths(document);
  const rows: TableRow[] = [detailHeaderRow(document, widths)];

  for (const section of document.sections) {
    rows.push(
      new TableRow({
        children: [
          cell([paragraph(section.number, { color: WHITE, bold: true, size: 15 })], widths.number, { fill: BLACK }),
          cell([paragraph(section.title, { color: WHITE, bold: true, size: 15 })], widths.description, { fill: BLACK }),
          cell([paragraph("", { color: WHITE })], widths.rate, { fill: BLACK }),
          ...currencyAmountCells(document, section.amounts, widths.amounts, { fill: BLACK, bold: true, color: WHITE }),
        ],
      }),
    );

    for (const narrative of section.narrative) rows.push(detailNarrativeRow(document, narrative, widths));
    for (const item of section.items) rows.push(detailLineItemRow(document, item, widths));

    for (const subsection of section.subsections) {
      rows.push(
        new TableRow({
          children: [
            cell([paragraph(subsection.number, { bold: true, size: 15 })], widths.number, { fill: GREY }),
            cell([paragraph(subsection.title, { bold: true, size: 15 })], widths.description, { fill: GREY }),
            cell([paragraph("")], widths.rate, { fill: GREY }),
            ...currencyAmountCells(document, subsection.amounts, widths.amounts, { fill: GREY, bold: true }),
          ],
        }),
      );
      for (const narrative of subsection.narrative) rows.push(detailNarrativeRow(document, narrative, widths));
      for (const item of subsection.items) rows.push(detailLineItemRow(document, item, widths));
    }
  }

  return table(rows, widths.all);
}

function buildBody(document: EstimateDocument): Array<Paragraph | Table> {
  const body: Array<Paragraph | Table> = [];
  body.push(paragraph("", { after: 520 }));
  body.push(metadataTable(document));
  body.push(paragraph("", { after: 130 }));
  body.push(summaryTable(document));

  const optional = optionalSummaryTable(document);
  if (optional) {
    body.push(paragraph("", { after: 180 }));
    body.push(optional);
  }

  body.push(paragraph("", { after: 260 }));

  for (const note of document.notes) {
    body.push(paragraph(note, { size: 16, after: 130 }));
  }

  if (document.exclusions.length) {
    body.push(paragraph("Budget Exclusions:", { size: 16, after: 120 }));
    for (const exclusion of document.exclusions) {
      body.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 20, line: 210 },
          children: [text(exclusion, { size: 15 })],
        }),
      );
    }
  }

  body.push(new Paragraph({ children: [new PageBreak()] }));
  body.push(detailTable(document));
  return body;
}

export async function generateEstimateDocx(document: EstimateDocument, logo?: PdfLogo): Promise<Blob> {
  const wordDocument = new Document({
    creator: "Estimate to Word",
    description: "Editable Word reconstruction of a PDF cost estimate",
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: {
              top: 1780,
              right: LEFT_RIGHT_MARGIN,
              bottom: 2550,
              left: LEFT_RIGHT_MARGIN,
              header: 180,
              footer: 180,
            },
          },
        },
        headers: { default: createHeader(document, logo) },
        footers: { default: createFooter(document) },
        children: buildBody(document),
      },
    ],
  });

  return Packer.toBlob(wordDocument);
}

export function suggestedDocxName(document: EstimateDocument): string {
  const stem = document.metadata.projectNumber || document.sourceFileName.replace(/\.pdf$/i, "") || "estimate";
  return `${stem.replace(/[^a-z0-9-_]+/gi, "_")}.docx`;
}
