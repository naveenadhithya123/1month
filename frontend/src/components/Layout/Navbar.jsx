export default function Navbar({ userEmail, onSpeak, hasAnswer }) {
  return (
    <div className="navbar">
      <div>
        <h2 style={{ margin: 0 }}>Study Workspace</h2>
        <div className="status-row">
          Chat, upload, summarize, quiz, generate, and email.
        </div>
      </div>
      <div className="composer-actions">
        <div className="user-chip">{userEmail || "Guest mode"}</div>
        <button className="mini-button" onClick={onSpeak} disabled={!hasAnswer}>
          Read Answer
        </button>
      </div>
    </div>
  );
}
