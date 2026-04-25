import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeReconciliation,
  sendChatMessage,
  sendReconciliationEmail,
} from "./services/api.js";

const initialMessages = [
  {
    role: "assistant",
    text:
      "Upload the invoice PDF and the bank details PDF. I will compare company names, dates, references, and amounts, then prepare the mismatch report.",
  },
];

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "-";
  }

  return number.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getIssueRows(result) {
  return [...(result?.mismatches || []), ...(result?.reviewItems || [])];
}

function buildAnalysisContext(result) {
  if (!result) {
    return "";
  }

  const issueRows = getIssueRows(result);
  const summaryLines = [
    `Summary: ${result.summary || ""}`,
    `Matched count: ${result.matchedCount ?? 0}`,
    `Mismatch count: ${result.mismatchCount ?? 0}`,
    `Review count: ${result.reviewCount ?? 0}`,
    `Invoice total: ${result.totalInvoiceAmount ?? 0}`,
    `Paid total: ${result.totalPaidAmount ?? 0}`,
  ];

  if (!issueRows.length) {
    return summaryLines.join("\n");
  }

  const issueLines = issueRows.map((row, index) =>
    `${index + 1}. Invoice ${row.invoiceNo}, company ${row.companyName}, status ${row.status}, invoice amount ${row.invoiceAmount}, paid amount ${row.paidAmount}, difference ${row.difference}, invoice date ${row.invoiceDate}, payment date ${row.paymentDate}, issue ${row.issue || "none"}`,
  );

  return `${summaryLines.join("\n")}\nOpen issues:\n${issueLines.join("\n")}`;
}

