import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from '../utils/router';
import SyncNoteLogo from '../components/SyncNoteLogo';
import { Eye, EyeOff, Lock, Mail, User, ArrowRight, AlertCircle, Loader2 } from 'lucide-react';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const validate = () => {
    const errs = {};
    if (!username.trim() || username.trim().length < 3) {
      errs.username = 'Username must be at least 3 characters.';
    } else if (!/^[a-zA-Z0-9_-]+$/.test(username.trim())) {
      errs.username = 'Letters, numbers, underscores, and hyphens only.';
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim() || !emailRegex.test(email.trim())) {
      errs.email = 'Valid email address required.';
    }

    if (!password || password.length < 6) {
      errs.password = 'Password must be at least 6 characters.';
    }

    if (password !== confirmPassword) {
      errs.confirmPassword = 'Passwords do not match.';
    }

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      await register({
        username: username.trim(),
        email: email.trim(),
        password,
        confirmPassword
      });
      navigate('/notes');
    } catch (err) {
      setErrorMsg(err.message || 'Failed to create account. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-page-root">
      <div className="auth-ambient-glow" />
      <div className="auth-card-container">
        
        {/* Brand Header */}
        <div className="auth-brand-header">
          <SyncNoteLogo showText={true} />
          <h2 className="auth-headline">Create your workspace</h2>
          <p className="auth-subheadline">Set up your local-first SyncNote account</p>
        </div>

        {/* Global Error Banner */}
        {errorMsg && (
          <div className="auth-status-alert danger">
            <AlertCircle size={15} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Registration Form */}
        <form onSubmit={handleSubmit} className="auth-form-cluster">
          <div className="auth-input-group">
            <label className="auth-label" htmlFor="reg-username">
              Username
            </label>
            <div className="auth-input-wrapper">
              <User size={15} className="input-symbol" />
              <input
                id="reg-username"
                type="text"
                className={`auth-text-field ${fieldErrors.username ? 'error' : ''}`}
                placeholder="developer_handle"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (fieldErrors.username) setFieldErrors(prev => ({ ...prev, username: null }));
                }}
                autoComplete="username"
                required
              />
            </div>
            {fieldErrors.username && <span className="field-error-message">{fieldErrors.username}</span>}
          </div>

          <div className="auth-input-group">
            <label className="auth-label" htmlFor="reg-email">
              Email Address
            </label>
            <div className="auth-input-wrapper">
              <Mail size={15} className="input-symbol" />
              <input
                id="reg-email"
                type="email"
                className={`auth-text-field ${fieldErrors.email ? 'error' : ''}`}
                placeholder="dev@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (fieldErrors.email) setFieldErrors(prev => ({ ...prev, email: null }));
                }}
                autoComplete="email"
                required
              />
            </div>
            {fieldErrors.email && <span className="field-error-message">{fieldErrors.email}</span>}
          </div>

          <div className="auth-input-group">
            <label className="auth-label" htmlFor="reg-password">
              Password
            </label>
            <div className="auth-input-wrapper">
              <Lock size={15} className="input-symbol" />
              <input
                id="reg-password"
                type={showPassword ? 'text' : 'password'}
                className={`auth-text-field ${fieldErrors.password ? 'error' : ''}`}
                placeholder="Min. 6 characters"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password) setFieldErrors(prev => ({ ...prev, password: null }));
                }}
                autoComplete="new-password"
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
            {fieldErrors.password && <span className="field-error-message">{fieldErrors.password}</span>}
          </div>

          <div className="auth-input-group">
            <label className="auth-label" htmlFor="reg-confirm-password">
              Confirm Password
            </label>
            <div className="auth-input-wrapper">
              <Lock size={15} className="input-symbol" />
              <input
                id="reg-confirm-password"
                type={showPassword ? 'text' : 'password'}
                className={`auth-text-field ${fieldErrors.confirmPassword ? 'error' : ''}`}
                placeholder="Re-enter password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (fieldErrors.confirmPassword) setFieldErrors(prev => ({ ...prev, confirmPassword: null }));
                }}
                autoComplete="new-password"
                required
              />
            </div>
            {fieldErrors.confirmPassword && (
              <span className="field-error-message">{fieldErrors.confirmPassword}</span>
            )}
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
                <span>Create Workspace Account</span>
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </form>

        <div className="auth-footer-prompt">
          <span>Already have an account?</span>
          <Link to="/login" className="auth-switch-link">
            Sign in
          </Link>
        </div>

      </div>
    </div>
  );
}
