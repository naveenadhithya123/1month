import { buildAnswerPdf, buildPdfFromPages, escapePdfText, normalizePdfText, wrapText } from "./pdfGenerator.js";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LEFT = 42;
const RIGHT = 42;
const CONTENT_WIDTH = PAGE_WIDTH - LEFT - RIGHT;
const TOP = 750;
const BOTTOM = 54;

function money(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value || "-");
  }

  return numeric.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  const text = String(value || "").trim();
  if (!text || text === "-") {
    return "-";
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return text;
  }

  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function toTitleCase(value = "") {
  return String(value)
    .replace(/_/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function cleanText(value = "") {
  return normalizePdfText(String(value || "").trim() || "-");
}

function normalizeRow(row = {}, index = 0) {
  const invoiceAmount = Number(row.invoiceAmount ?? row.invoice_amount ?? 0);
  const paidAmount = Number(row.paidAmount ?? row.paid_amount ?? 0);
  const difference = Number(row.difference ?? paidAmount - invoiceAmount);

  return {
    invoiceNo: String(row.invoiceNo || row.invoice_no || row.invoiceNumber || `Invoice ${index + 1}`),
    companyName: String(row.companyName || row.company_name || row.clientName || "-"),
    invoiceDate: String(row.invoiceDate || row.invoice_date || "-"),
    paymentDate: String(row.paymentDate || row.payment_date || "-"),
    invoiceAmount,
    paidAmount,
    difference,
    status: String(row.status || "needs_review"),
    issue: String(row.issue || row.reason || ""),
    confidence: String(row.confidence || "medium"),
  };
}

function buildIssueLabel(row) {
  if (row.status === "underpaid") {
    return "Mismatch";
  }
  if (row.status === "overpaid") {
    return "Overpaid";
  }
  if (row.status === "unpaid") {
    return "Missing";
  }
  if (row.status === "needs_review") {
    return "Review";
  }
  return toTitleCase(row.status || "Review");
}

function buildIssueDetails(row) {
  const invoiceAmount = money(row.invoiceAmount);
  const paidAmount = money(row.paidAmount);
  const gap = money(Math.abs(Number(row.difference || 0)));

  if (row.status === "underpaid") {
    return `${row.companyName} (${row.invoiceNo}): Invoice INR ${invoiceAmount}, settled INR ${paidAmount}, short by INR ${gap}.`;
  }

  if (row.status === "overpaid") {
    return `${row.companyName} (${row.invoiceNo}): Invoice INR ${invoiceAmount}, settled INR ${paidAmount}, over by INR ${gap}.`;
  }

  if (row.status === "unpaid") {
    return `${row.companyName} (${row.invoiceNo}): No settlement found for this invoice in the selected period.`;
  }

  return `${row.companyName} (${row.invoiceNo}): ${row.issue || "Needs manual verification with the bank statement."}`;
}

export function normalizeReconciliationResult(result = {}) {
  const matches = Array.isArray(result.matches) ? result.matches : [];
  const mismatches = Array.isArray(result.mismatches) ? result.mismatches : [];
  const reviewItems = Array.isArray(result.reviewItems || result.review_items)
    ? result.reviewItems || result.review_items
    : [];
  const normalizedMatches = matches.map(normalizeRow);
  const normalizedMismatches = mismatches.map(normalizeRow);
  const normalizedReviewItems = reviewItems.map(normalizeRow);
  const matchedCount = Number(result.matchedCount ?? result.matched_count ?? normalizedMatches.length);
  const mismatchCount = Number(result.mismatchCount ?? result.mismatch_count ?? normalizedMismatches.length);

  return {
    summary:
      String(result.summary || "").trim() ||
      `${matchedCount} invoice payment(s) matched and ${mismatchCount} require review.`,
    matchedCount,
    mismatchCount,
    reviewCount: Number(result.reviewCount ?? result.review_count ?? normalizedReviewItems.length),
    totalInvoiceAmount: Number(result.totalInvoiceAmount ?? result.total_invoice_amount ?? 0),
    totalPaidAmount: Number(result.totalPaidAmount ?? result.total_paid_amount ?? 0),
    matches: normalizedMatches,
    mismatches: normalizedMismatches,
    reviewItems: normalizedReviewItems,
    nextSteps: Array.isArray(result.nextSteps || result.next_steps)
      ? result.nextSteps || result.next_steps
      : [],
  };
}

export function buildReportMarkdown(result = {}) {
  const normalized = normalizeReconciliationResult(result);
  const issueRows = [...normalized.mismatches, ...normalized.reviewItems];
  const lines = [
    `Summary: ${normalized.summary}`,
    "",
    `Matched invoices: ${normalized.matchedCount}`,
    `Mismatches: ${normalized.mismatchCount}`,
    `Needs review: ${normalized.reviewCount}`,
    `Invoice total: ${money(normalized.totalInvoiceAmount)}`,
    `Paid total: ${money(normalized.totalPaidAmount)}`,
    "",
  ];

  if (issueRows.length) {
    lines.push("Mismatch / Review Table");
    lines.push("Note | Details");
    lines.push("--- | ---");
    for (const row of issueRows) {
      lines.push(`${buildIssueLabel(row)} | ${buildIssueDetails(row)}`);
    }
  } else {
    lines.push("All detected invoice payments matched correctly. No mismatch table is required.");
  }

  if (normalized.nextSteps.length) {
    lines.push("", "Recommended next steps");
    for (const step of normalized.nextSteps) {
      lines.push(`- ${step}`);
    }
  }

  return lines.join("\n");
}

function drawText(lines, { text, x, y, font = "F1", size = 12, color = "0 0 0" }) {
  if (!text) {
    return;
  }

  lines.push("BT");
  lines.push(`/${font} ${size} Tf`);
  lines.push(`${color} rg`);
  lines.push(`${x} ${y} Td`);
  lines.push(`(${escapePdfText(text)}) Tj`);
  lines.push("ET");
}

function drawFilledRect(lines, { x, y, width, height, fillColor, strokeColor }) {
  if (fillColor) {
    lines.push(`${fillColor} rg`);
    lines.push(`${x} ${y} ${width} ${height} re`);
    lines.push("f");
  }

  if (strokeColor) {
    lines.push(`${strokeColor} RG`);
    lines.push("0.8 w");
    lines.push(`${x} ${y} ${width} ${height} re`);
    lines.push("S");
  }
}

function buildInfoRows(normalized) {
  return [
    ["Question", "Invoice PDF vs Bank Details PDF"],
    ["Summary", normalized.summary],
    ["Matched invoices", String(normalized.matchedCount)],
    ["Mismatches", String(normalized.mismatchCount)],
    ["Needs review", String(normalized.reviewCount)],
    ["Invoice total", `INR ${money(normalized.totalInvoiceAmount)}`],
    ["Paid total", `INR ${money(normalized.totalPaidAmount)}`],
  ];
}

function buildIssueRows(normalized) {
  return [...normalized.mismatches, ...normalized.reviewItems].map((row) => ({
    note: buildIssueLabel(row),
    details: buildIssueDetails(row),
    status: toTitleCase(row.status),
    invoice: row.invoiceNo,
    company: row.companyName,
    invoiceDate: formatDate(row.invoiceDate),
    paymentDate: formatDate(row.paymentDate),
    difference: `INR ${money(row.difference)}`,
  }));
}

function defaultNextSteps(normalized) {
  const rows = buildIssueRows(normalized);
  if (!rows.length) {
    return ["All invoices in this batch are settled correctly. No follow-up is needed."];
  }

  return rows.slice(0, 4).map((row) => {
    if (row.status.toLowerCase() === "underpaid") {
      return `Investigate the short payment for ${row.company} (${row.invoice}).`;
    }
    if (row.status.toLowerCase() === "unpaid") {
      return `Follow up with ${row.company} regarding unpaid invoice ${row.invoice}.`;
    }
    return `Review ${row.company} (${row.invoice}) and confirm the settlement details.`;
  });
}

function createPage() {
  return { commands: [], y: TOP };
}

function ensureSpace(pages, currentPage, heightNeeded) {
  if (currentPage.y - heightNeeded >= BOTTOM) {
    return currentPage;
  }

  const nextPage = createPage();
  pages.push(nextPage);
  return nextPage;
}

function pushWrappedText(lines, text, x, y, widthChars, options = {}) {
  const wrapped = wrapText(cleanText(text), widthChars);
  const leading = options.leading || 14;
  const font = options.font || "F1";
  const size = options.size || 10;
  const color = options.color || "0 0 0";
  const startOffset = options.topOffset || 12;

  wrapped.forEach((line, index) => {
    drawText(lines, {
      text: line,
      x,
      y: y - startOffset - index * leading,
      font,
      size,
      color,
    });
  });

  return wrapped.length;
}

function drawInfoTable(page, rows) {
  const labelWidth = 118;
  const valueWidth = CONTENT_WIDTH - labelWidth;
  let currentY = page.y;

  drawText(page.commands, {
    text: "Reconciliation overview",
    x: LEFT,
    y: currentY,
    font: "F2",
    size: 15,
  });
  currentY -= 22;

  for (const [label, value] of rows) {
    const wrappedValue = wrapText(cleanText(value), 70);
    const rowHeight = Math.max(28, wrappedValue.length * 14 + 10);
    drawFilledRect(page.commands, {
      x: LEFT,
      y: currentY - rowHeight,
      width: labelWidth,
      height: rowHeight,
      fillColor: "0.95 0.96 0.98",
      strokeColor: "0.82 0.86 0.92",
    });
    drawFilledRect(page.commands, {
      x: LEFT + labelWidth,
      y: currentY - rowHeight,
      width: valueWidth,
      height: rowHeight,
      fillColor: "1 1 1",
      strokeColor: "0.82 0.86 0.92",
    });

    drawText(page.commands, {
      text: label,
      x: LEFT + 10,
      y: currentY - 18,
      font: "F2",
      size: 10,
      color: "0.18 0.23 0.31",
    });
    pushWrappedText(page.commands, value, LEFT + labelWidth + 10, currentY, 70, {
      size: 10,
      leading: 14,
      color: "0.18 0.2 0.24",
    });

    currentY -= rowHeight;
  }

  page.y = currentY - 24;
}

function drawIssueTable(pages, currentPage, rows) {
  const columns = [
    { key: "note", title: "Note", width: 82, chars: 10 },
    { key: "details", title: "Details", width: 446, chars: 76 },
  ];
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);

  currentPage = ensureSpace(pages, currentPage, 90);
  drawText(currentPage.commands, {
    text: "Mismatch / Review table",
    x: LEFT,
    y: currentPage.y,
    font: "F2",
    size: 15,
  });
  currentPage.y -= 18;

  drawText(currentPage.commands, {
    text: "Only exceptions are listed here. Fully settled invoices are not repeated in the table.",
    x: LEFT,
    y: currentPage.y,
    font: "F1",
    size: 10,
    color: "0.36 0.4 0.48",
  });
  currentPage.y -= 22;

  const drawHeader = () => {
    drawFilledRect(currentPage.commands, {
      x: LEFT,
      y: currentPage.y - 28,
      width: tableWidth,
      height: 28,
      fillColor: "0.62 0.17 0.12",
      strokeColor: "0.62 0.17 0.12",
    });

    let cursorX = LEFT;
    for (const column of columns) {
      drawText(currentPage.commands, {
        text: column.title,
        x: cursorX + 10,
        y: currentPage.y - 18,
        font: "F2",
        size: 10,
        color: "1 1 1",
      });
      cursorX += column.width;
    }

    currentPage.y -= 28;
  };

  drawHeader();

  rows.forEach((row, index) => {
    const wrappedColumns = columns.map((column) => wrapText(cleanText(row[column.key]), column.chars));
    const rowHeight = Math.max(34, Math.max(...wrappedColumns.map((entry) => entry.length)) * 14 + 12);

    currentPage = ensureSpace(pages, currentPage, rowHeight + 20);
    if (currentPage.y === TOP) {
      drawHeader();
    }

    drawFilledRect(currentPage.commands, {
      x: LEFT,
      y: currentPage.y - rowHeight,
      width: tableWidth,
      height: rowHeight,
      fillColor: index % 2 === 0 ? "0.98 0.93 0.92" : "0.95 0.89 0.88",
      strokeColor: "0.78 0.72 0.72",
    });

    let cursorX = LEFT;
    columns.forEach((column, columnIndex) => {
      if (columnIndex > 0) {
        currentPage.commands.push("0.86 0.82 0.82 RG");
        currentPage.commands.push("0.8 w");
        currentPage.commands.push(`${cursorX} ${currentPage.y - rowHeight} m`);
        currentPage.commands.push(`${cursorX} ${currentPage.y} l`);
        currentPage.commands.push("S");
      }

      wrappedColumns[columnIndex].forEach((line, lineIndex) => {
        drawText(currentPage.commands, {
          text: line,
          x: cursorX + 10,
          y: currentPage.y - 16 - lineIndex * 14,
          font: column.key === "note" ? "F2" : "F1",
          size: 10,
          color: "0.12 0.12 0.12",
        });
      });
      cursorX += column.width;
    });

    currentPage.y -= rowHeight;
  });

  if (!rows.length) {
    drawFilledRect(currentPage.commands, {
      x: LEFT,
      y: currentPage.y - 34,
      width: tableWidth,
      height: 34,
      fillColor: "0.95 0.98 0.95",
      strokeColor: "0.77 0.86 0.78",
    });
    drawText(currentPage.commands, {
      text: "No exceptions found in this reconciliation batch.",
      x: LEFT + 10,
      y: currentPage.y - 20,
      font: "F2",
      size: 10,
      color: "0.16 0.4 0.22",
    });
    currentPage.y -= 34;
  }

  currentPage.y -= 24;
  return currentPage;
}

function drawReferenceCards(pages, currentPage, issueRows) {
  if (!issueRows.length) {
    return currentPage;
  }

  currentPage = ensureSpace(pages, currentPage, 110);
  drawText(currentPage.commands, {
    text: "Exception references",
    x: LEFT,
    y: currentPage.y,
    font: "F2",
    size: 15,
  });
  currentPage.y -= 20;

  issueRows.slice(0, 6).forEach((row) => {
    const note = `${row.invoice} | ${row.company} | ${row.status}`;
    const details = `${row.invoiceDate} | ${row.paymentDate} | Difference ${row.difference}`;
    currentPage = ensureSpace(pages, currentPage, 46);

    drawFilledRect(currentPage.commands, {
      x: LEFT,
      y: currentPage.y - 38,
      width: CONTENT_WIDTH,
      height: 38,
      fillColor: "0.97 0.98 1",
      strokeColor: "0.82 0.86 0.92",
    });
    drawText(currentPage.commands, {
      text: note,
      x: LEFT + 10,
      y: currentPage.y - 15,
      font: "F2",
      size: 10,
      color: "0.18 0.23 0.31",
    });
    drawText(currentPage.commands, {
      text: details,
      x: LEFT + 10,
      y: currentPage.y - 29,
      font: "F1",
      size: 9,
      color: "0.33 0.38 0.46",
    });
    currentPage.y -= 46;
  });

  return currentPage;
}

function drawNextSteps(pages, currentPage, steps) {
  currentPage = ensureSpace(pages, currentPage, 90);
  drawText(currentPage.commands, {
    text: "Recommended next steps",
    x: LEFT,
    y: currentPage.y,
    font: "F2",
    size: 15,
  });
  currentPage.y -= 22;

  steps.forEach((step) => {
    const lines = wrapText(cleanText(step), 78);
    const blockHeight = lines.length * 14 + 8;
    currentPage = ensureSpace(pages, currentPage, blockHeight + 6);

    drawText(currentPage.commands, {
      text: "-",
      x: LEFT + 4,
      y: currentPage.y - 12,
      font: "F2",
      size: 12,
      color: "0.62 0.17 0.12",
    });
    lines.forEach((line, index) => {
      drawText(currentPage.commands, {
        text: line,
        x: LEFT + 18,
        y: currentPage.y - 12 - index * 14,
        font: "F1",
        size: 10,
        color: "0.16 0.18 0.22",
      });
    });
    currentPage.y -= blockHeight;
  });

  return currentPage;
}

function buildCustomReconciliationPdf(result = {}) {
  const normalized = normalizeReconciliationResult(result);
  const issueRows = buildIssueRows(normalized);
  const infoRows = buildInfoRows(normalized);
  const nextSteps = normalized.nextSteps.length ? normalized.nextSteps : defaultNextSteps(normalized);
  const pages = [createPage()];
  let currentPage = pages[0];

  drawText(currentPage.commands, {
    text: "Invoice Reconciliation Report",
    x: LEFT,
    y: currentPage.y,
    font: "F2",
    size: 23,
  });
  currentPage.y -= 28;

  drawText(currentPage.commands, {
    text: "Generated for invoice PDF vs bank details PDF",
    x: LEFT,
    y: currentPage.y,
    font: "F1",
    size: 11,
    color: "0.36 0.4 0.48",
  });
  currentPage.y -= 26;

  drawInfoTable(currentPage, infoRows);
  currentPage = drawIssueTable(pages, currentPage, issueRows);
  currentPage = drawReferenceCards(pages, currentPage, issueRows);
  currentPage = drawNextSteps(pages, currentPage, nextSteps);

  const streams = pages.map((page) => page.commands.join("\n"));
  return buildPdfFromPages(streams);
}

export function buildReconciliationPdf(result = {}) {
  try {
    return buildCustomReconciliationPdf(result);
  } catch {
    return buildAnswerPdf({
      title: "Invoice Reconciliation Report",
      question: "Invoice PDF vs Bank Details PDF",
      answer: buildReportMarkdown(result),
    });
  }
}
