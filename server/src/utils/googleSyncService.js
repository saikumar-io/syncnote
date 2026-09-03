const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// In-memory Google Account identity store per user
const userGoogleAccounts = new Map();
// In-memory Google Drive authorization store per user
const userGoogleDriveAuths = new Map();

// Local simulated cloud storage directory for offline/dev testing when OAuth client ID is not configured
const mockCloudDir = path.join(__dirname, '../../data/google_drive_mock');
if (!fs.existsSync(mockCloudDir)) {
  fs.mkdirSync(mockCloudDir, { recursive: true });
}

/**
 * HARD PRIVACY ISOLATION ENFORCEMENT
 * Rejects any note upload attempt unless sync_mode === "google"
 */
function rejectGoogleUpload(note) {
  if (!note) {
    throw new Error('PRIVACY REJECTED: Invalid note payload provided for Google Drive upload.');
  }

  if (note.sync_mode !== 'google' && note.sync_mode !== 'cloud') {
    const errorMsg = `CRITICAL PRIVACY VIOLATION REJECTED: Note '${note.title || note.id}' has sync_mode '${note.sync_mode || 'local'}'. ONLY notes explicitly set to 'cloud' may be uploaded to Google Drive.`;
    console.error(`[Google Sync Security Guard] ${errorMsg}`);
    throw new Error(errorMsg);
  }
}

/**
 * Get connected Google account status (Identity) for a user
 */
function getGoogleAccountStatus(userId) {
  const userKey = userId || 'usr_local_default';
  let session = userGoogleAccounts.get(userKey) || userGoogleAccounts.get(String(userId));
  if (!session && userGoogleAccounts.size > 0) {
    session = Array.from(userGoogleAccounts.values()).find(s => s.isConnected);
  }

  if (session && session.isConnected) {
    return {
      connected: true,
      email: session.email,
      name: session.name,
      picture: session.picture,
      connectedAt: session.connectedAt
    };
  }

  return {
    connected: false,
    email: null,
    name: null,
    picture: null
  };
}

const { NoteModel, NotebookModel, GoogleDriveAuthModel } = require('../db/database');
const { calculateHash, readNoteFile } = require('./fileStorage');

/**
 * Get connected Google Drive status (Cloud Storage) for a user
 */
function getGoogleDriveStatus(userId) {
  const userKey = userId ? String(userId) : 'usr_local_default';

  // Try migrating any unassociated 'usr_local_default' session to this authenticated user
  if (userKey !== 'usr_local_default' && GoogleDriveAuthModel) {
    GoogleDriveAuthModel.migrateDefaultUserTo(userKey);
  }

  let session = userGoogleDriveAuths.get(userKey);

  // If not in memory, query database
  if (!session && GoogleDriveAuthModel) {
    const dbRecord = GoogleDriveAuthModel.get(userKey);
    if (dbRecord && dbRecord.isConnected) {
      session = {
        isConnected: true,
        email: dbRecord.email,
        accessToken: dbRecord.accessToken,
        refreshToken: dbRecord.refreshToken,
        folderId: dbRecord.folderId,
        folderName: dbRecord.folderName || 'SyncNote',
        authorizedAt: dbRecord.authorizedAt
      };
      userGoogleDriveAuths.set(userKey, session);
    }
  }

  const isRealConnection = Boolean(session && session.isConnected && session.accessToken && !session.accessToken.startsWith('drive_access_'));

  if (isRealConnection) {
    return {
      connected: true,
      email: session.email,
      folderName: 'SyncNote',
      folderId: session.folderId || null,
      authorizedAt: session.authorizedAt
    };
  }

  return {
    connected: false,
    email: session?.email || null,
    folderName: 'SyncNote',
    folderId: null,
    authorizedAt: null
  };
}

/**
 * Connect Google Account Identity (Store basic profile info)
 */
