// ── 学习闭环:百日挑战 + 复习队列 + 掌握地图 ──
// 规格来源:designs/shixu-learning-loop/fsd.md(P0 范围)
// 原则:挑战、卡片、知识点都是学习主题的附属,不修改日历事件本体。
// 真机存 Android SQLite(loop_* 表);浏览器降级 localStorage(仅开发预览)。
import { Capacitor } from "@capacitor/core";
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from "@capacitor-community/sqlite";

// ── 类型 ──

export type ChallengeStatus = "active" | "paused" | "finished" | "abandoned";
export type CheckinKind = "event" | "light" | "freeze";
export type PointStatus = "dark" | "touched" | "shaky" | "mastered";
export type BloomLevel = "recall" | "explain" | "apply" | "create";
export type CardStatus = "draft" | "active" | "suspended" | "archived";
export type ReviewGrade = "forgot" | "fuzzy" | "recall";

export interface Challenge {
  id: string;
  topicId: string;
  topicTitle: string;
  startDate: string;
  totalDays: number;
  threshold: "one_event" | "minutes";
  thresholdMinutes: number | null;
  freezesLeft: number;
  status: ChallengeStatus;
  /** daily_settle 幂等标记:已结算到的「结算执行日」 */
  settledOn: string;
  /** 目标笔记:Pi create_challenge 确认后随挑战落库(FSD §6.1) */
  goalNote: string;
}

export interface Checkin {
  id: string;
  challengeId: string;
  date: string;
  kind: CheckinKind;
  eventId: string | null;
  noteId: string | null;
}

export interface KnowledgePoint {
  id: string;
  topicId: string;
  name: string;
  bloomLevel: BloomLevel;
  mastery: number;
  status: PointStatus;
  lastEvidenceAt: string | null;
}

export interface ReviewCard {
  id: string;
  topicId: string;
  pointId: string | null;
  sourceType: "pdca" | "transcript" | "reflection" | "manual";
  sourceId: string;
  sourceTitle: string;
  front: string;
  back: string;
  ease: number;
  intervalDays: number;
  dueDate: string;
  status: CardStatus;
}

export interface TeachbackResult {
  pointId: string;
  covered: boolean;
  quote: string;
}

export interface ReviewLogEntry {
  id: string;
  cardId: string;
  reviewedAt: string;
  grade: ReviewGrade;
}

// ── 常量(FSD §4.2 / §5.2)──

export const DAILY_QUEUE_LIMIT = 20;
export const NEW_CARDS_PER_DAY = 10;
export const MASTER_THRESHOLD = 0.85;
export const SHAKY_THRESHOLD = 0.5;
/** BKT 默认参数,后续可做主题级覆盖 */
export const BKT = { p0: 0.1, learn: 0.15, guess: 0.2, slip: 0.1 };

// Pi 三工具常量(FSD §6.1:建议制,工具只产草稿与文案)
/** 挑战天数夹取区间 */
export const CHALLENGE_DAYS_MIN = 7;
export const CHALLENGE_DAYS_MAX = 365;
/** 目标笔记草稿截断上限 */
export const GOAL_NOTE_LIMIT = 200;
/** draft_cards 首调来源文本截断上限(pdca/voiceNote/reflection 各一份) */
export const PI_SOURCE_TEXT_LIMIT = 400;
/** draft_cards 复调单次最多起草张数 */
export const PI_CARD_BATCH_LIMIT = 10;
/** challenge_reminder 缓存文案长度上限 */
export const REMINDER_TITLE_LIMIT = 30;
export const REMINDER_BODY_LIMIT = 160;
/** 静态回退文案,与 P0 通知模板逐字一致(CalendarApp syncLoopNotifications) */
export const LOOP_REMINDER_TITLE = "拾序 · 今日复习";
export const LOOP_REMINDER_BODY = "复习队列已就绪,几分钟就能清空;边缘知识点优先。";

const DB_VERSION = 1;
const LOOP_KEY = "shixu-learning-loop-v1";
const MILLISECONDS_PER_DAY = 86_400_000;

// ── 内存态 + 存储后端 ──

interface LoopStore {
  challenges: Challenge[];
  checkins: Checkin[];
  points: KnowledgePoint[];
  cards: ReviewCard[];
  reviewLogs: ReviewLogEntry[];
  teachbacks: {
    id: string;
    topicId: string;
    transcriptId: string;
    result: TeachbackResult[];
    createdAt: string;
  }[];
}

const emptyStore = (): LoopStore => ({
  challenges: [],
  checkins: [],
  points: [],
  cards: [],
  reviewLogs: [],
  teachbacks: [],
});

