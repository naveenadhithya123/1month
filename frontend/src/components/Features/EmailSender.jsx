import { useState } from "react";
import { sendAnswerEmail } from "../../services/api.js";

export default function EmailSender({ answer, question, defaultTo = "" }) {
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState("AI Tutor Answer");
  const [status, setStatus] = useState("");

  async function handleSend() {
    if (!answer) {
      setStatus("Ask something first so there is an answer to send.");
      return;
    }

    const response = await sendAnswerEmail({
      to,
      subject,
      answer,
      question,
    });

    setStatus(response.success ? "Email sent." : "Email request finished.");
  }

  return (
    <section className="panel-card">
      <h3>Email Answer</h3>
      <input
        type="email"
        placeholder="recipient@example.com"
        value={to}
        onChange={(event) => setTo(event.target.value)}
      />
      <input
        type="text"
        placeholder="Subject"
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
      />
      <button className="send-button" type="button" onClick={handleSend}>
        Send Email
      </button>
      <p className="status-row">{status}</p>
    </section>
  );
}
