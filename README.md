# Estimate to Word

A browser-only SPA that converts an PDF cost estimate into an editable `.docx` file.

The app is deliberately tuned to the reference estimate format supplied for the MVP. It does not use Adobe APIs, OCR, a document conversion service, or an application backend.

## What it does

- Reads the PDF with PDF.js in the browser.
- Extracts selectable text, coordinates, page dimensions and a cropped header logo.
- Reconstructs the estimate into a structured data model.
- Validates summary totals and detail category totals.
- Shows the original PDF beside an approximate Word-layout preview.
- Generates an editable Word document with real tables, headers, footers and page numbers using `docx`.
- Lets you download the parsed JSON for debugging.

## Current scope

The parser expects an estimate with the same overall structure as the supplied Inizio example:

- Project Number
- Client Name
- Project Name
- Event/Completion
- Costing Version
- Date
- Cost Estimate Summary
- Total Cost
- Budget Exclusions
- Cost Estimate Detail
- numbered major sections
- optional decimal-numbered subsections
- line items in the form `quantity unit @ £rate £amount`

This MVP intentionally does not OCR scanned PDFs. If a PDF does not contain selectable text, it will stop and tell the user.

## Run locally

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite.

## Build

```bash
npm run build
```

The static site is written to `dist/`.

## Publish on GitHub Pages

1. Create a GitHub repository and add these files.
2. Push to the `main` branch.
3. In the repository, open **Settings > Pages**.
4. Set **Source** to **GitHub Actions** if GitHub has not selected it automatically.
5. The included `.github/workflows/deploy-pages.yml` workflow builds and publishes the site.

`vite.config.ts` uses a relative base path, so the site works from a project subdirectory such as `https://username.github.io/repository-name/`.

## Architecture

```text
PDF
  -> PDF.js
  -> positioned text lines
  -> Inizio estimate parser
  -> structured EstimateDocument JSON
  -> commercial validation
  -> docx.js
  -> editable DOCX
```

Everything happens in the browser. The repository contains no application server.

## Useful next improvements

- Tune logo extraction using PDF image objects rather than a cropped page render.
- Add a layout-profile system for additional estimate templates.
- Add an editable review screen before Word generation.
- Add user-adjustable extraction zones when a source template changes.
- Add a visual DOCX regression harness for a fixed set of test PDFs.
- Add OCR only as an optional local capability if scanned estimates become a requirement.
