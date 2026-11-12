import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import DashboardNav from '@/components/DashboardNav';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'GridPulse Dashboard' };

export default async function DashboardLayout({ children }) {
  // Middleware already guards this segment; this is a defence-in-depth check
  // and supplies the user to the nav.
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardNav user={session.user} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
