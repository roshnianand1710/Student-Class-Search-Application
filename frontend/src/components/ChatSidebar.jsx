// Left sidebar — chat list, new chat, delete, and CourseCompass branding.
// Turns a timestamp into friendly text like "5m ago" or "Yesterday".
function formatRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ChatSidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  isOpen,
  onClose,
}) {
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <>
      {/* Dim overlay on mobile when the drawer is open. */}
      <div
        className={`sidebar-backdrop ${isOpen ? 'sidebar-backdrop-visible' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`chat-sidebar ${isOpen ? 'chat-sidebar-open' : ''}`}
        aria-label="Chat history"
      >
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <div className="logo sidebar-logo" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
                <path d="M12 3v4M12 17v4M3 12h4M17 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="12" cy="12" r="2.5" fill="currentColor" />
              </svg>
            </div>
            <span className="sidebar-title">
              <span className="sidebar-title-line">Course</span>
              <span className="sidebar-title-line">Compass</span>
            </span>
          </div>
          <button type="button" className="new-chat-btn" onClick={onNew}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            New chat
          </button>
        </div>

        <div className="sidebar-section-label">Chats</div>

        <nav className="chat-list" aria-label="Previous chats">
          {sorted.length === 0 ? (
            <p className="sidebar-empty">No chats yet</p>
          ) : (
            sorted.map((chat) => (
              <div
                key={chat.id}
                className={`chat-list-item ${chat.id === activeId ? 'chat-list-item-active' : ''}`}
              >
                <button
                  type="button"
                  className="chat-list-btn"
                  onClick={() => {
                    onSelect(chat.id);
                    onClose?.();
                  }}
                  aria-current={chat.id === activeId ? 'true' : undefined}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="chat-list-icon">
                    <path d="M8 10h8M8 14h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8A2.5 2.5 0 0 1 17.5 17H9l-5 3v-3.5A2.5 2.5 0 0 1 4 14.5v-8Z" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                  <span className="chat-list-text">
                    <span className="chat-list-title">{chat.title}</span>
                    <span className="chat-list-time">{formatRelativeTime(chat.updatedAt)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="chat-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(chat.id);
                  }}
                  aria-label={`Delete ${chat.title}`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M6 7h12M9 7V5h6v2M10 11v6M14 11v6M8 7l1 12h6l1-12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            ))
          )}
        </nav>

        <div className="sidebar-footer">
          <span>MIT Course 6 · EECS</span>
        </div>
      </aside>
    </>
  );
}