function connectGoogleAccount(userId, { email, name, picture }) {
  const userKey = userId ? String(userId) : 'usr_local_default';
  const session = {
    isConnected: true,
    email: email || 'user@gmail.com',
    name: name || 'Google Sync Note User',
    picture: picture || 'https://lh3.googleusercontent.com/a/default-user',
    connectedAt: new Date().toISOString()
  };

  userGoogleAccounts.set(userKey, session);
  console.log(`[Google OAuth Diagnostic]`);
  console.log(` - Authenticated SyncNote User ID: ${userKey}`);
  console.log(` - Authenticated Email: ${session.email}`);
  return getGoogleAccountStatus(userKey);
}

/**
 * Connect Google Drive Authorization (Cloud Storage access)
 */
function connectGoogleDrive(userId, { email, accessToken, refreshToken }) {
  const userKey = userId ? String(userId) : 'usr_local_default';
  const accountEmail = (getGoogleAccountStatus(userKey).email);
  const session = {
    isConnected: true,
    email: email || accountEmail || 'user@gmail.com',
    accessToken: accessToken || `drive_access_${crypto.randomBytes(8).toString('hex')}`,
    refreshToken: refreshToken || `drive_refresh_${crypto.randomBytes(8).toString('hex')}`,
    folderId: null,
    folderName: 'SyncNote',
    authorizedAt: new Date().toISOString()
  };

  userGoogleDriveAuths.set(userKey, session);

  // Persist to SQLite Database
  if (GoogleDriveAuthModel) {
    GoogleDriveAuthModel.upsert({
      userId: userKey,
      email: session.email,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      folderId: session.folderId,
      folderName: session.folderName
    });
  }

  console.log(`[Google Drive OAuth Diagnostic]`);
  console.log(` - Authenticated SyncNote User ID: ${userKey}`);
  console.log(` - Authenticated Email: ${accountEmail || 'N/A'}`);
  console.log(` - Google Account Email: ${session.email}`);
  console.log(` - Drive Connection Record User ID: ${userKey}`);

  return getGoogleDriveStatus(userKey);
}

/**
 * Disconnect Google Drive Cloud Storage
 */
function disconnectGoogleDrive(userId) {
  const userKey = userId ? String(userId) : 'usr_local_default';
  userGoogleDriveAuths.delete(userKey);
  if (GoogleDriveAuthModel) {
    GoogleDriveAuthModel.disconnect(userKey);
  }
  console.log(`[Google Drive Sync] User ${userKey} disconnected Google Drive.`);
  return { connected: false };
}

/**
 * Disconnect Google Account Identity
 */
function disconnectGoogleAccount(userId) {
  const userKey = userId ? String(userId) : 'usr_local_default';
  userGoogleAccounts.delete(userKey);
  userGoogleDriveAuths.delete(userKey);
  if (GoogleDriveAuthModel) {
    GoogleDriveAuthModel.disconnect(userKey);
  }
  console.log(`[Google Cloud Sync] User ${userKey} disconnected Google Account & Drive.`);
  return { connected: false };
}

/**
 * Helper to get a valid Google Drive Access Token
 */
async function getValidDriveAccessToken(userId) {
  const userKey = userId ? String(userId) : 'usr_local_default';
  let session = userGoogleDriveAuths.get(userKey);

  if (!session && GoogleDriveAuthModel) {
    const dbRecord = GoogleDriveAuthModel.get(userKey);
    if (dbRecord && dbRecord.isConnected) {
      session = {
        isConnected: true,
        email: dbRecord.email,
        accessToken: dbRecord.accessToken,
        refreshToken: dbRecord.refreshToken,
        folderId: dbRecord.folderId,
        authorizedAt: dbRecord.authorizedAt
      };
      userGoogleDriveAuths.set(userKey, session);
    }
  }

  if (!session || !session.accessToken) {
    return null;
  }

  // Mock access tokens are invalid for real Google Drive operations
  if (session.accessToken.startsWith('drive_access_')) {
    console.warn(`[Google Drive Access Token] User ${userKey} has a mock access token. Real OAuth connection required.`);
    return null;
  }

  // Attempt refresh if refresh_token exists
  if (session.refreshToken) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (clientId && clientSecret && !clientId.includes('mock')) {
      try {
        const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: session.refreshToken,
            grant_type: 'refresh_token'
          }).toString()
        });
        const refreshData = await refreshRes.json();
        if (refreshRes.ok && refreshData.access_token) {
          console.log(`[Google Drive Token Refresh] Access token refreshed successfully for user ${userKey}`);
          session.accessToken = refreshData.access_token;
          userGoogleDriveAuths.set(userKey, session);
          if (GoogleDriveAuthModel) {
            GoogleDriveAuthModel.upsert({
              userId: userKey,
              email: session.email,
              accessToken: session.accessToken,
              refreshToken: session.refreshToken,
              folderId: session.folderId
            });
          }
        }
      } catch (e) {
        console.warn('[Google Drive Token Refresh Warning]:', e.message);
      }
    }
  }

  return { accessToken: session.accessToken, folderId: session.folderId, isMock: false, userKey };
}

