// Database queries: dataset stats for the AI and filtered class search.
import { pool } from '../db/client.js';

const STOP_WORDS = new Set([
  'how', 'many', 'what', 'who', 'when', 'where', 'which', 'does', 'do', 'is', 'are',
  'the', 'a', 'an', 'in', 'of', 'to', 'for', 'and', 'or', 'about', 'teach', 'teaches',
  'taught', 'class', 'classes', 'course', 'courses', 'there', 'this', 'database', 'find',
  'show', 'me', 'all', 'any', 'some', 'can', 'you', 'tell', 'that', 'with', 'from',
  'at', 'on', 'be', 'have', 'has', 'had', 'was', 'were', 'will', 'would', 'could',
  'should', 'most', 'least', 'more', 'less', 'than', 'also', 'not', 'offered', 'offer',
  'during', 'term', 'terms', 'level', 'undergrad', 'undergraduate', 'graduate', 'grad',
  'fall', 'spring', 'iap', 'summer', 'intro', 'introduction', 'mit', 'eecs', 'department',
  'prereq', 'prerequisites', 'prerequisite', 'prereqs', 'units', 'offering', 'offerings',
  'list', 'all', 'name', 'his', 'her', 'their', 'him', 'she', 'he', 'they',
]);

const COURSE_CODE_RE = /\b6\.\d{3,4}[A-Z]?\b/gi;

// Aggregate counts the LLM uses when answering factual questions.
export async function getDatasetStats() {
  const totals = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM classes) AS total_classes,
      (SELECT COUNT(*)::int FROM instructors) AS total_instructors,
      (SELECT COUNT(*)::int FROM classes WHERE offered_to = 'U') AS undergrad_count,
      (SELECT COUNT(*)::int FROM classes WHERE offered_to = 'G') AS grad_count,
      (SELECT COUNT(*)::int FROM classes WHERE has_fall = TRUE) AS fall_count,
      (SELECT COUNT(*)::int FROM classes WHERE has_spring = TRUE) AS spring_count,
      (SELECT COUNT(*)::int FROM classes WHERE has_iap = TRUE) AS iap_count,
      (SELECT COUNT(*)::int FROM classes WHERE has_summer = TRUE) AS summer_count
  `);
  return totals.rows[0];
}

// Level breakdown and top instructors for factual chat answers.
export async function getExtendedStats() {
  const [levels, topInstructors] = await Promise.all([
    pool.query(`
      SELECT level, COUNT(*)::int AS count
      FROM classes
      WHERE level IS NOT NULL
      GROUP BY level
      ORDER BY level
    `),
    pool.query(`
      SELECT i.name, COUNT(ci.class_id)::int AS class_count
      FROM instructors i
      JOIN class_instructors ci ON ci.instructor_id = i.id
      WHERE i.name NOT ILIKE '%department%'
        AND i.name NOT ILIKE 'consult%'
        AND i.name NOT ILIKE 'staff%'
      GROUP BY i.name
      ORDER BY class_count DESC, i.name
      LIMIT 25
    `),
  ]);

  return {
    levels: levels.rows,
    top_instructors: topInstructors.rows,
  };
}

export function extractTopicKeywords(query) {
  const withoutCourseCodes = query.replace(COURSE_CODE_RE, ' ');
  return withoutCourseCodes
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word) && !/^\d+$/.test(word));
}

async function lookupCoursesByCode(codes) {
  if (!codes.length) return [];

  const uniqueCodes = [...new Set(codes.map((c) => c.toUpperCase()))];
  const result = await pool.query(
    `
    SELECT c.course_code, c.title, c.description, c.prereq, c.terms_raw, c.level,
           c.units, c.offered_to, c.has_fall, c.has_spring, c.has_iap, c.has_summer,
           COALESCE(
             (SELECT string_agg(i.name, ', ')
              FROM class_instructors ci
              JOIN instructors i ON i.id = ci.instructor_id
              WHERE ci.class_id = c.id),
             ''
           ) AS instructors
    FROM classes c
    WHERE c.course_code ILIKE ANY($1::text[])
    ORDER BY c.course_code
    `,
    [uniqueCodes]
  );
  return result.rows;
}

function getInstructorLastName(fullName) {
  const parts = fullName.split(/[\s,]+/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const cleaned = parts[i].replace(/[^a-zA-Z]/g, '');
    if (cleaned.length > 2) return cleaned;
  }
  return null;
}

const PRONOUN_RE = /\b(he|him|his|she|her|they|them)\b/i;
const INSTRUCTOR_FILTER_RE = /instructor:\s*([^,)]+)/gi;
const TAUGHT_BY_RE = /taught by\s+([A-Za-z][A-Za-z.\s-]+?)(?:\?|$|\.|,|\s+and\b)/gi;

function buildContextText(query, history = []) {
  const historyText = history.map((m) => m.text || '').join('\n');
  return `${historyText}\n${query}`.trim();
}

function extractInstructorHints(text) {
  const hints = [];

  for (const match of text.matchAll(INSTRUCTOR_FILTER_RE)) {
    hints.push(match[1].trim());
  }

  for (const match of text.matchAll(TAUGHT_BY_RE)) {
    hints.push(match[1].trim());
  }

  for (const match of text.matchAll(/\b([A-Za-z][A-Za-z.''-]+)\s+teaches\b/gi)) {
    hints.push(match[1].trim());
  }

  return hints;
}

// For pronoun follow-ups ("he", "she"), use the most recently discussed instructor.
function getMostRecentInstructorHint(history = [], query = '') {
  for (let i = history.length - 1; i >= 0; i--) {
    const text = history[i].text || '';
    if (!text || text.trim() === query.trim()) continue;
    const hints = extractInstructorHints(text);
    if (hints.length) return hints[hints.length - 1];
  }
  return null;
}

async function fetchInstructorDetails(matchedRows) {
  if (!matchedRows.length) return [];

  const names = matchedRows.map((row) => row.name);
  const courses = await pool.query(
    `
    SELECT i.name AS instructor_name, c.course_code, c.title, c.offered_to, c.terms_raw
    FROM classes c
    JOIN class_instructors ci ON ci.class_id = c.id
    JOIN instructors i ON i.id = ci.instructor_id
    WHERE i.name = ANY($1::text[])
    ORDER BY i.name, c.course_code
    `,
    [names]
  );

  const coursesByInstructor = {};
  for (const row of courses.rows) {
    if (!coursesByInstructor[row.instructor_name]) {
      coursesByInstructor[row.instructor_name] = [];
    }
    coursesByInstructor[row.instructor_name].push({
      course_code: row.course_code,
      title: row.title,
      offered_to: row.offered_to,
      terms_raw: row.terms_raw,
    });
  }

  return matchedRows.map((row) => {
    const instructorCourses = coursesByInstructor[row.name] || [];
    const undergradCourses = instructorCourses.filter((c) => c.offered_to === 'U');
    const graduateCourses = instructorCourses.filter((c) => c.offered_to === 'G');

    return {
      name: row.name,
      class_count: row.class_count,
      undergrad_count: undergradCourses.length,
      grad_count: graduateCourses.length,
      undergrad_courses: undergradCourses,
      graduate_courses: graduateCourses,
      courses: instructorCourses,
    };
  });
}

async function lookupInstructorsMentioned(text) {
  const allInstructors = await pool.query(`
    SELECT i.name, COUNT(ci.class_id)::int AS class_count
    FROM instructors i
    LEFT JOIN class_instructors ci ON ci.instructor_id = i.id
    GROUP BY i.name
    ORDER BY i.name
  `);

  const matched = [];
  const seen = new Set();

  for (const row of allInstructors.rows) {
    const lastName = getInstructorLastName(row.name);
    if (!lastName) continue;
    if (['who', 'what', 'when', 'where', 'which', 'how'].includes(lastName.toLowerCase())) continue;

    const pattern = new RegExp(`\\b${lastName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(text) && !seen.has(row.name)) {
      seen.add(row.name);
      matched.push(row);
    }
  }

  return fetchInstructorDetails(matched);
}

