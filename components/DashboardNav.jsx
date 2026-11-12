'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Zap, LayoutDashboard, Home, LogOut, Menu, X, ShieldCheck, Sun } from 'lucide-react';
import { Badge } from '@/components/ui';

const NAV = {
  ADMIN: [{ href: '/dashboard/admin', label: 'Grid Control', icon: LayoutDashboard }],
  PROSUMER: [{ href: '/dashboard/prosumer', label: 'My Energy', icon: Home }],
};

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
}

export default function DashboardNav({ user }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const links = NAV[user.user_role] ?? [];
  const isAdmin = user.user_role === 'ADMIN';

  async function handleSignOut() {
    setSigningOut(true);
    await signOut({ callbackUrl: '/login' });
  }

  const profile = (
    <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white">
        {initials(user.full_name)}
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block max-w-[10rem] truncate text-sm font-medium text-slate-900">{user.full_name}</span>
        <span className="block max-w-[10rem] truncate text-xs text-slate-500">{user.email}</span>
      </span>
      <Badge tone={isAdmin ? 'amber' : 'emerald'}>
        {isAdmin ? <ShieldCheck className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
        {user.user_role}
      </Badge>
    </div>
  );

  const signOutBtn = (
    <button
      type="button" onClick={handleSignOut} disabled={signingOut}
      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      {signingOut ? 'Signing out…' : 'Sign out'}
    </button>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-2 font-bold tracking-tight text-slate-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <Zap className="h-4 w-4" aria-hidden="true" />
            </span>
            GridPulse
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {links.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href} href={href} aria-current={active ? 'page' : undefined}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    active ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="hidden items-center gap-3 md:flex">
          {profile}
          {signOutBtn}
        </div>

        <button
          type="button" onClick={() => setOpen((o) => !o)}
          aria-expanded={open} aria-label="Toggle menu"
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 md:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="space-y-4 border-t border-slate-200 bg-white px-4 py-4 md:hidden">
          <nav className="space-y-1" aria-label="Mobile">
            {links.map(({ href, label, icon: Icon }) => (
              <Link
                key={href} href={href} onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {profile}
            {signOutBtn}
          </div>
        </div>
      )}
    </header>
  );
}
