const path = require('path');
const dotenv = require('dotenv');

// 1. Load non-sensitive .env configuration from server/.env
dotenv.config({ path: path.join(__dirname, '../.env') });

// 2. Load sensitive credentials from server/.env.secrets (overrides placeholders)
dotenv.config({ path: path.join(__dirname, '../.env.secrets'), override: true });

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const healthRouter = require('./routes/health');
const authRouter = require('./routes/auth');
const notesRouter = require('./routes/notes');
const notebooksRouter = require('./routes/notebooks');
const syncRouter = require('./routes/sync');
const lanRouter = require('./routes/lan');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS & Cookie Parser
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(cookieParser());
app.use(express.json());

// Register API Routes
app.use('/api', healthRouter);
app.use('/api/auth', authRouter);
app.use('/auth', authRouter);
app.use('/api/notes', notesRouter);
app.use('/api/version-control', notesRouter);
app.use('/api/notebooks', notebooksRouter);
app.use('/api/sync', syncRouter);
app.use('/api/lan', lanRouter);

// API Root Index Endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'SyncNote API Server',
    status: 'running',
    healthCheck: `http://localhost:${PORT}/api/health`
  });
});

// Start Express Listener
app.listen(PORT, () => {
  console.log(`=================================`);
  console.log(` SyncNote Server Running Port: ${PORT}`);
  console.log(` Health URL: http://localhost:${PORT}/api/health`);
  console.log(` Environment Diagnostics:`);
  console.log(` - GOOGLE_CLIENT_ID: ${process.env.GOOGLE_CLIENT_ID ? 'LOADED' : 'NOT SET'}`);
  console.log(` - GOOGLE_CLIENT_SECRET: ${process.env.GOOGLE_CLIENT_SECRET ? 'LOADED' : 'NOT SET'}`);
  console.log(` - GOOGLE_CALLBACK_URL: ${process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/callback'}`);
  console.log(` - FRONTEND_URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
  console.log(`=================================`);
});
