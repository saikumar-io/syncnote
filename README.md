# SyncNote ⚡

> **An Offline-First Intelligent Knowledge Management Platform with AI-Assisted Semantic Synchronization**
> 
> *B.Tech Major Project — Phase 1 Scaffold*

---

## 📌 Project Architecture (Phase 1)

Phase 1 establishes the foundational monorepo structure for SyncNote, bringing together:
- **Frontend**: React + Vite (JavaScript / `.jsx`) with modern Obsidian/Craft-inspired glassmorphic UI.
- **Backend**: Express.js (Node.js) API providing health monitoring (`GET /api/health`).
- **Orchestration**: Root `package.json` with `concurrently` to start both frontend and backend concurrently via `npm run dev`.

---

## 📂 Final Folder Structure

```
syncnotes/
├── client/                     # Frontend (React + Vite + JS)
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Header.jsx      # Topbar branding, search, sync status badge
│   │   │   ├── Sidebar.jsx     # Navigation items & + New Note button
│   │   │   ├── MainContent.jsx # Hero card & notes grid
│   │   │   └── HealthBadge.jsx # Real-time Express /api/health connector
│   │   ├── App.jsx             # Main React app container & state management
│   │   ├── main.jsx            # React root entry point
│   │   └── index.css           # Modern CSS design tokens & glassmorphic styles
│   ├── index.html              # HTML base & Google Fonts (Inter / Plus Jakarta Sans)
│   ├── vite.config.js          # Vite config & API proxy (/api -> http://localhost:5000)
│   └── package.json            # Frontend dependencies (React, Lucide icons)
│
├── server/                     # Backend (Node.js + Express)
│   ├── src/
│   │   ├── routes/
│   │   │   └── health.js       # GET /api/health endpoint
│   │   └── server.js           # Express app setup & CORS configuration
│   ├── .env                    # Environment variables (PORT=5000)
│   └── package.json            # Server dependencies (Express, CORS, Nodemon)
│
├── package.json                # Root monorepo script launcher (concurrently)
└── README.md                   # Project documentation & Phase 1 instructions
```

---

## 🚀 How to Run the Project

### 1. Install Dependencies
Run from the root directory (`syncnotes`):
```bash
npm run install:all
```
*Or install individually:*
```bash
npm install                     # Installs root devDependencies (concurrently)
cd server && npm install && cd ..  # Installs backend dependencies
cd client && npm install && cd ..  # Installs frontend dependencies
```

### 2. Start Frontend & Backend Together
Run from the root directory:
```bash
npm run dev
```

This single command launches:
- **Express Server**: Runs on `http://localhost:5000`
- **React Frontend**: Runs on `http://localhost:5173`

---

## 🛠️ Folder & Component Responsibilities

1. **`client/`**:
   - Manages all user interaction, UI components, offline state, and visual presentation.
   - Built purely with React `.jsx` and standard JavaScript.
   - Uses `vite.config.js` to proxy `/api` calls directly to the Express backend port `5000`.

2. **`server/`**:
   - Handles backend service APIs.
   - Exposes `GET /api/health` which responds with `{ "status": "ok", "timestamp": "...", "service": "SyncNote API Server" }`.
   - Uses `cors` middleware to safely permit cross-origin HTTP requests from Vite dev server.

3. **Root (`/`)**:
   - Acts as the monorepo coordinator.
   - Leverages `concurrently` to run both services simultaneously without needing multiple terminal windows.

---

## 📡 Frontend ↔ Backend Communication Flow

1. When the user opens the frontend (`http://localhost:5173`), `App.jsx` triggers `fetch('/api/health')` on initial mount.
2. Vite's dev server proxies request `/api/health` to `http://localhost:5000/api/health`.
3. Express router (`server/src/routes/health.js`) handles the request and sends back a JSON payload:
   ```json
   {
     "status": "ok",
     "timestamp": "2026-08-15T23:45:00.000Z",
     "service": "SyncNote API Server",
     "version": "1.0.0"
   }
   ```
4. The React `HealthBadge` component processes the JSON response and updates the UI indicator to **Connected (Express API Operational)** in real time.

---

## ✅ How to Verify Everything Works

1. **Backend Endpoint Verification**:
   - Open browser or terminal to `http://localhost:5000/api/health`
   - You should see `{ "status": "ok", ... }` JSON response.

2. **Frontend UI Verification**:
   - Open `http://localhost:5173`
   - Verify the topbar shows **SyncNote Branding**, **Search Bar**, and **Sync status badge**.
   - Verify the **Sidebar** contains navigation items (*All Notes*, *Favorites*, *Notebooks*, *Tags*) and a **+ New Note** button.
   - Verify the connection status card displays **Backend Endpoint: Connected (Express API Operational)**.
   - Click **Test /api/health** button to test live communication.
   - Click **New Note** to test creating notes locally.