let store: LoopStore = emptyStore();
let db: SQLiteDBConnection | null = null;
let backend: "sqlite" | "local" = "local";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS loop_challenge (
    id TEXT PRIMARY KEY NOT NULL, topic_id TEXT NOT NULL, topic_title TEXT NOT NULL,
    start_date TEXT NOT NULL, total_days INTEGER NOT NULL,
    threshold TEXT NOT NULL, threshold_minutes INTEGER,
    freezes_left INTEGER NOT NULL DEFAULT 2,
    status TEXT NOT NULL DEFAULT 'active', settled_on TEXT NOT NULL DEFAULT '',
    goal_note TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS loop_checkin (
    id TEXT PRIMARY KEY NOT NULL, challenge_id TEXT NOT NULL, date TEXT NOT NULL,
    kind TEXT NOT NULL, event_id TEXT, note_id TEXT,
    UNIQUE(challenge_id, date)
  );
  CREATE TABLE IF NOT EXISTS loop_point (
    id TEXT PRIMARY KEY NOT NULL, topic_id TEXT NOT NULL, name TEXT NOT NULL,
    bloom_level TEXT NOT NULL, mastery REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'dark', last_evidence_at TEXT,
    UNIQUE(topic_id, name)
  );
  CREATE TABLE IF NOT EXISTS loop_card (
    id TEXT PRIMARY KEY NOT NULL, topic_id TEXT NOT NULL, point_id TEXT,
    source_type TEXT NOT NULL, source_id TEXT NOT NULL, source_title TEXT NOT NULL DEFAULT '',
    front TEXT NOT NULL, back TEXT NOT NULL,
    ease REAL NOT NULL DEFAULT 2.5, interval_days REAL NOT NULL DEFAULT 0,
    due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft'
  );
  CREATE TABLE IF NOT EXISTS loop_review_log (
    id TEXT PRIMARY KEY NOT NULL, card_id TEXT NOT NULL,
    reviewed_at TEXT NOT NULL, grade TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS loop_teachback (
    id TEXT PRIMARY KEY NOT NULL, topic_id TEXT NOT NULL, transcript_id TEXT NOT NULL,
    result_json TEXT NOT NULL, created_at TEXT NOT NULL
  );
`;

async function initSqlite(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const connection = new SQLiteConnection(CapacitorSQLite);
    const nativeDb = await connection.createConnection(
      "shixu",
      false,
      "no-encryption",
      DB_VERSION,
      false,
    );
    await nativeDb.open();
    await nativeDb.execute(SCHEMA);
    db = nativeDb;
    backend = "sqlite";
    await migrateLoopSchema();
    return true;
  } catch {
    // SQLite 初始化失败时退回 localStorage,不阻塞应用
    db = null;
    backend = "local";
    return false;
  }
}

/** 旧库迁移(FSD §6.1):loop_challenge 缺 goal_note 列时 PRAGMA 探测后 ALTER 补上 */
async function migrateLoopSchema(): Promise<void> {
  if (!db) return;
  try {
    const info = await db.query("PRAGMA table_info(loop_challenge)");
    const columns = new Set((info.values || []).map((row) => String(row.name)));
    if (columns.size > 0 && !columns.has("goal_note"))
      await db.execute(
        "ALTER TABLE loop_challenge ADD COLUMN goal_note TEXT NOT NULL DEFAULT ''",
      );
  } catch {
    // 探测失败不阻塞启动;读取时 goal_note 兜底空串
  }
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(LOOP_KEY);
    const parsed = raw ? (JSON.parse(raw) as LoopStore) : null;
    store = { ...emptyStore(), ...(parsed || {}) };
    // 旧数据挑战行缺 goalNote:读补空串而非 undefined(FSD §6.1)
    store.challenges = (store.challenges || []).map((item) => ({
      ...item,
      goalNote: typeof item.goalNote === "string" ? item.goalNote : "",
    }));
  } catch {
    store = emptyStore();
  }
}

/** SQLite 写入:表都很小(个人规模),整表重写最简单且不会漏行 */
async function saveSqlite() {
  if (!db) return;
  await db.execute("BEGIN");
  try {
    await db.execute(
      "DELETE FROM loop_challenge; DELETE FROM loop_checkin; DELETE FROM loop_point; DELETE FROM loop_card; DELETE FROM loop_review_log; DELETE FROM loop_teachback;",
    );
    for (const c of store.challenges)
      await db.run(
        `INSERT INTO loop_challenge (id,topic_id,topic_title,start_date,total_days,threshold,threshold_minutes,freezes_left,status,settled_on,goal_note) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          c.id,
          c.topicId,
          c.topicTitle,
          c.startDate,
          c.totalDays,
          c.threshold,
          c.thresholdMinutes,
          c.freezesLeft,
          c.status,
          c.settledOn,
          c.goalNote,
        ],
      );
    for (const row of store.checkins)
      await db.run(
        `INSERT INTO loop_checkin (id,challenge_id,date,kind,event_id,note_id) VALUES (?,?,?,?,?,?)`,
        [row.id, row.challengeId, row.date, row.kind, row.eventId, row.noteId],
      );
    for (const p of store.points)
      await db.run(
        `INSERT INTO loop_point (id,topic_id,name,bloom_level,mastery,status,last_evidence_at) VALUES (?,?,?,?,?,?,?)`,
        [p.id, p.topicId, p.name, p.bloomLevel, p.mastery, p.status, p.lastEvidenceAt],
      );
    for (const card of store.cards)
      await db.run(
        `INSERT INTO loop_card (id,topic_id,point_id,source_type,source_id,source_title,front,back,ease,interval_days,due_date,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          card.id,
          card.topicId,
          card.pointId,
          card.sourceType,
          card.sourceId,
          card.sourceTitle,
          card.front,
          card.back,
          card.ease,
          card.intervalDays,
          card.dueDate,
          card.status,
        ],
      );
    for (const log of store.reviewLogs)
      await db.run(
        `INSERT INTO loop_review_log (id,card_id,reviewed_at,grade) VALUES (?,?,?,?)`,
        [log.id, log.cardId, log.reviewedAt, log.grade],
      );
    for (const t of store.teachbacks)
      await db.run(
        `INSERT INTO loop_teachback (id,topic_id,transcript_id,result_json,created_at) VALUES (?,?,?,?,?)`,
        [t.id, t.topicId, t.transcriptId, JSON.stringify(t.result), t.createdAt],
      );
    await db.execute("COMMIT");
  } catch {
    await db.execute("ROLLBACK").catch(() => undefined);
    throw new Error("学习闭环数据保存失败");
  }
}

function persist() {
  if (backend === "sqlite") void saveSqlite().catch(() => undefined);
  else {
    try {
      localStorage.setItem(LOOP_KEY, JSON.stringify(store));
    } catch {
      /* 存储满时静默:预览环境可接受 */
    }
  }
}

/** 初始化学习闭环存储;返回使用的后端名 */
export async function initLoopStorage(): Promise<"sqlite" | "local"> {
  if (await initSqlite()) {
    const ch = await db!.query("SELECT * FROM loop_challenge");
    store.challenges = (ch.values || []).map((row) => ({
      id: String(row.id),
      topicId: String(row.topic_id),
      topicTitle: String(row.topic_title || ""),
      startDate: String(row.start_date),
      totalDays: Number(row.total_days),
      threshold: row.threshold === "minutes" ? "minutes" : "one_event",
      thresholdMinutes: row.threshold_minutes ? Number(row.threshold_minutes) : null,
      freezesLeft: Number(row.freezes_left),
      status: String(row.status) as ChallengeStatus,
      settledOn: String(row.settled_on || ""),
      goalNote: String(row.goal_note || ""),
    }));
    const ci = await db!.query("SELECT * FROM loop_checkin");
    store.checkins = (ci.values || []).map((row) => ({
      id: String(row.id),
      challengeId: String(row.challenge_id),
      date: String(row.date),
      kind: String(row.kind) as CheckinKind,
      eventId: row.event_id ? String(row.event_id) : null,
      noteId: row.note_id ? String(row.note_id) : null,
    }));
    const pt = await db!.query("SELECT * FROM loop_point");
    store.points = (pt.values || []).map((row) => ({
      id: String(row.id),
      topicId: String(row.topic_id),
      name: String(row.name),
      bloomLevel: String(row.bloom_level) as BloomLevel,
      mastery: Number(row.mastery),
      status: String(row.status) as PointStatus,
      lastEvidenceAt: row.last_evidence_at ? String(row.last_evidence_at) : null,
    }));
    const cd = await db!.query("SELECT * FROM loop_card");
    store.cards = (cd.values || []).map((row) => ({
      id: String(row.id),
      topicId: String(row.topic_id),
      pointId: row.point_id ? String(row.point_id) : null,
      sourceType: String(row.source_type) as ReviewCard["sourceType"],
      sourceId: String(row.source_id),
      sourceTitle: String(row.source_title || ""),
      front: String(row.front),
      back: String(row.back),
      ease: Number(row.ease),
      intervalDays: Number(row.interval_days),
      dueDate: String(row.due_date),
      status: String(row.status) as CardStatus,
    }));
    const rl = await db!.query("SELECT * FROM loop_review_log ORDER BY rowid");
    store.reviewLogs = (rl.values || []).map((row) => ({
      id: String(row.id),
      cardId: String(row.card_id),
      reviewedAt: String(row.reviewed_at),
      grade: String(row.grade) as ReviewGrade,
    }));
    const tb = await db!.query("SELECT * FROM loop_teachback");
    store.teachbacks = (tb.values || []).map((row) => ({
      id: String(row.id),
      topicId: String(row.topic_id),
      transcriptId: String(row.transcript_id),
      result: JSON.parse(String(row.result_json || "[]")) as TeachbackResult[],
      createdAt: String(row.created_at),
    }));
  } else {
    loadLocal();
  }
  return backend;
}

// ── Pi 三工具纯函数(FSD §6.1:create_challenge / draft_cards / challenge_reminder)──
// 一律建议制:这里只做规整与校验,落库仍走 createChallenge / createCard 由用户确认触发。

/** create_challenge 的会话确认卡草稿(FSD §6.1 ChallengeSuggestion) */
export interface ChallengeSuggestion {
  topicId: string;
  topicTitle: string;
  days: number;
  threshold: "one_event" | "minutes";
  goalNote: string;
}

/** 规整挑战草稿:缺 topicId 报错;days 夹取 [7,365](非法时默认 100);goalNote 截断至 GOAL_NOTE_LIMIT */
export function normalizeChallengeSuggestion(input: {
  topicId?: unknown;
  topicTitle?: unknown;
  days?: unknown;
  threshold?: unknown;
  goalNote?: unknown;
}): ChallengeSuggestion | { error: string } {
  const topicId = String(input.topicId ?? "").trim();
  if (!topicId) return { error: "挑战必须绑定学习主题" };
  const parsedDays = Number(input.days);
  const days = Number.isFinite(parsedDays)
    ? Math.min(CHALLENGE_DAYS_MAX, Math.max(CHALLENGE_DAYS_MIN, Math.round(parsedDays)))
    : 100;
  return {
    topicId,
    topicTitle: String(input.topicTitle ?? "").trim().slice(0, 60),
    days,
    threshold: input.threshold === "minutes" ? "minutes" : "one_event",
    goalNote: String(input.goalNote ?? "").trim().slice(0, GOAL_NOTE_LIMIT),
  };
}

export interface LoopCardSources {
  pdca: string;
  voiceNote: string;
  reflection: string;
}

/**
 * draft_cards 首调的来源读取(纯函数,零写入):
 * category='work'(钉钉)拒绝;三来源全空报错;非空字段各截断至 PI_SOURCE_TEXT_LIMIT。
 */
export function extractLoopCardSources(input: {
  category?: string;
  pdca?: { plan?: string; do?: string; check?: string; act?: string } | null;
  voiceNote?: string;
  reflection?: string;
}): LoopCardSources | { error: string } {
  if (input.category === "work") return { error: "钉钉/工作类事件不参与学习闭环" };
  const pdcaText = [input.pdca?.plan, input.pdca?.do, input.pdca?.check, input.pdca?.act]
    .map((text) => (text || "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, PI_SOURCE_TEXT_LIMIT);
  const voiceNote = (input.voiceNote || "").trim().slice(0, PI_SOURCE_TEXT_LIMIT);
  const reflection = (input.reflection || "").trim().slice(0, PI_SOURCE_TEXT_LIMIT);
  if (!pdcaText && !voiceNote && !reflection)
    return { error: "该事项没有可用的复习素材(PDCA、语音、复盘都为空)" };
  return { pdca: pdcaText, voiceNote, reflection };
}

export interface PiDraftCardInput {
  front: string;
  back: string;
  source: "pdca" | "transcript" | "reflection";
}

/** draft_cards 复调批量校验:超 PI_CARD_BATCH_LIMIT 张截断为前 N 张;front/back 为空的跳过并计入 skipped,不中断整批 */
export function normalizePiCardBatch(raw: unknown): {
  cards: PiDraftCardInput[];
  skipped: number;
  truncated: boolean;
} {
  const list = Array.isArray(raw) ? raw : [];
  const bounded = list.slice(0, PI_CARD_BATCH_LIMIT);
  const cards: PiDraftCardInput[] = [];
  let skipped = 0;
  for (const item of bounded) {
    const record = (item || {}) as Record<string, unknown>;
    const front = String(record.front ?? "").trim();
    const back = String(record.back ?? "").trim();
    if (!front || !back) {
      skipped += 1;
      continue;
    }
    const rawSource = String(record.source || "");
    const source: PiDraftCardInput["source"] =
      rawSource === "transcript" || rawSource === "reflection" ? rawSource : "pdca";
    cards.push({ front, back, source });
  }
  return { cards, skipped, truncated: list.length > PI_CARD_BATCH_LIMIT };
}

// ── 通知文案缓存(challenge_reminder:只管文案,不写 loop 库)──

const REMINDER_KEY = "shixu-loop-reminder-v1";

export interface LoopReminderCopy {
  date: string;
  title: string;
  body: string;
}

export function loadLoopReminderCopy(): LoopReminderCopy | null {
  try {
    const raw = localStorage.getItem(REMINDER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LoopReminderCopy> | null;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      date: typeof parsed.date === "string" ? parsed.date : "",
      title: typeof parsed.title === "string" ? parsed.title : "",
      body: typeof parsed.body === "string" ? parsed.body : "",
    };
  } catch {
    return null;
  }
}

/** 缓存当日文案(仅本地 localStorage,同日重调覆盖) */
export function cacheLoopReminderCopy(title: string, body: string): LoopReminderCopy {
  const copy: LoopReminderCopy = {
    date: todayKey(),
    title: title.trim().slice(0, REMINDER_TITLE_LIMIT) || LOOP_REMINDER_TITLE,
    body: body.trim().slice(0, REMINDER_BODY_LIMIT),
  };
  try {
    localStorage.setItem(REMINDER_KEY, JSON.stringify(copy));
  } catch {
    /* 存储满时静默;pick 未命中会回退静态模板 */
  }
  return copy;
}

/** 缓存命中(当天且标题/正文非空)返回缓存文案;未命中、过期或为空回退静态模板 */
export function pickLoopReminderCopy(
  cached: LoopReminderCopy | null | undefined,
  today: string,
): { title: string; body: string } {
  if (cached && cached.date === today && cached.title.trim() && cached.body.trim())
    return { title: cached.title, body: cached.body };
  return { title: LOOP_REMINDER_TITLE, body: LOOP_REMINDER_BODY };
}

// ── 日期工具 ──

export const dateKey = (value: Date) =>
  new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);

export const todayKey = () => dateKey(new Date());

export function addDays(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

const daysBetween = (from: string, to: string) =>
  Math.round(
    (new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) /
      MILLISECONDS_PER_DAY,
  );

// ── 挑战 ──

export function createChallenge(input: {
  topicId: string;
  topicTitle: string;
  totalDays?: number;
  threshold?: "one_event" | "minutes";
  thresholdMinutes?: number;
  startDate?: string;
  goalNote?: string; // Pi create_challenge 确认后随挑战落库(FSD §6.1)
}): Challenge | { error: string } {
  if (!input.topicId) return { error: "必须绑定学习主题" };
  const existing = store.challenges.find(
    (item) =>
      item.topicId === input.topicId &&
      (item.status === "active" || item.status === "paused"),
  );
  if (existing) return { error: "该主题已有进行中的挑战" };
  const challenge: Challenge = {
    id: crypto.randomUUID(),
    topicId: input.topicId,
    topicTitle: input.topicTitle,
    startDate: input.startDate || todayKey(),
    totalDays: input.totalDays || 100,
    threshold: input.threshold || "one_event",
    thresholdMinutes: input.thresholdMinutes ?? null,
    freezesLeft: 2,
    status: "active",
    settledOn: "",
    goalNote: (input.goalNote || "").trim().slice(0, GOAL_NOTE_LIMIT),
  };
  store.challenges.push(challenge);
  persist();
  return challenge;
}

export function challengesForTopic(topicId: string): Challenge[] {
  return store.challenges.filter((item) => item.topicId === topicId);
}

export function activeChallengeForTopic(topicId: string): Challenge | undefined {
  return store.challenges.find(
    (item) =>
      item.topicId === topicId &&
      (item.status === "active" || item.status === "paused"),
  );
}

const inChallengeRange = (challenge: Challenge, date: string) => {
  const endExclusive = addDays(challenge.startDate, challenge.totalDays);
  return date >= challenge.startDate && date < endExclusive;
};

const checkinFor = (challengeId: string, date: string) =>
  store.checkins.find(
    (item) => item.challengeId === challengeId && item.date === date,
  );

/** 实时打卡:当天该主题有完成事件即落 kind='event' 行。幂等(UNIQUE + 先查) */
export function recordEventDone(topicId: string, date: string, eventId: string): void {
  let changed = false;
  for (const challenge of store.challenges) {
    if (challenge.topicId !== topicId || challenge.status !== "active") continue;
    if (!inChallengeRange(challenge, date)) continue;
    if (checkinFor(challenge.id, date)) continue;
    store.checkins.push({
      id: crypto.randomUUID(),
      challengeId: challenge.id,
      date,
      kind: "event",
      eventId,
      noteId: null,
    });
    changed = true;
  }
  if (changed) persist();
}

export function lightCheckin(challengeId: string, date?: string): true | string {
  const challenge = store.challenges.find((item) => item.id === challengeId);
  if (!challenge || challenge.status !== "active") return "挑战不在进行中";
  const day = date || todayKey();
  if (!inChallengeRange(challenge, day)) return "不在挑战周期内";
  if (checkinFor(challengeId, day)) return "今天已有打卡记录";
  store.checkins.push({
    id: crypto.randomUUID(),
    challengeId,
    date: day,
    kind: "light",
    eventId: null,
    noteId: null,
  });
  persist();
  return true;
}

/** 补签:仅昨日、冻结未覆盖时;UNIQUE 约束天然限每天一次 */
export function makeupCheckin(challengeId: string): true | string {
  const challenge = store.challenges.find((item) => item.id === challengeId);
  if (!challenge || challenge.status !== "active") return "挑战不在进行中";
  const yesterday = addDays(todayKey(), -1);
  if (!inChallengeRange(challenge, yesterday)) return "昨日不在挑战周期内";
  const existing = checkinFor(challengeId, yesterday);
  if (existing?.kind === "freeze") return "昨日已由冻结卡保护,无需补签";
  if (existing) return "昨日已有打卡记录";
  store.checkins.push({
    id: crypto.randomUUID(),
    challengeId,
    date: yesterday,
    kind: "light",
    eventId: null,
    noteId: null,
  });
  persist();
  return true;
}

export function resumeChallenge(id: string): void {
  const challenge = store.challenges.find((item) => item.id === id);
  if (challenge && challenge.status === "paused") {
    challenge.status = "active";
    // 标记今天已结算:恢复只对今天及以后生效,避免同日重开 App 把昨日再结算一遍
    challenge.settledOn = todayKey();
    persist();
  }
}

export function abandonChallenge(id: string): void {
  const challenge = store.challenges.find((item) => item.id === id);
  if (challenge && challenge.status !== "finished") {
    challenge.status = "abandoned";
    persist();
  }
}

export interface ChallengeProgress {
  dayNumber: number;
  totalDays: number;
  doneCount: number;
  freezeCount: number;
  missCount: number;
  remaining: number;
  finished: boolean;
}

export function challengeProgress(challenge: Challenge): ChallengeProgress {
  const today = todayKey();
  const dayNumber = Math.min(
    Math.max(daysBetween(challenge.startDate, today) + 1, 0),
    challenge.totalDays,
  );
  const rows = store.checkins.filter((item) => item.challengeId === challenge.id);
  const doneCount = rows.filter(
    (item) => item.kind === "event" || item.kind === "light",
  ).length;
  const freezeCount = rows.filter((item) => item.kind === "freeze").length;
  const finished =
    challenge.status === "finished" ||
    (challenge.status === "active" && dayNumber >= challenge.totalDays);
  return {
    dayNumber,
    totalDays: challenge.totalDays,
    doneCount,
    freezeCount,
    missCount: Math.max(0, dayNumber - rows.length),
    remaining: Math.max(0, challenge.totalDays - dayNumber),
    finished,
  };
}

/** 里程碑:连续 done+freeze 天数(冻结保持连续但单独计数,见 FSD §3.3) */
export function challengeStreak(challenge: Challenge): number {
  let streak = 0;
  let cursor = todayKey();
  // 今天还没打卡不计入断签,从昨天开始往回数
  if (!checkinFor(challenge.id, cursor)) cursor = addDays(cursor, -1);
  while (inChallengeRange(challenge, cursor)) {
    const row = checkinFor(challenge.id, cursor);
    if (!row) break;
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/**
 * daily_settle(FSD §3.3):结算昨日缺口。幂等:settled_on 标记当天已结算。
 * missStreak 不落库,由打卡行派生(缺席即无记录)。
 */
export function dailySettle(): { challenge: Challenge; froze: boolean; paused: boolean }[] {
  const today = todayKey();
  const yesterday = addDays(today, -1);
  const out: { challenge: Challenge; froze: boolean; paused: boolean }[] = [];
  for (const challenge of store.challenges) {
    if (challenge.status !== "active") continue;
    if (!inChallengeRange(challenge, yesterday)) continue;
    if (challenge.settledOn === today) continue;
    let froze = false;
    let paused = false;
    if (!checkinFor(challenge.id, yesterday)) {
      if (challenge.freezesLeft > 0) {
        store.checkins.push({
          id: crypto.randomUUID(),
          challengeId: challenge.id,
          date: yesterday,
          kind: "freeze",
          eventId: null,
          noteId: null,
        });
        challenge.freezesLeft -= 1;
        froze = true;
      } else {
        // 从昨日往回数连续缺席天,≥2 即触发暂停红线
        let miss = 0;
        let cursor = yesterday;
        while (inChallengeRange(challenge, cursor) && !checkinFor(challenge.id, cursor)) {
          miss += 1;
          cursor = addDays(cursor, -1);
        }
        if (miss >= 2) {
          challenge.status = "paused";
          paused = true;
        }
      }
    }
    challenge.settledOn = today;
    out.push({ challenge, froze, paused });
  }
  if (out.length) persist();
  return out;
}

/** minutes 门槛模式的当日判定(UI 注入该主题当日已完成事件的累计分钟) */
export function thresholdMinutesMet(doneMinutesToday: number, challenge: Challenge): boolean {
  return doneMinutesToday >= (challenge.thresholdMinutes || 1);
}

/** 是否有活跃的闭环内容(用于决定是否安排每日复习通知) */
export function hasLoopActivity(): boolean {
  return (
    store.challenges.some(
      (item) => item.status === "active" || item.status === "paused",
    ) || store.cards.some((item) => item.status === "active")
  );
}

// ── 知识点与 BKT(FSD §5)──

export function addKnowledgePoint(input: {
  topicId: string;
  name: string;
  bloomLevel?: BloomLevel;
}): KnowledgePoint | { error: string } {
  const name = input.name.trim().slice(0, 40);
  if (!name) return { error: "知识点名称必填" };
  if (store.points.some((item) => item.topicId === input.topicId && item.name === name))
    return { error: "该主题下已有同名知识点" };
  const point: KnowledgePoint = {
    id: crypto.randomUUID(),
    topicId: input.topicId,
    name,
    bloomLevel: input.bloomLevel || "recall",
    mastery: 0,
    status: "dark",
    lastEvidenceAt: null,
  };
  store.points.push(point);
  persist();
  return point;
}

export function removeKnowledgePoint(id: string): void {
  for (const card of store.cards) if (card.pointId === id) card.pointId = null;
  store.points = store.points.filter((item) => item.id !== id);
  persist();
}

/** BKT 单步更新(FSD §5.2) */
function bktUpdate(point: KnowledgePoint, correct: boolean): void {
  const posterior = correct
    ? (point.mastery * (1 - BKT.slip)) /
      (point.mastery * (1 - BKT.slip) + (1 - point.mastery) * BKT.guess)
    : (point.mastery * BKT.slip) /
      (point.mastery * BKT.slip + (1 - point.mastery) * (1 - BKT.guess));
  point.mastery = Math.min(0.99, posterior + (1 - posterior) * BKT.learn);
  point.lastEvidenceAt = todayKey();
}

function recomputePointStatus(point: KnowledgePoint): void {
  const cardIds = new Set(
    store.cards
      .filter((card) => card.pointId === point.id && card.status === "active")
      .map((card) => card.id),
  );
  // reviewLogs 是 append-only 按时间序,取末尾即最近两条;
  // 不按 reviewedAt 排序——同毫秒连续复习时时间戳相同会打乱顺序
  const last2 = store.reviewLogs
    .filter((log) => cardIds.has(log.cardId))
    .slice(-2);
  const twoForgot = last2.length === 2 && last2.every((log) => log.grade === "forgot");
  if (point.mastery >= MASTER_THRESHOLD && !twoForgot) point.status = "mastered";
  else if (point.mastery >= SHAKY_THRESHOLD || twoForgot) point.status = "shaky";
  else if (point.mastery > 0) point.status = "touched";
  else point.status = "dark";
}

/** 知识点证据入口:复习与教回都汇到这里,四态在此收口 */
export function applyPointEvidence(pointId: string, correct: boolean): void {
  const point = store.points.find((item) => item.id === pointId);
  if (!point) return;
  if (point.status === "dark" && point.mastery === 0)
    point.mastery = BKT.p0; // 首次证据:从先验出发
  bktUpdate(point, correct);
  recomputePointStatus(point);
  persist();
}

/** 教回:covered 视作一次 correct;遗漏不自动降级(FSD §5.4) */
export function applyTeachback(
  topicId: string,
  transcriptId: string,
  results: TeachbackResult[],
): void {
  for (const item of results) if (item.covered) applyPointEvidence(item.pointId, true);
  store.teachbacks.push({
    id: crypto.randomUUID(),
    topicId,
    transcriptId,
    result: results,
    createdAt: new Date().toISOString(),
  });
  persist();
}

/** 主题的教回记录(#9 读取器:测试与后续反馈引导用) */
export function teachbacksForTopic(topicId: string): {
  id: string;
  transcriptId: string;
  result: TeachbackResult[];
  createdAt: string;
}[] {
  return store.teachbacks.filter((item) => item.topicId === topicId);
}

// ── 费曼教回(FSD §13,issue #9):assess_teachback 产出为草稿,应用才写库 ──

/** 教回引文截断上限 */
export const TEACHBACK_QUOTE_LIMIT = 120;

export interface TeachbackDraftResult {
  pointId: string;
  covered: boolean;
  quote: string;
}

export interface ResolvedTeachback {
  results: TeachbackDraftResult[];
  /** 主题内不存在的知识点名(去重) */
  unknown: string[];
}

/**
 * 教回评估草稿归一化(纯读,零写库):
 * 按主题内 UNIQUE 知识点名解析 pointId,未知名剔除并进 unknown;
 * covered 须带非空引文,否则按未覆盖;quote 先 trim 再截 120 字;重复点名只保留首条。
 */
export function resolveTeachbackResults(
  topicId: string,
  raw: unknown,
): ResolvedTeachback {
  const list = Array.isArray(raw) ? raw : [];
  const results: TeachbackDraftResult[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const record = (item || {}) as Record<string, unknown>;
    const name = String(record.point ?? "").trim();
    if (!name) continue; // 没有点名的条目无法报告,直接跳过
    const point = store.points.find(
      (candidate) => candidate.topicId === topicId && candidate.name === name,
    );
    if (!point) {
      if (!unknown.includes(name)) unknown.push(name);
      continue;
    }
    if (seen.has(point.id)) continue; // 重复点名保留首条
    seen.add(point.id);
    const quote = String(record.quote ?? "").trim().slice(0, TEACHBACK_QUOTE_LIMIT);
    results.push({
      pointId: point.id,
      covered: record.covered === true && quote.length > 0,
      quote,
    });
  }
  return { results, unknown };
}

export function topicPoints(topicId: string): KnowledgePoint[] {
  return store.points.filter((item) => item.topicId === topicId);
}

export function pointById(id: string): KnowledgePoint | undefined {
  return store.points.find((item) => item.id === id);
}

/** 掌握百分比:只数 shaky+mastered(FSD §5.3) */
export function topicMasteryPercent(topicId: string): number {
  const points = topicPoints(topicId);
  if (!points.length) return 0;
  const counted = points.filter(
    (item) => item.status === "shaky" || item.status === "mastered",
  ).length;
  return Math.round((counted / points.length) * 100);
}

// ── 复习卡与 SM-2(FSD §4)──

export function createCard(input: {
  topicId: string;
  pointId: string | null;
  sourceType: ReviewCard["sourceType"];
  sourceId: string;
  sourceTitle: string;
  front: string;
  back: string;
  active?: boolean; // true=跳过草稿直接入队(手动建卡)
}): ReviewCard | { error: string } {
  const front = input.front.trim().slice(0, 200);
  const back = input.back.trim().slice(0, 500);
  if (!front || !back) return { error: "正面与背面必填" };
  const card: ReviewCard = {
    id: crypto.randomUUID(),
    topicId: input.topicId,
    pointId: input.pointId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceTitle: input.sourceTitle.slice(0, 60),
    front,
    back,
    ease: 2.5,
    intervalDays: 0,
    dueDate: todayKey(),
    status: input.active ? "active" : "draft",
  };
  store.cards.push(card);
  persist();
  return card;
}

export function confirmCard(id: string): void {
  const card = store.cards.find((item) => item.id === id);
  if (card && card.status === "draft") {
    card.status = "active";
    persist();
  }
}

export function discardDraft(id: string): void {
  store.cards = store.cards.filter(
    (item) => !(item.id === id && item.status === "draft"),
  );
  persist();
}

export function archiveCard(id: string): void {
  const card = store.cards.find((item) => item.id === id);
  if (card && card.status !== "archived") {
    card.status = "archived";
    persist();
  }
}

export function cardsForTopic(topicId: string): ReviewCard[] {
  return store.cards.filter((item) => item.topicId === topicId);
}

export function draftCards(): ReviewCard[] {
  return store.cards.filter((item) => item.status === "draft");
}

/** SM-2 三档(FSD §4.2):忘→重置 1 天;模糊→正常晋升但 EF 微降;记得→正常晋升 */
export function scheduleCard(card: ReviewCard, grade: ReviewGrade): void {
  if (grade === "forgot") {
    card.intervalDays = 1;
    card.ease = Math.max(1.3, card.ease - 0.2);
  } else {
    card.ease = Math.min(3.0, card.ease + (grade === "fuzzy" ? -0.14 : 0.1));
    card.intervalDays =
      card.intervalDays <= 0 ? 1 : card.intervalDays === 1 ? 6 : Math.round(card.intervalDays * card.ease);
  }
  card.dueDate = addDays(todayKey(), card.intervalDays);
  store.reviewLogs.push({
    id: crypto.randomUUID(),
    cardId: card.id,
    reviewedAt: new Date().toISOString(),
    grade,
  });
  if (card.pointId) applyPointEvidence(card.pointId, grade !== "forgot");
  persist();
}

export interface QueueEntry {
  card: ReviewCard;
  pointName: string | null;
}

/** 每日队列(FSD §4.3):due≤今日;shaky 优先→逾期升序→EF 低优先;截断 20,新卡 ≤10 */
export function buildDailyQueue(topicId?: string): QueueEntry[] {
  const today = todayKey();
  const pointStatus = (id: string | null) =>
    id ? pointById(id)?.status || "dark" : "dark";
  const pool = store.cards.filter(
    (card) =>
      card.status === "active" &&
      card.dueDate <= today &&
      (!topicId || card.topicId === topicId),
  );
  pool.sort((a, b) => {
    const shakyA = pointStatus(a.pointId) === "shaky" ? 0 : 1;
    const shakyB = pointStatus(b.pointId) === "shaky" ? 0 : 1;
    if (shakyA !== shakyB) return shakyA - shakyB;
    if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return a.ease - b.ease;
  });
  const limited: ReviewCard[] = [];
  let fresh = 0;
  for (const card of pool) {
    if (limited.length >= DAILY_QUEUE_LIMIT) break;
    if (card.intervalDays <= 0) {
      if (fresh >= NEW_CARDS_PER_DAY) continue;
      fresh += 1;
    }
    limited.push(card);
  }
  return limited.map((card) => ({
    card,
    pointName: card.pointId ? pointById(card.pointId)?.name || null : null,
  }));
}

/** 待确认草稿数;传 topicId 时只数该主题(主题卡徽标接线,FSD §6.1) */
export function pendingDraftCount(topicId?: string): number {
  return store.cards.filter(
    (item) => item.status === "draft" && (!topicId || item.topicId === topicId),
  ).length;
}

// ── 启动零摩擦(FSD §14,issue #16)──

export type NextActionSource = "review" | "micro" | "reteach";

export type NextAction =
  | { source: "review"; cardId: string; micro: string }
  | { source: "micro"; cardId: null; micro: string }
  | { source: "reteach"; cardId: null; micro: string };

/** nextStep 的 2 分钟微版:首句截断(。;;!!??…或换行切分),无句读整段截 40 字 */
export function microStepOf(nextStep: string): string {
  const text = (nextStep || "").trim();
  if (!text) return "";
  return text
    .split(/[。;;!!??…\n]/)[0]
    .trim()
    .slice(0, 40);
}

/**
 * 每个非搁置主题任意时刻恰好一个「现在就做」(纯函数):
 * 到期复习卡 > nextStep 的 2 分钟微版 > 教回差距「再讲」;三档皆无返回 null。
 * 复习档取 buildDailyQueue(topicId) 首张,不建事件不计时。
 */
export function resolveNextAction(
  topicId: string,
  input: {
    nextStep?: string;
    lastGap?: { level?: string; gaps?: string } | null;
  },
): NextAction | null {
  const queue = buildDailyQueue(topicId);
  if (queue.length)
    return { source: "review", cardId: queue[0].card.id, micro: "" };
  const micro = microStepOf(input.nextStep || "");
  if (micro) return { source: "micro", cardId: null, micro };
  const gap = input.lastGap;
  if (gap && gap.level !== "solid" && (gap.gaps || "").trim())
    return { source: "reteach", cardId: null, micro: "" };
  return null;
}
