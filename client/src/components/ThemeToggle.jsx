import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';

export default function ThemeToggle({ theme, setTheme }) {
  const currentTheme = theme || 'dark';

  return (
    <div className="compact-theme-segmented">
      <button 
        className={`segmented-btn ${currentTheme === 'light' ? 'active' : ''}`}
        onClick={() => setTheme('light')}
        title="Light Theme"
      >
        <Sun size={12} />
      </button>
      <button 
        className={`segmented-btn ${currentTheme === 'dark' ? 'active' : ''}`}
        onClick={() => setTheme('dark')}
        title="Dark Theme"
      >
        <Moon size={12} />
      </button>
      <button 
        className={`segmented-btn ${currentTheme === 'system' ? 'active' : ''}`}
        onClick={() => setTheme('system')}
        title="System Theme"
      >
        <Monitor size={12} />
      </button>
    </div>
  );
}
