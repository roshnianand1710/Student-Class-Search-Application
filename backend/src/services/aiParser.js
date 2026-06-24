// Sends user queries to Groq (Llama) and returns search filters or chat query plans.
import dotenv from 'dotenv';
import { detectForcedChatIntent, detectForcedSearchIntent, extractSearchFiltersFromQuery } from './classQuery.js';
dotenv.config();

function formatContextSection(label, data) {
  if (!data || (Array.isArray(data) && !data.length)) return '';
  return `\n${label}:\n${JSON.stringify(data, null, 2)}`;
}

const FILTER_FIELDS = ['subject', 'instructor', 'term', 'level', 'offeredTo', 'keyword'];

function extractFilters(parsed) {
  const filters = {};
  for (const field of FILTER_FIELDS) {
    if (parsed[field] != null && parsed[field] !== '') filters[field] = parsed[field];
  }
  return filters;
}

// System prompt for intent classification and filter extraction.
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
    formatContextSection('Aggregated instructor group (when one name matches multiple instructors)', chatContext?.instructorGroup),
    formatContextSection('Topic keyword match counts from the database', chatContext?.keywordCounts),
    formatContextSection('Combined filter counts inferred from the user question', chatContext?.filterCounts),
  ]
    .filter(Boolean)
    .join('\n');

  return `You are the AI layer behind "Student Class Search," a chat assistant for MIT's course catalog (department 6 = EECS/Course 6).

Current dataset facts:
- Total classes: ${stats.total_classes}
- Total instructors: ${stats.total_instructors}
- Undergraduate classes: ${stats.undergrad_count}
- Graduate classes: ${stats.grad_count}
- Fall: ${stats.fall_count}, Spring: ${stats.spring_count}, IAP: ${stats.iap_count}, Summer: ${stats.summer_count}
- Classes by level: ${levelSummary || 'none recorded'}
- Top instructors: ${topInstructorSummary || 'none recorded'}

Query-specific database context:
${contextBlock || '(No specific matches pre-fetched — use conversation history for follow-ups.)'}

Classify each message and respond with ONLY valid JSON (no markdown) in ONE of these shapes:

SHAPE 1 — user wants a LIST of matching classes as search results:
{
  "intent": "search",
  "subject": string or null,
  "instructor": string or null,
  "term": string or null,
  "level": string or null,
  "offeredTo": string or null,
  "keyword": string or null
}

SHAPE 2 — user wants a FACTUAL ANSWER or conversation (counts, details, explanations, greetings):
{
  "intent": "chat",
  "questionType": "count" | "list" | "detail" | "aggregate" | "general",
  "compareInstructors": string[] or null,
  "subject": string or null,
  "instructor": string or null,
  "term": string or null,
  "level": string or null,
  "offeredTo": string or null,
  "keyword": string or null
}

Filter field rules (both shapes):
- "subject": department number string, usually null (all courses are dept 6)
- "term": "fall", "spring", "iap", or "summer" if named
- "level": "1000", "5000", etc. Map "intro" to "1000"
- "offeredTo": "U" for undergrad, "G" for graduate
- "instructor": last name only. For follow-ups with "he/she/they", extract the instructor from conversation history
- "keyword": topic words (e.g. "machine learning")

questionType rules (SHAPE 2 only):
- "count": how many, number of
- "list": which courses, what courses, list, name the courses
- "detail": prerequisites, who teaches, units, when offered — about a specific course
- "aggregate": complex stats — comparisons, percentages, breakdowns by term/level, "most/least", multi-filter counts
- "general": greetings, thanks, definitions (REST), capabilities — no SQL filters needed

- "compareInstructors": array of last names when comparing two+ instructors (e.g. ["Madden", "Guttag"]). Otherwise null.

Intent rules:
- "search" = user wants browseable search RESULTS (cards)
- "chat" = user wants an ANSWER (even if it requires counting or listing in prose)

Examples:
User: "Show me intro programming classes"
{"intent":"search","subject":null,"instructor":null,"term":null,"level":"1000","offeredTo":null,"keyword":"programming"}

User: "Find classes taught by Madden"
{"intent":"search","subject":null,"instructor":"Madden","term":null,"level":null,"offeredTo":null,"keyword":null}

User: "How many undergrad and grad courses does he take?"
(with Madden in history)
{"intent":"chat","questionType":"count","subject":null,"instructor":"Madden","term":null,"level":null,"offeredTo":null,"keyword":null}

User: "Which graduate courses does he take?"
(with Madden in history)
{"intent":"chat","questionType":"list","subject":null,"instructor":"Madden","term":null,"level":null,"offeredTo":"G","keyword":null}

User: "What are the prerequisites for 6.1020?"
{"intent":"chat","questionType":"detail","compareInstructors":null,"subject":null,"instructor":null,"term":null,"level":null,"offeredTo":null,"keyword":null}

User: "How many graduate Fall courses are there?"
{"intent":"chat","questionType":"aggregate","compareInstructors":null,"subject":null,"instructor":null,"term":"fall","level":null,"offeredTo":"G","keyword":null}

User: "Compare Madden and Guttag — who teaches more classes?"
{"intent":"chat","questionType":"aggregate","compareInstructors":["Madden","Guttag"],"subject":null,"instructor":null,"term":null,"level":null,"offeredTo":null,"keyword":null}

User: "What percentage of courses are graduate level?"
{"intent":"chat","questionType":"aggregate","compareInstructors":null,"subject":null,"instructor":null,"term":null,"level":null,"offeredTo":"G","keyword":null}

User: "What does REST mean?"
{"intent":"chat","questionType":"general","compareInstructors":null,"subject":null,"instructor":null,"term":null,"level":null,"offeredTo":null,"keyword":null}

User: "hi"
{"intent":"chat","questionType":"general","compareInstructors":null,"subject":null,"instructor":null,"term":null,"level":null,"offeredTo":null,"keyword":null}`;
}

