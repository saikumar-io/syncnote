import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from '../utils/router';
import SyncNoteLogo from '../components/SyncNoteLogo';
import { authApi } from '../api/authApi';
import { Eye, EyeOff, Lock, Mail, ArrowRight, AlertCircle, CheckCircle2, Loader2, WifiOff, ArrowLeft, KeyRound } from 'lucide-react';

export default function LoginPage() {
  const { login, isOffline } = useAuth();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Password Recovery state
  const [isForgotMode, setIsForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [recoveryToken, setRecoveryToken] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [forgotStep, setForgotStep] = useState(1);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      setErrorMsg('Please enter your email/username and password.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await login({ identifier: identifier.trim(), password });
      navigate('/notes');
    } catch (err) {
      if (err.isNetworkError) {
        setErrorMsg("You're offline. Sign in once while online to enable offline access on this device.");
      } else {
        setErrorMsg(err.message || 'Invalid credentials. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestRecovery = async (e) => {
    e.preventDefault();
    if (!forgotEmail.trim()) {
      setErrorMsg('Please enter your account email.');
      return;
    }
    setIsSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await authApi.forgotPassword({ email: forgotEmail.trim() });
      if (res && res.recoveryToken) {
        setRecoveryToken(res.recoveryToken);
      }
      setSuccessMsg(res.message || 'Recovery token generated.');
      setForgotStep(2);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to request recovery.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!recoveryToken.trim() || !resetNewPassword) {
      setErrorMsg('Please enter your recovery token and new password.');
      return;
    }
    if (resetNewPassword.length < 6) {
      setErrorMsg('New password must be at least 6 characters long.');
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    setIsSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await authApi.resetPassword({
        recoveryToken: recoveryToken.trim(),
        newPassword: resetNewPassword,
        confirmPassword: resetConfirmPassword
      });
      setSuccessMsg(res.message || 'Password reset successfully! You can now log in.');
      setIsForgotMode(false);
      setForgotStep(1);
      setIdentifier(forgotEmail);
      setPassword('');
    } catch (err) {
      setErrorMsg(err.message || 'Failed to reset password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err) {
      if (err === 'google_not_configured') {
        setErrorMsg('Google OAuth is not configured on this server (GOOGLE_CLIENT_ID missing in server environment).');
      } else {
        setErrorMsg(decodeURIComponent(err));
      }
    }
  }, []);

  const handleGoogleLogin = () => {
    if (isOffline) {
      setErrorMsg('Google OAuth requires an active internet connection.');
      return;
    }
    window.location.href = '/api/auth/google';
  };

  return (
    <div className="auth-page-wrapper">
      <div className="auth-card">
        {/* Brand Header */}
        <div className="auth-header">
          <SyncNoteLogo showText={true} />
          <h2 className="auth-title">Sign in to SyncNote</h2>
          <p className="auth-subtitle">Sign in to your local workspace</p>
        </div>

        {/* Offline Warning Banner */}
        {isOffline && (
          <div className="auth-error-banner" style={{ backgroundColor: 'rgba(245, 158, 11, 0.12)', borderColor: 'rgba(245, 158, 11, 0.3)', color: 'var(--accent-amber, #f59e0b)' }}>
            <WifiOff size={15} />
            <span>You're offline. Sign in once while online to enable offline access on this device.</span>
          </div>
        )}

        {/* Error Alert */}
        {errorMsg && (
          <div className="auth-error-banner">
            <AlertCircle size={15} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Success Alert */}
        {successMsg && (
          <div className="auth-error-banner success">
            <CheckCircle2 size={15} />
            <span>{successMsg}</span>
          </div>
        )}

        {isForgotMode ? (
          <div className="auth-form">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <button
                type="button"
                className="btn-secondary input-compact"
                style={{ padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                onClick={() => { setIsForgotMode(false); setErrorMsg(''); setSuccessMsg(''); }}
              >
                <ArrowLeft size={13} />
                <span>Back to Sign In</span>
              </button>
              <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Reset Password</span>
            </div>

            {forgotStep === 1 ? (
              <form onSubmit={handleRequestRecovery}>
                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="input-label" htmlFor="forgot-email">Account Email</label>
                  <div className="input-with-icon">
                    <Mail size={15} className="input-icon" />
                    <input
                      id="forgot-email"
                      type="email"
                      className="auth-input"
                      placeholder="Enter your registered email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="btn-primary auth-submit-btn"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Generating Recovery Token...' : 'Continue to Reset Password'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleResetPassword}>
                <div className="form-group" style={{ marginBottom: '10px' }}>
                  <label className="input-label" htmlFor="recovery-token">Recovery Token</label>
                  <div className="input-with-icon">
                    <KeyRound size={15} className="input-icon" />
                    <input
                      id="recovery-token"
                      type="text"
                      className="auth-input"
                      placeholder="Paste recovery token"
                      value={recoveryToken}
                      onChange={(e) => setRecoveryToken(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="form-group" style={{ marginBottom: '10px' }}>
                  <label className="input-label" htmlFor="reset-new-password">New Password</label>
                  <div className="input-with-icon">
                    <Lock size={15} className="input-icon" />
                    <input
                      id="reset-new-password"
                      type="password"
                      className="auth-input"
                      placeholder="Min 6 characters"
                      value={resetNewPassword}
                      onChange={(e) => setResetNewPassword(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="input-label" htmlFor="reset-confirm-password">Confirm Password</label>
                  <div className="input-with-icon">
                    <Lock size={15} className="input-icon" />
                    <input
                      id="reset-confirm-password"
                      type="password"
                      className="auth-input"
                      placeholder="Re-enter new password"
                      value={resetConfirmPassword}
                      onChange={(e) => setResetConfirmPassword(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="btn-primary auth-submit-btn"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Resetting Password...' : 'Save New Password & Sign In'}
                </button>
              </form>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form">
            <div className="form-group">
              <label className="input-label" htmlFor="login-identifier">
                Email or Username
              </label>
              <div className="input-with-icon">
                <Mail size={15} className="input-icon" />
                <input
                  id="login-identifier"
                  type="text"
                  className="auth-input"
                  placeholder="user@syncnote.io or username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="input-label" htmlFor="login-password" style={{ margin: 0 }}>
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => { setIsForgotMode(true); setErrorMsg(''); setSuccessMsg(''); }}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    fontSize: '0.74rem',
                    color: 'var(--accent-primary, #3b82f6)',
                    cursor: 'pointer',
                    textDecoration: 'none'
                  }}
                >
                  Forgot password?
                </button>
              </div>
              <div className="input-with-icon" style={{ marginTop: '4px' }}>
                <Lock size={15} className="input-icon" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  className="auth-input pr-10"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="btn-primary auth-submit-btn"
              disabled={isSubmitting || isOffline}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="spin-icon" />
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <span>Sign in</span>
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </form>
        )}

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', margin: '16px 0', color: 'var(--text-muted)', fontSize: '0.74rem' }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
          <span style={{ padding: '0 10px', textTransform: 'lowercase' }}>or</span>
          <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
        </div>

        {/* Continue with Google Button */}
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={isOffline}
          className="btn-secondary"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            padding: '9px 16px',
            fontSize: '0.84rem',
            fontWeight: 500,
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-app)',
            color: 'var(--text-primary)',
            cursor: isOffline ? 'not-allowed' : 'pointer'
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>Continue with Google</span>
        </button>

        {/* Footer Link */}
        <div className="auth-footer" style={{ marginTop: '16px' }}>
          <p>
            Don't have an account?{' '}
            <Link to="/register" className="auth-link">
              Create account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
