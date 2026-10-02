import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from '../utils/router';
import SyncNoteLogo from '../components/SyncNoteLogo';
import { authApi } from '../api/authApi';
import { 
  Eye, 
  EyeOff, 
  Lock, 
  Mail, 
  ArrowRight, 
  AlertCircle, 
  CheckCircle2, 
  Loader2, 
  WifiOff, 
  ArrowLeft, 
  RefreshCw, 
  ShieldCheck 
} from 'lucide-react';

export default function LoginPage() {
  const { login, isOffline } = useAuth();
  const navigate = useNavigate();

  // Login form state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Common submission & message state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Password Recovery state
  const [isForgotMode, setIsForgotMode] = useState(false);
  const [forgotStep, setForgotStep] = useState(1); // 1: Email, 2: OTP, 3: New Password, 4: Success
  const [forgotEmail, setForgotEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Resend cooldown timer
  useEffect(() => {
    let timer = null;
    if (resendCooldown > 0) {
      timer = setInterval(() => {
        setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [resendCooldown]);

  // Auto-redirect to login after successful password reset
  useEffect(() => {
    let redirectTimer = null;
    if (isForgotMode && forgotStep === 4) {
      redirectTimer = setTimeout(() => {
        setIsForgotMode(false);
        setForgotStep(1);
        setIdentifier(forgotEmail);
        setPassword('');
        setErrorMsg('');
        setSuccessMsg('Password changed successfully. Please sign in with your new password.');
      }, 3500);
    }
    return () => {
      if (redirectTimer) clearTimeout(redirectTimer);
    };
  }, [isForgotMode, forgotStep, forgotEmail]);

  // Standard Login submit
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

  // Step 1: Send OTP to registered Gmail
  const handleSendOtp = async (e) => {
    e.preventDefault();
    const cleanEmail = forgotEmail.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await authApi.forgotPassword({ email: cleanEmail });
      setSuccessMsg(res.message || 'OTP sent to your email.');
      setResendCooldown(60);
      setForgotStep(2);
      setOtpCode('');
    } catch (err) {
      setErrorMsg(err.message || 'Failed to send OTP. Please check your email.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step 2: Resend OTP
  const handleResendOtp = async () => {
    if (resendCooldown > 0 || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await authApi.resendOtp({ email: forgotEmail.trim() });
      setSuccessMsg(res.message || 'OTP sent to your email.');
      setResendCooldown(60);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to resend OTP. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step 2: Verify 6-digit OTP
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    const cleanOtp = otpCode.trim();

    if (!cleanOtp || cleanOtp.length !== 6) {
      setErrorMsg('Please enter the full 6-digit verification code.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await authApi.verifyOtp({ email: forgotEmail.trim(), otp: cleanOtp });
      if (res && res.resetToken) {
        setResetToken(res.resetToken);
      }
      setSuccessMsg('');
      setForgotStep(3);
    } catch (err) {
      setErrorMsg(err.message || 'Invalid or expired OTP.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step 3: Change Password
  const handleChangePassword = async (e) => {
    e.preventDefault();

    if (!resetNewPassword) {
      setErrorMsg('Please enter a new password.');
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
      await authApi.resetPassword({
        resetToken,
        newPassword: resetNewPassword,
        confirmPassword: resetConfirmPassword
      });

      setSuccessMsg('Password changed successfully.');
      setForgotStep(4);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to change password. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // URL query error check (OAuth)
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

  // Determine headlines dynamically based on current mode & step
  let currentHeadline = 'Sign in to SyncNote';
  let currentSubheadline = 'Offline-first intelligent knowledge management platform';

  if (isForgotMode) {
    if (forgotStep === 1) {
      currentHeadline = 'Forgot Password';
      currentSubheadline = 'Enter your registered Gmail to receive an OTP';
    } else if (forgotStep === 2) {
      currentHeadline = 'Verify OTP';
      currentSubheadline = `Enter the 6-digit code sent to ${forgotEmail}`;
    } else if (forgotStep === 3) {
      currentHeadline = 'Create New Password';
      currentSubheadline = 'Set your new SyncNote account password';
    } else if (forgotStep === 4) {
      currentHeadline = 'Password Changed';
      currentSubheadline = 'Your password has been updated successfully';
    }
  }

  return (
    <div className="auth-page-root">
      <div className="auth-ambient-glow" />
      <div className="auth-card-container">
        
        {/* Brand Header */}
        <div className="auth-brand-header">
          <SyncNoteLogo showText={true} />
          <h2 className="auth-headline">{currentHeadline}</h2>
          <p className="auth-subheadline">{currentSubheadline}</p>
        </div>

        {/* Offline Warning Banner */}
        {isOffline && (
          <div className="auth-status-alert warning">
            <WifiOff size={15} />
            <span>You're offline. Sign in once while online to enable offline access on this device.</span>
          </div>
        )}

        {/* Error Alert */}
        {errorMsg && (
          <div className="auth-status-alert danger">
            <AlertCircle size={15} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Success Alert */}
        {successMsg && forgotStep !== 4 && (
          <div className="auth-status-alert success">
            <CheckCircle2 size={15} />
            <span>{successMsg}</span>
          </div>
        )}

        {!isForgotMode ? (
          <>
            {/* Standard Login Form */}
            <form onSubmit={handleSubmit} className="auth-form-cluster">
              <div className="auth-input-group">
                <label className="auth-label">Email or Username</label>
                <div className="auth-input-wrapper">
                  <Mail size={15} className="input-symbol" />
                  <input
                    type="text"
                    className="auth-text-field"
                    placeholder="name@example.com or username"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </div>
              </div>

              <div className="auth-input-group">
                <div className="label-row-between">
                  <label className="auth-label">Password</label>
                  <button
                    type="button"
                    className="auth-link-button"
                    onClick={() => {
                      setIsForgotMode(true);
                      setForgotStep(1);
                      setForgotEmail(identifier.includes('@') ? identifier : '');
                      setErrorMsg('');
                      setSuccessMsg('');
                    }}
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="auth-input-wrapper">
                  <Lock size={15} className="input-symbol" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="auth-text-field"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle-trigger"
                    onClick={() => setShowPassword(!showPassword)}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="auth-submit-button"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight size={15} />
                  </>
                )}
              </button>
            </form>

            <div className="auth-divider-line">
              <span>OR CONTINUE WITH</span>
            </div>

            {/* Google OAuth Login */}
            <button
              type="button"
              className="auth-oauth-button"
              onClick={handleGoogleLogin}
              disabled={isOffline || isSubmitting}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" className="google-svg">
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

            <div className="auth-footer-prompt">
              <span>Don't have an account?</span>
              <Link to="/register" className="auth-switch-link">
                Create one now
              </Link>
            </div>
          </>
        ) : (
          /* OTP Password Recovery Flow */
          <div className="auth-recovery-cluster">
            {/* STEP 1: Enter Registered Gmail */}
            {forgotStep === 1 && (
              <form onSubmit={handleSendOtp} className="auth-form-cluster">
                <div className="auth-input-group">
                  <label className="auth-label">Email</label>
                  <div className="auth-input-wrapper">
                    <Mail size={15} className="input-symbol" />
                    <input
                      type="email"
                      className="auth-text-field"
                      placeholder="Enter your registered Gmail"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="auth-submit-button"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <>
                      <span>Send OTP</span>
                      <ArrowRight size={15} />
                    </>
                  )}
                </button>
              </form>
            )}

            {/* STEP 2: Enter and Verify 6-digit OTP */}
            {forgotStep === 2 && (
              <form onSubmit={handleVerifyOtp} className="auth-form-cluster">
                <div className="auth-input-group">
                  <label className="auth-label">Enter the 6-digit OTP</label>
                  <div className="auth-input-wrapper">
                    <input
                      type="text"
                      className="auth-text-field auth-otp-input"
                      placeholder="123456"
                      value={otpCode}
                      maxLength={6}
                      onChange={(e) => {
                        const numeric = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setOtpCode(numeric);
                      }}
                      required
                      autoFocus
                    />
                  </div>
                </div>

                <div className="auth-resend-wrapper">
                  <span>Didn't receive the code?</span>
                  <button
                    type="button"
                    className="auth-resend-btn"
                    disabled={resendCooldown > 0 || isSubmitting}
                    onClick={handleResendOtp}
                  >
                    <RefreshCw size={12} className={isSubmitting ? "spin" : ""} />
                    <span>
                      {resendCooldown > 0 ? `Resend OTP (${resendCooldown}s)` : 'Resend OTP'}
                    </span>
                  </button>
                </div>

                <button
                  type="submit"
                  className="auth-submit-button"
                  disabled={isSubmitting || otpCode.length !== 6}
                >
                  {isSubmitting ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <>
                      <span>Verify OTP</span>
                      <ShieldCheck size={16} />
                    </>
                  )}
                </button>
              </form>
            )}

            {/* STEP 3: Create and Confirm New Password */}
            {forgotStep === 3 && (
              <form onSubmit={handleChangePassword} className="auth-form-cluster">
                <div className="auth-input-group">
                  <label className="auth-label">New Password</label>
                  <div className="auth-input-wrapper">
                    <Lock size={15} className="input-symbol" />
                    <input
                      type={showResetPassword ? 'text' : 'password'}
                      className="auth-text-field"
                      placeholder="New Password (min 6 characters)"
                      value={resetNewPassword}
                      onChange={(e) => setResetNewPassword(e.target.value)}
                      required
                      autoFocus
                    />
                    <button
                      type="button"
                      className="password-toggle-trigger"
                      onClick={() => setShowResetPassword(!showResetPassword)}
                    >
                      {showResetPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div className="auth-input-group">
                  <label className="auth-label">Confirm New Password</label>
                  <div className="auth-input-wrapper">
                    <Lock size={15} className="input-symbol" />
                    <input
                      type={showResetConfirmPassword ? 'text' : 'password'}
                      className="auth-text-field"
                      placeholder="Confirm Password"
                      value={resetConfirmPassword}
                      onChange={(e) => setResetConfirmPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle-trigger"
                      onClick={() => setShowResetConfirmPassword(!showResetConfirmPassword)}
                    >
                      {showResetConfirmPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  className="auth-submit-button"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <>
                      <span>Change Password</span>
                      <ArrowRight size={15} />
                    </>
                  )}
                </button>
              </form>
            )}

            {/* STEP 4: Password Changed Successfully */}
            {forgotStep === 4 && (
              <div className="auth-success-screen">
                <div className="auth-success-icon-box">
                  <CheckCircle2 size={30} />
                </div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Password changed successfully.
                </h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '2px 0 14px' }}>
                  Your password has been updated securely. You can now log in with your new password.
                </p>
                <button
                  type="button"
                  className="auth-submit-button"
                  style={{ width: '100%' }}
                  onClick={() => {
                    setIsForgotMode(false);
                    setForgotStep(1);
                    setIdentifier(forgotEmail);
                    setPassword('');
                    setErrorMsg('');
                    setSuccessMsg('Password changed successfully. Please log in.');
                  }}
                >
                  <span>Back to Login</span>
                  <ArrowRight size={15} />
                </button>
              </div>
            )}

            {/* Navigation back to Login */}
            {forgotStep !== 4 && (
              <button
                type="button"
                className="auth-back-to-login"
                onClick={() => {
                  setIsForgotMode(false);
                  setForgotStep(1);
                  setErrorMsg('');
                  setSuccessMsg('');
                }}
              >
                <ArrowLeft size={14} />
                <span>Back to Sign In</span>
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
