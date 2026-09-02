const express = require('express');
const router = express.Router();
const { UserModel } = require('../db/database');
const { PgUserModel, PgDeviceModel } = require('../db/postgres');
const {
  hashPassword,
  comparePassword,
  generateToken,
  validateRegistrationInput
} = require('../utils/auth');
const { requireAuth, optionalAuth } = require('../middleware/authMiddleware');

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
};

/**
 * POST /api/auth/register
 */
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, confirmPassword, deviceId, deviceName, deviceType } = req.body;

    const validation = validateRegistrationInput({ username, email, password, confirmPassword });
    if (!validation.isValid) {
      return res.status(400).json({ error: 'Validation failed', details: validation.errors });
    }

    // Check duplicate email
    const existingEmail = await PgUserModel.findByEmail(email);
    if (existingEmail) {
      return res.status(400).json({ error: 'An account with this email address already exists.' });
    }

    // Check duplicate username
    const existingUsername = await PgUserModel.findByUsername(username);
    if (existingUsername) {
      return res.status(400).json({ error: 'This username is already taken. Please choose another.' });
    }

    const passwordHash = await hashPassword(password);

    const newUser = await PgUserModel.create({
      email,
      username,
      passwordHash
    });

    // Safely re-assign any existing unowned local notes/notebooks in SQLite to this registered user!
    UserModel.assignUnownedDataToUser(newUser.id);

    // Register Device
    const finalDeviceId = deviceId || `device_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const device = await PgDeviceModel.upsert({
      id: finalDeviceId,
      userId: newUser.id,
      deviceName: deviceName || 'Desktop PC',
      deviceType: deviceType || 'desktop'
    });

    // Issue Token
    const token = generateToken({ id: newUser.id, email: newUser.email, username: newUser.username });
    res.cookie('syncnote_token', token, COOKIE_OPTIONS);

    return res.status(201).json({
      user: {
        id: newUser.id,
        email: newUser.email,
        username: newUser.username,
        created_at: newUser.created_at
      },
      device,
      token
    });
  } catch (err) {
    console.error('Registration Error:', err);
    return res.status(500).json({ error: 'Failed to create account. Please try again.' });
  }
});

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  try {
    const { identifier, password, deviceId, deviceName, deviceType } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Please enter your email/username and password.' });
    }

    // Search by email or username
    const user = identifier.includes('@')
      ? await PgUserModel.findByEmail(identifier)
      : await PgUserModel.findByUsername(identifier);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials. Please check your username/email and password.' });
    }

    const isMatch = await comparePassword(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials. Please check your username/email and password.' });
    }

    // Safely assign any leftover unowned local notes/notebooks
    UserModel.assignUnownedDataToUser(user.id);

    // Register/Update Device
    const finalDeviceId = deviceId || `device_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const device = await PgDeviceModel.upsert({
      id: finalDeviceId,
      userId: user.id,
      deviceName: deviceName || 'Desktop PC',
      deviceType: deviceType || 'desktop'
    });

    const token = generateToken({ id: user.id, email: user.email, username: user.username });
    res.cookie('syncnote_token', token, COOKIE_OPTIONS);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        created_at: user.created_at
      },
      device,
      token
    });
  } catch (err) {
    console.error('Login Error:', err);
    return res.status(500).json({ error: 'Authentication failed. Please try again.' });
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  res.clearCookie('syncnote_token', COOKIE_OPTIONS);
  return res.json({ success: true, message: 'Logged out successfully.' });
});

/**
 * GET /api/auth/me
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await PgUserModel.findById(req.user.id);
    if (!user) {
      res.clearCookie('syncnote_token', COOKIE_OPTIONS);
      return res.status(401).json({ error: 'User not found.' });
    }

    const devices = await PgDeviceModel.getByUserId(req.user.id);
    const primaryDevice = devices.length > 0 ? devices[0] : null;

    return res.json({
      user,
      device: primaryDevice
    });
  } catch (err) {
    console.error('Me Auth Error:', err);
    return res.status(500).json({ error: 'Failed to fetch session user.' });
  }
});

/**
 * POST /api/auth/change-password
 */
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Please enter current and new passwords.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'New passwords do not match.' });
    }

    const dbUser = await PgUserModel.findByEmail(req.user.email);
    if (!dbUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const isMatch = await comparePassword(currentPassword, dbUser.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Incorrect current password.' });
    }

    const newHash = await hashPassword(newPassword);
    await PgUserModel.updatePassword(req.user.id, newHash);

    // Re-issue fresh token
    const token = generateToken({ id: dbUser.id, email: dbUser.email, username: dbUser.username });
    res.cookie('syncnote_token', token, COOKIE_OPTIONS);

    return res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    console.error('Change Password Error:', err);
    return res.status(500).json({ error: 'Failed to update password.' });
  }
});

