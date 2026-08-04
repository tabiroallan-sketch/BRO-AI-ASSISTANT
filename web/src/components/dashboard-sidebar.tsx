'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Box,
  Brain,
  LayoutDashboard,
  Link2,
  MessageSquare,
  ScrollText,
  Wrench,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const items: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/conversations', label: 'Conversations', icon: MessageSquare },
  { href: '/dashboard/memories', label: 'Memories', icon: Brain },
  { href: '/dashboard/accounts', label: 'Connected accounts', icon: Link2 },
  { href: '/dashboard/tools', label: 'Installed tools', icon: Wrench },
  { href: '/dashboard/plugins', label: 'Plugins', icon: Box },
  { href: '/dashboard/automations', label: 'Automations', icon: Workflow },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/dashboard/logs', label: 'Logs', icon: ScrollText },
];

export function DashboardSidebar(): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav className="flex w-full shrink-0 gap-1 overflow-x-auto md:w-56 md:flex-col md:gap-1 md:overflow-visible">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
