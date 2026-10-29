import type { Metadata } from 'next';
import { Hanken_Grotesk } from 'next/font/google';
import { AppProviders } from '@/components/providers';
import './globals.css';

const font = Hanken_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap' });

export const metadata: Metadata = { title: 'Relay — WhatsApp campaigns for your business', description: 'Manage contacts, consent and WhatsApp campaigns with honest delivery reporting.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={font.className}><AppProviders>{children}</AppProviders></body>
    </html>
  );
}
