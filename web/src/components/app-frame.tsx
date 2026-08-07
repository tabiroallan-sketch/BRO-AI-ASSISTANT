'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { Footer } from '@/components/footer';
import { Navbar } from '@/components/navbar';

/**
 * Routes that render inside the AI OS chrome (status bar, background,
 * shell) instead of the legacy marketing navbar + footer.
 */
const OS_ROUTES = ['/dashboard', '/overlay'];

export function AppFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  const pathname = usePathname();
  const isOsRoute = OS_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  if (isOsRoute) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
