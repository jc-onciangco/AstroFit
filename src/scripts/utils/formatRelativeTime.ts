// src/utils/formatRelativeTime.ts
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return "JUST NOW";
  if (diffHours < 24) return `${diffHours} HR${diffHours === 1 ? "" : "S"} AGO`;
  return `${diffDays} DAY${diffDays === 1 ? "" : "S"} AGO`;
}
