// Main chat panel — message list, suggestions, input, and loading state (controlled by App).
import { useState, useRef, useEffect, useCallback } from 'react';
import MessageBubble from './MessageBubble.jsx';

// Example questions shown when the chat is empty.
const SUGGESTIONS = [
  { text: 'Show me intro programming classes', icon: 'search' },
  { text: 'Find classes taught by Guttag', icon: 'person' },
  { text: 'How many courses are in this database?', icon: 'chat' },
];

// Small icon shown beside each suggestion chip.
function SuggestionIcon({ type }) {
  if (type === 'person') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 20c0-3.87 3.13-7 7-7s7 3.13 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'chat') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M8 10h8M8 14h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8A2.5 2.5 0 0 1 17.5 17H9l-5 3v-3.5A2.5 2.5 0 0 1 4 14.5v-8Z" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function ChatWindow({ chatId, messages, loading, onSend }) {
  const [input, setInput] = useState('');
  const bottomRef = useRef(null); // Scroll anchor at the end of the message list.
  const inputRef = useRef(null);

  // Reset input and focus when the user switches chats.
  useEffect(() => {
    setInput('');
    inputRef.current?.focus();
  }, [chatId]);

  // Keep the latest message in view as messages or loading state change.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, chatId]);

  const handleSend = useCallback(
    (text) => {
      const query = (text ?? input).trim();
      if (!query || loading) return;
      setInput('');
      onSend(chatId, query);
    },
    [chatId, input, loading, onSend]
  );

  return (
    <section className="chat-window" aria-label="Course search chat">
      <div
        className="chat-messages"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={loading}
      >
        {messages.length === 0 && (
          <div className="empty-chat">
            <div className="empty-icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M12 3L3 8.5v7L12 21l9-5.5v-7L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M12 12l9-3.5M12 12v9M12 12L3 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            </div>
            <h2>Where would you like to start?</h2>
            <p>Search the MIT EECS catalog or ask a question — pick a suggestion or type below.</p>
            <p className="suggestions-label">Suggestions</p>
            <div className="suggestions" role="group" aria-label="Example queries">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.text}
                  type="button"
                  className="suggestion-chip"
                  disabled={loading}
                  onClick={() => handleSend(s.text)}
                >
                  <SuggestionIcon type={s.icon} />
                  {s.text}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {loading && (
          <div className="loading-row" aria-hidden="true">
            <div className="message-avatar avatar-assistant">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M12 3L3 8.5v7L12 21l9-5.5v-7L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="loading-bubble">
              <div className="typing-dots">
                <span /><span /><span />
              </div>
              Searching catalog…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        <form
          className="chat-input-row"
          aria-label="Send a message"
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
        >
          <label htmlFor={`chat-input-${chatId}`} className="sr-only">
            Search query or question
          </label>
          <input
            id={`chat-input-${chatId}`}
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search classes or ask a question…"
            disabled={loading}
            autoComplete="off"
            enterKeyHint="send"
            maxLength={500}
          />
          <button
            type="submit"
            className="send-btn"
            disabled={loading || !input.trim()}
            aria-label={loading ? 'Sending…' : 'Send message'}
          >
            {loading ? (
              <span className="send-spinner" aria-hidden="true" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </form>
        <p className="input-hint">
          <kbd>Enter</kbd> to send · up to 500 characters
        </p>
      </div>
    </section>
  );
}
