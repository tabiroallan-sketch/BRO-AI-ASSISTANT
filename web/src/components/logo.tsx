import Image from 'next/image';
import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
  priority?: boolean;
  /** Use the small (navbar-size) variant instead of the full-resolution image. */
  icon?: boolean;
}

export function Logo({ className, priority, icon = false }: LogoProps): React.JSX.Element {
  return (
    <Image
      src={icon ? '/logo-icon.png' : '/logo.png'}
      alt="BRO logo"
      width={icon ? 96 : 1024}
      height={icon ? 144 : 1536}
      priority={priority}
      className={cn('h-8 w-auto object-contain', className)}
    />
  );
}
