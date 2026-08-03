'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Buildings,
  CheckCircle,
  Eye,
  EyeSlash,
  LockKey,
  ShieldCheck,
} from '@phosphor-icons/react';

const emptyCode = ['', '', '', '', '', ''];

function BrandPanel() {
  return (
    <section className="brand-panel" aria-label="IRIS Enterprise security">
      <div className="brand-content">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><ShieldCheck weight="duotone" /></div>
          <div>
            <div className="brand-name">IRIS</div>
            <div className="brand-edition">ENTERPRISE</div>
          </div>
        </div>
        <div className="brand-message">
          <span className="accent-line" />
          <h2>Secure Command Gateway</h2>
          <p>Trusted AI oversight. Protected operations.<br />Every access is verified. Every session<br />is encrypted. Your mission is our priority.</p>
        </div>
      </div>
    </section>
  );
}

function StepHeader({ step }) {
  return (
    <div className="steps" aria-label={`Step ${step} of 2`}>
      <div className={`step ${step === 1 ? 'active' : 'complete'}`}>
        <span className="step-circle">{step === 2 ? <CheckCircle weight="fill" /> : '1'}</span>
        <span>Sign in</span>
      </div>
      <span className={`step-line ${step === 2 ? 'complete' : ''}`} />
      <div className={`step ${step === 2 ? 'active' : ''}`}>
        <span className="step-circle">2</span>
        <span>Verify</span>
      </div>
    </div>
  );
}

function SignIn({ onContinue }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = (event) => {
    event.preventDefault();
    if (!email.includes('@') || password.length < 6) {
      setError('Enter a valid work email and a password of at least 6 characters.');
      return;
    }
    setError('');
    setLoading(true);
    window.setTimeout(() => onContinue(email), 650);
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <div className="heading">
        <h1>Secure access</h1>
        <p>Sign in to your account. Multi-factor authentication<br className="desktop-break" /> will follow.</p>
      </div>

      <div className="field-group">
        <label htmlFor="email">Work email</label>
        <input id="email" type="email" autoComplete="email" placeholder="name@yourorganization.gov" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(error)} />
      </div>

      <div className="field-group">
        <label htmlFor="password">Password</label>
        <div className="password-wrap">
          <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={Boolean(error)} />
          <button className="icon-button" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
            {showPassword ? <EyeSlash /> : <Eye />}
          </button>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="form-options">
        <label className="check-label">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Remember this device</span>
        </label>
        <button className="text-button" type="button" onClick={() => alert('Password recovery would open here.')}>Forgot password?</button>
      </div>

      <button className="primary-button" type="submit" disabled={loading}>
        <span>{loading ? 'Verifying…' : 'Continue securely'}</span>
        {!loading && <ArrowRight weight="bold" />}
      </button>

      <div className="divider"><span>or</span></div>

      <button className="sso-button" type="button" onClick={() => alert('Your organization SSO would open here.')}>
        <Buildings weight="duotone" />
        <span>Continue with organization SSO</span>
      </button>
    </form>
  );
}

function Mfa({ email, onBack }) {
  const [code, setCode] = useState(emptyCode);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');
  const inputs = useRef([]);

  useEffect(() => inputs.current[0]?.focus(), []);

  const updateCode = (index, value) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...code];
    next[index] = value.slice(-1);
    setCode(next);
    setError('');
    if (value && index < 5) inputs.current[index + 1]?.focus();
  };

  const handleKey = (index, event) => {
    if (event.key === 'Backspace' && !code[index] && index > 0) inputs.current[index - 1]?.focus();
  };

  const submit = (event) => {
    event.preventDefault();
    if (code.join('').length !== 6) {
      setError('Enter the complete 6-digit verification code.');
      return;
    }
    setVerified(true);
  };

  if (verified) {
    return (
      <div className="success-state" role="status">
        <div className="success-icon"><ShieldCheck weight="fill" /></div>
        <h1>Identity verified</h1>
        <p>Your secure IRIS Enterprise session is ready.</p>
        <button className="primary-button" type="button" onClick={() => setVerified(false)}>
          <span>Enter workspace</span><ArrowRight weight="bold" />
        </button>
      </div>
    );
  }

  return (
    <form className="auth-form mfa-form" onSubmit={submit}>
      <button className="back-button" type="button" onClick={onBack}><ArrowLeft /> Back to sign in</button>
      <div className="heading">
        <h1>Verify your identity</h1>
        <p>Enter the six-digit code sent to<br /><strong>{email}</strong>.</p>
      </div>
      <div className="code-inputs" aria-label="Verification code">
        {code.map((digit, index) => (
          <input key={index} ref={(el) => { inputs.current[index] = el; }} inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'} maxLength="1" value={digit} onChange={(e) => updateCode(index, e.target.value)} onKeyDown={(e) => handleKey(index, e)} aria-label={`Digit ${index + 1}`} />
        ))}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button" type="submit"><span>Verify securely</span><ArrowRight weight="bold" /></button>
      <p className="resend">Didn't receive a code? <button type="button" onClick={() => alert('A new code has been sent.')}>Send again</button></p>
    </form>
  );
}

export default function Home() {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');

  return (
    <main className="auth-shell">
      <BrandPanel />
      <section className="auth-panel">
        <div className="auth-content">
          <StepHeader step={step} />
          {step === 1 ? (
            <SignIn onContinue={(value) => { setEmail(value); setStep(2); }} />
          ) : (
            <Mfa email={email} onBack={() => setStep(1)} />
          )}
          <footer className="secure-footer">
            <span><LockKey weight="fill" /> Encrypted session</span>
            <span className="footer-divider" />
            <a href="#privacy">Privacy</a>
          </footer>
        </div>
      </section>
    </main>
  );
}
