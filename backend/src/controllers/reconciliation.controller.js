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

  return normalizeReconciliationResult(extractJson(raw));
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
