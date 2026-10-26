import React from 'react';

export type IconName = 'work' | 'board' | 'search' | 'pin' | 'calendar' | 'alert' | 'sparkles' | 'refresh' | 'list' | 'bolt' | 'shield';
const shapes: Record<IconName, React.ReactNode> = {
  work: <><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M9 5V3h6v2M8 10l1 1 2-2m-3 7 1 1 2-2m3-5h3m-3 6h3" /></>,
  board: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16m6-16v16M6 8v4m6-4v7m6-7v3" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
  pin: <><path d="m15 3 6 6-4 1-3 4v4l-8-8h4l4-3 1-4ZM9 15l-5 5" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2" /></>,
  alert: <><path d="m10.3 4.5-8 14A1.7 1.7 0 0 0 3.8 21h16.4a1.7 1.7 0 0 0 1.5-2.5l-8-14a2 2 0 0 0-3.4 0Z" /><path d="M12 9v5m0 3h.01" /></>,
  sparkles: <><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Zm7 0v4m-2-2h4M4 18v3m-1.5-1.5h3" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></>,
  list: <><path d="M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01" /></>,
  bolt: <path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z" />,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-5" /></>
};
export function Icon({ name, className = '', ...props }: { name: IconName } & React.SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={'icon ' + className} {...props}>{shapes[name]}</svg>;
}