function FileDrop({ label, description, file, onChange, inputRef }) {
  return (
    <label className={`file-zone ${file ? "has-file" : ""}`}>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        onChange={(event) => onChange(event.target.files?.[0] || null)}
      />
      <span className="file-zone-tag">PDF</span>
      <strong>{file ? file.name : label}</strong>
      <small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB ready` : description}</small>
    </label>
  );
}

export default function App() {
  const [invoicePdf, setInvoicePdf] = useState(null);
  const [bankPdf, setBankPdf] = useState(null);
  const [email, setEmail] = useState("");
  const [chatValue, setChatValue] = useState("");
  const [messages, setMessages] = useState(initialMessages);
  const [analysis, setAnalysis] = useState(null);
  const [runId, setRunId] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const invoiceRef = useRef(null);
  const bankRef = useRef(null);
  const chatFeedRef = useRef(null);

  const issueRows = useMemo(() => getIssueRows(analysis), [analysis]);
  const canAnalyze = invoicePdf && bankPdf && !isAnalyzing;
  const canSend = analysis && email.trim() && !isSending;

  useEffect(() => {
    if (!chatFeedRef.current) {
      return;
    }

    chatFeedRef.current.scrollTop = chatFeedRef.current.scrollHeight;
  }, [messages, isChatLoading]);

  function addMessage(role, text) {
    setMessages((previous) => [...previous, { role, text }]);
  }

  async function handleAnalyze() {
    if (!invoicePdf || !bankPdf) {
      addMessage("assistant", "Please upload both PDFs before starting the reconciliation.");
      return;
    }

    setIsAnalyzing(true);
    addMessage("user", "Analyze these invoice and bank PDFs.");
    addMessage("assistant", "Reading both PDFs and matching invoices against bank transactions...");

    try {
      const response = await analyzeReconciliation({ invoicePdf, bankPdf });
      setAnalysis(response.result);
      setRunId(response.runId || "");
      addMessage("assistant", response.result.summary);
    } catch (error) {
      addMessage("assistant", error.message || "Analysis failed. Please try again with clearer PDFs.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleSendEmail(targetEmail = email) {
    const finalEmail = String(targetEmail || "").trim();

    if (!analysis) {
      addMessage("assistant", "Run the reconciliation first, then I can send the report.");
      return;
    }

    if (!finalEmail) {
      addMessage("assistant", "Tell me the recipient email address and I will send the PDF report.");
      return;
    }

    setIsSending(true);
    addMessage("user", `Send the report to ${finalEmail}`);

    try {
      await sendReconciliationEmail({
        to: finalEmail,
        result: analysis,
        runId,
      });
      setEmail(finalEmail);
      addMessage("assistant", `Sent the reconciliation PDF report to ${finalEmail}.`);
    } catch (error) {
      addMessage("assistant", error.message || "Could not send the email right now.");
    } finally {
      setIsSending(false);
    }
  }

  function handleChatSubmit(event) {
    event.preventDefault();
    const text = chatValue.trim();

    if (!text) {
      return;
    }

    setChatValue("");

    const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (/\b(send|mail|email)\b/i.test(text) || emailMatch) {
      handleSendEmail(emailMatch?.[0] || email);
      return;
    }

    addMessage("user", text);
    setIsChatLoading(true);

    const history = messages.map((message) => ({
      role: message.role,
      content: message.text,
    }));
    const analysisContext = buildAnalysisContext(analysis);
    const prompt = analysisContext
      ? `${text}\n\nUse this invoice reconciliation context when answering:\n${analysisContext}`
      : text;

    sendChatMessage({
      message: prompt,
      history,
      mode: analysis ? "documents" : "study",
    })
      .then((response) => {
        addMessage(
          "assistant",
          response.answer ||
            "I could not prepare a reply right now. Please try again.",
        );
      })
      .catch((error) => {
        addMessage(
          "assistant",
          error.message || "The chat service could not answer right now.",
        );
      })
      .finally(() => {
        setIsChatLoading(false);
      });
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <aside className="control-panel">
          <div className="brand-block">
            <span className="brand-mark">IR</span>
            <div>
              <p>Finance AI</p>
              <h1>Invoice Reconciliation</h1>
            </div>
          </div>

          <div className="upload-stack">
            <FileDrop
              label="Upload invoice PDF"
              description="Multiple invoices are supported"
              file={invoicePdf}
              onChange={setInvoicePdf}
              inputRef={invoiceRef}
            />
            <FileDrop
              label="Upload bank details PDF"
              description="Statements or transaction reports"
              file={bankPdf}
              onChange={setBankPdf}
              inputRef={bankRef}
            />
          </div>

          <button className="primary-action" disabled={!canAnalyze} onClick={handleAnalyze}>
            {isAnalyzing ? "Analyzing..." : "Analyze payments"}
          </button>

          <label className="email-field">
            <span>Recipient email</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="finance@example.com"
            />
          </label>

          <button className="secondary-action" disabled={!canSend} onClick={() => handleSendEmail()}>
            {isSending ? "Sending..." : "Send PDF report"}
          </button>

          <div className="audit-note">
            <strong>Matching logic</strong>
            <span>Company name, invoice number, date proximity, reference text, and settled amount.</span>
          </div>
        </aside>

        <section className="analysis-panel">
          <header className="analysis-header">
            <div>
              <p>Reconciliation cockpit</p>
              <h2>Invoice vs Bank Settlement Review</h2>
            </div>
            <div className="status-pill">{analysis ? "Report ready" : "Waiting for PDFs"}</div>
          </header>

          <div className="metric-grid">
            <div className="metric-card">
              <span>Matched</span>
              <strong>{analysis?.matchedCount ?? 0}</strong>
            </div>
            <div className="metric-card warning">
              <span>Mismatches</span>
              <strong>{analysis?.mismatchCount ?? 0}</strong>
            </div>
            <div className="metric-card">
              <span>Invoice total</span>
              <strong>{formatMoney(analysis?.totalInvoiceAmount)}</strong>
            </div>
            <div className="metric-card">
              <span>Paid total</span>
              <strong>{formatMoney(analysis?.totalPaidAmount)}</strong>
            </div>
          </div>

          <div className="summary-band">
            {analysis?.summary ||
              "Once both PDFs are analyzed, the summary and mismatch table will appear here."}
          </div>

          <div className="table-shell">
            <div className="table-title">
              <h3>Exceptions table</h3>
              <span>{issueRows.length ? `${issueRows.length} item(s)` : "No exceptions yet"}</span>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Company</th>
                    <th>Invoice date</th>
                    <th>Payment date</th>
                    <th>Invoice amount</th>
                    <th>Paid amount</th>
                    <th>Difference</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {issueRows.length ? (
                    issueRows.map((row, index) => (
                      <tr key={`${row.invoiceNo}-${index}`}>
                        <td>{row.invoiceNo}</td>
                        <td>{row.companyName}</td>
                        <td>{row.invoiceDate}</td>
                        <td>{row.paymentDate}</td>
                        <td>{formatMoney(row.invoiceAmount)}</td>
                        <td>{formatMoney(row.paidAmount)}</td>
                        <td className={Number(row.difference) < 0 ? "negative" : "positive"}>
                          {formatMoney(row.difference)}
                        </td>
                        <td>
                          <span className="row-status">{row.status}</span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="8" className="empty-cell">
                        {analysis
                          ? "All detected invoice payments matched correctly."
                          : "No report generated yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </section>

      <section className="chat-panel">
        <div className="chat-feed" ref={chatFeedRef}>
          {messages.map((message, index) => (
            <div className={`chat-bubble ${message.role}`} key={`${message.role}-${index}`}>
              {message.text}
            </div>
          ))}
          {isChatLoading ? (
            <div className="chat-bubble assistant">
              Thinking...
            </div>
          ) : null}
        </div>
        <form className="chat-composer" onSubmit={handleChatSubmit}>
          <input
            value={chatValue}
            onChange={(event) => setChatValue(event.target.value)}
            placeholder="Type: send this report to accounts@example.com"
          />
          <button type="submit" disabled={isChatLoading || isSending || isAnalyzing}>Send</button>
        </form>
      </section>
    </main>
  );
}
