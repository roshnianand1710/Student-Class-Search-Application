// Express app entry point — wires middleware, routes, and error handling.
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import classesRouter from './routes/classes.js';
import searchRouter from './routes/search.js';

dotenv.config();

const app = express();
app.use(cors()); // Allow the Vite frontend to call this API from another port.
app.use(express.json()); // Parse JSON request bodies.

// Simple liveness check for deploys and local dev.
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/classes', classesRouter); // Paginated raw class listing.
app.use('/search', searchRouter); // Main chat/search endpoint used by the UI.

// Central error handler — catches failures from async route handlers.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error', detail: err.message });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
