// GET /classes — paginated list of all classes (debug/admin-style endpoint).
import express from 'express';
import { pool } from '../db/client.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;

    // Join subjects and aggregate instructor names for each class row.
    const result = await pool.query(
      `SELECT c.id, s.code AS subject, c.course_code, c.title, c.level, c.units,
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
       ORDER BY c.id
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({ count: result.rows.length, results: result.rows });
  } catch (err) {
    next(err);
  }
});

export default router;
