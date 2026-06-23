// Renders one chat message — user text, AI reply, search results, or error.
import ClassCard from './ClassCard.jsx';

// Human-readable labels for the filter tags on search results.
const FILTER_LABELS = {
  subject: 'Subject',
  instructor: 'Instructor',
  term: 'Term',
  level: 'Level',
  offeredTo: 'Audience',
  keyword: 'Keyword',
};

function UserAvatar() {
  return (
    <div className="message-avatar avatar-user" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 20c0-3.87 3.13-7 7-7s7 3.13 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function AssistantAvatar() {
  return (
    <div className="message-avatar avatar-assistant" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M12 3L3 8.5v7L12 21l9-5.5v-7L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export default function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  const activeFilters = message.filters
    ? Object.entries(message.filters).filter(([, v]) => v)
    : [];
  const resultCount = message.count ?? message.results?.length ?? 0;

  return (
    <div className={`message-row ${isUser ? 'message-row-user' : ''}`}>
      {isUser ? <UserAvatar /> : <AssistantAvatar />}
      <div className="message-content">
        <div className={`message-bubble ${isUser ? 'bubble-user' : 'bubble-system'}`}>
          {isUser ? (
            <p>{message.text}</p>
          ) : message.error ? (
            <p className="error-text">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
                <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {message.error}
            </p>
          ) : message.kind === 'chat' ? (
            <p>{message.text}</p>
          ) : (
            <>
              {activeFilters.length > 0 && (
                <div className="filter-pills">
                  {activeFilters.map(([key, value]) => (
                    <span key={key} className="filter-pill">
                      <span className="filter-pill-key">{FILTER_LABELS[key] || key}: </span>
                      {value}
                    </span>
                  ))}
                </div>
              )}
              {message.results && message.results.length > 0 ? (
                <>
                  <div className="results-header">
                    <span className="results-count">{resultCount} found</span>
                    <span className="results-label">matching classes</span>
                  </div>
                  <div className="class-results">
                    {message.results.map((cls) => (
                      <ClassCard key={cls.id} cls={cls} />
                    ))}
                  </div>
                </>
              ) : (
                <p className="empty-state">No matching classes found. Try a different query.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
