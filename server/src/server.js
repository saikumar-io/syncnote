const express = require('express');
const cors = require('cors');
require('dotenv').config();

const healthRouter = require('./routes/health');
const notesRouter = require('./routes/notes');
const notebooksRouter = require('./routes/notebooks');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for frontend integration
app.use(cors());
app.use(express.json());

// Register API Routes
app.use('/api', healthRouter);
app.use('/api/notes', notesRouter);
app.use('/api/notebooks', notebooksRouter);

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
  console.log(`=================================`);
});
