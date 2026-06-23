// Database queries: dataset stats for the AI and filtered class search.
import { pool } from '../db/client.js';

// Aggregate counts the LLM uses when answering factual questions.
export async function getDatasetStats() {
  const totals = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM classes) AS total_classes,
      (SELECT COUNT(*) FROM instructors) AS total_instructors,
      (SELECT COUNT(*) FROM classes WHERE offered_to = 'U') AS undergrad_count,
      (SELECT COUNT(*) FROM classes WHERE offered_to = 'G') AS grad_count
  `);
  return totals.rows[0];
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
