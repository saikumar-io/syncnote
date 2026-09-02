# SyncNote ⚡

> **An Offline-First Intelligent Knowledge Management Platform with AI-Assisted Semantic Synchronization**

---

## 💻 Setup on a New Windows Laptop

Follow these steps to set up SyncNote on a new Windows laptop from scratch:

### 1. Requirements
Ensure the following tools are installed on your system:
- **Git**: [https://git-scm.com/](https://git-scm.com/)
- **Node.js** (v18 or higher): [https://nodejs.org/](https://nodejs.org/)
- **Docker Desktop**: [https://www.docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)

---

### 2. First-Time Setup Workflow

Open PowerShell, clone the repository, and run the automated setup script:

```powershell
git clone <repository-url>
cd syncnotes
.\setup.ps1
```

#### What `setup.ps1` automates:
- Checks **Node.js**, **npm**, and **Docker** availability.
- Launches **Docker Desktop** automatically if installed but stopped.
- Detects or starts the **PostgreSQL container** (`syncnote-postgres` on port `5432`) using Docker Compose.
- Installs all dependencies for root monorepo, server, and client.
- Creates required local data directories (`./data`, `./server/data`).
- Initializes the local **SQLite database** (`server/data/syncnote.db`).
- Generates a **machine-specific cryptographic device identity** for LAN sync pairing (`server/data/device_identity.json`).
- Prepares local `.env` and `.env.secrets` files without overwriting existing configurations.

---

### 3. Four-File Environment Architecture

SyncNote uses a 4-file environment system to separate tracked documentation templates from private local secrets:

| File Name | Purpose | Git Tracking | Description |
| :--- | :--- | :--- | :--- |
| **`.env.example`** | Documentation Template | **Committed** | Documents ALL non-sensitive variable names and default local settings. Contains safe placeholders only. |
| **`.env.secrets.example`** | Secret Template | **Committed** | Documents sensitive variable names (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `COOKIE_SECRET`). Contains placeholders only. |
| **`.env`** | Local Non-Sensitive Config | **Ignored** | Local non-sensitive settings (ports, URLs, DB names). |
| **`.env.secrets`** | Local Real Secrets | **Ignored** | Contains your actual secret credentials. **NEVER committed to Git**. |

---

### 4. Second Laptop Setup Workflow

To set up a second trusted development laptop:

1. Clone the repository and run setup:
   ```powershell
   git clone <repository-url>
   cd syncnotes
   .\setup.ps1
   ```
2. **Securely copy your existing `.env.secrets` file** from your primary development laptop (or password manager) into the `syncnotes` root folder (and `server/` directory).
3. Start the application:
   ```powershell
   .\start.ps1
   ```

> [!IMPORTANT]
> **Private Secret Backup Guidelines**:
> Store `.env.secrets` securely using a password manager, encrypted USB drive, or private vault. **NEVER commit `.env.secrets` or real credentials to Git**, even if the repository is private.

---

### 5. Application Startup

To start SyncNote after setup, run either:

```powershell
.\start.ps1
```
*or:*
```bash
npm run dev
```

This command launches:
- **PostgreSQL Container**: Running on `localhost:5432` (`syncnote-postgres`)
- **Express API Backend**: Running on `http://localhost:5000`
- **React Frontend**: Running on `http://localhost:5173`

---

### 6. Google OAuth & Cloud Sync Configuration

1. Obtain your Google OAuth credentials from [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Add the credentials to `.env.secrets`:
   ```ini
   GOOGLE_CLIENT_ID=your_actual_google_client_id
   GOOGLE_CLIENT_SECRET=your_actual_google_client_secret
   ```
3. Authorized Callbacks in Google Cloud Console must match:
   - Login: `http://localhost:5000/api/auth/google/callback`
   - Drive Sync: `http://localhost:5000/api/auth/google/drive/callback`
4. Connect Google Drive within the application UI via:  
   **SyncNote → Settings → Google Drive → Connect**

---

### 7. Machine Isolation & Local Data Storage

- **SQLite Database**: Each computer maintains its own local SQLite database (`server/data/syncnote.db`). SQLite files are excluded from Git.
- **Cryptographic Device Identity**: Each laptop automatically generates its own ECDH key pair (`server/data/device_identity.json`) upon setup. Private keys are encrypted at rest using machine-derived hashes.
- **PostgreSQL Container**: Run through Docker container `syncnote-postgres`. Schema migrations execute automatically on server startup.
- **LAN Pairing**: Pair multiple laptops explicitly using the LAN Settings tab in SyncNote.

---

## 📂 Repository Structure

```
syncnotes/
├── client/                     # React + Vite Frontend
│   └── package.json
│
├── server/                     # Express.js Backend Server
│   ├── src/
│   │   ├── db/                 # PostgreSQL (postgres.js) & SQLite (database.js)
│   │   ├── routes/             # Auth, Notes, Sync, LAN endpoints
│   │   └── utils/              # Google Sync Service, Device Crypto (ECDH)
│   ├── data/                   # Local SQLite & device identity (Git ignored)
│   └── package.json
│
├── scripts/
│   └── dev-start.js            # Dev launcher (loads .env then .env.secrets)
│
├── setup.ps1                   # Automated 1-command Windows setup script
├── start.ps1                   # Convenient daily startup script
├── docker-compose.yml          # Docker service definition for PostgreSQL 16
├── .env.example                # Tracked environment variable reference template
├── .env.secrets.example        # Tracked sensitive secrets template (placeholders only)
├── package.json                # Monorepo root script launcher
└── README.md                   # Project documentation
```

---

## 📡 Live Application Endpoints

- **Frontend Application**: `http://localhost:5173`
- **Backend Health Check**: `http://localhost:5000/api/health`
- **Backend Sync Status**: `http://localhost:5000/api/sync/gdrive/status`