/**
 * PUT /api/auth/profile
 */
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { username, deviceName, deviceId } = req.body;

    if (username) {
      const existing = await PgUserModel.findByUsername(username);
      if (existing && existing.id !== req.user.id) {
        return res.status(400).json({ error: 'Username is already taken.' });
      }
      await PgUserModel.updateProfile(req.user.id, { username });
    }

    if (deviceName && deviceId) {
      await PgDeviceModel.upsert({
        id: deviceId,
        userId: req.user.id,
        deviceName
      });
    }

    const updatedUser = await PgUserModel.findById(req.user.id);
    const devices = await PgDeviceModel.getByUserId(req.user.id);

    return res.json({
      user: updatedUser,
      device: devices[0] || null
    });
  } catch (err) {
    console.error('Profile Update Error:', err);
    return res.status(500).json({ error: 'Failed to update profile.' });
  }
});

/**
 * GOOGLE ACCOUNT OAUTH ENDPOINTS
 */
/**
 * GOOGLE ACCOUNT & GOOGLE DRIVE SEPARATE OAUTH ENDPOINTS
 */
const {
  getGoogleAccountStatus,
  getGoogleDriveStatus,
  connectGoogleAccount,
  connectGoogleDrive,
  disconnectGoogleDrive,
  disconnectGoogleAccount
} = require('../utils/googleSyncService');

// 1. GOOGLE LOGIN (IDENTITY ONLY)
router.get(['/google', '/api/auth/google'], (req, res) => {
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/callback';

  console.log(`[OAuth] Using callback URI: ${redirectUri}`);

  if (!clientId || clientId.trim() === '' || clientId.includes('mock')) {
    console.error('[OAuth] GOOGLE_CLIENT_ID missing or invalid in server environment');
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(400).json({ error: 'Google OAuth is not configured on server (GOOGLE_CLIENT_ID missing in .env).' });
    }
    return res.redirect(`${FRONTEND_URL}/login?error=google_not_configured`);
  }

  // Minimum required identity scopes
  const scope = 'openid email profile';
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=select_account`;

  console.log(`[OAuth] Generated authorization URL: ${authUrl}`);

  return res.redirect(authUrl);
});

router.get(['/google/callback', '/api/auth/google/callback'], async (req, res) => {
  console.log('[OAuth] Callback received');
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
  const { code, error } = req.query;

  if (error || !code) {
    const errorMsg = error || 'Google authorization was cancelled';
    console.error(`[OAuth] Authentication failed: ${errorMsg}`);
    console.log(`[OAuth] Redirecting to ${FRONTEND_URL}/login?error=${encodeURIComponent(errorMsg)}`);
    return res.redirect(`${FRONTEND_URL}/login?error=${encodeURIComponent(errorMsg)}`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/callback';

  if (!clientId || !clientSecret) {
    console.error('[OAuth] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
    return res.redirect(`${FRONTEND_URL}/login?error=google_not_configured`);
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      }).toString()
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      const errorMsg = tokenData.error_description || tokenData.error || 'Failed to exchange authorization code with Google';
      console.error('[OAuth Token Error]:', errorMsg);
      console.log(`[OAuth] Redirecting to ${FRONTEND_URL}/login?error=...`);
      return res.redirect(`${FRONTEND_URL}/login?error=${encodeURIComponent(errorMsg)}`);
    }

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    const googleProfile = await userRes.json();
    if (!userRes.ok || !googleProfile.email) {
      console.error('[OAuth UserInfo Error]: Failed to fetch Google user profile');
      return res.redirect(`${FRONTEND_URL}/login?error=Failed+to+fetch+Google+user+profile`);
    }

    console.log(`[OAuth] Google user authenticated: ${googleProfile.email}`);

    const user = await PgUserModel.findOrCreateGoogleUser({
      googleId: googleProfile.id || googleProfile.sub,
      email: googleProfile.email,
      name: googleProfile.name || googleProfile.given_name,
      avatarUrl: googleProfile.picture
    });

    console.log(`[OAuth] PostgreSQL user found/created: ${user.id}`);

    const deviceId = `device_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const device = await PgDeviceModel.upsert({
      id: deviceId,
      userId: user.id,
      deviceName: 'Web Browser (Google Login)',
      deviceType: 'desktop'
    });

    try {
      connectGoogleAccount(user.id, {
        email: googleProfile.email,
        name: googleProfile.name,
        picture: googleProfile.picture
      });
    } catch (e) { }

    const token = generateToken({ id: user.id, email: user.email, username: user.username });
    res.cookie('syncnote_token', token, COOKIE_OPTIONS);
    console.log('[OAuth] Session created');

    const targetRedirect = `${FRONTEND_URL}/`;
    console.log(`[OAuth] Redirecting to ${targetRedirect}`);
    return res.redirect(targetRedirect);
  } catch (err) {
    console.error('[OAuth Server Error]:', err.message);
    const errorMsg = err.message || 'Server authentication error during Google OAuth';
    return res.redirect(`${FRONTEND_URL}/login?error=${encodeURIComponent(errorMsg)}`);
  }
});

