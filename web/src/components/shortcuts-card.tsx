'use client';

import * as React from 'react';
import { Keyboard, Loader2, MonitorDown, RotateCcw } from 'lucide-react';
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  SHORTCUT_LABELS,
  acceleratorFromEvent,
  formatAccelerator,
  getDesktopApi,
  type ShortcutAction,
  type ShortcutBindings,
} from '@/lib/desktop';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function kbd(value: string): React.JSX.Element {
  return (
    <kbd className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs">
      {value}
    </kbd>
  );
}

/**
 * Global hotkey settings (Stage 3). Works only inside the desktop shell; in a
 * plain browser it explains where the feature lives.
 */
export const ShortcutsCard = React.memo(function ShortcutsCard(): React.JSX.Element {
  const api = getDesktopApi();
  const [bindings, setBindings] = React.useState<ShortcutBindings | null>(null);
  const [capturing, setCapturing] = React.useState<ShortcutAction | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!api) {
      return;
    }
    const desktop = api;
    let cancelled = false;
    async function bootstrap(): Promise<void> {
      const [config, current] = await Promise.all([desktop.config.get(), desktop.shortcuts.get()]);
      if (!cancelled) {
        setBindings({ ...config.shortcuts, ...current });
      }
    }
    void bootstrap();
    const unsubscribe = desktop.shortcuts.onChanged((next) => {
      if (!cancelled) {
        setBindings(next);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api]);

  async function commit(action: ShortcutAction, accelerator: string): Promise<void> {
    if (!api) {
      return;
    }
    setError(null);
    setNotice(null);
    const result = await api.shortcuts.set(action, accelerator);
    if (!result.ok) {
      setError(result.message);
      setNotice(null);
      return;
    }
    setBindings(result.bindings);
    setNotice(
      accelerator
        ? `${SHORTCUT_LABELS[action]} bound to ${formatAccelerator(accelerator)}.`
        : `${SHORTCUT_LABELS[action]} disabled.`,
    );
    setCapturing(null);
  }

  async function resetAll(): Promise<void> {
    if (!api) {
      return;
    }
    setError(null);
    setNotice(null);
    let next: ShortcutBindings = bindings ?? DEFAULT_SHORTCUTS;
    for (const action of SHORTCUT_ACTIONS) {
      const result = await api.shortcuts.set(action, DEFAULT_SHORTCUTS[action]);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      next = result.bindings;
    }
    setBindings(next);
    setNotice('Shortcuts restored to their defaults.');
  }

  if (!api) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4" /> Global hotkeys
          </CardTitle>
          <CardDescription>
            Shortcuts are available in the BRO desktop app. Open BRO to customize them.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Keyboard className="h-4 w-4" /> Global hotkeys
        </CardTitle>
        <CardDescription>
          BRO responds to these shortcuts anywhere on your computer, even when the window is hidden.
          Click a binding and press the new combination.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <MonitorDown className="h-4 w-4" /> {error}
          </p>
        )}
        {notice && <p className="text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}

        <ul className="divide-y divide-border rounded-lg border">
          {SHORTCUT_ACTIONS.map((action) => {
            const accelerator = bindings?.[action] ?? DEFAULT_SHORTCUTS[action];
            const active = capturing === action;
            return (
              <li
                key={action}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{SHORTCUT_LABELS[action]}</p>
                  {active ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Press a key combination… <span className="text-destructive">Esc cancels</span>
                    </p>
                  ) : accelerator ? (
                    <p className="mt-1">{kbd(formatAccelerator(accelerator))}</p>
                  ) : (
                    <p className="mt-0.5 text-xs text-muted-foreground">Disabled</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {active ? (
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Listening…
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCapturing(action);
                        setError(null);
                        setNotice(null);
                      }}
                    >
                      {accelerator ? 'Change' : 'Set'}
                    </Button>
                  )}
                  {!active && accelerator ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void commit(action, '')}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      Disable
                    </Button>
                  ) : null}
                  {active ? (
                    <CaptureInput
                      onCapture={(accelerator: string) => {
                        if (accelerator) {
                          void commit(action, accelerator);
                        } else {
                          setCapturing(null);
                        }
                      }}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Esc hides the overlay and also cancels recording. Push-to-talk uses a key with Alt
            because Windows reserves bare-modifier global shortcuts.
          </p>
          <Button variant="outline" size="sm" onClick={() => void resetAll()}>
            <RotateCcw className="h-4 w-4" /> Reset all
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});

/**
 * Invisible input that captures the next non-modifier keypress and reports the
 * accelerator. Esc cancels recording (returns '').
 */
function CaptureInput({
  onCapture,
}: {
  onCapture: (accelerator: string) => void;
}): React.JSX.Element {
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      onCapture('');
      return;
    }
    const accelerator = acceleratorFromEvent(event.nativeEvent);
    if (accelerator) {
      onCapture(accelerator);
    }
  }

  return (
    <input
      ref={inputRef}
      aria-label="New shortcut"
      className="absolute h-px w-px opacity-0"
      onKeyDown={handleKeyDown}
      onBlur={() => onCapture('')}
      autoFocus
    />
  );
}
