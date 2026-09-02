import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from '../utils/router';
import { User, Settings, Laptop, LogOut, ChevronDown } from 'lucide-react';

export default function UserMenu() {
  const { user, device, logout } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  if (!user) return null;

  const initial = (user.username || user.email || 'U').charAt(0).toUpperCase();

  const handleLogout = async () => {
    setIsOpen(false);
    await logout();
    navigate('/login');
  };

  return (
    <div className="user-menu-wrapper" ref={menuRef}>
      <button
        className="user-menu-trigger"
        onClick={() => setIsOpen(!isOpen)}
        title={`${user.username} (${user.email})`}
        type="button"
      >
        {user.picture || user.avatar_url ? (
          <img
            src={user.picture || user.avatar_url}
            alt={user.username}
            className="user-avatar-img"
            style={{ width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover' }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        ) : null}
        {(!user.picture && !user.avatar_url) && (
          <div className="user-avatar-badge">{initial}</div>
        )}
        <span className="user-menu-username">{user.username}</span>
        <ChevronDown size={13} className={`chevron-icon ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="user-menu-dropdown">
          <div className="user-menu-header" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {(user.picture || user.avatar_url) ? (
              <img
                src={user.picture || user.avatar_url}
                alt={user.username}
                style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover' }}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            ) : (
              <div className="user-avatar-badge" style={{ width: '36px', height: '36px', fontSize: '1rem' }}>{initial}</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="user-menu-full-name">{user.username}</div>
              <div className="user-menu-email">{user.email}</div>
              {device && (
                <div className="user-menu-device-tag">
                  <Laptop size={11} />
                  <span>{device.device_name || 'Current Device'}</span>
                </div>
              )}
            </div>
          </div>

          <div className="dropdown-divider" />

          <Link
            to="/settings"
            className="user-menu-item"
            onClick={() => setIsOpen(false)}
          >
            <User size={14} />
            <span>Profile & Account</span>
          </Link>

          <Link
            to="/settings"
            className="user-menu-item"
            onClick={() => setIsOpen(false)}
          >
            <Settings size={14} />
            <span>Settings & Device</span>
          </Link>

          <div className="dropdown-divider" />

          <button
            className="user-menu-item logout-item"
            onClick={handleLogout}
            type="button"
          >
            <LogOut size={14} />
            <span>Log out</span>
          </button>
        </div>
      )}
    </div>
  );
}