// 2. GOOGLE DRIVE AUTHORIZATION (CLOUD STORAGE SEPARATE FLOW)
router.get(['/google/drive', '/api/auth/google/drive'], optionalAuth, (req, res) => {
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_DRIVE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/drive/callback';

  if (!clientId || clientId.trim() === '' || clientId.includes('mock')) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(400).json({ error: 'Google OAuth is not configured on server.' });
    }
    return res.redirect(`${FRONTEND_URL}/settings?error=google_not_configured`);
  }

  // Google Drive authorization scope granting access to manage SyncNote folder & files in My Drive
  const scope = 'https://www.googleapis.com/auth/drive';
  const userId = req.user ? req.user.id : null;
  const statePayload = Buffer.from(JSON.stringify({ userId, ts: Date.now() })).toString('base64');
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent&state=${encodeURIComponent(statePayload)}`;

  return res.redirect(authUrl);
});

router.get(['/google/drive/callback', '/api/auth/google/drive/callback'], optionalAuth, async (req, res) => {
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
  const { code, error, state } = req.query;

  if (error || !code) {
    return res.redirect(`${FRONTEND_URL}/settings?error=${encodeURIComponent(error || 'Google Drive authorization was cancelled')}`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_DRIVE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/drive/callback';

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      }).toString()
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      return res.redirect(`${FRONTEND_URL}/settings?error=${encodeURIComponent(tokenData.error_description || 'Drive token exchange failed')}`);
    }

    // Resolve authenticated user ID
    let userId = req.user ? req.user.id : null;
    if (!userId && state) {
      try {
        const decodedState = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
        if (decodedState && decodedState.userId) {
          userId = decodedState.userId;
        }
      } catch (e) {}
    }

    if (!userId) {
      userId = 'usr_local_default';
    }

    // Fetch user info for drive email if available
    let driveEmail = null;
    try {
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      if (userInfoRes.ok) {
        const info = await userInfoRes.json();
        driveEmail = info.email;
      }
    } catch (e) {}

    const connectResult = connectGoogleDrive(userId, {
      email: driveEmail,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token
    });

    console.log('[Google Drive OAuth Callback Diagnostic]');
    console.log(' - Authenticated SyncNote user ID:', userId);
    console.log(' - Authenticated email:', req.user?.email || 'N/A');
    console.log(' - Google account email:', driveEmail || connectResult?.email || 'N/A');
    console.log(' - Drive connection record user ID:', userId);

    return res.redirect(`${FRONTEND_URL}/settings?drive=connected`);
  } catch (err) {
    console.error('Google Drive Callback Exception:', err);
    return res.redirect(`${FRONTEND_URL}/settings?error=${encodeURIComponent(err.message)}`);
  }
});

router.get('/google/status', requireAuth, (req, res) => {
  const accountStatus = getGoogleAccountStatus(req.user.id);
  const driveStatus = getGoogleDriveStatus(req.user.id);
  return res.json({
    success: true,
    googleAccount: accountStatus,
    googleDrive: driveStatus
  });
});

router.post('/google/drive/connect', requireAuth, (req, res) => {
  try {
    const { email } = req.body || {};
    const status = connectGoogleDrive(req.user.id, { email: email || req.user.email });
    return res.json({ success: true, message: 'Google Drive connected', googleDrive: status });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to connect Google Drive', details: err.message });
  }
});

router.post('/google/drive/disconnect', requireAuth, (req, res) => {
  try {
    const status = disconnectGoogleDrive(req.user.id);
    return res.json({ success: true, message: 'Google Drive disconnected', googleDrive: status });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to disconnect Google Drive', details: err.message });
  }
});

router.post('/google/connect', requireAuth, (req, res) => {
  try {
    const { email, name, picture } = req.body || {};
    const finalEmail = email || (req.user ? req.user.email : 'user@gmail.com');
    const status = connectGoogleAccount(req.user.id, {
      email: finalEmail,
      name: name || (req.user ? req.user.username : 'SyncNote User'),
      picture: picture || 'https://lh3.googleusercontent.com/a/default-user'
    });
    return res.json({ success: true, message: 'Google Account connected successfully', googleAccount: status });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to connect Google Account', details: err.message });
  }
});

router.post('/google/disconnect', requireAuth, (req, res) => {
  try {
    const status = disconnectGoogleAccount(req.user.id);
    return res.json({ success: true, message: 'Google Account disconnected', googleAccount: status });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to disconnect Google Account', details: err.message });
  }
});

module.exports = router;
