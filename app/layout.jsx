import '@/app/globals.css';

export const metadata = {
  title: 'GridPulse - Smart Micro-Grid Hub',
  description: 'Decentralized P2P Energy Trading and Telemetry Platform',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full bg-slate-50">
      <body className="min-h-full text-slate-900 antialiased">{children}</body>
    </html>
  );
}
