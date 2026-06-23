# Architecture & Design Write-up

## Architecture

The system has three tiers: a React chat UI, an Express API, and a Postgres database (Supabase), with a single LLM call sitting between the UI and the database that decides how to handle each message.

Request flow:
1. User types a message in the chat UI.
2. Frontend POSTs `{ query, history }` to `/search`, where `history` is the last few turns of the conversation (kept in React state only, not persisted).
3. Backend fetches live dataset stats (total classes, instructor count, undergrad/grad split) from Postgres.
4. Backend sends the query, conversation history, and those stats to Groq's Llama 3.3 70B with a system prompt that asks the model to classify the message as either a **class search** or a **conversational/factual question**, and respond with strict JSON in one of two shapes.
5. If `intent: "search"`, the backend builds a parameterized SQL query from whichever filters were extracted (subject, instructor, term, level, undergrad/grad, keyword) and returns matched classes.
6. If `intent: "chat"`, the backend returns the model's natural-language reply directly — grounded in the real stats it was given, not invented.
7. The frontend renders either filter pills + class cards, or a plain chat bubble, depending on which path was taken.

## Why this stack

- **Postgres/Supabase**: the data is inherently relational — a class has a subject, can have multiple instructors, and recurs across terms — so a normalized relational schema fits better than a document store. Free tier, and SQL is easy.
- **Express**: minimal and fast to wire up for three small route files without unnecessary abstraction.
- **React + Vite**: fast dev loop for a single-page chat UI with no build complexity needed.
- **Groq (Llama 3.3 70B) over a paid API**: free tier with generous limits, OpenAI-compatible API, and fast inference — appropriate for a prototype.
- **Single LLM call for intent + extraction**: one well-structured prompt with strict JSON output and few-shot examples handles both decisions reliably, avoiding the latency and complexity of two model calls per request.

## How the AI search and chat layer works

The system prompt gives the model:
- The exact JSON shapes it must choose between (`intent: "search"` with extracted filters, or `intent: "chat"` with a reply string).
- Real, live numbers about the dataset (total classes, instructor count, undergrad/grad counts), so factual answers are grounded rather than hallucinated.
- Few-shot examples mirroring the assignment's own sample queries, plus examples of conversational questions, so the model reliably distinguishes "find me X" from "tell me about Y."
- Up to the last six turns of conversation history, so follow-up questions ("and how many are graduate-level?") resolve correctly using prior context.

The backend never trusts the model blindly: the response is parsed as JSON, and if parsing fails, the API call errors, or the shape is unexpected, the backend falls back to a plain keyword search across class titles and descriptions — so the user always gets a usable result instead of an error.

## Future Enhancements

- Persist conversation history server-side per session for multi-device continuity.
- Add a "did you mean" correction layer for misspelled instructor names or course codes.
- Add automated tests for the intent classification, filter extraction, and SQL-building logic.
