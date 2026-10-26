import React, { useEffect, useState } from 'react';

type Theme = 'system' | 'light' | 'dark';
const themeKey = 'jira-copilot-theme';
const isTheme = (value: string | null): value is Theme => value === 'system' || value === 'light' || value === 'dark';

export function ThemeSelect() {
  const [theme, setTheme] = useState<Theme>(() => {
    try { const stored = localStorage.getItem(themeKey); return isTheme(stored) ? stored : 'system'; }
    catch { return 'system'; }
  });
  useEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (system.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#111827' : '#f5f7fb');
    };
    apply();
    system.addEventListener('change', apply);
    return () => system.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === themeKey || event.key === null) setTheme(isTheme(event.newValue) ? event.newValue : 'system');
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  return <label className="theme-select"><span>Appearance</span><select aria-label="Appearance" value={theme} onChange={event => {
    const value = event.target.value as Theme;
    setTheme(value);
    try { localStorage.setItem(themeKey, value); } catch { /* Keep the choice for this session. */ }
  }}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>;
}
