'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/marketing/Button';
import { authRoute, getSafeNextUrl } from '@/lib/navigation';
import { digitsOnly, toE164, isValidNationalNumber } from '@/lib/phone';
import { messageForError } from '@/lib/errors';
import { GOAL_META, LEARNER_GOALS, type LearnerGoal } from '@/types/learnerGoal';
import { useAuth } from '@/context/AuthContext';
import { signUp, verifyOtp, resendOtp, updatePassword } from '@/services/authService';
import { supabase } from '@/config/supabase';
import './auth-preview.css';

export type AuthScreen = 'login' | 'signup' | 'verify' | 'onboarding' | 'forgot-password';

const SCREEN_COPY: Record<AuthScreen, { eyebrow: string; title: string; description: string }> = {
  login: {
    eyebrow: 'WELCOME BACK',
    title: 'Your next chapter starts here.',
    description: 'Log in to pick up where you left off.',
  },
  signup: {
    eyebrow: 'A SMALL FIRST STEP',
    title: 'Big goals. A fresh start.',
    description: 'Create your account and start your learning journey.',
  },
  verify: {
    eyebrow: 'VERIFY YOUR PHONE',
    title: 'One step closer.',
    description: 'Enter your six-digit code to continue.',
  },
  onboarding: {
    eyebrow: 'MAKE IT YOURS',
    title: 'What are you working towards?',
    description: 'Choose your learning goal, then add an email if you like.',
  },
  'forgot-password': {
    eyebrow: 'LET’S GET YOU BACK',
    title: 'Reset your password.',
    description: 'Verify your phone number and choose a new password.',
  },
};

export function AuthPreviewShell({ screen }: { screen: AuthScreen }) {
  const copy = SCREEN_COPY[screen];
  const active =
    screen === 'signup' ? 0 : screen === 'verify' ? 1 : screen === 'onboarding' ? 2 : null;

  return (
    <div className="auth-preview">
      <a href="#auth-main" className="auth-skip">
        Skip to content
      </a>
      <header className="auth-header">
        <Link href="/" className="auth-logo" aria-label="MakeMeTopper home">
          make<span>me</span>topper<b>.</b>
        </Link>
        <Link href="/courses" className="auth-text-link">
          Explore courses <span aria-hidden="true">↗</span>
        </Link>
      </header>
      <main id="auth-main" className="auth-main">
        <aside className="auth-story" aria-label="Your learning journey">
          <p className="auth-eyebrow">A LITTLE EVERY DAY. A LONG WAY AHEAD.</p>
          <h2>
            Find your focus.
            <br />
            Build your
            <br />
            <em>possibilities.</em>
          </h2>
          <p>
            From your first concept to your next big exam. Start with a goal that feels like you.
          </p>
          <div className="auth-path" aria-hidden="true">
            <span className="auth-path-label">YOUR NEXT CHAPTER</span>
            <div>
              <span className="auth-path-dot" />
              Choose a goal
            </div>
            <div>
              <span className="auth-path-dot" />
              Explore your subjects
            </div>
            <div>
              <span className="auth-path-dot" />
              Take the next small step <span>↗</span>
            </div>
          </div>
          <p className="auth-story-note">Your ambition. Your pace.</p>
        </aside>
        <section className="auth-panel" aria-labelledby="auth-title">
          {active !== null && (
            <ol className="auth-steps" aria-label="Account setup progress">
              {['Create account', 'Verify phone', 'Choose goal'].map((label, index) => (
                <li
                  key={label}
                  aria-current={active === index ? 'step' : undefined}
                  data-complete={index < active}
                >
                  <span className="tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                  {label}
                </li>
              ))}
            </ol>
          )}
          <p className="auth-eyebrow">{copy.eyebrow}</p>
          <h1 id="auth-title">{copy.title}</h1>
          <p className="auth-description">{copy.description}</p>
          <Suspense fallback={<Loading />}>
            <AuthClient screen={screen} />
          </Suspense>
        </section>
      </main>
      <footer className="auth-footer">
        <span>MakeMeTopper · Learning, one step at a time.</span>
        <Link href="/courses">Find your course</Link>
      </footer>
    </div>
  );
}

function Loading() {
  return (
    <p className="auth-loading" role="status">
      Loading…
    </p>
  );
}

