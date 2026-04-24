import { buildAnswerPdf } from "./pdfGenerator.js";

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
    lines.push("Invoice | Company | Invoice Date | Payment Date | Invoice Amount | Paid Amount | Difference | Status | Issue");
    lines.push("--- | --- | --- | --- | ---: | ---: | ---: | --- | ---");
    for (const row of issueRows) {
      lines.push(
        [
          row.invoiceNo,
          row.companyName,
          row.invoiceDate,
          row.paymentDate,
          money(row.invoiceAmount),
          money(row.paidAmount),
          money(row.difference),
          row.status,
          row.issue || "-",
        ].join(" | "),
      );
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

export function buildReconciliationPdf(result = {}) {
  return buildAnswerPdf({
    title: "Invoice Reconciliation Report",
    question: "Invoice PDF vs Bank Details PDF",
    answer: buildReportMarkdown(result),
  });
}