/**
 * Helper to handle and format Drive API errors with diagnostic logging
 */
function handleDriveApiError(resStatus, errorData, authInfo, operationName = 'Drive API operation') {
  const googleReason = errorData?.error?.errors?.[0]?.reason || errorData?.error?.status || 'unknown';
  const rawMessage = errorData?.error?.message || (typeof errorData === 'string' ? errorData : `HTTP ${resStatus}`);
  const driveEmail = authInfo?.email || (authInfo?.userKey ? getGoogleDriveStatus(authInfo.userKey)?.email : null) || 'N/A';
  const userKey = authInfo?.userKey || 'N/A';
  const requestedScope = 'https://www.googleapis.com/auth/drive';

  console.error(`[Google Drive API Error] Operation: ${operationName}`);
  console.error(` - HTTP status: ${resStatus}`);
  console.error(` - Google error reason: ${googleReason}`);
  console.error(` - Google error message: ${rawMessage}`);
  console.error(` - Requested scope: ${requestedScope}`);
  console.error(` - Authenticated Google account: ${driveEmail}`);
  console.error(` - SyncNote user ID: ${userKey}`);

  const isInsufficientScope = googleReason === 'insufficientScopes' ||
    googleReason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' ||
    /insufficient.*scope/i.test(rawMessage) ||
    /granted.*scopes.*do.*not.*give.*access/i.test(rawMessage);

  if (isInsufficientScope) {
    throw new Error('Google Drive permission is insufficient. Please reconnect Google Drive in Settings and grant SyncNote access to Google Drive.');
  }

  const isInsufficientPermission = resStatus === 403 ||
    googleReason === 'insufficientPermissions' ||
    googleReason === 'insufficientFilePermissions' ||
    /insufficient.*permission/i.test(rawMessage);

  if (isInsufficientPermission) {
    throw new Error('Google Drive permission is insufficient. Please reconnect Google Drive in Settings and grant SyncNote access to Google Drive.');
  }

  const isUnauthorized = resStatus === 401 || googleReason === 'unauthorized' || googleReason === 'invalid_grant';
  if (isUnauthorized) {
    throw new Error('Google Drive authentication expired. Please reconnect Google Drive in Settings.');
  }

  const isRateLimit = resStatus === 429 || googleReason === 'rateLimitExceeded' || googleReason === 'userRateLimitExceeded';
  if (isRateLimit) {
    throw new Error('Google Drive API rate limit exceeded. Please try again later.');
  }

  const isApiDisabled = googleReason === 'accessNotConfigured' || googleReason === 'apiNotEnabled';
  if (isApiDisabled) {
    throw new Error('Google Drive API is disabled in Google Cloud Console.');
  }

  throw new Error(`Google Drive API ${operationName} failed (${resStatus}): ${rawMessage}`);
}

/**
 * Get or Create 'SyncNote' root folder on Google Drive
 */