function AuthClient({ screen }: { screen: AuthScreen }) {
  const params = useSearchParams();
  const next = getSafeNextUrl(params.get('next'), '/student/overview');

  return (
    <div className="auth-controls" key={`${screen}:${next}`}>
      {screen === 'login' && <CredentialsForm next={next} signup={false} />}
      {screen === 'signup' && <CredentialsForm next={next} signup />}
      {screen === 'verify' && <VerificationForm next={next} />}
      {screen === 'onboarding' && <OnboardingForm next={next} />}
      {screen === 'forgot-password' && <PasswordRecovery next={next} />}
    </div>
  );
}

function AuthForm({
  children,
  submitLabel,
  action,
}: {
  children: ReactNode;
  submitLabel: string;
  action: () => Promise<{ success: boolean; error?: string }>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      aria-busy={busy}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
          const result = await action();
          if (!result.success && result.error) setError(result.error);
        } catch (err) {
          setError(messageForError(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && (
        <p id="auth-error" className="auth-error" role="alert">
          {error}
        </p>
      )}
      <fieldset
        className="auth-form-fields"
        disabled={busy}
        aria-describedby={error ? 'auth-error' : undefined}
      >
        {children}
        <Button type="submit" className="auth-primary" disabled={busy}>
          {busy ? 'Please wait…' : submitLabel}
          <span aria-hidden="true">↗</span>
        </Button>
      </fieldset>
    </form>
  );
}

function PhoneField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="auth-field" htmlFor="auth-phone">
      Phone number
      <span className="auth-phone-input">
        <span aria-hidden="true">+91</span>
        <input
          id="auth-phone"
          name="phone"
          type="tel"
          autoComplete="tel-national"
          inputMode="tel"
          required
          value={value}
          onChange={(event) => onChange(digitsOnly(event.target.value).slice(0, 10))}
          placeholder="10-digit phone number"
          aria-describedby="auth-phone-note"
        />
      </span>
      <small id="auth-phone-note">Enter your 10-digit Indian mobile number.</small>
    </label>
  );
}

function PasswordField({
  value,
  onChange,
  current = false,
}: {
  value: string;
  onChange: (value: string) => void;
  current?: boolean;
}) {
  return (
    <label className="auth-field" htmlFor="auth-password">
      {current ? 'Password' : 'Choose a password'}
      <input
        id="auth-password"
        name="password"
        type="password"
        autoComplete={current ? 'current-password' : 'new-password'}
        required
        minLength={6}
        maxLength={128}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={current ? undefined : 'auth-password-note'}
      />
      {!current && <small id="auth-password-note">Use at least 6 characters.</small>}
    </label>
  );
}

function OtpField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="auth-field" htmlFor="auth-code">
      Verification code
      <input
        id="auth-code"
        name="code"
        className="auth-otp tabular-nums"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        pattern="[0-9]{6}"
        minLength={6}
        maxLength={6}
        value={value}
        onChange={(event) => onChange(digitsOnly(event.target.value).slice(0, 6))}
        aria-describedby="auth-code-note"
      />
      <small id="auth-code-note">Enter the 6-digit SMS verification code.</small>
    </label>
  );
}

function CredentialsForm({ signup, next }: { signup: boolean; next: string }) {
  const router = useRouter();
  const { signIn } = useAuth();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  return (
    <>
      <AuthForm
        submitLabel={signup ? 'Create account' : 'Log in'}
        action={async () => {
          if (!isValidNationalNumber(phone)) {
            return { success: false, error: 'Please enter a valid 10-digit mobile number.' };
          }
          const fullPhone = toE164(phone);

          if (signup) {
            const res = await signUp({ name: name.trim(), phone: fullPhone, password });
            if (!res.success) {
              return { success: false, error: res.error };
            }
            if (typeof window !== 'undefined') {
              sessionStorage.setItem('mmt_pending_phone', fullPhone);
            }
            router.push(authRoute('/signup/verify', next));
            return { success: true };
          } else {
            const res = await signIn(fullPhone, password);
            if (res.error) {
              return { success: false, error: res.error };
            }
            router.replace(next);
            return { success: true };
          }
        }}
      >
        {signup && (
          <label className="auth-field" htmlFor="auth-name">
            Full name
            <input
              id="auth-name"
              name="name"
              autoComplete="name"
              required
              minLength={2}
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        )}
        <PhoneField value={phone} onChange={setPhone} />
        <PasswordField value={password} onChange={setPassword} current={!signup} />
        {!signup && (
          <Link className="auth-text-link auth-forgot" href={authRoute('/forgot-password', next)}>
            Forgot password?
          </Link>
        )}
      </AuthForm>
      <p className="auth-switch">
        {signup ? 'Already have an account?' : 'New here?'}{' '}
        <Link href={authRoute(signup ? '/login' : '/signup', next)}>
          {signup ? 'Log in' : 'Create account'}
        </Link>
      </p>
    </>
  );
}

