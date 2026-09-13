import Link from 'next/link';

export function Footer(): React.JSX.Element {
  return (
    <footer className="border-t py-6">
      <div className="container mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 text-sm text-muted-foreground sm:flex-row">
        <p>&copy; {new Date().getFullYear()} BRO — AI Assistant Platform</p>
        <div className="flex items-center gap-4">
          <Link href="/privacy" className="transition-colors hover:text-foreground">
            Privacy Policy
          </Link>
          <Link href="/terms" className="transition-colors hover:text-foreground">
            Terms of Service
          </Link>
          <Link href="/settings" className="transition-colors hover:text-foreground">
            Settings
          </Link>
        </div>
      </div>
    </footer>
  );
}
