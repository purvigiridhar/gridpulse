'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Zap, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { ErrorBanner, FieldError, Spinner, inputClass, primaryButtonClass } from '@/components/ui';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AUTH_ERRORS = {
  CredentialsSignin: 'Invalid email or password.',
  AuthUnavailable: 'Sign-in is temporarily unavailable. Please try again shortly.',
};

// Only allow same-site relative redirects (blocks open-redirect via ?callbackUrl=).
function safeCallback(url) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/dashboard';
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = safeCallback(params.get('callbackUrl'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');

    const errs = {};
    if (!email.trim()) errs.email = 'Email is required.';
    else if (!EMAIL_RE.test(email.trim())) errs.email = 'Enter a valid email address.';
    if (!password) errs.password = 'Password is required.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    setSubmitting(true);
    try {
      const res = await signIn('credentials', {
        email: email.trim(),
        password,
        redirect: false,
      });
      if (!res || res.error) {
        setError(AUTH_ERRORS[res?.error] || 'Unable to sign in. Please try again.');
        setSubmitting(false);
        return;
      }
      router.replace(callbackUrl); // middleware forwards /dashboard to the role's home
      router.refresh();
    } catch {
      setError('Network error. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/30">
          <Zap className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">GridPulse</h1>
        <p className="mt-1 text-sm text-slate-500">Sign in to your micro-grid energy hub</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <ErrorBanner message={error} onDismiss={() => setError('')} />

          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                id="email" type="email" autoComplete="email" autoFocus
                value={email} onChange={(e) => setEmail(e.target.value)}
                disabled={submitting} placeholder="you@example.com"
                aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email ? 'email-err' : undefined}
                className={`${inputClass} pl-9`}
              />
            </div>
            <FieldError id="email-err" message={fieldErrors.email} />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)}
                disabled={submitting} placeholder="••••••••"
                aria-invalid={!!fieldErrors.password} aria-describedby={fieldErrors.password ? 'password-err' : undefined}
                className={`${inputClass} pl-9 pr-10`}
              />
              <button
                type="button" onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <FieldError id="password-err" message={fieldErrors.password} />
          </div>

          <button type="submit" disabled={submitting} className={`${primaryButtonClass} w-full py-2.5`}>
            {submitting && <Spinner />}
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>

      {process.env.NODE_ENV !== 'production' && (
        <p className="mt-6 text-center text-xs text-slate-400">
          Dev seed accounts: admin@gridpulse.io · rajesh@gmail.com · ananya@gmail.com — password123
        </p>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-emerald-50 px-4 py-12">
      <Suspense fallback={<Spinner className="h-6 w-6 text-emerald-600" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