function VerificationForm({ next }: { next: string }) {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(60);
  const [resending, setResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem('mmt_pending_phone');
      if (stored) {
        setPhone(stored);
      } else {
        router.replace(authRoute('/signup', next));
      }
    }
  }, [next, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleResend = async () => {
    if (cooldown > 0 || resending || !phone) return;
    setResending(true);
    setResendStatus(null);
    try {
      const res = await resendOtp(phone);
      if (res.success) {
        setResendStatus('A new 6-digit code has been sent to your phone.');
        setCooldown(60);
      } else {
        setResendStatus(res.error || 'Failed to resend code. Please try again.');
      }
    } catch {
      setResendStatus('Failed to resend code. Please try again.');
    } finally {
      setResending(false);
    }
  };

  if (!phone) return <Loading />;

  return (
    <>
      <p className="auth-note">
        Verifying <strong className="tabular-nums">{phone}</strong>
      </p>
      <AuthForm
        submitLabel="Verify phone"
        action={async () => {
          const res = await verifyOtp({ phone, token: code });
          if (!res.success) {
            return { success: false, error: res.error };
          }
          if (typeof window !== 'undefined') {
            sessionStorage.removeItem('mmt_pending_phone');
          }
          router.replace(authRoute('/onboarding', next));
          return { success: true };
        }}
      >
        <OtpField value={code} onChange={setCode} />
        <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {resendStatus && (
            <p
              style={{
                color: resendStatus.includes('sent') ? '#15803d' : '#b91c1c',
                fontSize: '0.8rem',
                margin: 0,
                fontWeight: 600
              }}
            >
              {resendStatus}
            </p>
          )}
          <button
            type="button"
            onClick={handleResend}
            disabled={cooldown > 0 || resending}
            className="auth-text-link"
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: cooldown > 0 || resending ? 'not-allowed' : 'pointer',
              opacity: cooldown > 0 || resending ? 0.65 : 1,
              textAlign: 'left',
              fontSize: '0.82rem',
              fontWeight: 600,
            }}
          >
            {resending
              ? 'Sending new code…'
              : cooldown > 0
              ? `Resend code in ${cooldown}s`
              : 'Didn’t receive code? Resend OTP'}
          </button>
        </div>
      </AuthForm>
      <p className="auth-switch">
        <Link href={authRoute('/signup', next)}>Start again</Link>
      </p>
    </>
  );
}