// Call Groq to classify intent and extract filters; search falls back to keyword on failure.
export async function parseQuery(userQuery, stats, history = [], extendedStats = {}, chatContext = {}) {
  try {
    const messages = [
      ...history.slice(-6).map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.text || JSON.stringify(m.raw || {}),
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
        max_tokens: 300,
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
      const compareInstructors = Array.isArray(parsed.compareInstructors)
        ? parsed.compareInstructors.filter(Boolean)
        : [];
      return {
        intent: 'chat',
        questionType: parsed.questionType || 'general',
        filters: extractFilters(parsed),
        compareInstructors,
        source: 'ai',
      };
    }

    return { intent: 'search', filters: extractFilters(parsed), source: 'ai' };
  } catch (err) {
    console.error('AI parsing failed, falling back to keyword search:', err.message);
    if (/^(hi|hey|hello|howdy|yo|thanks|thank you)\b/i.test(userQuery.trim())) {
      return { intent: 'chat', questionType: 'general', filters: {}, source: 'fallback' };
    }
    const forcedChat = detectForcedChatIntent(userQuery);
    if (forcedChat) {
      return { ...forcedChat, compareInstructors: [], source: 'fallback' };
    }
    const forcedSearch = await detectForcedSearchIntent(userQuery);
    if (forcedSearch) {
      return { ...forcedSearch, source: 'fallback' };
    }
    const filters = await extractSearchFiltersFromQuery(userQuery);
    return { intent: 'search', filters, source: 'fallback' };
  }
}

// Second LLM call: turn authoritative SQL results into a natural-language chat reply.
export async function generateChatReply(
  userQuery,
  history,
  stats,
  extendedStats,
  sqlResult,
  chatContext
) {
  const messages = [
    ...history.slice(-6).map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.text || '',
    })),
    { role: 'user', content: userQuery },
  ];

  const systemPrompt = `You are a helpful MIT EECS course catalog assistant.

The user asked a factual question. SQL queries were run against the database. The results below are AUTHORITATIVE — use these exact numbers and course details. Do not invent or estimate data.

Dataset totals: ${stats.total_classes} classes, ${stats.total_instructors} instructors, ${stats.undergrad_count} undergrad, ${stats.grad_count} graduate.

SQL query results (USE THESE — includes counts, course lists, and aggregate breakdowns):
${JSON.stringify(sqlResult, null, 2)}

Additional context:
${JSON.stringify(
  {
    courses: chatContext?.courses,
    instructors: chatContext?.instructors,
    instructorGroup: chatContext?.instructorGroup,
    keywordCounts: chatContext?.keywordCounts,
    levels: extendedStats?.levels,
    top_instructors: extendedStats?.top_instructors?.slice(0, 10),
  },
  null,
  2
)}

Rules:
- Use sqlResult.count, sqlResult.aggregates, sqlResult.instructor_comparison, sqlResult.by_term, sqlResult.by_level for all numbers.
- For comparisons, cite each instructor's exact counts from instructor_comparison.
- For percentages, use aggregates.percentage_of_catalog or compute from provided counts only.
- For "most classes" questions, use aggregates.top_instructors[0].
- If the user says an instructor "takes" courses, they mean courses the instructor teaches.
- Answer in 1-5 concise, friendly sentences.
- Include specific course codes and titles when listing courses.
- For general knowledge (e.g. what REST means) with questionType "general", answer from MIT catalog knowledge.
- If unrelated to the MIT EECS catalog, say you can only help with course catalog questions.
- Respond with plain text only, no JSON.`;

  try {
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
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`AI API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || 'I could not generate a reply.';
  } catch (err) {
    console.error('Chat reply generation failed:', err.message);
    return null;
  }
}
