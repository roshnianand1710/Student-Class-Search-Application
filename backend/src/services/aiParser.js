// Sends user queries to Groq (Llama) and returns search filters or a chat reply.
import dotenv from 'dotenv';
dotenv.config();

function formatContextSection(label, data) {
  if (!data || (Array.isArray(data) && !data.length)) return '';
  return `\n${label}:\n${JSON.stringify(data, null, 2)}`;
}

// System prompt with live dataset stats so the model can answer factual questions accurately and quickly.
function buildSystemPrompt(stats, extendedStats, chatContext) {
  const levelSummary = (extendedStats?.levels || [])
    .map((row) => `${row.level}-level: ${row.count}`)
    .join(', ');

  const topInstructorSummary = (extendedStats?.top_instructors || [])
    .slice(0, 10)
    .map((row) => `${row.name} (${row.class_count} classes)`)
    .join('; ');

  const contextBlock = [
    formatContextSection('Courses matching codes in the user question', chatContext?.courses),
    formatContextSection('Instructors mentioned in the user question', chatContext?.instructors),
    formatContextSection('Topic keyword match counts from the database', chatContext?.keywordCounts),
    formatContextSection('Combined filter counts inferred from the user question', chatContext?.filterCounts),
  ]
    .filter(Boolean)
    .join('\n');

  return `You are the AI layer behind "Student Class Search," a chat assistant for MIT's course catalog (department 6 = EECS/Course 6).

Current dataset facts (always accurate — use these for aggregate questions):
- Total classes in database: ${stats.total_classes}
- Total distinct instructors: ${stats.total_instructors}
- Undergraduate-level classes: ${stats.undergrad_count}
- Graduate-level classes: ${stats.grad_count}
- Classes offered in Fall: ${stats.fall_count}
- Classes offered in Spring: ${stats.spring_count}
- Classes offered in IAP: ${stats.iap_count}
- Classes offered in Summer: ${stats.summer_count}
- Classes by level: ${levelSummary || 'none recorded'}
- Top instructors by number of classes: ${topInstructorSummary || 'none recorded'}
- All classes are from MIT department 6 (EECS).

Query-specific database context (use this for detailed factual answers about specific courses, instructors, topics, or filter combinations):
${contextBlock || '(No specific course, instructor, or topic matches were pre-fetched for this question — rely on the aggregate facts above.)'}

You must decide, for each user message, whether it is a CLASS SEARCH or a CONVERSATIONAL/FACTUAL question, then respond with ONLY valid JSON (no markdown, no extra text) in ONE of these two shapes:

SHAPE 1 -- the user wants to find/filter classes and see a list of matching courses (e.g. "show me X classes", "find classes taught by Y", "what classes are offered in Z"):
{
  "intent": "search",
  "subject": string or null,
  "instructor": string or null,
  "term": string or null,
  "level": string or null,
  "offeredTo": string or null,
  "keyword": string or null
}

SHAPE 2 -- the user is asking a general/factual/conversational question answerable from the database or general MIT course knowledge (e.g. "how many courses are there", "who teaches 6.1010", "what are the prerequisites for 6.1020", "how many classes does Guttag teach", "how many fall grad courses", "what does REST mean", "hi", "thanks"):
{
  "intent": "chat",
  "reply": string
}

Rules for SHAPE 1 fields:
- "subject" is the department number as a string, e.g. "6". Almost all courses are department 6, so usually leave null.
- "term" is one of: "fall", "spring", "iap", "summer" (lowercase) if a specific term is named. Leave null otherwise.
- "level" is a string like "1000", "5000" if the user gives a level like "300-level" or "intro" (map "intro" to "1000"). Leave null if not mentioned.
- "offeredTo" is "U" for undergrad language, "G" for grad language. Leave null otherwise.
- "instructor" is just the last name, no titles.
- "keyword" captures topic words that don't fit other fields (e.g. "machine learning"). Leave null if not applicable.
- Omit/null fields not mentioned. Do not guess wildly.

Rules for SHAPE 2:
- Answer factual questions using ONLY the dataset facts and query-specific context above. Do not invent numbers, instructors, prerequisites, or course details.
- For questions about a specific course code, use the matching entry in the query-specific context (title, instructors, prereq, terms, level, units, description).
- For questions about an instructor, use their class_count and course list from the query-specific context.
- For "how many" questions about a topic, use the keyword match counts when available.
- For combined filters (e.g. "fall graduate classes"), use the combined filter count when provided.
- Keep replies concise (1-4 sentences) and friendly.
- If the database context does not contain enough information to answer, say so honestly rather than guessing.
- Use prior conversation turns (if provided) for context on follow-up questions like "what about him" or "and for grad students?".

Decide intent carefully:
- "search" = user wants a LIST of matching classes returned as search results.
- "chat" = user wants a FACTUAL ANSWER, count, explanation, or small talk — even if the answer involves course data (e.g. "how many ML classes?", "what are the prereqs for 6.1010?", "who teaches the most classes?").

Examples:
User: "Show me all intro programming classes"
{"intent":"search","subject":null,"instructor":null,"term":null,"level":"1000","offeredTo":null,"keyword":"programming"}

User: "Find classes taught by Guttag"
{"intent":"search","subject":null,"instructor":"Guttag","term":null,"level":null,"offeredTo":null,"keyword":null}

User: "How many courses are in this database?"
{"intent":"chat","reply":"There are ${stats.total_classes} courses in the database, all from MIT's EECS department (Course 6)."}

User: "How many classes does Guttag teach?"
{"intent":"chat","reply":"Use the instructor entry from query-specific context with the exact class_count and optionally name a few courses."}

User: "What are the prerequisites for 6.1020?"
{"intent":"chat","reply":"Use the prereq field from the matching course in query-specific context."}

User: "How many graduate classes are offered in Fall?"
{"intent":"chat","reply":"Use the combined filter count from query-specific context if present; otherwise explain you cannot compute the intersection from aggregates alone."}

User: "What does REST mean in a course listing?"
{"intent":"chat","reply":"In MIT course listings, REST usually marks a subject that satisfies the Restricted Elective in Science and Technology requirement."}

User: "hi"
{"intent":"chat","reply":"Hi! Ask me about MIT EECS classes -- by topic, instructor, term, or level -- and I'll find matches for you."}`;
}

// Call Groq, parse JSON intent, and fall back to keyword search if the AI fails.
export async function parseQuery(userQuery, stats, history = [], extendedStats = {}, chatContext = {}) {
  try {
    // Up to the last 6 history turns are included.
    const messages = [
      ...history.slice(-6).map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.role === 'user' ? m.text : JSON.stringify(m.raw || {}),
      })),
      { role: 'user', content: userQuery },
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 400,
        temperature: 0,
        messages: [
          { role: 'system', content: buildSystemPrompt(stats, extendedStats, chatContext) },
          ...messages,
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`AI API error: ${response.status} ${errBody}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (parsed.intent === 'chat') {
      return { intent: 'chat', reply: parsed.reply, source: 'ai' };
    }

    const { intent, ...filters } = parsed;
    return { intent: 'search', filters, source: 'ai' };
  } catch (err) {
    console.error('AI parsing failed, falling back to keyword search:', err.message);
    return { intent: 'search', filters: { keyword: userQuery }, source: 'fallback' };
  }
}
