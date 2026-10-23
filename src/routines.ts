export interface Routine {
  id: string;
  name: string;
  prompt: string;
  time: string;
  endTime: string;
  enabled: boolean;
}

const ROUTINES_KEY = "shixu-routines-v1";
const FIRED_KEY = "shixu-routine-fired-v1";

export function loadRoutines(): Routine[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(ROUTINES_KEY) || "[]",
    ) as Routine[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRoutines(routines: Routine[]) {
  localStorage.setItem(ROUTINES_KEY, JSON.stringify(routines));
}

export function loadFiredMap(): Record<string, string> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(FIRED_KEY) || "{}",
    ) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveFiredMap(map: Record<string, string>) {
  localStorage.setItem(FIRED_KEY, JSON.stringify(map));
}

// 到点且当天未触发即到期；错过了结束时间（如睡前故事过了点）就不再补。
export function isDue(
  routine: Routine,
  nowHM: string,
  lastFired: string | undefined,
  todayKey: string,
): boolean {
  if (!routine.enabled || lastFired === todayKey) return false;
  if (nowHM < routine.time) return false;
  if (routine.endTime && nowHM > routine.endTime) return false;
  return true;
}
