// POST /search — AI intent routing plus class search or chat reply.
import express from 'express';
import { parseQuery } from '../services/aiParser.js';
import { searchClasses, getDatasetStats } from '../services/classQuery.js';

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const { query, history } = req.body;

    // Reject empty or missing queries before hitting the AI or database.
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'A non-empty "query" string is required.' });
    }

    const stats = await getDatasetStats(); // Live counts for factual chat answers.
    const parsed = await parseQuery(query.trim(), stats, Array.isArray(history) ? history : []);

    // Conversational path — return a plain-text reply from the LLM.
    if (parsed.intent === 'chat') {
      return res.json({
        intent: 'chat',
        reply: parsed.reply,
        interpretedVia: parsed.source,
      });
    }

    // Search path — run SQL with extracted filters and return matching classes.
    const results = await searchClasses(parsed.filters);
    res.json({
      intent: 'search',
      interpreted: parsed.filters,
      interpretedVia: parsed.source,
      count: results.length,
      results,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
