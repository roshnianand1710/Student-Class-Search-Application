// POST /search — AI intent routing plus class search or chat reply.
import express from 'express';
import { parseQuery, generateChatReply } from '../services/aiParser.js';
import {
  searchClasses,
  getDatasetStats,
  getExtendedStats,
  getChatContext,
  resolveChatFilters,
  executeChatQuery,
  formatChatReplyFromSql,
  detectForcedChatIntent,
  detectForcedSearchIntent,
  extractSearchFiltersFromQuery,
  normalizeSearchKeyword,
  shouldRetryAsChat,
  isComplexOrAggregateQuery,
} from '../services/classQuery.js';

const router = express.Router();

async function handleChatResponse(
  trimmedQuery,
  normalizedHistory,
  parsed,
  chatContext,
  stats,
  extendedStats
) {
  const filters = resolveChatFilters(parsed.filters, chatContext, trimmedQuery, normalizedHistory);
  const sqlResult = await executeChatQuery(
    filters,
    parsed.questionType,
    chatContext,
    trimmedQuery,
    stats,
    extendedStats,
    { compareInstructors: parsed.compareInstructors }
  );

  const complex = isComplexOrAggregateQuery(trimmedQuery, parsed, sqlResult);
  const deterministic = formatChatReplyFromSql(trimmedQuery, sqlResult, chatContext, stats);

  let reply = deterministic;
  if (!reply && complex) {
    reply = await generateChatReply(
      trimmedQuery,
      normalizedHistory,
      stats,
      extendedStats,
      sqlResult,
      chatContext
    );
  }
  if (!reply) reply = deterministic;

  if (!reply) {
    reply = 'I could not find enough information in the catalog to answer that question.';
  }

  return {
    intent: 'chat',
    reply,
    interpreted: filters,
    questionType: parsed.questionType,
    sqlResult: {
      count: sqlResult.count,
      undergradCount: sqlResult.undergradCount,
      gradCount: sqlResult.gradCount,
      resultCount: sqlResult.results?.length ?? 0,
      aggregates: sqlResult.aggregates,
    },
    interpretedVia: parsed.source,
  };
}

router.post('/', async (req, res, next) => {
  try {
    const { query, history } = req.body;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'A non-empty "query" string is required.' });
    }

    const trimmedQuery = query.trim();
    const normalizedHistory = Array.isArray(history) ? history : [];
    const [stats, extendedStats, chatContext] = await Promise.all([
      getDatasetStats(),
      getExtendedStats(),
      getChatContext(trimmedQuery, normalizedHistory),
    ]);

    const forcedChat = detectForcedChatIntent(trimmedQuery);
    let parsed;

    if (forcedChat) {
      parsed = { ...forcedChat, source: 'rule' };
    } else {
      parsed = await parseQuery(trimmedQuery, stats, normalizedHistory, extendedStats, chatContext);

      if ((parsed.source === 'fallback' || parsed.intent === 'chat') && !detectForcedChatIntent(trimmedQuery)) {
        const forcedSearch = await detectForcedSearchIntent(trimmedQuery);
        if (forcedSearch) {
          parsed = { ...forcedSearch, source: 'rule-fallback' };
        }
      }
    }

    if (parsed.intent === 'chat') {
      return res.json(
        await handleChatResponse(
          trimmedQuery,
          normalizedHistory,
          parsed,
          chatContext,
          stats,
          extendedStats
        )
      );
    }

    const searchFilters = { ...parsed.filters };
    if (searchFilters.keyword) {
      searchFilters.keyword = normalizeSearchKeyword(searchFilters.keyword);
    }

    let results = await searchClasses(searchFilters);
    if (results.length === 0) {
      const enriched = await extractSearchFiltersFromQuery(trimmedQuery);
      if (enriched.instructor && !searchFilters.instructor) {
        Object.assign(searchFilters, enriched);
        results = await searchClasses(searchFilters);
      } else if (parsed.filters?.keyword) {
        const cleaned = normalizeSearchKeyword(parsed.filters.keyword);
        if (cleaned && cleaned !== searchFilters.keyword) {
          results = await searchClasses({ ...searchFilters, keyword: cleaned });
          if (results.length) searchFilters.keyword = cleaned;
        }
      }
    }

    const retry = shouldRetryAsChat(trimmedQuery, parsed, results, chatContext);

    if (retry) {
      return res.json(
        await handleChatResponse(
          trimmedQuery,
          normalizedHistory,
          { ...retry, source: 'rule-fallback' },
          chatContext,
          stats,
          extendedStats
        )
      );
    }

    res.json({
      intent: 'search',
      interpreted: searchFilters,
      interpretedVia: parsed.source,
      count: results.length,
      results,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
