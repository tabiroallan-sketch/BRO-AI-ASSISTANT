'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Footer } from '@/components/footer';
import { Navbar } from '@/components/navbar';
import { getDesktopApi } from '@/lib/desktop';
import { setModeNavigator } from '@/lib/mode-store';

/**
 * Routes that render inside the AI OS chrome (status bar, background,
 * shell) instead of the legacy marketing navbar + footer.
 */
const OS_ROUTES = ['/dashboard', '/overlay', '/voice'];

export function AppFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const isOsRoute = OS_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  // Let the mode store route to the matching surface when the mode changes,
  // and follow navigation requests from the desktop shell (tray, app menu,
  // window orchestration on mode switch).
  React.useEffect(() => {
    setModeNavigator((path) => router.push(path));
    const api = getDesktopApi();
    return api?.window?.onNavigate?.((path) => router.push(path));
  }, [router]);

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