async function lookupInstructorsByHints(hints) {
  if (!hints.length) return [];

  const allInstructors = await pool.query(`
    SELECT i.name, COUNT(ci.class_id)::int AS class_count
    FROM instructors i
    LEFT JOIN class_instructors ci ON ci.instructor_id = i.id
    GROUP BY i.name
    ORDER BY i.name
  `);

  const matched = [];
  const seen = new Set();

  for (const hint of hints) {
    const hintPattern = hint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const row of allInstructors.rows) {
      if (seen.has(row.name)) continue;
      if (new RegExp(hintPattern, 'i').test(row.name)) {
        seen.add(row.name);
        matched.push(row);
      }
    }
  }

  return fetchInstructorDetails(matched);
}

async function resolveInstructors(query, history = []) {
  if (PRONOUN_RE.test(query)) {
    const recentHint = getMostRecentInstructorHint(history, query);
    if (recentHint) {
      return lookupInstructorsByHints([recentHint]);
    }

    for (let i = history.length - 1; i >= 0; i--) {
      const text = history[i].text || '';
      if (!text || text.trim() === query.trim()) continue;
      const fromMsg = await lookupInstructorsMentioned(text);
      if (fromMsg.length) return fromMsg;
    }

    return [];
  }

  const fromQuery = await lookupInstructorsMentioned(query);
  if (fromQuery.length) return fromQuery;

  const hints = extractInstructorHints(query);
  if (hints.length) return lookupInstructorsByHints(hints.slice(-1));

  return [];
}

function buildInstructorGroupSummary(instructors, hint) {
  if (instructors.length <= 1) return null;

  const undergradCourses = [];
  const graduateCourses = [];
  const seenCodes = new Set();

  for (const instructor of instructors) {
    for (const course of instructor.courses) {
      if (seenCodes.has(course.course_code)) continue;
      seenCodes.add(course.course_code);
      if (course.offered_to === 'G') graduateCourses.push(course);
      else undergradCourses.push(course);
    }
  }

  return {
    matched_name: hint || getInstructorLastName(instructors[0]?.name) || 'instructor',
    instructor_names: instructors.map((i) => i.name),
    total_class_count: seenCodes.size,
    undergrad_count: undergradCourses.length,
    grad_count: graduateCourses.length,
    undergrad_courses: undergradCourses,
    graduate_courses: graduateCourses,
  };
}

async function countByKeyword(keyword) {
  const pattern = `%${keyword}%`;
  const result = await pool.query(
    `
    SELECT COUNT(*)::int AS count
    FROM classes c
    WHERE c.title ILIKE $1 OR c.description ILIKE $1
    `,
    [pattern]
  );
  return result.rows[0].count;
}

