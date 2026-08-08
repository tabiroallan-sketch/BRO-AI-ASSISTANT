'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Logo } from '@/components/logo';
import { NotificationsMenu } from '@/components/notifications-menu';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/chat', label: 'Chat' },
  { href: '/memories', label: 'Memories' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/settings', label: 'Settings' },
];

export function Navbar(): React.JSX.Element {
  const { status, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const authenticated = status === 'authenticated';

  async function handleLogout(): Promise<void> {
    await logout();
    router.push('/');
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Logo icon className="h-6 w-auto" />
            <span>BRO</span>
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground',
                  pathname === link.href
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {authenticated && <NotificationsMenu />}
          <ThemeToggle />
          {status === 'loading' ? null : authenticated ? (
            <Button variant="outline" size="sm" onClick={() => void handleLogout()}>
              Sign out
            </Button>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  Sign in
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm">Get started</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
