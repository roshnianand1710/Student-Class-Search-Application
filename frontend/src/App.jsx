// Root React component — owns chat sessions, sidebar state, and API calls.
import { useState, useEffect, useCallback, useMemo } from 'react';
import ChatSidebar from './components/ChatSidebar.jsx';
import ChatWindow from './components/ChatWindow.jsx';
import GalaxyBackground from './components/GalaxyBackground.jsx';
import { searchClasses } from './api.js';
import { buildHistory } from './utils/chatHistory.js';
import {
  createChat,
  loadStoredChats,
  saveStoredChats,
  nextId,
  titleFromQuery,
} from './utils/chatStorage.js';
import './App.css';

// Restore chats from localStorage on first load, or start with one empty chat.
function initState() {
  const stored = loadStoredChats();
  if (stored) {
    const activeExists = stored.sessions.some((s) => s.id === stored.activeId);
    return {
      sessions: stored.sessions,
      activeId: activeExists ? stored.activeId : stored.sessions[0].id,
    };
  }
  const first = createChat();
  return { sessions: [first], activeId: first.id };
}

export default function App() {
  const [{ sessions, activeId }, setChatState] = useState(initState);
  const [loadingChatId, setLoadingChatId] = useState(null); // Which chat is waiting on the API.
  const [sidebarOpen, setSidebarOpen] = useState(false); // Mobile drawer toggle.

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? sessions[0],
    [sessions, activeId]
  );

  // Persist sessions whenever chats or the active id change.
  useEffect(() => {
    saveStoredChats(sessions, activeId);
  }, [sessions, activeId]);

  // Immutable update helper for a single chat by id.
  const updateSession = useCallback((chatId, updater) => {
    setChatState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.id === chatId ? { ...updater(s), updatedAt: Date.now() } : s
      ),
    }));
  }, []);

  const handleNewChat = useCallback(() => {
    const chat = createChat();
    setChatState((prev) => ({
      sessions: [chat, ...prev.sessions],
      activeId: chat.id,
    }));
    setSidebarOpen(false);
  }, []);

  const handleSelectChat = useCallback((id) => {
    setChatState((prev) => ({ ...prev, activeId: id }));
  }, []);

  const handleDeleteChat = useCallback((id) => {
    setChatState((prev) => {
      const remaining = prev.sessions.filter((s) => s.id !== id);
      if (remaining.length === 0) {
        const fresh = createChat();
        return { sessions: [fresh], activeId: fresh.id };
      }
      const nextActive = prev.activeId === id ? remaining[0].id : prev.activeId;
      return { sessions: remaining, activeId: nextActive };
    });
  }, []);

  // Send a message in one chat: optimistically add user msg, call API, append assistant reply.
  const handleSend = useCallback(
    async (chatId, text) => {
      const query = text.trim();
      if (!query || loadingChatId) return;

      const session = sessions.find((s) => s.id === chatId);
      if (!session) return;

      const userMessage = { id: nextId(), role: 'user', text: query };
      const priorMessages = session.messages;
      const isFirstMessage = priorMessages.length === 0;
      const history = buildHistory(priorMessages);

      updateSession(chatId, (s) => ({
        ...s,
        title: isFirstMessage ? titleFromQuery(query) : s.title,
        messages: [...s.messages, userMessage],
      }));

      setLoadingChatId(chatId);

      try {
        const data = await searchClasses(query, history);

        updateSession(chatId, (s) => {
          const assistantMessage =
            data.intent === 'chat'
              ? { id: nextId(), role: 'assistant', text: data.reply, kind: 'chat' }
              : {
                  id: nextId(),
                  role: 'assistant',
                  filters: data.interpreted,
                  results: data.results,
                  count: data.count,
                  kind: 'search',
                };
          return { ...s, messages: [...s.messages, assistantMessage] };
        });
      } catch (err) {
        updateSession(chatId, (s) => ({
          ...s,
          messages: [
            ...s.messages,
            {
              id: nextId(),
              role: 'assistant',
              error: err.message || 'Something went wrong. Please try again.',
            },
          ],
        }));
      } finally {
        setLoadingChatId(null);
      }
    },
    [loadingChatId, sessions, updateSession]
  );

  return (
    <div className="app-shell">
      <GalaxyBackground />

      <div className="app-layout">
        <ChatSidebar
          sessions={sessions}
          activeId={activeId}
          onSelect={handleSelectChat}
          onNew={handleNewChat}
          onDelete={handleDeleteChat}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        <div className="app-panel">
          <header className="app-header">
            <button
              type="button"
              className="sidebar-toggle"
              onClick={() => setSidebarOpen((o) => !o)}
              aria-label={sidebarOpen ? 'Close chat history' : 'Open chat history'}
              aria-expanded={sidebarOpen}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <div className="header-brand">
              <div className="header-text">
                <h1>{activeSession?.title ?? 'CourseCompass'}</h1>
                <p>Each chat keeps its own context · search classes or ask anything</p>
              </div>
            </div>
          </header>

          <main className="app-main">
            {activeSession && (
              <ChatWindow
                key={activeSession.id}
                chatId={activeSession.id}
                messages={activeSession.messages}
                loading={loadingChatId === activeSession.id}
                onSend={handleSend}
              />
            )}
          </main>

          <footer className="app-footer">
            <span>Powered by Groq · Llama 3.3</span>
            <span className="footer-dot" aria-hidden="true" />
            <span>EECS catalog data</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
