// One-time script: reads courses.csv and loads rows into Postgres.
import fs from 'fs';
import csv from 'csv-parser';
import { pool } from '../db/client.js';

const subjectCache = new Map();
const instructorCache = new Map();

// Look up or insert a subject row and cache the id for this ingest run.
async function getSubjectId(code) {
  if (!code) return null;
  if (subjectCache.has(code)) return subjectCache.get(code);
  const existing = await pool.query('SELECT id FROM subjects WHERE code = $1', [code]);
  let id;
  if (existing.rows.length) {
    id = existing.rows[0].id;
  } else {
    const inserted = await pool.query(
      'INSERT INTO subjects (code) VALUES ($1) RETURNING id',
      [code]
    );
    id = inserted.rows[0].id;
  }
  subjectCache.set(code, id);
  return id;
}

// Look up or insert an instructor row and cache the id for this ingest run.
async function getInstructorId(name) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (instructorCache.has(trimmed)) return instructorCache.get(trimmed);
  const existing = await pool.query('SELECT id FROM instructors WHERE name = $1', [trimmed]);
  let id;
  if (existing.rows.length) {
    id = existing.rows[0].id;
  } else {
    const inserted = await pool.query(
      'INSERT INTO instructors (name) VALUES ($1) RETURNING id',
      [trimmed]
    );
    id = inserted.rows[0].id;
  }
  instructorCache.set(trimmed, id);
  return id;
}

// "6.1010" -> subject "6". "6.5060" -> subject "6".
function deriveSubjectCode(code) {
  const match = String(code || '').match(/^(\d+)\./);
  return match ? match[1] : null;
}

// Rough level bucket from the first digit after the department dot.
// e.g. "6.1010" -> "1000", "6.5060" -> "5000"
function deriveLevel(code) {
  const match = String(code || '').match(/\.(\d)/);
  if (!match) return null;
  const firstDigit = match[1];
  return `${firstDigit}000`;
}

function deriveUnits(hoursText) {
  return (hoursText || '').trim() || null;
}

// Parse the terms text into boolean flags used by SQL filters.
function parseTerms(termsText) {
  const text = (termsText || '').toLowerCase();
  return {
    has_fall: text.includes('fall'),
    has_spring: text.includes('spring'),
    has_iap: text.includes('iap'),
    has_summer: text.includes('summer'),
  };
}

async function run() {
  const rows = [];

  // Stream-parse the bundled MIT Course 6 CSV into memory.
  await new Promise((resolve, reject) => {
    fs.createReadStream('src/data/raw/courses.csv')
      .pipe(csv())
      .on('data', (row) => rows.push(row))
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`Read ${rows.length} rows from CSV.`);

  let inserted = 0;
  for (const row of rows) {
    const code = (row.code || '').trim();
    const title = (row.title || '').trim();
    if (!code || !title) continue;

    const subjectCode = deriveSubjectCode(code);
    const subjectId = await getSubjectId(subjectCode);
    const level = deriveLevel(code);
    const units = deriveUnits(row.hours);
    const termFlags = parseTerms(row.terms);

    // Insert the class row and link any comma-separated instructors.
    const classResult = await pool.query(
      `INSERT INTO classes
        (subject_id, course_code, title, description, prereq, terms_raw, level, units, offered_to,
         has_fall, has_spring, has_iap, has_summer)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        subjectId,
        code,
        title,
        (row.description || '').trim() || null,
        (row.prereq || '').trim() || null,
        (row.terms || '').trim() || null,
        level,
        units,
        (row.offered_to || '').trim() || null,
        termFlags.has_fall,
        termFlags.has_spring,
        termFlags.has_iap,
        termFlags.has_summer,
      ]
    );
    const classId = classResult.rows[0].id;

    const instructorNames = (row.instructor || '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);

    for (const name of instructorNames) {
      const instructorId = await getInstructorId(name);
      if (instructorId) {
        await pool.query(
          `INSERT INTO class_instructors (class_id, instructor_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [classId, instructorId]
        );
      }
    }

    inserted++;
  }

  console.log(`Inserted ${inserted} classes.`);
  await pool.end();
}

run().catch((err) => {
  console.error('Ingest failed:', err);
  process.exit(1);
});
