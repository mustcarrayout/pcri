import solarlunar from "solarlunar";

export type DayMetaKind = "festival" | "term" | null;

export interface DayMeta {
  lunarText: string;
  label: string;
  special: string | null;
  kind: DayMetaKind;
  rest: string | null;
  work: string | null;
}

function expandRange(
  year: number,
  start: [number, number],
  end: [number, number],
  name: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  const cursor = new Date(year, start[0] - 1, start[1]);
  const last = new Date(year, end[0] - 1, end[1]);
  for (; cursor <= last; cursor.setDate(cursor.getDate() + 1))
    out[
      `${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`
    ] = name;
  return out;
}

// 法定节假日按国务院办公厅通知逐年公布，更新下面两张表即可（来源：中国政府网放假安排通知）。
// 未收录的年份仍会显示农历和传统节日，只是没有 休/班 角标。
const REST_DAYS: Record<number, Record<string, string>> = {
  2025: Object.assign(
    {},
    expandRange(2025, [1, 1], [1, 1], "元旦"),
    expandRange(2025, [1, 28], [2, 4], "春节"),
    expandRange(2025, [4, 4], [4, 6], "清明节"),
    expandRange(2025, [5, 1], [5, 5], "劳动节"),
    expandRange(2025, [5, 31], [6, 2], "端午节"),
    expandRange(2025, [10, 1], [10, 8], "国庆节·中秋节"),
  ),
  2026: Object.assign(
    {},
    expandRange(2026, [1, 1], [1, 3], "元旦"),
    expandRange(2026, [2, 15], [2, 23], "春节"),
    expandRange(2026, [4, 4], [4, 6], "清明节"),
    expandRange(2026, [5, 1], [5, 5], "劳动节"),
    expandRange(2026, [6, 19], [6, 21], "端午节"),
    expandRange(2026, [9, 25], [9, 27], "中秋节"),
    expandRange(2026, [10, 1], [10, 7], "国庆节"),
  ),
};
const WORK_DAYS: Record<number, Record<string, string>> = {
  2025: Object.assign(
    {},
    expandRange(2025, [1, 26], [1, 26], "春节调休"),
    expandRange(2025, [2, 8], [2, 8], "春节调休"),
    expandRange(2025, [4, 27], [4, 27], "劳动节调休"),
    expandRange(2025, [9, 28], [9, 28], "国庆节调休"),
    expandRange(2025, [10, 11], [10, 11], "国庆节调休"),
  ),
  2026: Object.assign(
    {},
    expandRange(2026, [1, 4], [1, 4], "元旦调休"),
    expandRange(2026, [2, 14], [2, 14], "春节调休"),
    expandRange(2026, [2, 28], [2, 28], "春节调休"),
    expandRange(2026, [5, 9], [5, 9], "劳动节调休"),
    expandRange(2026, [9, 20], [9, 20], "国庆节调休"),
    expandRange(2026, [10, 10], [10, 10], "国庆节调休"),
  ),
};

export function getDayMeta(date: Date): DayMeta {
  const empty: DayMeta = {
    lunarText: "",
    label: "",
    special: null,
    kind: null,
    rest: null,
    work: null,
  };
  const lunar = solarlunar.solar2lunar(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  );
  if (lunar === -1) return empty;
  const festivals = solarlunar.getFestivals(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  ) as string[];
  const festival = festivals[0] || null;
  const term = lunar.term || null;
  const special = festival || term;
  const key = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return {
    lunarText: `${lunar.monthCn}${lunar.dayCn}`,
    label: special || (lunar.lDay === 1 ? lunar.monthCn : lunar.dayCn),
    special,
    kind: festival ? "festival" : term ? "term" : null,
    rest: REST_DAYS[date.getFullYear()]?.[key] ?? null,
    work: WORK_DAYS[date.getFullYear()]?.[key] ?? null,
  };
}
