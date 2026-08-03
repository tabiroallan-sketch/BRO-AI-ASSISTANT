import * as React from 'react';
import { cn } from '@/lib/utils';

function Separator({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('shrink-0 bg-border', className)} {...props} />;
}

export { Separator };
