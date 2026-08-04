import type { Metadata } from 'next';
import { AppFrame } from '@/components/app-frame';
import { ThemeProvider } from '@/components/theme-provider';
import { AuthProvider } from '@/lib/auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'BRO — AI Assistant Platform',
  description:
    'BRO is a production-grade AI assistant with chat, memory, voice, tools, and automation.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            <AppFrame>{children}</AppFrame>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
