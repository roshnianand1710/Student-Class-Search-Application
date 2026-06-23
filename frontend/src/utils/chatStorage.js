// Persists multi-chat sessions in the browser via localStorage.
const STORAGE_KEY = 'coursecompass-chats';

// Generate a unique id for chats and messages.
export function nextId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Create a blank chat session with default title and timestamps.
export function createChat(title = 'New chat') {
  const now = Date.now();
  return {
    id: nextId(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

// Load saved sessions from localStorage, or null if none/invalid.
export function loadStoredChats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.sessions) || data.sessions.length === 0) return null;
    return { sessions: data.sessions, activeId: data.activeId };
  } catch {
    return null;
  }
}

// Save all sessions and the currently active chat id to localStorage.
export function saveStoredChats(sessions, activeId) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions, activeId }));
  } catch {
    // quota exceeded or private mode — silently ignore
  }
}

// Derive a sidebar title from the user's first message in a chat.
export function titleFromQuery(query) {
  const trimmed = query.trim();
  if (!trimmed) return 'New chat';
  return trimmed.length > 42 ? `${trimmed.slice(0, 42)}…` : trimmed;
}
