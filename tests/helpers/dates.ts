export function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

export function isoDaysFromNow(days: number): string {
  return daysFromNow(days).toISOString();
}
