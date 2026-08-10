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
import type { EstimateDocument, EstimateLineItem } from "./types";

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

function money(document: EstimateDocument, value: number): string {
  return formatEstimateMoney(value, document.currency);
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

function createHeader(document: EstimateDocument, logoPng?: Uint8Array): Header {
  const leftWidth = 6200;
  const rightWidth = CONTENT_WIDTH - leftWidth;

  const addressParagraphs = document.companyHeaderLines.length
    ? document.companyHeaderLines.slice(0, 9).map((line) => paragraph(line, { size: 14 }))
    : [paragraph("Inizio Engage XD Limited", { bold: true, size: 14 })];

  let logoParagraphs: Paragraph[];
  if (logoPng?.length) {
    logoParagraphs = [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { after: 0 },
        children: [
          new ImageRun({
            type: "png",
            data: logoPng,
            transformation: { width: 190, height: 76 },
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

function summaryTable(document: EstimateDocument): Table {
  const numberWidth = 650;
  const amountWidth = 1700;
  const descriptionWidth = CONTENT_WIDTH - numberWidth - amountWidth;
  const widths = [numberWidth, descriptionWidth, amountWidth];
  const rows: TableRow[] = [];

  rows.push(
    new TableRow({
      children: [
        cell([paragraph("", { color: WHITE })], numberWidth, { fill: BLACK }),
        cell([paragraph("Cost Estimate Summary", { color: WHITE, bold: true, size: 15 })], descriptionWidth, {
          fill: BLACK,
        }),
        cell(
          [paragraph(`${document.currency.symbol} Amount`, { color: WHITE, bold: true, size: 15, alignment: AlignmentType.RIGHT })],
          amountWidth,
          { fill: BLACK },
        ),
      ],
    }),
  );

  for (const row of document.summary) {
    rows.push(
      new TableRow({
        children: [
          cell([paragraph(row.number, { size: 15 })], numberWidth),
          cell([paragraph(row.description, { size: 15 })], descriptionWidth),
          cell([paragraph(money(document, row.amount), { size: 15, alignment: AlignmentType.RIGHT })], amountWidth),
        ],
      }),
    );
  }

  rows.push(
    new TableRow({
      children: [
        cell([paragraph("", { color: WHITE })], numberWidth, { fill: BLACK }),
        cell([paragraph("Total Cost", { color: WHITE, bold: true, size: 15 })], descriptionWidth, { fill: BLACK }),
        cell(
          [paragraph(money(document, document.total), { color: WHITE, bold: true, size: 15, alignment: AlignmentType.RIGHT })],
          amountWidth,
          { fill: BLACK },
        ),
      ],
    }),
  );

  return table(rows, widths);
}

function optionalSummaryTable(document: EstimateDocument): Table | undefined {
  if (!document.optionalSummary.length) return undefined;

  const numberWidth = 650;
  const amountWidth = 1700;
  const descriptionWidth = CONTENT_WIDTH - numberWidth - amountWidth;
  const widths = [numberWidth, descriptionWidth, amountWidth];
  const rows: TableRow[] = [
    new TableRow({
      children: [
        cell([paragraph("", { color: WHITE })], numberWidth, { fill: BLACK }),
        cell([paragraph("Optional (not included in Project Total)", { color: WHITE, bold: true, size: 15 })], descriptionWidth, {
          fill: BLACK,
        }),
        cell(
          [paragraph(`${document.currency.symbol} Amount`, { color: WHITE, bold: true, size: 15, alignment: AlignmentType.RIGHT })],
          amountWidth,
          { fill: BLACK },
        ),
      ],
    }),
  ];

  for (const row of document.optionalSummary) {
    rows.push(
      new TableRow({
        children: [
          cell([paragraph(row.number, { size: 15 })], numberWidth),
          cell([paragraph(row.description, { size: 15 })], descriptionWidth),
          cell(
            [paragraph(row.amount === undefined ? "" : money(document, row.amount), { size: 15, alignment: AlignmentType.RIGHT })],
            amountWidth,
          ),
        ],
      }),
    );
  }

  rows.push(
    new TableRow({
      children: [
        cell([paragraph("", { color: WHITE })], numberWidth, { fill: BLACK }),
        cell([paragraph("Optional Total", { color: WHITE, bold: true, size: 15 })], descriptionWidth, { fill: BLACK }),
        cell(
          [paragraph(document.optionalTotal === undefined ? "" : money(document, document.optionalTotal), {
            color: WHITE,
            bold: true,
            size: 15,
            alignment: AlignmentType.RIGHT,
          })],
          amountWidth,
          { fill: BLACK },
        ),
      ],
    }),
  );

  return table(rows, widths);
}

function detailHeaderRow(document: EstimateDocument): TableRow {
  const widths = [650, 5850, 2650, CONTENT_WIDTH - 9150];
  return new TableRow({
    children: [
      cell([paragraph("", { color: WHITE })], widths[0], { fill: BLACK }),
      cell([paragraph("Cost Estimate Detail", { color: WHITE, bold: true, size: 15 })], widths[1], { fill: BLACK }),
      cell([paragraph("", { color: WHITE })], widths[2], { fill: BLACK }),
      cell(
        [paragraph(`${document.currency.symbol} Amount`, { color: WHITE, bold: true, size: 15, alignment: AlignmentType.RIGHT })],
        widths[3],
        { fill: BLACK },
      ),
    ],
  });
}

function detailLineItemRow(document: EstimateDocument, item: EstimateLineItem, widths: number[]): TableRow {
  const descriptionParagraphs = [paragraph(item.description, { size: 15 })];
  for (const note of item.notes) {
    descriptionParagraphs.push(paragraph(note, { size: 14 }));
  }

  return new TableRow({
    children: [
      cell([paragraph("")], widths[0]),
      cell(descriptionParagraphs, widths[1]),
      cell(
        [paragraph(`${item.quantity.toFixed(2)} ${item.unit} @ ${money(document, item.rate)}`, { size: 15, alignment: AlignmentType.RIGHT })],
        widths[2],
        { verticalAlign: VerticalAlign.TOP },
      ),
      cell([paragraph(money(document, item.amount), { size: 15, alignment: AlignmentType.RIGHT })], widths[3], {
        verticalAlign: VerticalAlign.TOP,
      }),
    ],
  });
}

function detailNarrativeRow(value: string, widths: number[]): TableRow {
  return new TableRow({
    children: [
      cell([paragraph("")], widths[0]),
      cell([paragraph(value, { size: 14 })], widths[1]),
      cell([paragraph("")], widths[2]),
      cell([paragraph("")], widths[3]),
    ],
  });
}

function detailTable(document: EstimateDocument): Table {
  const widths = [650, 5850, 2650, CONTENT_WIDTH - 9150];
  const rows: TableRow[] = [detailHeaderRow(document)];

  for (const section of document.sections) {
    rows.push(
      new TableRow({
        children: [
          cell([paragraph(section.number, { color: WHITE, bold: true, size: 15 })], widths[0], { fill: BLACK }),
          cell([paragraph(section.title, { color: WHITE, bold: true, size: 15 })], widths[1], { fill: BLACK }),
          cell([paragraph("", { color: WHITE })], widths[2], { fill: BLACK }),
          cell(
            [paragraph(money(document, section.amount), { color: WHITE, bold: true, size: 15, alignment: AlignmentType.RIGHT })],
            widths[3],
            { fill: BLACK },
          ),
        ],
      }),
    );

    for (const narrative of section.narrative) rows.push(detailNarrativeRow(narrative, widths));
    for (const item of section.items) rows.push(detailLineItemRow(document, item, widths));

    for (const subsection of section.subsections) {
      rows.push(
        new TableRow({
          children: [
            cell([paragraph(subsection.number, { bold: true, size: 15 })], widths[0], { fill: GREY }),
            cell([paragraph(subsection.title, { bold: true, size: 15 })], widths[1], { fill: GREY }),
            cell([paragraph("")], widths[2], { fill: GREY }),
            cell(
              [paragraph(money(document, subsection.amount), { bold: true, size: 15, alignment: AlignmentType.RIGHT })],
              widths[3],
              { fill: GREY },
            ),
          ],
        }),
      );
      for (const narrative of subsection.narrative) rows.push(detailNarrativeRow(narrative, widths));
      for (const item of subsection.items) rows.push(detailLineItemRow(document, item, widths));
    }
  }

  return table(rows, widths);
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

export async function generateEstimateDocx(document: EstimateDocument, logoPng?: Uint8Array): Promise<Blob> {
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
        headers: { default: createHeader(document, logoPng) },
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