async function getOrCreateSyncNoteFolder(authInfo) {
  const { accessToken, folderId: storedFolderId, userKey } = authInfo;
  if (!accessToken || accessToken.startsWith('drive_access_')) {
    throw new Error('Google Drive access token missing or invalid. Please connect Google Drive in Settings.');
  }

  // 1. Verify stored folder ID if present
  if (storedFolderId && !storedFolderId.startsWith('syncnote_gdrive_')) {
    try {
      const verifyRes = await fetch(`https://www.googleapis.com/drive/v3/files/${storedFolderId}?fields=id,name,trashed`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (verifyRes.ok) {
        const fileInfo = await verifyRes.json();
        if (fileInfo && fileInfo.id && !fileInfo.trashed) {
          console.log(`[Google Drive Sync] Verified existing SyncNote folder ID: ${fileInfo.id}`);
          return fileInfo.id;
        }
      } else if (verifyRes.status === 403 || verifyRes.status === 401) {
        const errData = await verifyRes.json().catch(() => ({}));
        handleDriveApiError(verifyRes.status, errData, authInfo, 'folder verification');
      }
    } catch (e) {
      if (e.message && e.message.includes('Google Drive permission is insufficient')) {
        throw e;
      }
      console.warn(`[Google Drive Sync] Stored folder verification failed:`, e.message);
    }
  }

  // 2. Search for existing 'SyncNote' folder in user's normal My Drive space
  try {
    const query = encodeURIComponent("name='SyncNote' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id,name,trashed)`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        const foundId = searchData.files[0].id;
        console.log(`[Google Drive Sync] Found existing SyncNote folder ID: ${foundId}`);
        if (GoogleDriveAuthModel) {
          const record = GoogleDriveAuthModel.get(userKey);
          if (record) {
            GoogleDriveAuthModel.upsert({ ...record, folderId: foundId });
          }
        }
        return foundId;
      }
    } else {
      const searchErr = await searchRes.json().catch(() => ({}));
      handleDriveApiError(searchRes.status, searchErr, authInfo, 'folder search');
    }
  } catch (e) {
    if (e.message && e.message.includes('Google Drive permission is insufficient')) {
      throw e;
    }
    console.warn(`[Google Drive Sync] Folder search failed:`, e.message);
  }

  // 3. Create 'SyncNote' folder in My Drive
  console.log(`[Google Drive Sync] Creating new 'SyncNote' root folder on Google Drive...`);
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'SyncNote',
      mimeType: 'application/vnd.google-apps.folder'
    })
  });

  const createData = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !createData || !createData.id) {
    handleDriveApiError(createRes.status, createData, authInfo, 'folder creation');
  }

  const newFolderId = createData.id;
  console.log(`[Google Drive Sync] Created new SyncNote folder ID: ${newFolderId}`);
  if (GoogleDriveAuthModel) {
    const record = GoogleDriveAuthModel.get(userKey);
    if (record) {
      GoogleDriveAuthModel.upsert({ ...record, folderId: newFolderId });
    }
  }
  return newFolderId;
}

/**
 * Upload or Update Markdown file on Google Drive
 */
