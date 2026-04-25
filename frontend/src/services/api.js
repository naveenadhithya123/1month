const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const raw = await response.text();
  let data = {};

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { error: raw };
    }
  }

  if (!response.ok) {
    throw new Error(data.error || data.message || `${response.status} ${response.statusText}`);
  }

  return data;
}

export async function analyzeReconciliation({ invoicePdf, bankPdf }) {
  const formData = new FormData();
  formData.append("invoicePdf", invoicePdf);
  formData.append("bankPdf", bankPdf);

  const response = await fetch(`${API_URL}/reconciliation/analyze`, {
    method: "POST",
    body: formData,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Reconciliation analysis failed.");
  }

  return data;
}

export function sendReconciliationEmail(payload) {
  return request("/reconciliation/send-email", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
