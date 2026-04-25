import { chatCompletion } from "../services/huggingface.service.js";
import { sendEmail } from "../services/brevo.service.js";
import { saveReconciliationRun, updateReconciliationRun } from "../services/supabase.service.js";
import { extractTextFromBuffer } from "../services/ocr.service.js";
import { extractPdfText } from "../utils/pdfParser.js";
import {
  buildReconciliationPdf,
  buildReportMarkdown,
  normalizeReconciliationResult,
} from "../utils/reconciliationReport.js";

function cleanEntityName(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(private|pvt|ltd|limited|inc|corp|corporation|llc|agency|solutions|solution|technologies|technology)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseAmount(value = "") {
  const numeric = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatIsoDate(raw = "") {
  const text = String(raw || "").trim();
  if (!text) {
    return "-";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const dayMonthYear = text.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (dayMonthYear) {
    const [, day, monthText, year] = dayMonthYear;
    const monthMap = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    };
    const month = monthMap[monthText.toLowerCase()];
    if (month) {
      return `${year}-${month}-${String(day).padStart(2, "0")}`;
    }
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return text;
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizeInvoiceBlock(block = "") {
  return String(block || "")
    .replace(/\r/g, "\n")
    .replace(/\|/g, "\n")
    .replace(/\s{2,}/g, " ")
    .replace(/(Invoice\s*No\s*:|Bill\s*To\s*:|Customer\s*Name\s*:|Reference\s*:|Invoice\s*Date\s*:|Due\s*Date\s*:|Currency\s*:)/gi, "\n$1")
    .replace(/\n+/g, "\n")
    .trim();
}

function extractField(block = "", labels = []) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = block.match(
      new RegExp(
        `${escaped}\\s*:\\s*([\\s\\S]*?)(?=\\n(?:Invoice\\s*No|Bill\\s*To|Customer\\s*Name|Reference|Invoice\\s*Date|Due\\s*Date|Currency)\\s*:|$)`,
        "i",
      ),
    );
    const value = match?.[1]?.replace(/\s+/g, " ").trim();
    if (value) {
      return value;
    }
  }

  return "";
}

function extractInvoiceRecords(invoiceText = "") {
  const blocks = String(invoiceText || "")
    .split(/(?=Invoice\s*No\s*:)/gi)
    .filter((block) => /Invoice\s*No\s*:/i.test(block));

  return blocks
    .map((block, index) => {
      const normalizedBlock = normalizeInvoiceBlock(block);
      const invoiceNo = extractField(normalizedBlock, ["Invoice No"]).match(/[A-Z0-9/-]+/i)?.[0]?.trim() || "";
      const companyName = extractField(normalizedBlock, ["Bill To", "Customer Name"]);
      const reference = extractField(normalizedBlock, ["Reference"]).match(/[A-Z0-9/-]+/i)?.[0]?.trim() || "";
      const invoiceDate = extractField(normalizedBlock, ["Invoice Date"]) || "-";
      const totals = [...normalizedBlock.matchAll(/(?:TOTAL|Grand Total)[^\d]*([\d,]+\.\d{2})/gi)].map((match) => parseAmount(match[1]));
      const fallbackAmounts = [...normalizedBlock.matchAll(/\b([\d,]+\.\d{2})\b/g)].map((match) => parseAmount(match[1]));
      const invoiceAmount = totals.at(-1) || fallbackAmounts.at(-1) || 0;

      if (!invoiceNo || !companyName || !invoiceAmount) {
        return null;
      }

      return {
        invoiceNo,
        companyName,
        reference,
        invoiceDate: formatIsoDate(invoiceDate),
        invoiceAmount,
        key: slug(invoiceNo || `${companyName}-${index}`),
      };
    })
    .filter(Boolean);
}

function extractTransactionAmount(line = "", invoiceAmount = 0) {
  const matches = [...String(line || "").matchAll(/\b([\d,]+\.\d{2})\b/g)].map((match) => parseAmount(match[1]));
  if (!matches.length) {
    return 0;
  }

  if (matches.length === 1) {
    return matches[0];
  }

  return matches.reduce((best, current) => {
    if (!best) {
      return current;
    }

    const currentGap = Math.abs(current - invoiceAmount);
    const bestGap = Math.abs(best - invoiceAmount);
    return currentGap < bestGap ? current : best;
  }, 0);
}

function extractLineDate(line = "") {
  const match = String(line || "").match(/(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{4}-\d{2}-\d{2})/);
  return formatIsoDate(match?.[1] || "-");
}

function extractDateFromWindow(lines = [], anchorIndex = 0) {
  const orderedIndexes = Array.from({ length: lines.length }, (_, index) => index).sort(
    (left, right) => Math.abs(left - anchorIndex) - Math.abs(right - anchorIndex),
  );

  for (const index of orderedIndexes) {
    const line = lines[index];
    if (/opening balance|closing balance/i.test(String(line || ""))) {
      continue;
    }

    const value = extractLineDate(line);
    if (value && value !== "-") {
      return value;
    }
  }

  return "-";
}

function extractBankTransactions(bankText = "") {
  const normalized = String(bankText || "")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();

  if (!normalized) {
    return [];
  }

  const datePattern = "\\d{1,2}\\s+[A-Za-z]{3}\\s+\\d{4}";
  const rowPattern = new RegExp(
    `(${datePattern})\\s+(${datePattern})([\\s\\S]*?)(?=(?:${datePattern})\\s+(?:${datePattern})|$)`,
    "g",
  );
  const transactions = [];

  for (const match of normalized.matchAll(rowPattern)) {
    const txnDate = formatIsoDate(match[1]);
    const valueDate = formatIsoDate(match[2]);
    const segment = String(match[3] || "").replace(/\n+/g, " ").replace(/\s+/g, " ").trim();

    if (!segment || /opening balance|closing balance/i.test(segment)) {
      continue;
    }

    const amounts = [...segment.matchAll(/\b([\d,]+\.\d{2})\b/g)].map((entry) => parseAmount(entry[1]));
    if (!amounts.length) {
      continue;
    }

    const balance = amounts.length >= 2 ? amounts.at(-1) : 0;
    const transactionAmount = amounts.length >= 2 ? amounts.at(-2) : amounts[0];
    const description = segment.replace(/([\d,]+\.\d{2}\s*)+$/g, "").trim();

    if (!description || !transactionAmount) {
      continue;
    }

    transactions.push({
      txnDate,
      valueDate,
      paymentDate: valueDate !== "-" ? valueDate : txnDate,
      description,
      descriptionSlug: slug(description),
      amount: transactionAmount,
      balance,
    });
  }

  return transactions;
}

function extractReferenceContext(bankText = "", invoice) {
  const rawText = String(bankText || "");
  const normalizedText = rawText.replace(/\r/g, "\n");
  if (!normalizedText.trim()) {
    return { snippet: "", paymentDate: "-", hitText: "" };
  }

  const reference = String(invoice?.reference || "").trim();
  const company = String(invoice?.companyName || "").trim();
  const lookups = [reference, company].filter(Boolean);
  let hitIndex = -1;
  let hitText = "";

  for (const lookup of lookups) {
    const index = normalizedText.toLowerCase().indexOf(lookup.toLowerCase());
    if (index >= 0) {
      hitIndex = index;
      hitText = lookup;
      break;
    }
  }

  if (hitIndex < 0) {
    return { snippet: "", paymentDate: "-", hitText: "" };
  }

  const prefix = normalizedText.slice(Math.max(0, hitIndex - 120), hitIndex);
  const suffix = normalizedText.slice(hitIndex, Math.min(normalizedText.length, hitIndex + 220));
  const prefixDateMatches = [...prefix.matchAll(/\b(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{4}-\d{2}-\d{2})\b/g)];
  const paymentDate = prefixDateMatches.length
    ? formatIsoDate(prefixDateMatches.at(-1)[1])
    : "-";

  return {
    snippet: suffix,
    paymentDate,
    hitText,
  };
}

function extractAmountFromReferenceContext(invoice, bankText = "") {
  const { snippet, paymentDate, hitText } = extractReferenceContext(bankText, invoice);
  if (!snippet || !hitText) {
    return null;
  }

  const hitIndex = snippet.toLowerCase().indexOf(hitText.toLowerCase());
  if (hitIndex < 0) {
    return null;
  }

  const afterHit = snippet.slice(hitIndex + hitText.length);
  const amounts = [...afterHit.matchAll(/\b([\d,]+\.\d{2})\b/g)].map((match) => parseAmount(match[1]));
  if (!amounts.length) {
    return null;
  }

  const meaningfulAmounts = amounts.filter(
    (amount) => amount > 0 && amount <= Math.max(invoice.invoiceAmount * 3, invoice.invoiceAmount + 100000),
  );
  const chosen = meaningfulAmounts[0] || amounts[0];
  if (!chosen) {
    return null;
  }

  return {
    paidAmount: chosen,
    paymentDate,
    snippet,
  };
}

function scoreTransactionAgainstInvoice(invoice, transaction) {
  const referenceSlug = slug(invoice.reference);
  const invoiceSlug = slug(invoice.invoiceNo);
  const companyTokens = cleanEntityName(invoice.companyName)
    .split(" ")
    .filter((token) => token.length >= 4)
    .slice(0, 3);

  let score = 0;

  if (referenceSlug && transaction.descriptionSlug.includes(referenceSlug)) {
    score += 18;
  }
  if (invoiceSlug && transaction.descriptionSlug.includes(invoiceSlug)) {
    score += 12;
  }

  for (const token of companyTokens) {
    if (transaction.descriptionSlug.includes(token)) {
      score += 4;
    }
  }

  if (Math.abs(transaction.amount - invoice.invoiceAmount) <= Math.max(1, invoice.invoiceAmount * 0.1)) {
    score += 2;
  }

  return score;
}

function pickBestTransaction(invoice, transactions = []) {
  let bestMatch = null;

  for (const transaction of transactions) {
    const score = scoreTransactionAgainstInvoice(invoice, transaction);
    if (score < 8) {
      continue;
    }

    const candidate = {
      line: transaction.description,
      score,
      paidAmount: transaction.amount,
      paymentDate: transaction.paymentDate,
      confidence: score >= 18 ? "high" : "medium",
      balance: transaction.balance,
    };

    if (!bestMatch || candidate.score > bestMatch.score) {
      bestMatch = candidate;
    }
  }

  return bestMatch;
}

function findBankMatch(invoice, bankText = "") {
  const transactions = extractBankTransactions(bankText);
  const lines = String(bankText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const referenceSlug = slug(invoice.reference);
  const invoiceSlug = slug(invoice.invoiceNo);
  const companyTokens = cleanEntityName(invoice.companyName)
    .split(" ")
    .filter((token) => token.length >= 4)
    .slice(0, 3);

  let bestMatch = null;
  const localContextMatch = extractAmountFromReferenceContext(invoice, bankText);

  bestMatch = pickBestTransaction(invoice, transactions);

  if (localContextMatch && (!bestMatch || Math.abs(localContextMatch.paidAmount - invoice.invoiceAmount) < Math.abs(bestMatch.paidAmount - invoice.invoiceAmount))) {
    bestMatch = {
      line: localContextMatch.snippet,
      score: 999,
      paidAmount: localContextMatch.paidAmount,
      paymentDate: localContextMatch.paymentDate,
      confidence: "high",
    };
  }

  if (bestMatch) {
    return bestMatch;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineSlug = slug(line);
    let score = 0;

    if (referenceSlug && lineSlug.includes(referenceSlug)) {
      score += 14;
    }
    if (invoiceSlug && lineSlug.includes(invoiceSlug)) {
      score += 10;
    }

    for (const token of companyTokens) {
      if (lineSlug.includes(token)) {
        score += 4;
      }
    }

    if (score < 8) {
      continue;
    }

    const windowStart = Math.max(0, index - 2);
    const windowEnd = Math.min(lines.length, index + 4);
    const windowLines = lines.slice(windowStart, windowEnd);
    const anchorIndex = index - windowStart;
    const candidateAmounts = windowLines
      .flatMap((entry, localIndex) => {
        const amounts = [...String(entry || "").matchAll(/\b([\d,]+\.\d{2})\b/g)].map((match) => parseAmount(match[1]));
        const usableAmounts = amounts.length > 1 ? amounts.slice(0, -1) : amounts;

        return usableAmounts.map((amount) => ({
          amount,
          score:
            Math.abs(amount - invoice.invoiceAmount) +
            Math.abs(localIndex - anchorIndex) * 250 +
            (amount > invoice.invoiceAmount * 2 ? amount - invoice.invoiceAmount * 2 : 0),
        }));
      })
      .sort((left, right) => left.score - right.score);
    const amount = candidateAmounts[0]?.amount || extractTransactionAmount(line, invoice.invoiceAmount);
    if (!amount) {
      continue;
    }

    const candidate = {
      line,
      score,
      paidAmount: amount,
      paymentDate: extractDateFromWindow(windowLines, anchorIndex) || extractLineDate(line),
      confidence: score >= 14 ? "high" : "medium",
    };

    if (!bestMatch || candidate.score > bestMatch.score) {
      bestMatch = candidate;
    }
  }

  return bestMatch;
}

function repairBalanceMisreads(rows = [], parsedInvoices = [], bankText = "") {
  const transactions = extractBankTransactions(bankText);
  if (!transactions.length) {
    return rows;
  }

  const invoiceMap = new Map(parsedInvoices.map((invoice) => [invoice.key, invoice]));

  return rows.map((row) => {
    const invoice =
      invoiceMap.get(slug(row.invoiceNo || `${row.companyName}-${row.invoiceDate}`)) ||
      parsedInvoices.find((entry) => slug(entry.invoiceNo) === slug(row.invoiceNo));

    if (!invoice) {
      return row;
    }

    const transaction = pickBestTransaction(invoice, transactions);
    const localContextMatch = extractAmountFromReferenceContext(invoice, bankText);
    if (!transaction) {
      if (!localContextMatch) {
        return row;
      }
    }

    const currentPaidAmount = Number(row.paidAmount || 0);
    const currentDifference = Number(row.difference ?? currentPaidAmount - Number(row.invoiceAmount || 0));
    const correctedPaidAmount = localContextMatch?.paidAmount || transaction?.paidAmount || currentPaidAmount;
    const looksLikeBalanceMisread =
      currentPaidAmount > invoice.invoiceAmount * 2 ||
      (transaction?.balance && Math.abs(currentPaidAmount - transaction.balance) < 0.01) ||
      Math.abs(correctedPaidAmount - invoice.invoiceAmount) < Math.abs(currentPaidAmount - invoice.invoiceAmount);

    if (!looksLikeBalanceMisread) {
      return row;
    }

    const correctedDifference = correctedPaidAmount - invoice.invoiceAmount;
    let status = "matched";
    let issue = "";

    if (correctedDifference < 0) {
      status = "underpaid";
      issue = `Settled short by INR ${Math.abs(correctedDifference).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}.`;
    } else if (correctedDifference > 0) {
      status = "overpaid";
      issue = `Settled above invoice by INR ${correctedDifference.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}.`;
    }

    if (currentPaidAmount === 0 && currentDifference < 0) {
      return row;
    }

    return {
      ...row,
      companyName: invoice.companyName,
      invoiceDate: invoice.invoiceDate,
      paymentDate: localContextMatch?.paymentDate || transaction?.paymentDate || row.paymentDate || "-",
      paidAmount: correctedPaidAmount,
      difference: correctedDifference,
      status,
      issue,
      confidence: transaction?.confidence || row.confidence || "high",
    };
  });
}

function buildHeuristicRow(invoice, bankMatch) {
  const paidAmount = bankMatch?.paidAmount || 0;
  const difference = paidAmount - invoice.invoiceAmount;
  let status = "matched";
  let issue = "";

  if (!bankMatch) {
    status = "unpaid";
    issue = "No matching transaction found in the bank statement.";
  } else if (difference < 0) {
    status = "underpaid";
    issue = `Settled short by INR ${Math.abs(difference).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}.`;
  } else if (difference > 0) {
    status = "overpaid";
    issue = `Settled above invoice by INR ${difference.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}.`;
  }

  return {
    invoiceNo: invoice.invoiceNo,
    companyName: invoice.companyName,
    invoiceDate: invoice.invoiceDate,
    paymentDate: bankMatch?.paymentDate || "-",
    invoiceAmount: invoice.invoiceAmount,
    paidAmount,
    difference,
    status,
    issue,
    confidence: bankMatch?.confidence || "high",
  };
}

function summarizeResult(result) {
  const parts = [];
  if (result.matchedCount) {
    parts.push(`${result.matchedCount} fully matched`);
  }

  const underpaid = result.mismatches.filter((item) => item.status === "underpaid").length;
  const overpaid = result.mismatches.filter((item) => item.status === "overpaid").length;
  const unpaid = result.mismatches.filter((item) => item.status === "unpaid").length;

  if (underpaid) {
    parts.push(`${underpaid} underpaid`);
  }
  if (overpaid) {
    parts.push(`${overpaid} overpaid`);
  }
  if (unpaid) {
    parts.push(`${unpaid} unpaid`);
  }
  if (result.reviewCount) {
    parts.push(`${result.reviewCount} needs review`);
  }

  const summaryCore = parts.length ? parts.join(", ") : "No invoices were classified";
  return `${summaryCore}; total invoice amount INR ${result.totalInvoiceAmount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}, total paid INR ${result.totalPaidAmount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}.`;
}

function enrichReconciliationResult(aiResult, invoiceText, bankText) {
  const normalized = normalizeReconciliationResult(aiResult);
  const parsedInvoices = extractInvoiceRecords(invoiceText);

  if (!parsedInvoices.length) {
    return normalized;
  }

  const existingRows = [
    ...normalized.matches,
    ...normalized.mismatches,
    ...normalized.reviewItems,
  ];
  const byKey = new Map(
    existingRows.map((row) => [slug(row.invoiceNo || `${row.companyName}-${row.invoiceDate}`), row]),
  );

  for (const invoice of parsedInvoices) {
    const bankMatch = findBankMatch(invoice, bankText);
    const heuristicRow = buildHeuristicRow(invoice, bankMatch);
    byKey.set(invoice.key, heuristicRow);
  }

  const rows = repairBalanceMisreads([...byKey.values()], parsedInvoices, bankText);
  const matches = rows.filter((row) => row.status === "matched");
  const mismatches = rows.filter((row) => ["underpaid", "overpaid", "unpaid"].includes(row.status));
  const reviewItems = rows.filter((row) => !["matched", "underpaid", "overpaid", "unpaid"].includes(row.status));
  const totalInvoiceAmount = rows.reduce((sum, row) => sum + Number(row.invoiceAmount || 0), 0);
  const totalPaidAmount = rows.reduce((sum, row) => sum + Number(row.paidAmount || 0), 0);

  const nextSteps = mismatches.map((row) => {
    if (row.status === "underpaid") {
      return `Investigate the short payment for ${row.companyName} (${row.invoiceNo}).`;
    }
    if (row.status === "overpaid") {
      return `Confirm the excess settlement for ${row.companyName} (${row.invoiceNo}).`;
    }
    return `Follow up with ${row.companyName} regarding unpaid invoice ${row.invoiceNo}.`;
  });

  const result = {
    summary: "",
    matchedCount: matches.length,
    mismatchCount: mismatches.length,
    reviewCount: reviewItems.length,
    totalInvoiceAmount,
    totalPaidAmount,
    matches,
    mismatches,
    reviewItems,
    nextSteps: nextSteps.length ? nextSteps : normalized.nextSteps,
  };

  result.summary = summarizeResult(result);
  return result;
}

function getUploadedFile(req, fieldName) {
  return Array.isArray(req.files?.[fieldName]) ? req.files[fieldName][0] : null;
}

async function extractUploadedPdf(file) {
  if (!file) {
    return "";
  }

  let text = "";
  try {
    text = await extractPdfText(file.buffer);
  } catch (_error) {
    text = "";
  }

  if (!text?.trim()) {
    text = await extractTextFromBuffer(file.buffer, file.originalname, file.mimetype);
  }

  return String(text || "").trim();
}

function extractJson(raw = "") {
  const cleaned = String(raw || "").replace(/```json|```/gi, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);

  if (!match) {
    throw new Error("The AI analysis did not return valid reconciliation JSON.");
  }

  return JSON.parse(match[0]);
}

async function analyzeTexts({ invoiceText, bankText }) {
  const raw = await chatCompletion({
    temperature: 0,
    maxTokens: 2200,
    messages: [
      {
        role: "system",
        content: `You are a senior finance reconciliation analyst.
Compare invoice PDF text with bank transaction PDF text.
Match invoices to payments using company/client name, invoice number, reference text, date proximity, and amount.
Classify each detected invoice as:
- matched: company/client and amount are settled correctly.
- underpaid: bank paid amount is less than invoice amount.
- overpaid: bank paid amount is more than invoice amount.
- unpaid: no bank transaction can be matched.
- needs_review: weak or ambiguous match.
Return valid JSON only. Do not include markdown.`,
      },
      {
        role: "user",
        content: `Return this exact JSON shape:
{
  "summary": "short human summary",
  "matchedCount": 0,
  "mismatchCount": 0,
  "reviewCount": 0,
  "totalInvoiceAmount": 0,
  "totalPaidAmount": 0,
  "matches": [
    {
      "invoiceNo": "string",
      "companyName": "string",
      "invoiceDate": "YYYY-MM-DD or original",
      "paymentDate": "YYYY-MM-DD or original",
      "invoiceAmount": 0,
      "paidAmount": 0,
      "difference": 0,
      "status": "matched",
      "issue": "",
      "confidence": "high"
    }
  ],
  "mismatches": [],
  "reviewItems": [],
  "nextSteps": ["short action"]
}

Invoice PDF text:
${invoiceText.slice(0, 45000)}

Bank details PDF text:
${bankText.slice(0, 45000)}`,
      },
    ],
  });

  return enrichReconciliationResult(extractJson(raw), invoiceText, bankText);
}

export async function analyzeReconciliation(req, res) {
  try {
    const invoiceFile = getUploadedFile(req, "invoicePdf");
    const bankFile = getUploadedFile(req, "bankPdf");
    const userId = req.body.userId || null;

    if (!invoiceFile || !bankFile) {
      return res.status(400).json({ error: "Both invoicePdf and bankPdf are required." });
    }

    const [invoiceText, bankText] = await Promise.all([
      extractUploadedPdf(invoiceFile),
      extractUploadedPdf(bankFile),
    ]);

    if (!invoiceText || !bankText) {
      return res.status(400).json({
        error: "Could not extract enough text from one of the PDFs. Please upload text-based or clearer PDFs.",
      });
    }

    const result = await analyzeTexts({ invoiceText, bankText });
    const reportMarkdown = buildReportMarkdown(result);
    let savedRun = null;
    try {
      savedRun = await saveReconciliationRun({
        user_id: userId,
        invoice_filename: invoiceFile.originalname,
        bank_filename: bankFile.originalname,
        invoice_text: invoiceText,
        bank_text: bankText,
        result,
        status: "analyzed",
      });
    } catch (_error) {
      savedRun = null;
    }

    return res.json({
      success: true,
      runId: savedRun?.id || "",
      result,
      reportMarkdown,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Reconciliation analysis failed." });
  }
}

export async function sendReconciliationEmail(req, res) {
  try {
    const { to, result, runId = "" } = req.body || {};

    if (!to || !result) {
      return res.status(400).json({ error: "to and result are required." });
    }

    const normalized = normalizeReconciliationResult(result);
    const pdf = buildReconciliationPdf(normalized);
    const subject = normalized.mismatchCount || normalized.reviewCount
      ? "Invoice Reconciliation Report - Action Required"
      : "Invoice Reconciliation Report - All Payments Matched";

    const response = await sendEmail({
      to,
      subject,
      html: `
        <h2>Invoice Reconciliation Report</h2>
        <p>${normalized.summary}</p>
        <p><strong>Matched:</strong> ${normalized.matchedCount}</p>
        <p><strong>Mismatches:</strong> ${normalized.mismatchCount}</p>
        <p><strong>Needs review:</strong> ${normalized.reviewCount}</p>
        <p>The detailed table is attached as a PDF.</p>
      `,
      text: `${normalized.summary}\nMatched: ${normalized.matchedCount}\nMismatches: ${normalized.mismatchCount}\nNeeds review: ${normalized.reviewCount}`,
      attachments: [
        {
          name: "invoice-reconciliation-report.pdf",
          content: pdf.toString("base64"),
          type: "application/pdf",
        },
      ],
    });

    if (runId) {
      try {
        await updateReconciliationRun(runId, {
          status: "emailed",
          emailed_to: to,
          emailed_at: new Date().toISOString(),
        });
      } catch (_error) {
        // Email delivery should not fail because audit logging is unavailable.
      }
    }

    return res.json({
      success: true,
      provider: "brevo",
      messageId: response?.messageId || response?.message_id || "",
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Could not send reconciliation email." });
  }
}