async function getMentionedFilterCounts(query) {
  const queryLower = query.toLowerCase();
  const counts = {};
  const conditions = [];
  const params = [];
  let i = 1;

  const wantsUndergrad = /\b(undergrad|undergraduate)\b/.test(queryLower);
  const wantsGrad = /\b(grad|graduate|grad-level|graduate-level)\b/.test(queryLower);
  const wantsFall = /\bfall\b/.test(queryLower);
  const wantsSpring = /\bspring\b/.test(queryLower);
  const wantsIap = /\biap\b/.test(queryLower);
  const wantsSummer = /\bsummer\b/.test(queryLower);
  const termWants = [
    wantsFall && 'fall',
    wantsSpring && 'spring',
    wantsIap && 'iap',
    wantsSummer && 'summer',
  ].filter(Boolean);
  const wantsIntro = /\bintro\b/.test(queryLower);
  const levelMatch = queryLower.match(/\b(\d)-?level\b|\blevel\s+(\d{4})\b|\b(\d{4})-level\b/);
  const level = wantsIntro
    ? '1000'
    : levelMatch
      ? (levelMatch[1] ? `${levelMatch[1]}000` : levelMatch[2] || levelMatch[3])
      : null;

  if (wantsUndergrad) {
    conditions.push(`c.offered_to = $${i++}`);
    params.push('U');
    counts.audience = 'undergraduate';
  } else if (wantsGrad) {
    conditions.push(`c.offered_to = $${i++}`);
    params.push('G');
    counts.audience = 'graduate';
  }

  if (termWants.length === 1) {
    const termColumn = {
      fall: 'has_fall',
      spring: 'has_spring',
      iap: 'has_iap',
      summer: 'has_summer',
    }[termWants[0]];
    conditions.push(`c.${termColumn} = TRUE`);
    counts.term = termWants[0];
  } else if (termWants.length > 1) {
    counts.terms = termWants;
  }

  if (level) {
    conditions.push(`c.level = $${i++}`);
    params.push(level);
    counts.level = level;
  }

  if (!conditions.length) {
    if (counts.terms?.length) return counts;
    return null;
  }

  const whereClause = conditions.join(' AND ');
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM classes c WHERE ${whereClause}`,
    params
  );

  return { ...counts, count: result.rows[0].count };
}

// Pull course, instructor, keyword, and filter data relevant to a chat question.
export async function getChatContext(query, history = []) {
  const contextText = buildContextText(query, history);
  const courseCodes = [...contextText.matchAll(COURSE_CODE_RE)].map((match) => match[0]);
  const keywords = extractTopicKeywords(query);

  const [courses, instructors, filterCounts] = await Promise.all([
    lookupCoursesByCode(courseCodes),
    resolveInstructors(query, history),
    getMentionedFilterCounts(query),
  ]);

  const keywordCounts = [];
  if (keywords.length) {
    const phrase = keywords.join(' ');
    const phraseCount = await countByKeyword(phrase);
    keywordCounts.push({ term: phrase, count: phraseCount });

    if (keywords.length > 1) {
      for (const keyword of keywords) {
        const count = await countByKeyword(keyword);
        keywordCounts.push({ term: keyword, count });
      }
    }
  }

  const hints = extractInstructorHints(buildContextText(query, history));
  const activeHint = PRONOUN_RE.test(query)
    ? getMostRecentInstructorHint(history, query)
    : hints.length
      ? hints[hints.length - 1]
      : null;
  const instructorGroup =
    instructors.length > 1 ? buildInstructorGroupSummary(instructors, activeHint) : null;

  return { courses, instructors, instructorGroup, keywordCounts, filterCounts };
}

const SMALLTALK_RE = /what does REST|what is REST/i;
const DETAIL_QUESTION_RE =
  /prereq|prerequisite|who teaches|instructor for|how many units|what units|when is.*offered|what.*offered|describe/i;
const COUNT_QUESTION_RE = /how many|how much|number of|count of|total/i;
const SEARCH_VERB_RE = /\b(show|find|list|search|give me all|give me the)\b/i;

function isGreetingOrSmallTalk(query) {
  const q = query.trim().toLowerCase().replace(/[!.,?]+$/, '');
  if (SMALLTALK_RE.test(q)) return true;
  if (/^(what can you do|what do you do|help)$/.test(q)) return true;
  if (/^(what\'?s up|whats up)$/.test(q)) return true;
  return /^(hi|hey|hello|howdy|yo|hiya|sup|thanks|thank you|good morning|good afternoon|good evening)(\s+(there|everyone|friend))?(\s+!)?$/.test(
    q
  );
}

const CATALOG_TOPIC_RE =
  /\b(class|classes|course|courses|instructor|professor|teach|taught|catalog|mit|eecs|department|prereq|prerequisite|undergrad|graduate|grad|fall|spring|iap|summer|offered|units|level|database|subject|elective|rest)\b/i;

const OFF_TOPIC_RE =
  /\b(weather|temperature|forecast|rain|snow|sunny|news|sport|sports|football|basketball|soccer|movie|music|recipe|food|bitcoin|crypto|stock|politics|president|joke|poem|capital of|your name|who made you|are you ai|chatgpt|gpt)\b/i;

function isOffTopicQuestion(query) {
  if (isGreetingOrSmallTalk(query)) return false;

  const q = query.trim();
  if (/\b6\.\d{3,4}[A-Z]?\b/i.test(q)) return false;
  if (CATALOG_TOPIC_RE.test(q)) return false;
  if (COUNT_QUESTION_RE.test(q) || DETAIL_QUESTION_RE.test(q)) return false;
  if (OFF_TOPIC_RE.test(q)) return true;

  // Generic questions with no catalog keywords — e.g. "how's the weather", "who is Einstein"
  if (/^(how'?s|what'?s|who is|where is|when is|tell me about|do you know|can you explain)\b/i.test(q)) {
    return true;
  }

  return false;
}

function formatOffTopicReply() {
  return "I can only answer questions about the MIT EECS course catalog — things like finding classes, instructors, prerequisites, and course counts. Try asking about a topic, instructor, or course code!";
}

function formatGeneralReply(query) {
  const q = query.trim();
  if (/what does REST|what is REST/i.test(q)) {
    return "In MIT course listings, REST marks a subject that satisfies the Restricted Elective in Science and Technology requirement.";
  }
  if (/what can you do|what do you do|^help\b/i.test(q)) {
    return "I can search MIT EECS classes by instructor, topic, term, or level — and answer factual questions about the catalog like course counts, prerequisites, and instructor breakdowns.";
  }
  if (/^thanks|thank you/i.test(q)) {
    return "You're welcome! Ask me anything about MIT EECS classes.";
  }
  if (/^(what\'?s up|whats up)$/i.test(q.replace(/[!.,?]+$/, ''))) {
    return "Hey! I'm CourseCompass — ask me about MIT EECS classes and I'll find matches or answer factual questions from the catalog.";
  }
  return "Hi! I'm CourseCompass — ask me about MIT EECS classes by topic, instructor, term, or level, and I'll find matches or answer factual questions from the catalog.";
}

// Deterministic routing for questions the LLM sometimes misclassifies as search.
export function detectForcedChatIntent(query) {
  const q = query.trim();
  const courseCodes = [...q.matchAll(/\b6\.\d{3,4}[A-Z]?\b/gi)].map((m) => m[0]);

  if (courseCodes.length && DETAIL_QUESTION_RE.test(q)) {
    return { intent: 'chat', questionType: 'detail', filters: {} };
  }

  if (PRONOUN_RE.test(q) && /\b(courses?|classes?)\b/i.test(q)) {
    if (/how many|count|number/i.test(q)) {
      return { intent: 'chat', questionType: 'count', filters: {} };
    }
    if (/which|what|name|list/i.test(q)) {
      return { intent: 'chat', questionType: 'list', filters: {} };
    }
  }

  if (/compare|versus|vs\b|percent|ratio|most|top instructor|breakdown|difference between/i.test(q)) {
    return {
      intent: 'chat',
      questionType: 'aggregate',
      filters: {},
      compareInstructors: extractCompareInstructorNames(q, {}, []),
    };
  }

  if (COUNT_QUESTION_RE.test(q) && !SEARCH_VERB_RE.test(q)) {
    return { intent: 'chat', questionType: 'count', filters: {} };
  }

  if (isGreetingOrSmallTalk(q)) {
    return { intent: 'chat', questionType: 'general', filters: {} };
  }

  if (isOffTopicQuestion(q)) {
    return { intent: 'chat', questionType: 'off-topic', filters: {} };
  }

  return null;
}

function isBrowseSearchQuery(query) {
  const q = query.trim();
  if (PRONOUN_RE.test(q)) return false;

  const keywords = extractTopicKeywords(q);
  const isFactualQuestion =
    COUNT_QUESTION_RE.test(q) ||
    DETAIL_QUESTION_RE.test(q) ||
    /\bcompare\b|\bpercent\b|\bmost\b|\bdifference between\b/i.test(q);

  if (isFactualQuestion) return false;

  return (
    SEARCH_VERB_RE.test(q) ||
    /\b(list|all)\b.*\b(courses?|classes?)\b/i.test(q) ||
    (/\b(courses?|classes?)\b/i.test(q) && keywords.length > 0)
  );
}

// Extract search filters from natural language without calling the LLM.
export async function extractSearchFiltersFromQuery(query) {
  const q = query.toLowerCase();
  const filters = {};

  const instructors = await lookupInstructorsMentioned(query);
  const instructorNames = new Set(
    instructors
      .map((row) => getInstructorLastName(row.name)?.toLowerCase())
      .filter(Boolean)
  );

  const keywords = extractTopicKeywords(query).filter(
    (word) => !instructorNames.has(word.toLowerCase())
  );
  if (keywords.length) filters.keyword = keywords.join(' ');

  if (instructors.length >= 1) {
    filters.instructor = getInstructorLastName(instructors[0].name);
  }

  if (/\bintro\b/.test(q)) {
    filters.level = '1000';
  } else {
    const levelMatch = q.match(/\b(\d)-?level\b|\blevel\s+(\d{4})\b|\b(\d{4})-level\b/);
    if (levelMatch) {
      filters.level = levelMatch[1] ? `${levelMatch[1]}000` : levelMatch[2] || levelMatch[3];
    }
  }

  const wantsUndergrad = /\b(undergrad|undergraduate)\b/.test(q);
  const wantsGrad = /\b(grad|graduate)\b/.test(q);
  if (wantsUndergrad && !wantsGrad) filters.offeredTo = 'U';
  else if (wantsGrad && !wantsUndergrad) filters.offeredTo = 'G';

  for (const term of ['fall', 'spring', 'iap', 'summer']) {
    if (new RegExp(`\\b${term}\\b`).test(q)) {
      filters.term = term;
      break;
    }
  }

  return filters;
}

// Deterministic routing for topic/instructor browse queries the LLM may misclassify.
export async function detectForcedSearchIntent(query) {
  if (detectForcedChatIntent(query)) return null;
  if (!isBrowseSearchQuery(query)) return null;

  const filters = await extractSearchFiltersFromQuery(query);
  if (!Object.keys(filters).length) return null;

  return { intent: 'search', filters };
}

export function normalizeSearchKeyword(keyword) {
  if (!keyword || typeof keyword !== 'string') return keyword;
  const cleaned = extractTopicKeywords(keyword).join(' ');
  return cleaned || keyword.trim();
}

// Retry as chat when search returned nothing but the question is clearly factual.
export function shouldRetryAsChat(query, parsed, results, chatContext) {
  if (parsed?.intent !== 'search' || results.length > 0) return null;

  const forced = detectForcedChatIntent(query);
  if (forced) return forced;

  if (PRONOUN_RE.test(query) && /\b(courses?|classes?)\b/i.test(query)) {
    return {
      intent: 'chat',
      questionType: /how many|count|number/i.test(query) ? 'count' : 'list',
      filters: {},
    };
  }

  const keyword = parsed.filters?.keyword || '';
  if (keyword.length > 40 || /what are the|who teaches|prereq/i.test(keyword)) {
    return { intent: 'chat', questionType: 'detail', filters: {} };
  }

  if (chatContext?.courses?.length) {
    return { intent: 'chat', questionType: 'detail', filters: {} };
  }

  if (isGreetingOrSmallTalk(query)) {
    return { intent: 'chat', questionType: 'general', filters: {} };
  }

  if (isOffTopicQuestion(query)) {
    return { intent: 'chat', questionType: 'off-topic', filters: {} };
  }

  return null;
}

function buildSearchConditions(filters) {
  const conditions = [];
  const params = [];
  let i = 1;

  if (filters.subject) {
    conditions.push(`s.code = $${i++}`);
    params.push(filters.subject);
  }
  if (filters.level) {
    conditions.push(`c.level = $${i++}`);
    params.push(filters.level);
  }
  if (filters.offeredTo) {
    conditions.push(`c.offered_to = $${i++}`);
    params.push(filters.offeredTo);
  }
  if (filters.term) {
    const termColumn = {
      fall: 'has_fall',
      spring: 'has_spring',
      iap: 'has_iap',
      summer: 'has_summer',
    }[filters.term.toLowerCase()];
    if (termColumn) {
      conditions.push(`c.${termColumn} = TRUE`);
    }
  }
  if (filters.instructor) {
    conditions.push(`EXISTS (
      SELECT 1 FROM class_instructors ci
      JOIN instructors i ON i.id = ci.instructor_id
      WHERE ci.class_id = c.id AND i.name ILIKE $${i++}
    )`);
    params.push(`%${filters.instructor}%`);
  }
  if (filters.keyword) {
    const p1 = i++, p2 = i++;
    conditions.push(`(c.title ILIKE $${p1} OR c.description ILIKE $${p2})`);
    const kw = `%${filters.keyword}%`;
    params.push(kw, kw);
  }

  return { conditions, params };
}

// Merge LLM-extracted filters with instructors/courses resolved from query + history.
export function resolveChatFilters(llmFilters = {}, chatContext = {}, query = '', history = []) {
  const filters = {};
  for (const [key, value] of Object.entries(llmFilters || {})) {
    if (value != null && value !== '') filters[key] = value;
  }

  if (PRONOUN_RE.test(query)) {
    const recentHint = getMostRecentInstructorHint(history, query);
    if (recentHint) {
      filters.instructor = recentHint;
    } else if (chatContext.instructorGroup?.matched_name) {
      filters.instructor = chatContext.instructorGroup.matched_name;
    } else if (chatContext.instructors?.length >= 1) {
      filters.instructor = getInstructorLastName(chatContext.instructors[0].name);
    }
  } else if (
    !filters.instructor &&
    !isInstructorComparisonQuery(query) &&
    !(DETAIL_QUESTION_RE.test(query) && COURSE_CODE_RE.test(query))
  ) {
    const hints = extractInstructorHints(query);
    if (hints.length) {
      filters.instructor = hints[hints.length - 1];
    } else if (chatContext.instructorGroup?.matched_name) {
      filters.instructor = chatContext.instructorGroup.matched_name;
    } else if (chatContext.instructors?.length === 1) {
      filters.instructor = getInstructorLastName(chatContext.instructors[0].name);
    }
  }

  if (chatContext.filterCounts) {
    const fc = chatContext.filterCounts;
    if (fc.audience === 'graduate' && !filters.offeredTo) filters.offeredTo = 'G';
    if (fc.audience === 'undergraduate' && !filters.offeredTo) filters.offeredTo = 'U';
    if (fc.term && !filters.term && !fc.terms?.length) filters.term = fc.term;
    if (fc.level && !filters.level) filters.level = fc.level;
  }

  return filters;
}

export async function countClasses(filters = {}) {
  const { conditions, params } = buildSearchConditions(filters);
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query(
    `
    SELECT COUNT(*)::int AS count
    FROM classes c
    LEFT JOIN subjects s ON c.subject_id = s.id
    ${whereClause}
    `,
    params
  );
  return result.rows[0].count;
}

// Run SQL for a factual chat question using the same filters as search.
function isInstructorComparisonQuery(query) {
  return /\bcompare\b|\bversus\b|\bvs\.?\b|\bmore than\b|\bfewer than\b|\bdifference between\b/i.test(query);
}

function extractCompareInstructorNames(query, chatContext = {}, llmNames = []) {
  const names = new Set();

  for (const name of llmNames) {
    if (name) names.add(name.trim());
  }

  for (const match of query.matchAll(/\b([A-Za-z]+)\s+(?:and|vs\.?|versus)\s+([A-Za-z]+)\b/gi)) {
    names.add(match[1]);
    names.add(match[2]);
  }

  for (const match of query.matchAll(/compare\s+([A-Za-z]+(?:\s+and\s+[A-Za-z]+)+)/gi)) {
    match[1].split(/\s+and\s+/i).forEach((n) => names.add(n.trim()));
  }

  const wantsComparison = names.size >= 2 || isInstructorComparisonQuery(query);
  if (wantsComparison && chatContext.instructors?.length) {
    for (const inst of chatContext.instructors) {
      const last = getInstructorLastName(inst.name);
      if (last) names.add(last);
    }
  }

  return [...names].filter(Boolean);
}

export async function runAggregateQueries(
  filters = {},
  query = '',
  stats = {},
  extendedStats = {},
  chatContext = {},
  options = {}
) {
  const q = query.toLowerCase();
  const aggregates = {
    dataset: {
      total_classes: stats.total_classes,
      total_instructors: stats.total_instructors,
      undergrad_count: stats.undergrad_count,
      grad_count: stats.grad_count,
      fall_count: stats.fall_count,
      spring_count: stats.spring_count,
      iap_count: stats.iap_count,
      summer_count: stats.summer_count,
    },
    levels: extendedStats.levels || [],
    top_instructors: (extendedStats.top_instructors || []).slice(0, 15),
  };

  if (Object.keys(filters).length) {
    aggregates.filtered_count = await countClasses(filters);
    if (/list|which|what courses|names of|name of/i.test(q)) {
      aggregates.filtered_courses = await searchClasses(filters);
    }
  }

  if (chatContext.filterCounts) {
    aggregates.inferred_filter_count = chatContext.filterCounts;
  }
  if (chatContext.keywordCounts?.length) {
    aggregates.keyword_counts = chatContext.keywordCounts;
  }

  const baseFilters = { ...filters };
  delete baseFilters.term;

  if (/fall|spring|iap|summer|each term|by term|breakdown/i.test(q)) {
    aggregates.by_term = {
      fall: await countClasses({ ...baseFilters, term: 'fall' }),
      spring: await countClasses({ ...baseFilters, term: 'spring' }),
      iap: await countClasses({ ...baseFilters, term: 'iap' }),
      summer: await countClasses({ ...baseFilters, term: 'summer' }),
    };
  }

  if (/level|1000|2000|3000|4000|5000|6000|7000|intro/i.test(q)) {
    aggregates.by_level = {};
    for (const row of extendedStats.levels || []) {
      aggregates.by_level[row.level] = await countClasses({ ...filters, level: row.level });
    }
  }

  if (/undergrad|graduate|grad\b/i.test(q) && Object.keys(filters).length) {
    aggregates.by_audience = {
      undergraduate: await countClasses({ ...filters, offeredTo: 'U' }),
      graduate: await countClasses({ ...filters, offeredTo: 'G' }),
    };
  }

  const compareNames = extractCompareInstructorNames(
    query,
    chatContext,
    options.compareInstructors || []
  );

  if (compareNames.length >= 2 || isInstructorComparisonQuery(query)) {
    aggregates.instructor_comparison = [];
    for (const name of compareNames.slice(0, 5)) {
      const instructorFilters = { instructor: name };
      aggregates.instructor_comparison.push({
        instructor: name,
        total: await countClasses(instructorFilters),
        undergraduate: await countClasses({ ...instructorFilters, offeredTo: 'U' }),
        graduate: await countClasses({ ...instructorFilters, offeredTo: 'G' }),
        courses: (await searchClasses(instructorFilters)).map((c) => ({
          course_code: c.course_code,
          title: c.title,
          offered_to: c.offered_to,
        })),
      });
    }
  }

  if (/percent|ratio|proportion|fraction|what share/i.test(q)) {
    const numerator = aggregates.filtered_count ?? chatContext.filterCounts?.count ?? null;
    const denominator = stats.total_classes;
    if (numerator != null && denominator) {
      aggregates.percentage_of_catalog = Math.round((numerator / denominator) * 1000) / 10;
    }
    if (stats.grad_count && stats.total_classes && /grad/i.test(q)) {
      aggregates.grad_percentage_of_catalog =
        Math.round((stats.grad_count / stats.total_classes) * 1000) / 10;
    }
    if (stats.undergrad_count && stats.total_classes && /undergrad/i.test(q)) {
      aggregates.undergrad_percentage_of_catalog =
        Math.round((stats.undergrad_count / stats.total_classes) * 1000) / 10;
    }
  }

  return aggregates;
}

export function isComplexOrAggregateQuery(query, parsed = {}, sqlResult = {}) {
  if (parsed.questionType === 'aggregate') return true;
  if (parsed.compareInstructors?.length >= 2) return true;
  if (/compare|versus|vs\b|percent|ratio|proportion|fraction|most|least|top instructor|breakdown|distribution|each term|by level|more than|fewer than|difference between/i.test(query)) {
    return true;
  }
  if (sqlResult.aggregates?.instructor_comparison?.length >= 2) return true;
  if (sqlResult.aggregates?.by_term && Object.keys(sqlResult.filters || {}).length > 0) return true;
  return false;
}

export async function executeChatQuery(
  filters = {},
  questionType = 'count',
  chatContext = {},
  query = '',
  stats = {},
  extendedStats = {},
  options = {}
) {
  const q = query.toLowerCase();
  const hasFilters = Object.keys(filters).length > 0;
  let effectiveQuestionType = questionType;

  if (effectiveQuestionType === 'count' && /which|what.*courses|list|names of|name of/i.test(q)) {
    effectiveQuestionType = 'list';
  }

  const result = {
    filters,
    questionType: effectiveQuestionType,
    count: null,
    undergradCount: null,
    gradCount: null,
    results: [],
    gradResults: [],
    undergradResults: [],
  };

  if (hasFilters) {
    result.count = await countClasses(filters);

    if (filters.instructor) {
      result.undergradCount = await countClasses({ ...filters, offeredTo: 'U' });
      result.gradCount = await countClasses({ ...filters, offeredTo: 'G' });
      result.gradResults = await searchClasses({ ...filters, offeredTo: 'G' });
      result.undergradResults = await searchClasses({ ...filters, offeredTo: 'U' });
    }

    if (effectiveQuestionType === 'list' || effectiveQuestionType === 'detail') {
      if (filters.instructor && /grad/i.test(q) && !/undergrad/i.test(q)) {
        result.results = result.gradResults;
        result.count = result.gradCount;
      } else if (filters.instructor && /undergrad/i.test(q) && !/grad/i.test(q)) {
        result.results = result.undergradResults;
        result.count = result.undergradCount;
      } else if (filters.instructor) {
        result.results = uniqueCourses([...result.gradResults, ...result.undergradResults]);
      } else {
        result.results = await searchClasses(filters);
      }
    }

    if (chatContext.instructorGroup) {
      result.instructorGroup = chatContext.instructorGroup;
    }
  }

  result.aggregates = await runAggregateQueries(
    filters,
    query,
    stats,
    extendedStats,
    chatContext,
    options
  );

  return result;
}

function formatCourseList(courses) {
  return courses.map((c) => `${c.course_code} (${c.title})`).join('; ');
}

function uniqueCourses(courses) {
  const seen = new Set();
  return courses.filter((c) => {
    const key = c.course_code || c.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function queryWantsUndergradOnly(q) {
  return /\b(undergrad|undergraduate)\b/i.test(q) && !/\b(grad|graduate)\b/i.test(q);
}

function queryWantsGradOnly(q) {
  return /\b(grad|graduate)\b/i.test(q) && !/\b(undergrad|undergraduate)\b/i.test(q);
}

function queryWantsBothLevels(q) {
  return /\b(undergrad|undergraduate)\b/i.test(q) && /\b(grad|graduate)\b/i.test(q);
}

function queryWantsCourseNames(q) {
  return /which|what.*courses|names of|name of|list|\bname\b/i.test(q);
}

function getInstructorCourseSets(sqlResult, chatContext, instructorLabel) {
  const undergradCourses = uniqueCourses(
    sqlResult.undergradResults ||
      sqlResult.instructorGroup?.undergrad_courses ||
      chatContext.instructors?.flatMap((i) => i.undergrad_courses) ||
      []
  );
  const gradCourses = uniqueCourses(
    sqlResult.gradResults ||
      sqlResult.instructorGroup?.graduate_courses ||
      chatContext.instructors?.flatMap((i) => i.graduate_courses) ||
      []
  );
  const undergrad = sqlResult.instructorGroup?.undergrad_count ?? sqlResult.undergradCount ?? undergradCourses.length;
  const graduate = sqlResult.instructorGroup?.grad_count ?? sqlResult.gradCount ?? gradCourses.length;
  const total = sqlResult.instructorGroup?.total_class_count ?? sqlResult.count ?? undergrad + graduate;

  return { undergradCourses, gradCourses, undergrad, graduate, total };
}

function formatInstructorReply(query, sqlResult, chatContext, instructorLabel) {
  const q = query.toLowerCase();
  const { undergradCourses, gradCourses, undergrad, graduate, total } = getInstructorCourseSets(
    sqlResult,
    chatContext,
    instructorLabel
  );
  const wantsCount = /how many|count|number/i.test(q);
  const wantsNames = queryWantsCourseNames(q);

  if (queryWantsUndergradOnly(q)) {
    if (wantsCount && wantsNames) {
      return undergradCourses.length
        ? `${instructorLabel} teaches ${undergrad} undergraduate course(s): ${formatCourseList(undergradCourses)}.`
        : `${instructorLabel} has no undergraduate courses listed in the catalog.`;
    }
    if (wantsCount) {
      return `${instructorLabel} teaches ${undergrad} undergraduate course(s) in the catalog.`;
    }
    if (wantsNames) {
      return undergradCourses.length
        ? `Undergraduate courses taught by ${instructorLabel}: ${formatCourseList(undergradCourses)}.`
        : `${instructorLabel} has no undergraduate courses listed in the catalog.`;
    }
  }

  if (queryWantsGradOnly(q)) {
    if (wantsCount && wantsNames) {
      return gradCourses.length
        ? `${instructorLabel} teaches ${graduate} graduate course(s): ${formatCourseList(gradCourses)}.`
        : `${instructorLabel} has no graduate courses listed in the catalog.`;
    }
    if (wantsCount) {
      return `${instructorLabel} teaches ${graduate} graduate course(s) in the catalog.`;
    }
    if (wantsNames) {
      return gradCourses.length
        ? `Graduate courses taught by ${instructorLabel}: ${formatCourseList(gradCourses)}.`
        : `${instructorLabel} has no graduate courses listed in the catalog.`;
    }
  }

  if (queryWantsBothLevels(q) && wantsCount) {
    return `${instructorLabel} teaches ${total} course(s) in the catalog: ${undergrad} undergraduate and ${graduate} graduate.`;
  }

  if (wantsCount) {
    return `${instructorLabel} teaches ${total} course(s) in the catalog.`;
  }

  if (wantsNames && gradCourses.length && !undergradCourses.length) {
    return `Graduate courses taught by ${instructorLabel}: ${formatCourseList(gradCourses)}.`;
  }

  if (wantsNames && undergradCourses.length) {
    return `Courses taught by ${instructorLabel}: ${formatCourseList(uniqueCourses([...undergradCourses, ...gradCourses]))}.`;
  }

  return null;
}

// Build a natural-language reply directly from SQL results when the answer is unambiguous.
export function formatChatReplyFromSql(query, sqlResult, chatContext = {}, stats = {}) {
  const q = query.toLowerCase();

  if (isGreetingOrSmallTalk(query)) {
    return formatGeneralReply(query);
  }

  if (sqlResult.questionType === 'off-topic' || isOffTopicQuestion(query)) {
    return formatOffTopicReply();
  }

  if (sqlResult.questionType === 'general') {
    return formatGeneralReply(query);
  }

  const { filters, count, undergradCount, gradCount, results, gradResults, instructorGroup } = sqlResult;

  if (chatContext.courses?.length === 1) {
    const course = chatContext.courses[0];
    if (/prereq/i.test(q)) {
      return course.prereq
        ? `The prerequisite for ${course.course_code} (${course.title}) is ${course.prereq}.`
        : `${course.course_code} (${course.title}) has no prerequisites listed in the catalog.`;
    }
    if (/who teaches|instructor/i.test(q)) {
      return `${course.course_code} (${course.title}) is taught by ${course.instructors || 'instructors not listed'}.`;
    }
    if (/unit/i.test(q)) {
      return `${course.course_code} (${course.title}) is ${course.units || 'units not listed'}.`;
    }
    if (/fall|spring|iap|summer|term|offered|when/i.test(q)) {
      return `${course.course_code} (${course.title}) is offered: ${course.terms_raw || 'see catalog for term details'}.`;
    }
  }

  const instructorLabel =
    instructorGroup?.matched_name ||
    filters?.instructor ||
    chatContext.instructorGroup?.matched_name;

  if (instructorLabel) {
    const instructorReply = formatInstructorReply(query, sqlResult, chatContext, instructorLabel);
    if (instructorReply) return instructorReply;
  }

  if (filters?.keyword && /how many|count/i.test(q) && count != null) {
    return `There are ${count} course(s) matching "${filters.keyword}" in the catalog.`;
  }

  if (count != null && /how many|count|number/i.test(q) && Object.keys(filters).length > 0) {
    const parts = [];
    if (filters.offeredTo === 'G') parts.push('graduate');
    if (filters.offeredTo === 'U') parts.push('undergraduate');
    if (filters.term) parts.push(filters.term);
    if (filters.level) parts.push(`level ${filters.level}`);
    const desc = parts.length ? parts.join(' ') + ' ' : '';
    return `There are ${count} ${desc}course(s) in the catalog matching your question.`;
  }

  if (sqlResult.aggregates?.by_term && /fall|spring|iap|summer|term|vs|versus|each|breakdown|compare/i.test(q)) {
    const bt = sqlResult.aggregates.by_term;
    const mentionedTerms = chatContext.filterCounts?.terms;
    const entries = Object.entries(bt).filter(([term]) =>
      !mentionedTerms?.length || mentionedTerms.includes(term)
    );
    const parts = entries.map(([term, count]) => `${term}: ${count} course(s)`);
    if (parts.length) {
      return `Courses by term: ${parts.join('; ')}.`;
    }
  }

  if (
    !Object.keys(filters).length &&
    !instructorLabel &&
    /how many courses are|courses in (the )?(database|catalog)/i.test(q)
  ) {
    return `There are ${stats.total_classes} courses in the catalog, all from MIT's EECS department (Course 6).`;
  }

  if (!Object.keys(filters).length && /how many instructors/i.test(q)) {
    return `There are ${stats.total_instructors} distinct instructors in the catalog.`;
  }

  if (/most|top instructor|teaches the most/i.test(q) && sqlResult.aggregates?.top_instructors?.length) {
    const top = sqlResult.aggregates.top_instructors[0];
    return `${top.name} teaches the most classes in the catalog with ${top.class_count} course(s).`;
  }

  if (sqlResult.aggregates?.grad_percentage_of_catalog != null && /grad|graduate/i.test(q) && /percent|ratio|proportion|fraction|share/i.test(q)) {
    return `${sqlResult.aggregates.grad_percentage_of_catalog}% of courses in the catalog are graduate level (${stats.grad_count} of ${stats.total_classes}).`;
  }

  if (sqlResult.aggregates?.undergrad_percentage_of_catalog != null && /undergrad/i.test(q) && /percent|ratio|proportion|fraction|share/i.test(q)) {
    return `${sqlResult.aggregates.undergrad_percentage_of_catalog}% of courses in the catalog are undergraduate (${stats.undergrad_count} of ${stats.total_classes}).`;
  }

  if (sqlResult.aggregates?.percentage_of_catalog != null && /percent|ratio|proportion|fraction/i.test(q)) {
    return `${sqlResult.aggregates.percentage_of_catalog}% of courses in the catalog match your criteria (${sqlResult.aggregates.filtered_count} of ${stats.total_classes}).`;
  }

  if (
    sqlResult.aggregates?.instructor_comparison?.length >= 2 &&
    isInstructorComparisonQuery(query)
  ) {
    const rows = [...sqlResult.aggregates.instructor_comparison].sort((a, b) => b.total - a.total);
    const summary = rows.map((r) => `${r.instructor}: ${r.total} course(s)`).join('; ');
    return `${summary}. ${rows[0].instructor} teaches the most.`;
  }

  if (sqlResult.aggregates?.inferred_filter_count?.count != null && /how many|count/i.test(q)) {
    const fc = sqlResult.aggregates.inferred_filter_count;
    const parts = [fc.audience, fc.term, fc.level].filter(Boolean);
    const desc = parts.length ? `${parts.join(' ')} ` : '';
    return `There are ${fc.count} ${desc}course(s) in the catalog matching your question.`;
  }

  if (results?.length && /which|what courses|list|name/i.test(q)) {
    return `Matching courses: ${formatCourseList(results)}.`;
  }

  return null;
}

// Build and run a dynamic SQL query from AI-extracted search filters.
export async function searchClasses(filters) {
  const { conditions, params } = buildSearchConditions(filters);
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const query = `
    SELECT c.id, s.code AS subject, c.course_code, c.title, c.level, c.units,
           c.offered_to, c.terms_raw, c.prereq,
           COALESCE(
             (SELECT string_agg(i.name, ', ')
              FROM class_instructors ci
              JOIN instructors i ON i.id = ci.instructor_id
              WHERE ci.class_id = c.id),
             ''
           ) AS instructors
    FROM classes c
    LEFT JOIN subjects s ON c.subject_id = s.id
    ${whereClause}
    ORDER BY c.id
    LIMIT 50
  `;

  const result = await pool.query(query, params);
  return result.rows;
}
