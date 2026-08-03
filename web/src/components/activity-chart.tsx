import * as React from 'react';

export function ActivityChart({
  daily,
}: {
  daily: Array<{ date: string; count: number }>;
}): React.JSX.Element {
  const max = Math.max(1, ...daily.map((day) => day.count));

  return (
    <div>
      <div className="flex h-32 items-end gap-1">
        {daily.map((day) => {
          const height = day.count === 0 ? 2 : Math.max(5, Math.round((day.count / max) * 120));
          return (
            <div
              key={day.date}
              className="flex flex-1 items-end justify-center"
              title={`${day.date}: ${day.count}`}
            >
              <div
                className="w-full rounded-sm bg-primary/70"
                style={{ height: `${Math.min(height, 120)}px` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] text-muted-foreground">
        {daily.map((day, index) => (
          <div key={day.date} className="flex-1 text-center">
            {index % 3 === 0
              ? new Date(`${day.date}T00:00:00Z`).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })
              : ''}
          </div>
        ))}
      </div>
    </div>
  );
}
