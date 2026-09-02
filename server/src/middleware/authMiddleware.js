const { verifyToken } = require('../utils/auth');

/**
 * Authentication Middleware
 * Checks HTTP-Only cookie 'syncnote_token' or Authorization header
 */
const requireAuth = (req, res, next) => {
  let token = null;

  // Check HTTP-Only Cookie
  if (req.cookies && req.cookies.syncnote_token) {
    token = req.cookies.syncnote_token;
  } 
  // Fallback: Authorization Bearer header
  else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const decoded = verifyToken(token);
  if (!decoded || !decoded.id) {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }

  req.user = {
    id: decoded.id,
    email: decoded.email,
    username: decoded.username
  };

  next();
};

/**
 * Optional Authentication Middleware (attaches req.user if available, otherwise proceeds)
 */
const optionalAuth = (req, res, next) => {
  let token = null;
  if (req.cookies && req.cookies.syncnote_token) {
    token = req.cookies.syncnote_token;
  } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (token) {
    const decoded = verifyToken(token);
    if (decoded && decoded.id) {
      req.user = {
        id: decoded.id,
        email: decoded.email,
        username: decoded.username
      };
    }
  }
  next();
};

module.exports = { requireAuth, optionalAuth };
