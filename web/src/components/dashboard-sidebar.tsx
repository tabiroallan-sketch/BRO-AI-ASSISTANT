'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Activity,
  BarChart3,
  Bell,
  BellRing,
  Box,
  Brain,
  KeyRound,
  LayoutDashboard,
  Link2,
  MessageSquare,
  Monitor,
  ScrollText,
  ShieldCheck,
  Store,
  Wrench,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { ModeSwitcher } from '@/components/mode-switcher';

const items: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/notifications', label: 'Notifications', icon: Bell },
  { href: '/dashboard/proactive', label: 'Proactive', icon: BellRing },
  { href: '/dashboard/conversations', label: 'Conversations', icon: MessageSquare },
  { href: '/dashboard/memories', label: 'Memories', icon: Brain },
  { href: '/dashboard/system', label: 'Computer', icon: Monitor },
  { href: '/dashboard/accounts', label: 'Connected accounts', icon: Link2 },
  { href: '/dashboard/integrations', label: 'Marketplace', icon: Store },
  { href: '/dashboard/health', label: 'Health', icon: Activity },
  { href: '/dashboard/permissions', label: 'Permissions', icon: KeyRound },
  { href: '/dashboard/tools', label: 'Installed tools', icon: Wrench },
  { href: '/dashboard/automations', label: 'Automations', icon: Workflow },
  { href: '/dashboard/plugins', label: 'Plugins', icon: Box },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
];

const adminItems: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: '/dashboard/logs', label: 'Logs', icon: ScrollText },
  { href: '/dashboard/admin', label: 'Admin', icon: ShieldCheck },
];

export function DashboardSidebar(): React.JSX.Element {
  const pathname = usePathname();
  const { user } = useAuth();

  const visibleItems = user?.role === 'ADMIN' ? [...items, ...adminItems] : items;

  return (
    <nav className="glass flex w-full shrink-0 flex-row gap-1 overflow-x-auto rounded-2xl p-2 md:flex-col md:overflow-visible">
      {visibleItems.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'group relative flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-all duration-300',
              active
                ? 'bg-neon-cyan/10 text-neon-cyan'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          >
            {active && (
              <motion.span
                layoutId="sidebar-active-pill"
                className="absolute inset-0 rounded-xl bg-neon-cyan/10 ring-1 ring-neon-cyan/30 shadow-[0_0_18px_-6px_var(--neon-cyan)]"
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              />
            )}
            <span
              className={cn(
                'absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-neon-cyan shadow-[0_0_8px_var(--neon-cyan)] transition-opacity duration-300',
                active ? 'opacity-100' : 'opacity-0',
              )}
            />
            <item.icon
              className={cn(
                'relative h-4 w-4 shrink-0 transition-colors',
                active ? 'text-neon-cyan' : 'text-muted-foreground group-hover:text-foreground',
              )}
            />
            <span className="relative">{item.label}</span>
          </Link>
        );
      })}
      <ModeSwitcher className="mx-auto md:mt-auto md:flex-col md:rounded-2xl" />
    </nav>
  );
}
