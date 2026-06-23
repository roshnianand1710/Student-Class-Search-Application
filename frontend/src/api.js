// Frontend HTTP client for the backend search API.
// Backend URL — change VITE_API_URL in .env if the API is not on port 4000.
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// POST /search with the user query and recent chat history for follow-up context.
export async function searchClasses(query, history = []) {
  const res = await fetch(`${BASE_URL}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, history }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Search failed');
  }
  return res.json();
}
