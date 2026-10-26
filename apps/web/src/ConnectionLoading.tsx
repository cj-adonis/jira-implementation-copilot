import React from 'react';
import type { ConnectionProgress } from '@jira-copilot/shared';

export function ConnectionLoading({ phase, message, help }: {
  phase: ConnectionProgress['phase']; message?: string; help?: React.ReactNode;
}) {
  const step = phase === 'connected' ? 2 : phase === 'automatic' || phase === 'browser' ? 1 : 0;
  const browser = phase === 'browser';
  const title = step === 2 ? 'Your workspace is almost ready' : browser ? 'One sign-in away from your work' : step === 1 ? 'Signing you in securely' : 'Getting your workspace ready';
  const description = step === 2 ? 'Jira is connected. Bringing your workspace into view.'
    : browser ? 'Finish Samsung SSO in the Chrome window that opened. We’ll take it from there.'
      : step === 1 ? 'Connecting your Samsung account to Jira MX. If a sign-in window appears, complete it there.'
        : 'Looking for your existing Samsung SSO session and preparing a connection to Jira MX.';
  const steps = ['Check your session', 'Samsung sign-in', 'Open your workspace'];
  return <section className="connection-loading" aria-label="Connecting to Jira MX">
    <div className="connection-loading-main">
      <div className="connection-art" aria-hidden="true"><div className="connection-orbit orbit-outer" /><div className="connection-orbit orbit-inner" /><span className="orbit-spark spark-one" /><span className="orbit-spark spark-two" /><span className="orbit-spark spark-three" /><div className="connection-logo">J<svg viewBox="0 0 24 24" className="connection-logo-check">{step === 2 ? <path d="m6 12 4 4 8-8" /> : <><rect x="6" y="10" width="12" height="10" rx="2" /><path d="M9 10V7a3 3 0 0 1 6 0v3" /></>}</svg></div></div>
      <div className="connection-loading-copy"><span className="connection-loading-label"><span className="loading-dot" />{step === 2 ? 'Almost there' : 'Connecting'}</span>
        <div role="status" aria-live="polite" aria-atomic="true"><h2>{title}</h2><p>{description}</p><p className="connection-live-message">{message || 'Establishing your connection…'}</p></div>
        <div className="connection-progress-track" role="progressbar" aria-label="Jira connection progress" aria-valuetext={steps[step]}><span /></div>
      </div>
    </div>
    <ol className="connection-steps" aria-label="Connection steps">{steps.map((label, index) => <li key={label} className={index < step ? 'complete' : index === step ? 'current' : 'upcoming'} aria-current={index === step ? 'step' : undefined}>
      <span className="connection-step-marker" aria-hidden="true">{index < step ? <svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-8" /></svg> : index + 1}</span><span>{label}<small>{index < step ? 'Done' : index === step ? browser ? 'Your turn' : 'In progress' : 'Up next'}</small></span>
    </li>)}</ol>
    <div className={'connection-loading-note' + (browser ? ' needs-sign-in' : '')}><svg viewBox="0 0 24 24" aria-hidden="true">{browser ? <><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M3 8h18M8 21h8m-4-3v3" /></> : <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-5" /></>}</svg><span>{browser ? 'Keep this page open while you finish signing in. It updates automatically.' : 'Your connection uses your Samsung SSO session.'}</span></div>
    {help}
    <div className="connection-preview" aria-hidden="true"><div className="preview-placeholder"><span className="placeholder-dot" /><span /><span /></div><div className="preview-placeholder"><span className="placeholder-dot" /><span /><span /></div><div className="preview-placeholder"><span className="placeholder-dot" /><span /><span /></div></div>
  </section>;
}
