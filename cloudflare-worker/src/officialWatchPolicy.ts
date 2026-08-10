export interface OfficialWatchWindow {
  activationPolicy: "official_calendar_presence";
  endsOn: string;
  active: boolean;
}

function parseStrictReleaseDate(releaseDate: string): { year: number; month: number; day: number } {
  const match = releaseDate.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Date de sortie invalide: ${releaseDate}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(`Date de sortie invalide: ${releaseDate}`);
  }
  return { year, month, day };
}

function daysInUtcMonth(year: number, monthOneBased: number): number {
  return new Date(Date.UTC(year, monthOneBased, 0, 12, 0, 0)).getUTCDate();
}

export function oneCalendarMonthAfter(releaseDate: string): string {
  const { year, month, day } = parseStrictReleaseDate(releaseDate);
  const zeroBasedTarget = month;
  const targetYear = year + Math.floor(zeroBasedTarget / 12);
  const targetMonthZeroBased = zeroBasedTarget % 12;
  const targetMonthOneBased = targetMonthZeroBased + 1;
  const targetDay = Math.min(day, daysInUtcMonth(targetYear, targetMonthOneBased));
  return `${targetYear}-${String(targetMonthOneBased).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

export function computeOfficialWatchWindow(
  releaseDate: string,
  now = new Date()
): OfficialWatchWindow {
  const endsOn = oneCalendarMonthAfter(releaseDate);
  const today = now.toISOString().slice(0, 10);
  return {
    activationPolicy: "official_calendar_presence",
    endsOn,
    active: today <= endsOn
  };
}
