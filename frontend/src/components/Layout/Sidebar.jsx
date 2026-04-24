export default function Sidebar({ onNewChat, appName }) {
  return (
    <div className="sidebar">
      <div className="brand-mark">AI</div>
      <button type="button" onClick={onNewChat}>
        New Chat
      </button>
      <div className="status-row" style={{ textAlign: "center" }}>
        {appName}
      </div>
    </div>
  );
}