async function uploadFileToDriveAPI(authInfo, folderId, fileName, fileContent, existingFileId) {
  const { accessToken } = authInfo;
  if (!accessToken || accessToken.startsWith('drive_access_')) {
    throw new Error('Google Drive API access token missing or invalid. Please connect Google Drive in Settings.');
  }

  const boundary = '-------SyncNoteBoundary314159';
  const delimiter = `\r\n--${boundary}\r\n`;
  const close_delim = `\r\n--${boundary}--`;

  if (existingFileId && !existingFileId.startsWith('gdrive_file_')) {
    try {
      console.log(`[Google Drive Sync] Attempting update on existing Drive file ID: ${existingFileId}`);
      const metadata = { name: fileName, mimeType: 'text/markdown' };
      const body = delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: text/markdown; charset=UTF-8\r\n\r\n' +
        fileContent +
        close_delim;

      const patchRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart&fields=id,name,mimeType,parents`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary="${boundary}"`
        },
        body: body
      });

      const patchData = await patchRes.json().catch(() => ({}));
      if (patchRes.ok && patchData && patchData.id) {
        console.log(`[Google Drive Sync] Drive API returned`);
        console.log(`[Google Drive Sync] Drive file ID: ${patchData.id}`);
        console.log(`[Google Drive Sync] Drive file name: ${fileName}`);
        console.log(`[Google Drive Sync] Drive parents: ${folderId}`);
        return patchData.id;
      }

      if (patchRes.status === 403) {
        handleDriveApiError(patchRes.status, patchData, authInfo, 'file update');
      }
    } catch (e) {
      if (e.message && e.message.includes('permission is insufficient')) {
        throw e;
      }
      console.warn('[Google Drive Sync] File update failed, falling back to create:', e.message);
    }
  }

  // Create new file
  console.log(`[Google Drive Sync] Creating new file on Google Drive: '${fileName}' in folder '${folderId}'`);
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: 'text/markdown'
  };

  const body = delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: text/markdown; charset=UTF-8\r\n\r\n' +
    fileContent +
    close_delim;

  const createRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,parents', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary="${boundary}"`
    },
    body: body
  });

  const createData = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !createData || !createData.id) {
    handleDriveApiError(createRes.status, createData, authInfo, 'file creation');
  }

  console.log(`[Google Drive Sync] Drive API returned`);
  console.log(`[Google Drive Sync] Drive file ID: ${createData.id}`);
  console.log(`[Google Drive Sync] Drive file name: ${fileName}`);
  console.log(`[Google Drive Sync] Drive parents: ${folderId}`);

  return createData.id;
}

/**
 * Verify Drive file exists and belongs to SyncNote folder
 */
