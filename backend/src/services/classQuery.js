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
  'prerequisites', 'prerequisite', 'prereq', 'prereqs', 'units', 'offering', 'offerings',
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

function extractTopicKeywords(query) {
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

async function lookupInstructorsMentioned(query) {
  const allInstructors = await pool.query(`
    SELECT i.name, COUNT(ci.class_id)::int AS class_count
    FROM instructors i
    LEFT JOIN class_instructors ci ON ci.instructor_id = i.id
    GROUP BY i.name
    ORDER BY i.name
  `);

  const matched = [];

  for (const row of allInstructors.rows) {
    const lastName = getInstructorLastName(row.name);
    if (!lastName) continue;

    const pattern = new RegExp(`\\b${lastName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(query)) matched.push(row);
  }

  if (!matched.length) return [];

  const names = matched.map((row) => row.name);
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

  return matched.map((row) => ({
    name: row.name,
    class_count: row.class_count,
    courses: coursesByInstructor[row.name] || [],
  }));
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

  if (wantsFall) {
    conditions.push('c.has_fall = TRUE');
    counts.term = 'fall';
  } else if (wantsSpring) {
    conditions.push('c.has_spring = TRUE');
    counts.term = 'spring';
  } else if (wantsIap) {
    conditions.push('c.has_iap = TRUE');
    counts.term = 'iap';
  } else if (wantsSummer) {
    conditions.push('c.has_summer = TRUE');
    counts.term = 'summer';
  }

  if (level) {
    conditions.push(`c.level = $${i++}`);
    params.push(level);
    counts.level = level;
  }

  if (!conditions.length) return null;

  const whereClause = conditions.join(' AND ');
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM classes c WHERE ${whereClause}`,
    params
  );

  return { ...counts, count: result.rows[0].count };
}

// Pull course, instructor, keyword, and filter data relevant to a chat question.
export async function getChatContext(query) {
  const courseCodes = [...query.matchAll(COURSE_CODE_RE)].map((match) => match[0]);
  const keywords = extractTopicKeywords(query);

  const [courses, instructors, filterCounts] = await Promise.all([
    lookupCoursesByCode(courseCodes),
    lookupInstructorsMentioned(query),
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

  return { courses, instructors, keywordCounts, filterCounts };
}

// Build and run a dynamic SQL query from AI-extracted search filters.
export async function searchClasses(filters) {
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
