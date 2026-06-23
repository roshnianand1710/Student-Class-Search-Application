# Student Class Search Application

A conversational search app for MIT Course 6 (EECS) classes. Type questions in plain English — the app uses an LLM to decide whether you're searching for classes or asking a factual question, then returns matching course cards or a chat reply.

## Features

- **Natural-language search** — filter by subject, instructor, term, level, undergrad/grad status, or keywords
- **Conversational Q&A** — ask factual questions grounded in live dataset stats (e.g. "how many graduate classes are there?")
- **Follow-up context** — the last few chat turns are sent to the backend so follow-ups work
- **Graceful fallback** — if the LLM fails, the backend falls back to keyword search instead of erroring

## Tech Stack

| Layer | Stack |
|-------|-------|
| Frontend | React 19, Vite |
| Backend | Node.js, Express |
| Database | PostgreSQL (Supabase) |
| AI | Groq — Llama 3.3 70B |

## Project Structure

```
student-class-search/
├── frontend/          # React chat UI
├── backend/
│   ├── src/
│   │   ├── routes/    # /search, /classes
│   │   ├── services/  # AI parsing, SQL search
│   │   ├── db/        # schema + Postgres client
│   │   └── data/      # CSV + ingest script
│   └── .env.example
└── WRITEUP.md         # Architecture & design notes
```

### What each source file does

| File | Purpose |
|------|---------|
| `frontend/src/main.jsx` | Starts React and loads the app |
| `frontend/src/App.jsx` | Manages chats, sidebar, and API calls |
| `frontend/src/api.js` | Sends search requests to the backend |
| `frontend/src/components/ChatWindow.jsx` | Message list, input box, suggestions |
| `frontend/src/components/ChatSidebar.jsx` | Chat history list and New chat button |
| `frontend/src/components/MessageBubble.jsx` | Renders one user or assistant message |
| `frontend/src/components/ClassCard.jsx` | One course card in search results |
| `frontend/src/components/GalaxyBackground.jsx` | Animated starfield behind the UI |
| `frontend/src/utils/chatStorage.js` | Saves chats to localStorage |
| `frontend/src/utils/chatHistory.js` | Builds history sent to the API |
| `frontend/src/index.css` | Global colors, fonts, page defaults |
| `frontend/src/App.css` | All component layout and styling |
| `backend/src/server.js` | Express server entry point |
| `backend/src/routes/search.js` | `POST /search` — main chat endpoint |
| `backend/src/routes/classes.js` | `GET /classes` — list all classes |
| `backend/src/services/aiParser.js` | Calls Groq LLM to parse the query |
| `backend/src/services/classQuery.js` | SQL search and dataset stats |
| `backend/src/db/client.js` | Postgres connection pool |
| `backend/src/db/schema.sql` | Database table definitions |
| `backend/src/data/ingest.js` | Loads `courses.csv` into Postgres |

## Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) Postgres database (or any Postgres instance)
- A [Groq](https://console.groq.com) API key

## Setup

### 1. Clone and install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Configure environment

Copy the backend env template and fill in your values:

```bash
cp backend/.env.example backend/.env
```

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Postgres connection string (Supabase pooler URL works) |
| `PORT` | Backend port (default `4000`) |
| `AI_API_KEY` | Groq API key |

Optionally, set `VITE_API_URL` in the frontend if the backend is not at `http://localhost:4000`.

### 3. Initialize the database

Run the schema against your Postgres database, then ingest the bundled CSV:

```bash
# From the backend directory — apply schema.sql via psql or Supabase SQL editor
psql "$DATABASE_URL" -f src/db/schema.sql

npm run ingest
```

The ingest script loads `src/data/raw/courses.csv` (MIT Course 6 catalog).

### 4. Run locally

In two terminals:

```bash
# Terminal 1 — backend (http://localhost:4000)
cd backend && npm run dev

# Terminal 2 — frontend (http://localhost:5173)
cd frontend && npm run dev
```

Open the frontend URL in your browser and start chatting.

## Example Queries

**Search**
- "Show me intro-level classes in Fall"
- "Find classes taught by Madden"
- "Graduate classes about machine learning"

**Chat**
- "How many classes are in the database?"
- "What's the difference between undergrad and grad offerings?"

## API

### `POST /search`

Main endpoint used by the chat UI.

**Request**
```json
{
  "query": "find spring classes about algorithms",
  "history": [
    { "role": "user", "text": "..." },
    { "role": "assistant", "text": "..." }
  ]
}
```

**Response (search)**
```json
{
  "intent": "search",
  "interpreted": { "term": "spring", "keyword": "algorithms" },
  "interpretedVia": "ai",
  "count": 5,
  "results": []
}
```

**Response (chat)**
```json
{
  "intent": "chat",
  "reply": "...",
  "interpretedVia": "ai"
}
```

### Other endpoints

- `GET /health` — health check
- `GET /classes?limit=50&offset=0` — paginated class listing

## Limitations

- Dataset covers MIT Course 6 (EECS) only 
- Chats persist in browser `localStorage` on this device only (not synced across browsers)

