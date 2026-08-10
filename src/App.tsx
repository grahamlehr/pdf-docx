import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { buildEstimateDocument, formatEstimateMoney, validateEstimate } from "./parser";
import { parsePdfFile } from "./pdf";
import { generateEstimateDocx, suggestedDocxName } from "./docxGenerator";
import type { EstimateDocument, EstimateLineItem, ParsedPdf, ValidationCheck } from "./types";
import "./styles.css";

type Status = "idle" | "reading" | "ready" | "generating" | "error";

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function Icon({ name }: { name: "upload" | "file" | "word" | "check" | "warning" | "lock" }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8 };
  const paths: Record<typeof name, ReactNode> = {
    upload: <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />,
    file: <path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm7 0v5h5M8 12h8M8 16h8" />,
    word: <path d="M5 4h11l3 3v13H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm11 0v4h4M7.5 11l1.7 6 1.8-5 1.8 5 1.7-6" />,
    check: <path d="m5 12 4 4L19 6" />,
    warning: <path d="M12 3 2.5 20h19L12 3Zm0 6v5m0 3h.01" />,
    lock: <path d="M7 10V8a5 5 0 0 1 10 0v2m-9 0h8a2 2 0 0 1 2 2v8H6v-8a2 2 0 0 1 2-2Z" />,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function ValidationPanel({ checks }: { checks: ValidationCheck[] }) {
  const passed = checks.filter((check) => check.ok).length;
  return (
    <section className="panel validation-panel">
      <div className="panel-title-row">
        <div>
          <p className="eyebrow">Validation</p>
          <h2>Commercial checks</h2>
        </div>
        <span className={`score ${passed === checks.length ? "score-good" : "score-warn"}`}>
          {passed}/{checks.length}
        </span>
      </div>
      <div className="validation-list">
        {checks.map((check) => (
          <div className="validation-row" key={check.label}>
            <span className={`status-icon ${check.ok ? "ok" : "warn"}`}>
              <Icon name={check.ok ? "check" : "warning"} />
            </span>
            <div className="validation-copy">
              <strong>{check.label}</strong>
              {check.detail && <span>{check.detail}</span>}
            </div>
            {check.value && <span className="validation-value">{check.value}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

function PdfPreview({ parsedPdf }: { parsedPdf: ParsedPdf }) {
  return (
    <div className="pdf-preview-stack">
      {parsedPdf.pages.map((page) => (
        <figure className="pdf-page" key={page.page}>
          <img src={page.previewUrl} alt={`Original PDF page ${page.page}`} />
          <figcaption>Page {page.page}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function ItemDescription({ item }: { item: EstimateLineItem }) {
  return (
    <span>
      {item.description}
      {item.notes.map((note, index) => (
        <span key={`${note}-${index}`}><br /><small>{note}</small></span>
      ))}
    </span>
  );
}

function WordPreview({ estimate }: { estimate: EstimateDocument }) {
  const currencies = estimate.currencies;
  const money = (value: number, currency = estimate.currency) => formatEstimateMoney(value, currency);
  const summaryGrid = { gridTemplateColumns: `44px minmax(0, 1fr) repeat(${currencies.length}, 104px)` };
  const detailGrid = { gridTemplateColumns: `44px minmax(0, 1fr) 180px repeat(${currencies.length}, 104px)` };

  return (
    <div className="word-preview-stack">
      <article className="word-page">
        <div className="mock-header">
          <div className="mock-company">
            {(estimate.companyHeaderLines.length ? estimate.companyHeaderLines.slice(0, 7) : ["Inizio Engage XD Limited"]).map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
          <div className="mock-logo">INIZIO<span>ENGAGE</span></div>
        </div>

        <dl className="metadata-grid">
          <dt>Project Number:</dt><dd>{estimate.metadata.projectNumber}</dd>
          <dt>Client Name:</dt><dd>{estimate.metadata.clientName}</dd>
          <dt>Project Name:</dt><dd>{estimate.metadata.projectName}</dd>
          <dt>Event/Completion:</dt><dd>{estimate.metadata.completionDate}</dd>
          <dt>Costing Version:</dt><dd>{estimate.metadata.costingVersion}</dd>
          <dt>Date:</dt><dd>{estimate.metadata.estimateDate}</dd>
        </dl>

        <div className="estimate-table summary-table">
          <div className="table-row black-row table-header" style={summaryGrid}>
            <span></span><span>Cost Estimate Summary</span>
            {currencies.map((currency) => <span className="currency-value" key={currency.id}>{currency.label} Amount</span>)}
          </div>
          {estimate.summary.map((row) => (
            <div className="table-row" style={summaryGrid} key={row.number}>
              <span>{row.number}</span><span>{row.description}</span>
              {currencies.map((currency) => (
                <span className="currency-value" key={currency.id}>
                  {row.amounts[currency.id] === undefined ? "" : money(row.amounts[currency.id], currency)}
                </span>
              ))}
            </div>
          ))}
          <div className="table-row black-row total-row" style={summaryGrid}>
            <span></span><span>Total Cost</span>
            {currencies.map((currency) => (
              <span className="currency-value" key={currency.id}>
                {estimate.totals[currency.id] === undefined ? "" : money(estimate.totals[currency.id], currency)}
              </span>
            ))}
          </div>
        </div>

        {estimate.optionalSummary.length > 0 && (
          <div className="estimate-table summary-table">
            <div className="table-row black-row table-header" style={summaryGrid}>
              <span></span><span>Optional (not included in Project Total)</span>
              {currencies.map((currency) => <span className="currency-value" key={currency.id}>{currency.label} Amount</span>)}
            </div>
            {estimate.optionalSummary.map((row) => (
              <div className="table-row" style={summaryGrid} key={`optional-${row.number}`}>
                <span>{row.number}</span><span>{row.description}</span>
                {currencies.map((currency) => (
                  <span className="currency-value" key={currency.id}>
                    {row.amounts[currency.id] === undefined ? "" : money(row.amounts[currency.id], currency)}
                  </span>
                ))}
              </div>
            ))}
            <div className="table-row black-row total-row" style={summaryGrid}>
              <span></span><span>Optional Total</span>
              {currencies.map((currency) => (
                <span className="currency-value" key={currency.id}>
                  {estimate.optionalTotals[currency.id] === undefined ? "" : money(estimate.optionalTotals[currency.id], currency)}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="notes-block">
          {estimate.notes.map((note, index) => <p key={`${note}-${index}`}>{note}</p>)}
          {estimate.exclusions.length > 0 && <><p>Budget Exclusions:</p><ul>{estimate.exclusions.map((item) => <li key={item}>{item}</li>)}</ul></>}
        </div>
      </article>

      <article className="word-page detail-page">
        <div className="estimate-table detail-table">
          <div className="detail-row black-row table-header" style={detailGrid}>
            <span></span><span>Cost Estimate Detail</span><span></span>
            {currencies.map((currency) => <span className="currency-value" key={currency.id}>{currency.label} Amount</span>)}
          </div>
          {estimate.sections.map((section) => (
            <div className="detail-section" key={section.number}>
              <div className="detail-row black-row section-row" style={detailGrid}>
                <span>{section.number}</span><span>{section.title}</span><span></span>
                {currencies.map((currency) => (
                  <span className="currency-value" key={currency.id}>
                    {section.amounts[currency.id] === undefined ? "" : money(section.amounts[currency.id], currency)}
                  </span>
                ))}
              </div>
              {section.narrative.map((line, index) => (
                <div className="detail-row" style={detailGrid} key={`${section.number}-narrative-${index}`}>
                  <span></span><span>{line}</span><span></span>{currencies.map((currency) => <span key={currency.id}></span>)}
                </div>
              ))}
              {section.items.map((item, index) => (
                <div className="detail-row" style={detailGrid} key={`${section.number}-item-${index}`}>
                  <span></span><ItemDescription item={item} />
                  <span className="currency-value">{item.quantity.toFixed(2)} {item.unit} @ {money(item.rate)}</span>
                  {currencies.map((currency) => (
                    <span className="currency-value" key={currency.id}>
                      {item.amounts[currency.id] === undefined ? "" : money(item.amounts[currency.id], currency)}
                    </span>
                  ))}
                </div>
              ))}
              {section.subsections.map((subsection) => (
                <div className="detail-subsection" key={subsection.number}>
                  <div className="detail-row grey-row subsection-row" style={detailGrid}>
                    <span>{subsection.number}</span><span>{subsection.title}</span><span></span>
                    {currencies.map((currency) => (
                      <span className="currency-value" key={currency.id}>
                        {subsection.amounts[currency.id] === undefined ? "" : money(subsection.amounts[currency.id], currency)}
                      </span>
                    ))}
                  </div>
                  {subsection.narrative.map((line, index) => (
                    <div className="detail-row" style={detailGrid} key={`${subsection.number}-narrative-${index}`}>
                      <span></span><span>{line}</span><span></span>{currencies.map((currency) => <span key={currency.id}></span>)}
                    </div>
                  ))}
                  {subsection.items.map((item, index) => (
                    <div className="detail-row" style={detailGrid} key={`${subsection.number}-item-${index}`}>
                      <span></span><ItemDescription item={item} />
                      <span className="currency-value">{item.quantity.toFixed(2)} {item.unit} @ {money(item.rate)}</span>
                      {currencies.map((currency) => (
                        <span className="currency-value" key={currency.id}>
                          {item.amounts[currency.id] === undefined ? "" : money(item.amounts[currency.id], currency)}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsedPdf, setParsedPdf] = useState<ParsedPdf | null>(null);
  const [estimate, setEstimate] = useState<EstimateDocument | null>(null);
  const [activePreview, setActivePreview] = useState<"pdf" | "word">("pdf");
  const [isDragging, setIsDragging] = useState(false);

  const checks = useMemo(() => (estimate ? validateEstimate(estimate) : []), [estimate]);
  const allCriticalChecksPass = checks.filter((check) => check.label !== "Unparsed detail lines").every((check) => check.ok);

  async function processFile(file?: File) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please choose a PDF file.");
      setStatus("error");
      return;
    }

    setStatus("reading");
    setError("");
    setFileName(file.name);
    setParsedPdf(null);
    setEstimate(null);

    try {
      const parsed = await parsePdfFile(file);
      const document = buildEstimateDocument(parsed, file.name);
      if (!document.summary.length || !document.sections.length) {
        throw new Error(
          "I could read the PDF, but it does not match the cost-estimate structure this converter supports yet.",
        );
      }
      setParsedPdf(parsed);
      setEstimate(document);
      setStatus("ready");
    } catch (reason) {
      setStatus("error");
      setError(reason instanceof Error ? reason.message : "Could not read this PDF.");
    }
  }

  async function generateWord() {
    if (!estimate || !parsedPdf) return;
    setStatus("generating");
    setError("");
    try {
      const blob = await generateEstimateDocx(estimate, parsedPdf.logoPng);
      downloadBlob(blob, suggestedDocxName(estimate));
      setStatus("ready");
    } catch (reason) {
      setStatus("error");
      setError(reason instanceof Error ? reason.message : "Could not generate the Word document.");
    }
  }

  function downloadJson() {
    if (!estimate) return;
    const blob = new Blob([JSON.stringify(estimate, null, 2)], { type: "application/json" });
    downloadBlob(blob, `${estimate.metadata.projectNumber || "estimate"}.json`);
  }

  function reset() {
    setStatus("idle");
    setError("");
    setFileName("");
    setParsedPdf(null);
    setEstimate(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="app-shell">


      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">Procim estimate converter</p>
            <h3>Turn a PDF cost estimate into an editable Word document.</h3>
          </div>
          {estimate && (
            <div className="hero-actions">
              <button className="button secondary" onClick={reset}>New estimate</button>
              <button className="button primary" disabled={!allCriticalChecksPass || status === "generating"} onClick={generateWord}>
                <Icon name="word" /> {status === "generating" ? "Generating..." : "Generate Word"}
              </button>
            </div>
          )}
        </section>

        {status === "idle" || status === "reading" || status === "error" ? (
          <section
            className={`drop-zone ${isDragging ? "dragging" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              void processFile(event.dataTransfer.files[0]);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => void processFile(event.target.files?.[0])}
              hidden
            />
            <div className="drop-icon"><Icon name="upload" /></div>
            <h2>{status === "reading" ? "Reading estimate..." : "Drop an estimate PDF here"}</h2>
            <p>{status === "reading" ? "Extracting text, layout, page previews and logo." : "Supports the Procim cost-estimate family, with automatic currency detection and multi-currency estimates."}</p>
            <button className="button primary" disabled={status === "reading"} onClick={() => fileInputRef.current?.click()}>
              <Icon name="file" /> Choose PDF
            </button>
            {fileName && <span className="file-name">{fileName}</span>}
            {error && <div className="error-box"><Icon name="warning" /><span>{error}</span></div>}
          </section>
        ) : null}

        {estimate && parsedPdf && (
          <div className="workspace-grid">
            <div className="workspace-main">
              <section className="panel preview-panel">
                <div className="panel-title-row preview-title-row">
                  <div>
                    <p className="eyebrow">Preview</p>
                    <h2>{estimate.metadata.projectNumber || fileName}</h2>
                  </div>
                  <div className="segmented-control">
                    <button className={activePreview === "pdf" ? "active" : ""} onClick={() => setActivePreview("pdf")}>Original PDF</button>
                    <button className={activePreview === "word" ? "active" : ""} onClick={() => setActivePreview("word")}>Word layout</button>
                  </div>
                </div>
                <div className="preview-surface">
                  {activePreview === "pdf" ? <PdfPreview parsedPdf={parsedPdf} /> : <WordPreview estimate={estimate} />}
                </div>
              </section>
            </div>

            <aside className="workspace-side">
              <ValidationPanel checks={checks} />

              <section className="panel extracted-panel">
                <p className="eyebrow">Extracted data</p>
                <h2>Estimate summary</h2>
                <dl className="fact-list">
                  <div><dt>Project</dt><dd>{estimate.metadata.projectName || "Not found"}</dd></div>
                  <div><dt>Client</dt><dd>{estimate.metadata.clientName || "Not found"}</dd></div>
                  <div><dt>Currencies</dt><dd>{estimate.currencies.map((currency) => currency.label).join(" + ")}</dd></div>
                  <div><dt>Categories</dt><dd>{estimate.sections.length}</dd></div>
                  <div><dt>Total</dt><dd>{formatEstimateMoney(estimate.total, estimate.currency)}</dd></div>
                </dl>
                <button className="text-button" onClick={downloadJson}>Download parsed JSON</button>
              </section>

              <section className="panel privacy-panel">
                <div className="mini-icon"><Icon name="lock" /></div>
                <div><strong>Local-only processing</strong><p>The PDF is read with PDF.js and the DOCX is created in-browser. There is no app server in this project.</p></div>
              </section>
            </aside>
          </div>
        )}
      </main>

      <footer className="site-footer">
        <span>V1.2</span>
        <span>grahamlehr.github.io</span>
      </footer>
    </div>
  );
}