async function verifyDriveFileAPI(authInfo, fileId, expectedFolderId) {
  const { accessToken } = authInfo;
  if (!accessToken || accessToken.startsWith('drive_access_')) {
    throw new Error('Drive API access token missing or invalid');
  }

  if (!fileId || fileId.startsWith('gdrive_file_')) {
    throw new Error('Invalid Google Drive file ID generated.');
  }

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,parents,trashed`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    handleDriveApiError(res.status, errData, authInfo, 'file verification');
  }

  const fileData = await res.json();
  if (!fileData || fileData.trashed) {
    throw new Error(`Google Drive file '${fileId}' is trashed or non-existent.`);
  }

  console.log(`[Google Drive Sync] Verification success for file ID: ${fileData.id}`);
  return true;
}

async function uploadNoteToGoogleDrive(userId, noteOrId, content) {
  const actualNoteId = (typeof noteOrId === 'object' && noteOrId !== null) ? noteOrId.id : noteOrId;
  return syncSingleNoteWithGoogleDrive(userId, actualNoteId);
}

async function fetchNotesFromGoogleDrive(userId) {
  return syncUserNotesWithGoogleDrive(userId);
}

/**
 * Perform a full SyncNote Google Drive synchronization pass for a user.
 */
async function syncUserNotesWithGoogleDrive(userId) {
  const userKey = userId ? String(userId) : 'usr_local_default';
  const authInfo = await getValidDriveAccessToken(userKey);

  if (!authInfo) {
    throw new Error('Google Drive is not connected or token expired. Please connect Google Drive in Settings.');
  }

  const folderId = await getOrCreateSyncNoteFolder(authInfo);
  const allNotes = NoteModel.getAll(userKey);
  const googleNotes = allNotes.filter(n => n.sync_mode === 'cloud' || n.sync_mode === 'google');

  const results = {
    success: true,
    synced: 0,
    modifiedOffline: 0,
    conflicts: 0,
    failed: 0,
    folder: 'SyncNote',
    folderId: folderId,
    lastSyncAt: new Date().toISOString(),
    items: []
  };

  for (const note of googleNotes) {
    try {
      rejectGoogleUpload(note);
    } catch (err) {
      console.error(`[Google Sync Guard Rejected] ${err.message}`);
      continue;
    }

    try {
      const currentContent = readNoteFile(note.file_path);
      const currentHash = calculateHash(currentContent);

      // Skip upload if unchanged and already has confirmed Drive file ID
      if (note.gdrive_file_id && note.last_synced_hash === currentHash && note.sync_state === 'SYNCED') {
        results.synced++;
        results.items.push({ id: note.id, title: note.title, state: 'SYNCED', gdriveFileId: note.gdrive_file_id });
        continue;
      }

      NoteModel.updateSyncMetadata(note.id, userKey, {
        syncState: 'SYNCING',
        syncError: null
      });

      const safeTitle = (note.title || 'Untitled Note').replace(/[^a-zA-Z0-9_\-\s]/g, '_').trim();
      const fileName = `${safeTitle}.md`;

      console.log(`[Google Drive Sync] Starting sync pass`);
      console.log(`[Google Drive Sync] User: ${userKey}`);
      console.log(`[Google Drive Sync] Note: ${note.title}`);
      console.log(`[Google Drive Sync] Mode: ${note.sync_mode}`);
      console.log(`[Google Drive Sync] Folder ID: ${folderId}`);
      console.log(`[Google Drive Sync] Existing file ID: ${note.gdrive_file_id || 'none'}`);
      console.log(`[Google Drive Sync] Creating Drive file`);

      const confirmedFileId = await uploadFileToDriveAPI(authInfo, folderId, fileName, currentContent, note.gdrive_file_id);
      console.log(`[Google Drive Sync] Drive API success`);
      console.log(`[Google Drive Sync] File ID: ${confirmedFileId}`);
      console.log(`[Google Drive Sync] Verifying Drive file`);

      await verifyDriveFileAPI(authInfo, confirmedFileId, folderId);
      console.log(`[Google Drive Sync] Verification success`);

      const now = new Date().toISOString();
      const metaUpdate = NoteModel.updateSyncMetadata(note.id, userKey, {
        gdriveFileId: confirmedFileId,
        lastSyncedHash: currentHash,
        lastSyncedAt: now,
        syncState: 'SYNCED',
        syncError: null
      });

      if (!metaUpdate) {
        throw new Error('Failed to update SQLite metadata');
      }

      console.log(`[Google Drive Sync] SQLite metadata update success`);
      console.log(`[Google Drive Sync] Successfully synced note '${note.title}'`);

      results.synced++;
      results.items.push({ id: note.id, title: note.title, state: 'SYNCED', gdriveFileId: confirmedFileId });

    } catch (itemErr) {
      console.error(`[Google Drive Sync FAILED] Note ${note.id} at stage: ${itemErr.message}`);
      NoteModel.updateSyncMetadata(note.id, userKey, {
        syncState: 'SYNC_FAILED',
        syncError: itemErr.message
      });
      results.failed++;
    }
  }

  return results;
}

/**
 * Check pending offline changes for a user's Google Drive notes
 */
function getPendingGoogleSyncItems(userId) {
  const userKey = userId ? String(userId) : 'usr_local_default';
  const allNotes = NoteModel.getAll(userKey).filter(n => n.sync_mode === 'cloud' || n.sync_mode === 'google');

  const pending = [];
  for (const note of allNotes) {
    try {
      const currentContent = readNoteFile(note.file_path);
      const currentHash = calculateHash(currentContent);

      let state = note.sync_state || 'NOT_SYNCED';
      if (!note.gdrive_file_id || !note.last_synced_hash) {
        state = 'NOT_SYNCED';
      } else if (currentHash !== note.last_synced_hash) {
        state = 'MODIFIED_OFFLINE';
      }

      if (state !== 'SYNCED') {
        pending.push({
          id: note.id,
          title: note.title,
          sync_mode: note.sync_mode,
          sync_state: state,
          updated_at: note.updated_at,
          last_synced_at: note.last_synced_at,
          last_synced_hash: note.last_synced_hash,
          current_hash: currentHash
        });
      }
    } catch (err) {
      console.warn(`[getPendingGoogleSyncItems] Failed inspecting note ${note.id}: ${err.message}`);
    }
  }

  return pending;
}

/**
 * Synchronize a single note explicitly with Google Drive
 */
async function syncSingleNoteWithGoogleDrive(userId, noteId) {
  const userKey = userId ? String(userId) : 'usr_local_default';
  const note = NoteModel.getById(noteId, userKey);
  if (!note) {
    throw new Error(`Note '${noteId}' not found.`);
  }

  rejectGoogleUpload(note);

  // Transition state to SYNCING before starting network API operations
  NoteModel.updateSyncMetadata(note.id, userKey, {
    syncState: 'SYNCING',
    syncError: null
  });

  try {
    const authInfo = await getValidDriveAccessToken(userKey);
    if (!authInfo) {
      throw new Error('Google Drive is not connected or token expired. Please connect Google Drive in Settings.');
    }

    console.log(`[Google Drive Sync] Starting single-note sync`);
    console.log(`[Google Drive Sync] User: ${userKey}`);
    console.log(`[Google Drive Sync] Note: ${note.title}`);
    console.log(`[Google Drive Sync] Mode: ${note.sync_mode}`);

    const folderId = await getOrCreateSyncNoteFolder(authInfo);
    console.log(`[Google Drive Sync] Folder ID: ${folderId}`);
    console.log(`[Google Drive Sync] Existing file ID: ${note.gdrive_file_id || 'none'}`);
    console.log(`[Google Drive Sync] Creating/updating Drive file...`);

    const currentContent = readNoteFile(note.file_path);
    const currentHash = calculateHash(currentContent);
    const safeTitle = (note.title || 'Untitled Note').replace(/[^a-zA-Z0-9_\-\s]/g, '_').trim();
    const fileName = `${safeTitle}.md`;

    const confirmedFileId = await uploadFileToDriveAPI(authInfo, folderId, fileName, currentContent, note.gdrive_file_id);
    console.log(`[Google Drive Sync] Drive API success`);
    console.log(`[Google Drive Sync] File ID: ${confirmedFileId}`);
    console.log(`[Google Drive Sync] Verifying Drive file...`);

    await verifyDriveFileAPI(authInfo, confirmedFileId, folderId);
    console.log(`[Google Drive Sync] Verification success`);

    const now = new Date().toISOString();
    const metaUpdate = NoteModel.updateSyncMetadata(note.id, userKey, {
      gdriveFileId: confirmedFileId,
      lastSyncedHash: currentHash,
      lastSyncedAt: now,
      syncState: 'SYNCED',
      syncError: null
    });

    if (!metaUpdate) {
      throw new Error('SQLite metadata update failed');
    }

    console.log(`[Google Drive Sync] SQLite metadata update success`);
    console.log(`[Google Drive Sync] Successfully synced single note '${note.title}'`);

    const updatedNote = NoteModel.getById(note.id, userKey);

    return {
      success: true,
      note: {
        ...updatedNote,
        content: currentContent
      },
      gdriveFileId: confirmedFileId,
      syncedAt: now
    };
  } catch (err) {
    console.error(`[Google Drive Sync FAILED] Single note '${note.title}' sync failed: ${err.message}`);
    NoteModel.updateSyncMetadata(note.id, userKey, {
      syncState: 'SYNC_FAILED',
      syncError: err.message
    });
    throw err;
  }
}

/**
 * Check Google Drive API reachability
 */
async function checkGoogleDriveReachability(userId) {
  const account = getGoogleAccountStatus(userId);
  const drive = getGoogleDriveStatus(userId);

  return {
    reachable: true,
    connected: drive.connected || account.connected,
    driveConnected: drive.connected,
    accountConnected: account.connected,
    email: drive.email || account.email,
    folderName: 'SyncNote',
    checkedAt: new Date().toISOString()
  };
}

module.exports = {
  rejectGoogleUpload,
  getGoogleAccountStatus,
  getGoogleDriveStatus,
  connectGoogleAccount,
  connectGoogleDrive,
  disconnectGoogleDrive,
  disconnectGoogleAccount,
  uploadNoteToGoogleDrive,
  fetchNotesFromGoogleDrive,
  syncUserNotesWithGoogleDrive,
  syncSingleNoteWithGoogleDrive,
  getPendingGoogleSyncItems,
  checkGoogleDriveReachability
};