function OnboardingForm({ next }: { next: string }) {
  const router = useRouter();
  const [goal, setGoal] = useState<LearnerGoal>('NEET');
  const [email, setEmail] = useState('');
  const [emailStep, setEmailStep] = useState(false);

  return (
    <AuthForm
      key={String(emailStep)}
      submitLabel={emailStep ? 'Save and continue' : 'Continue'}
      action={async () => {
        if (!goal) return { success: false, error: 'Choose a learning goal to continue.' };
        if (!emailStep) {
          setEmailStep(true);
          return { success: true };
        }

        try {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (!user) {
            router.replace(authRoute('/login', next));
            return { success: true };
          }

          // Map goal code to stream_id
          const { data: streamRow } = await supabase
            .from('streams')
            .select('stream_id')
            .ilike('code', goal)
            .maybeSingle();

          const streamId = streamRow?.stream_id || null;

          const updatePayload: Record<string, any> = {};
          if (streamId) updatePayload.selected_stream_id = streamId;
          if (email.trim()) updatePayload.email = email.trim();

          if (Object.keys(updatePayload).length > 0) {
            await supabase.from('profiles').update(updatePayload).eq('profile_id', user.id);
            if (streamId) {
              await supabase
                .from('student_details')
                .update({ selected_stream_id: streamId })
                .eq('student_id', user.id);
            }
          }

          router.replace(next);
          return { success: true };
        } catch (err) {
          return { success: false, error: messageForError(err) };
        }
      }}
    >
      {!emailStep ? (
        <>
          <fieldset className="auth-goals" aria-describedby="auth-goal-note">
            <legend>
              My learning goal <span>(choose one)</span>
            </legend>
            <div className="auth-goal-grid">
              {LEARNER_GOALS.map((entry) => (
                <label key={entry} className="auth-goal" data-selected={goal === entry}>
                  <input
                    type="radio"
                    name="goal"
                    value={entry}
                    checked={goal === entry}
                    required
                    onChange={() => setGoal(entry)}
                  />
                  <span>
                    <strong>{GOAL_META[entry].label}</strong>
                    <small>{GOAL_META[entry].blurb}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <p id="auth-goal-note" className="auth-note">
            One focus for now. You can change your goal anytime from your profile.
          </p>
        </>
      ) : (
        <>
          <p className="auth-note">
            Your goal: <strong>{GOAL_META[goal].label}</strong> ·{' '}
            <button
              className="auth-text-link"
              type="button"
              onClick={() => setEmailStep(false)}
            >
              Change
            </button>
          </p>
          <label className="auth-field" htmlFor="auth-email">
            Email address <span>(optional)</span>
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoFocus
            />
          </label>
          <p className="auth-note">Leave this blank if you prefer to add it later.</p>
        </>
      )}
    </AuthForm>
  );
}

function PasswordRecovery({ next }: { next: string }) {
  const router = useRouter();
  const [step, setStep] = useState<'phone' | 'otp' | 'password'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');

  return (
    <>
      <p className="auth-note" role="status">
        {step === 'phone'
          ? 'Step 1 of 3 · Find your account'
          : step === 'otp'
          ? 'Step 2 of 3 · Verify your phone'
          : 'Step 3 of 3 · Set a new password'}
      </p>
      <AuthForm
        key={step}
        submitLabel={
          step === 'phone'
            ? 'Continue'
            : step === 'otp'
            ? 'Verify phone'
            : 'Save new password'
        }
        action={async () => {
          if (step === 'phone') {
            if (!isValidNationalNumber(phone)) {
              return { success: false, error: 'Please enter a valid 10-digit mobile number.' };
            }
            const fullPhone = toE164(phone);
            const { error } = await supabase.auth.signInWithOtp({
              phone: fullPhone,
              options: { shouldCreateUser: false },
            });
            if (error) {
              return { success: false, error: messageForError(error) };
            }
            setStep('otp');
            return { success: true };
          }
          if (step === 'otp') {
            const fullPhone = toE164(phone);
            const res = await verifyOtp({ phone: fullPhone, token: code });
            if (!res.success) {
              return { success: false, error: res.error };
            }
            setStep('password');
            return { success: true };
          }
          if (password.length < 6) {
            return { success: false, error: 'Password must be at least 6 characters.' };
          }
          if (password !== confirmation) {
            return { success: false, error: 'Passwords do not match.' };
          }
          const res = await updatePassword(password);
          if (!res.success) {
            return { success: false, error: res.error };
          }
          router.replace(authRoute('/login', next));
          return { success: true };
        }}
      >
        {step === 'phone' && <PhoneField value={phone} onChange={setPhone} />}
        {step === 'otp' && <OtpField value={code} onChange={setCode} />}
        {step === 'password' && (
          <>
            <PasswordField value={password} onChange={setPassword} />
            <label className="auth-field" htmlFor="auth-confirm">
              Confirm new password
              <input
                id="auth-confirm"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                maxLength={128}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
          </>
        )}
      </AuthForm>
      {step !== 'phone' && (
        <button
          className="auth-reset"
          type="button"
          onClick={() => {
            setCode('');
            setPassword('');
            setConfirmation('');
            setStep('phone');
          }}
        >
          Start again
        </button>
      )}
      <p className="auth-switch">
        <Link href={authRoute('/login', next)}>Back to login</Link>
      </p>
    </>
  );
}
