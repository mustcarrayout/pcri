<script setup lang="ts">
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from "@capacitor-community/sqlite";
import { SpeechRecognition } from "@capacitor-community/speech-recognition";
import { SecureStoragePlugin } from "capacitor-secure-storage-plugin";
import { LocalNotifications } from "@capacitor/local-notifications";
import { getDayMeta } from "./calendarMeta";
import { speak, stopSpeak } from "./speech";
import {
  isDue,
  loadFiredMap,
  loadRoutines,
  saveFiredMap,
  saveRoutines,
  type Routine,
} from "./routines";
import {
  DAILY_QUEUE_LIMIT,
  LOOP_REMINDER_TITLE,
  abandonChallenge,
  activeChallengeForTopic,
  addKnowledgePoint,
  applyPointEvidence,
  applyTeachback,
  buildDailyQueue,
  cacheLoopReminderCopy,
  challengeProgress,
  challengeStreak,
  confirmCard,
  createCard,
  createChallenge,
  dailySettle,
  discardDraft,
  draftCards,
  extractLoopCardSources,
  hasLoopActivity,
  initLoopStorage,
  lightCheckin,
  loadLoopReminderCopy,
  MILESTONES,
  milestoneHit,
  normalizeChallengeSuggestion,
  normalizePiCardBatch,
  resolveNextAction,
  pendingDraftCount,
  pickLoopReminderCopy,
  pointById,
  pointTransitionText,
  recallHintText,
  recordEventDone,
  resolveTeachbackResults,
  reviewSummaryText,
  scheduleCard,
  todayReviewStats,
  removeKnowledgePoint,
  resumeChallenge,
  todayKey,
  topicMasteryPercent,
  topicPoints,
  type BloomLevel,
  type Challenge,
  type ChallengeProgress,
  type ChallengeSuggestion,
  type NextAction,
  type PointStatus,
  type QueueEntry,
  type ReviewCard,
  type ReviewGrade,
} from "./learningLoop";
import {
  clearDingTalkConfig,
  fetchDingTalkEvents,
  loadDingTalkConfig,
  loadDingTalkSyncStamp,
  persistDingTalkConfig,
  saveDingTalkSyncStamp,
  type DingTalkConfig,
} from "./dingtalk";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  ArrowRight,
  Brain,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ListChecks,
  LogOut,
  Map as MapIcon,
  Mic,
  MessageCircle,
  Plus,
  Send,
  Settings,
  Sparkles,
  Tag,
  Trash2,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from "lucide-vue-next";

type Category = "work" | "interest" | "plan";
type Step = "plan" | "do" | "check" | "act";
interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  time: string;
  category: Category;
  tags: string[];
  source: "personal" | "dingtalk";
  /** 钉钉日程的外部 ID，用于同步去重；本机创建的事件没有 */
  externalId?: string;
  done: boolean;
  important: boolean;
  urgent: boolean;
  voiceNote: string;
  reflection: string;
  /** 2 分钟微版(FSD §14,#16):plan_goal 任务可带;「现在就做」事件承载派生微版 */
  micro: string;
  pdca: Record<Step, string>;
}
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  suggestions?: EventSuggestion[];
  saved?: boolean[];
  /** Pi create_challenge 产出的挑战确认卡;用户点确认才落库(FSD §6.1) */
  challengeDraft?: ChallengeSuggestion;
  challengeSaved?: boolean;
  /** Pi assess_teachback 产出的教回评估草稿;用户点应用才写库(FSD §13,#9) */
  teachbackDraft?: TeachbackDraft;
  /** 红线暂停消息携带的主题 id,渲染可点击「继续挑战」(FSD §15.3,#17) */
  resumeTopicId?: string;
  resumed?: boolean;
}
/** 教回评估草稿的展示条目(名称+引文,标摇态与差距动作态仅内存) */
interface TeachbackDraftItemView {
  pointId: string;
  pointName: string;
  covered: boolean;
  quote: string;
  marked?: boolean;
  actions?: { card?: boolean; task?: boolean; reteach?: boolean };
}
interface TeachbackDraft {
  topicId: string;
  topicTitle: string;
  summary: string;
  items: TeachbackDraftItemView[];
  unknown: string[];
  applied?: boolean;
}
interface EventSuggestion {
  title: string;
  date: string;
  time: string;
  category: Category;
  tags: string[];
  important: boolean;
  urgent: boolean;
}
type AiProvider = "deepseek" | "zhipu";
interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
}
const aiProviderList: {
  id: AiProvider;
  label: string;
  endpoint: string;
  defaultModel: string;
  note: string;
}[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    endpoint: "https://api.deepseek.com/chat/completions",
    defaultModel: "deepseek-chat",
    note: "在 platform.deepseek.com 获取",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    defaultModel: "glm-4-flash",
    note: "在 open.bigmodel.cn 获取",
  },
];
function providerInfo(id: AiProvider) {
  return aiProviderList.find((item) => item.id === id) || aiProviderList[0];
}
const aiStorageKey = "shixu-ai-config-v1";

const categoryNames: Record<Category, string> = {
  work: "工作",
  interest: "兴趣",
  plan: "计划",
};
const categories: Category[] = ["work", "interest", "plan"];
const steps: { id: Step; label: string; short: string; prompt: string }[] = [
  {
    id: "plan",
    label: "Plan 计划",
    short: "P 计划",
    prompt: "目标是什么？打算怎么做？",
  },
  { id: "do", label: "Do 执行", short: "D 执行", prompt: "实际做了什么？" },
  {
    id: "check",
    label: "Check 检查",
    short: "C 检查",
    prompt: "结果如何？有哪些差异？",
  },
  {
    id: "act",
    label: "Act 调整",
    short: "A 调整",
    prompt: "下一轮如何改进？",
  },
];
const monthNames = [
  "一月",
  "二月",
  "三月",
  "四月",
  "五月",
  "六月",
  "七月",
  "八月",
  "九月",
  "十月",
  "十一月",
  "十二月",
];
const weekNames = ["一", "二", "三", "四", "五", "六", "日"];
const profileKey = "shixu-profile-v1";
const eventsKey = "shixu-calendar-events-v1";
const now = new Date();
const dateKey = (value: Date) =>
  new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
const today = ref(dateKey(now));

const name = ref("");
const signedIn = ref(false);
const events = ref<CalendarEvent[]>([]);
const view = ref<"learn" | "year" | "month" | "week" | "day">("learn");
const activeQuadrant = ref("");
const year = ref(now.getFullYear());
const month = ref(now.getMonth());
const selectedDate = ref(today.value);
const database = ref("初始化日历…");
const dbNotice = ref("");
const db = ref<SQLiteDBConnection | null>(null);
const dialog = ref<
  | "settings"
  | "pdca"
  | "routines"
  | "dingtalk"
  | "topic"
  | "review"
  | "challenge"
  | "map"
  | ""
>("");
const topicForm = ref<{
  id: string;
  title: string;
  why: string;
  useCase: string;
  status: TopicStatus;
  nextStep: string;
}>({ id: "", title: "", why: "", useCase: "", status: "learning", nextStep: "" });
function openTopicDialog(topic?: LearningTopic) {
  if (!topic) return; // 创建一律走 quick-topic 一句话入口;表单只用于编辑
  topicForm.value = {
    id: topic.id,
    title: topic.title,
    why: topic.why,
    useCase: topic.useCase,
    status: topic.status,
    nextStep: topic.nextStep,
  };
  dialog.value = "topic";
}
// ── 说一句建主题(FSD §16.1 延伸,#16):创建 = 一句话/一段语音,字段由 Pi 补 ──
const quickTopicText = ref("");
const quickTopicListening = ref(false);
const quickTopicInput = ref<HTMLInputElement | null>(null);
function focusQuickTopic() {
  void nextTick(() => quickTopicInput.value?.focus());
}
async function recordQuickTopicVoice() {
  if (quickTopicListening.value) {
    stopVoice();
    quickTopicListening.value = false;
    return;
  }
  quickTopicListening.value = true;
  try {
    const transcript = await transcribe();
    if (transcript)
      quickTopicText.value = quickTopicText.value
        ? `${quickTopicText.value} ${transcript}`
        : transcript;
  } catch (error) {
    messages.value.push({
      role: "assistant",
      content:
        error instanceof Error ? error.message : "语音识别失败,请重试。",
    });
    chatOpen.value = true;
  } finally {
    quickTopicListening.value = false;
  }
}
function submitQuickTopic() {
  const text = quickTopicText.value.trim();
  if (!text) return;
  if (chatBusy.value) {
    // Pi 忙时不静默丢弃:文本留在输入框,提示稍后发送
    messages.value.push({
      role: "assistant",
      content: "Pi 正在回复上一条,稍等片刻再按一次发送。",
    });
    chatOpen.value = true;
    return;
  }
  quickTopicText.value = "";
  void askPi(
    `我想学「${text}」。帮我建学习主题:为什么学、打算在哪用由你推断,不确定的最多问我一个问题;建完立刻给我第一个 2 分钟就能动手的任务,别让我停下来。`,
  );
}
function saveTopicDialog() {
  const title = topicForm.value.title.trim().slice(0, 40);
  if (!title) return;
  const existing = topics.value.find((item) => item.id === topicForm.value.id);
  if (existing) {
    existing.title = title;
    existing.why = topicForm.value.why.trim().slice(0, 120);
    existing.useCase = topicForm.value.useCase.trim().slice(0, 120);
    existing.status = topicForm.value.status;
    existing.nextStep = topicForm.value.nextStep.trim().slice(0, 80);
  } else {
    topics.value.push({
      id: crypto.randomUUID(),
      title,
      why: topicForm.value.why.trim().slice(0, 120),
      useCase: topicForm.value.useCase.trim().slice(0, 120),
      goalTag: "",
      status: topicForm.value.status,
      nextStep: topicForm.value.nextStep.trim().slice(0, 80),
      createdAt: today.value,
      evidence: [],
    });
  }
  saveTopics();
  dialog.value = "";
}
function deleteTopicDialog() {
  topics.value = topics.value.filter(
    (item) => item.id !== topicForm.value.id,
  );
  saveTopics();
  dialog.value = "";
}
function pauseTopic(topic: LearningTopic) {
  topic.status = "paused";
  saveTopics();
}
const search = ref("");
const messages = ref<ChatMessage[]>([]);
const chatText = ref("");
const chatBusy = ref(false);
// ── 语音播报(#18):语音发起的对话自动播报;手动喇叭重播/停止 ──
const speakingMsgIndex = ref(-1);
const voiceInitiated = ref(false);
async function toggleSpeak(message: ChatMessage, index: number) {
  if (speakingMsgIndex.value === index) {
    speakingMsgIndex.value = -1;
    await stopSpeak();
    return;
  }
  speakingMsgIndex.value = index;
  await stopSpeak(); // 打断上一条播报
  try {
    await speak(message.content);
  } catch {
    /* 真机无中文 TTS 引擎时静默 */
  }
  if (speakingMsgIndex.value === index) speakingMsgIndex.value = -1;
}
const chatListening = ref(false);
const chatHistoryEl = ref<HTMLElement | null>(null);
const chatOpen = ref(false);
const aiConfig = ref<AiConfig | null>(null);
const aiForm = ref<AiConfig>({
  provider: "deepseek",
  apiKey: "",
  model: aiProviderList[0].defaultModel,
});
const aiError = ref("");
const dingConfig = ref<DingTalkConfig | null>(null);
const dingForm = ref<DingTalkConfig>({
  clientId: "",
  clientSecret: "",
  mobile: "",
});
const dingError = ref("");
const dingSyncing = ref(false);
const dingLastSyncAt = ref("");
const pdcaTargetId = ref("");
const pdcaStage = ref<Step>("plan");
const pdcaForm = ref<Record<Step, string>>({
  plan: "",
  do: "",
  check: "",
  act: "",
});
const pdcaHint = ref("");
const formDictating = ref(false);
const formParsing = ref(false);
async function aiDictateRoutine() {
  if (formDictating.value) {
    stopVoice();
    formDictating.value = false;
    return;
  }
  if (formParsing.value) return;
  if (!aiConfig.value) {
    routineError.value = "先在右上角配置模型 API Key，才能智能听写。";
    return;
  }
  formDictating.value = true;
  routineError.value = "";
  try {
    const transcript = await transcribe();
    if (!transcript) {
      routineError.value = "没有识别到语音。";
      return;
    }
    formParsing.value = true;
    const result = await postModelChat({
      model: aiConfig.value.model,
      messages: [
        {
          role: "system",
          content: `你是定时任务表单解析器。从用户的一句话提取每日任务信息，只输出 JSON：{"name":"任务短名","prompt":"生成内容的具体指令","time":"HH:MM","endTime":"HH:MM 或空"}。时间表达（每天晚上九点半）换算成 24 小时制 HH:MM；没提到结束时间 endTime 留空；prompt 把口语扩写成给 AI 的清晰生成指令。不要输出 JSON 以外的文字。`,
        },
        { role: "user", content: transcript },
      ],
      temperature: 0.2,
      max_tokens: 400,
      stream: false,
    });
    const parsed = extractJsonObject(
      result.choices?.[0]?.message?.content?.trim() || "",
    ) as Record<string, unknown> | null;
    if (!parsed) throw new Error("未能解析内容，请再说一遍。");
    const name = String(parsed.name || "").trim();
    if (name) routineForm.value.name = name.slice(0, 20);
    const prompt = String(parsed.prompt || "").trim();
    if (prompt) routineForm.value.prompt = prompt.slice(0, 300);
    const time = String(parsed.time || "").trim();
    if (/^\d{1,2}:\d{2}$/.test(time)) routineForm.value.time = time.padStart(5, "0");
    const endTime = String(parsed.endTime || "").trim();
    if (/^\d{1,2}:\d{2}$/.test(endTime)) routineForm.value.endTime = endTime.padStart(5, "0");
  } catch (error) {
    routineError.value =
      error instanceof Error ? error.message : "识别失败，请重试。";
  } finally {
    formDictating.value = false;
    formParsing.value = false;
  }
}
// 默认标签池 + 用户历史标签，按使用频次合并展示
const DEFAULT_TAGS = ["会议", "项目", "学习", "阅读", "运动", "健康", "生活"];
const customTag = ref("");
const availableTags = computed(() => {
  const freq = new Map<string, number>();
  for (const event of events.value)
    for (const tag of event.tags) freq.set(tag, (freq.get(tag) || 0) + 1);
  const used = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);
  return [...new Set([...used, ...DEFAULT_TAGS])].slice(0, 12);
});
const pdcaAiInput = ref("");
const pdcaAiBusy = ref(false);
const pdcaAiListening = ref(false);
// PDCA 是一次执行完的循环，不是分段讨论：一条记录，AI 整圈跑完
const PDCA_AI_PROMPT =
  "执行一次完整的 PDCA 循环：把用户的记录落进计划（目标是什么）、执行（实际发生了什么）、检查（结果与差异）、调整（下一轮动作）；记录里没有的阶段保持原样，不要编造。";
const routines = ref<Routine[]>([]);
const routineFired = ref<Record<string, string>>({});
const routineForm = ref({ name: "", prompt: "", time: "21:00", endTime: "" });
const routineError = ref("");
const routineListening = ref<"name" | "prompt" | null>(null);
const appVersion = __APP_VERSION__;
const buildStamp = (() => {
  const build = new Date(__BUILD_TIME__);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(build.getMonth() + 1)}${pad(build.getDate())} ${pad(build.getHours())}:${pad(build.getMinutes())}`;
})();
const listening = ref(false);
let speechRecognition: SpeechRecognitionLike | undefined;

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<
          ArrayLike<{ transcript: string }> & { isFinal: boolean }
        >;
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechWindow extends Window {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
}

const dateTitle = computed(() =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date(`${selectedDate.value}T12:00:00`)),
);
const title = computed(() =>
  view.value === "learn"
    ? "学习"
    : view.value === "year"
      ? `${year.value} 年`
      : view.value === "month"
        ? `${year.value} 年 ${month.value + 1} 月`
        : view.value === "week"
          ? weekTitle.value
          : dateTitle.value,
);
const selectedDayMeta = computed(() =>
  getDayMeta(new Date(`${selectedDate.value}T12:00:00`)),
);
const weekStartDate = computed(() => {
  const base = new Date(`${selectedDate.value}T12:00:00`);
  base.setDate(base.getDate() - ((base.getDay() + 6) % 7));
  return base;
});
const weekDays = computed(() =>
  Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStartDate.value);
    date.setDate(weekStartDate.value.getDate() + index);
    const key = dateKey(date);
    return {
      key,
      date,
      meta: getDayMeta(date),
      events: events.value.filter((event) => event.date === key),
    };
  }),
);
const weekTitle = computed(() => {
  const start = weekStartDate.value;
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const format = (date: Date) => `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${format(start)} – ${format(end)}`;
});
const weekReviewCount = computed(() => {
  const keys = new Set(weekDays.value.map((day) => day.key));
  return events.value.filter(
    (event) =>
      keys.has(event.date) && (event.pdca.check || event.pdca.act),
  ).length;
});
const pdcaEventTitle = computed(
  () => events.value.find((event) => event.id === pdcaTargetId.value)?.title || "",
);
const pdcaEvent = computed(
  () => events.value.find((event) => event.id === pdcaTargetId.value) || null,
);
const currentStep = computed(
  () => steps.find((step) => step.id === pdcaStage.value) || steps[0],
);
const pdcaStreak = computed(() => {
  const hasRecord = (date: Date) =>
    events.value.some(
      (event) =>
        event.date === dateKey(date) &&
        (Object.values(event.pdca).some(Boolean) || event.reflection),
    );
  const cursor = new Date(`${today.value}T12:00:00`);
  if (!hasRecord(cursor)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (hasRecord(cursor) && streak < 3650) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
});
const shownEvents = computed(() =>
  events.value
    .filter(
      (event) =>
        event.date === selectedDate.value &&
        (!search.value ||
          event.title.includes(search.value) ||
          event.tags.some((tag) => tag.includes(search.value))),
    )
    .sort((a, b) => a.time.localeCompare(b.time)),
);
const prioritizedEvents = computed(() => {
  if (!activeQuadrant.value) return shownEvents.value;
  return quadrants.value.find((quadrant) => quadrant.id === activeQuadrant.value)?.events || [];
});
const morningEvents = computed(() =>
  prioritizedEvents.value.filter((event) => Number(event.time.slice(0, 2)) < 12),
);
const afternoonEvents = computed(() =>
  prioritizedEvents.value.filter((event) => Number(event.time.slice(0, 2)) >= 12),
);
const quadrants = computed(() => [
  {
    id: "urgent-important",
    title: "重要且紧急",
    hint: "立即处理",
    events: shownEvents.value.filter(
      (event) => event.important && event.urgent,
    ),
  },
  {
    id: "important",
    title: "重要不紧急",
    hint: "安排计划",
    events: shownEvents.value.filter(
      (event) => event.important && !event.urgent,
    ),
  },
  {
    id: "urgent",
    title: "紧急不重要",
    hint: "尽量委托",
    events: shownEvents.value.filter(
      (event) => !event.important && event.urgent,
    ),
  },
  {
    id: "neither",
    title: "不重要不紧急",
    hint: "考虑减少",
    events: shownEvents.value.filter(
      (event) => !event.important && !event.urgent,
    ),
  },
]);
const days = computed(() => {
  const first = new Date(year.value, month.value, 1);
  const start = new Date(
    year.value,
    month.value,
    1 - ((first.getDay() + 6) % 7),
  );
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    const key = dateKey(day);
    return {
      key,
      day: day.getDate(),
      inMonth: day.getMonth() === month.value,
      events: events.value.filter((event) => event.date === key),
      meta: getDayMeta(day),
    };
  });
});

function demoEvents(): CalendarEvent[] {
  return [
    {
      id: crypto.randomUUID(),
      title: "产品迭代周会",
      date: today.value,
      time: "10:00",
      category: "work",
      tags: ["周会", "项目"],
      source: "dingtalk",
      done: false,
      important: true,
      urgent: true,
      voiceNote: "",
      reflection: "",
      micro: "",
      pdca: { plan: "对齐本周迭代目标", do: "", check: "", act: "" },
    },
    {
      id: crypto.randomUUID(),
      title: "下班后慢跑 5 公里",
      date: today.value,
      time: "18:30",
      category: "interest",
      tags: ["跑步", "健康"],
      source: "personal",
      done: false,
      important: true,
      urgent: false,
      voiceNote: "",
      reflection: "",
      micro: "",
      pdca: { plan: "轻松完成 5 公里，不追配速", do: "", check: "", act: "" },
    },
    {
      id: crypto.randomUUID(),
      title: "阅读 20 分钟",
      date: today.value,
      time: "20:30",
      category: "plan",
      tags: ["阅读"],
      source: "personal",
      done: true,
      important: true,
      urgent: false,
      voiceNote: "",
      reflection: "比计划多读了 5 分钟，睡前阅读很适合我。",
      micro: "",
      pdca: {
        plan: "睡前读完一章",
        do: "完成第三章",
        check: "比计划多读 5 分钟",
        act: "",
      },
    },
  ];
}

async function openDatabase() {
  if (Capacitor.isNativePlatform()) {
    try {
      const connection = new SQLiteConnection(CapacitorSQLite);
      const nativeDb = await connection.createConnection(
        "shixu",
        false,
        "no-encryption",
        1,
        false,
      );
      await nativeDb.open();
      await nativeDb.execute(`CREATE TABLE IF NOT EXISTS calendar_events (
        id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('work','interest','plan')), tags TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'personal', done INTEGER NOT NULL DEFAULT 0,
        important INTEGER NOT NULL DEFAULT 0, urgent INTEGER NOT NULL DEFAULT 0,
        voice_note TEXT NOT NULL DEFAULT '', reflection TEXT NOT NULL DEFAULT '',
        pdca_plan TEXT NOT NULL DEFAULT '', pdca_do TEXT NOT NULL DEFAULT '',
        pdca_check TEXT NOT NULL DEFAULT '', pdca_act TEXT NOT NULL DEFAULT '',
        external_id TEXT NOT NULL DEFAULT ''
      )`);
      const columns = await nativeDb.query(
        "PRAGMA table_info(calendar_events)",
      );
      const existingColumns = new Set(
        (columns.values || []).map((column) => String(column.name)),
      );
      for (const [column, definition] of Object.entries({
        important: "INTEGER NOT NULL DEFAULT 0",
        urgent: "INTEGER NOT NULL DEFAULT 0",
        voice_note: "TEXT NOT NULL DEFAULT ''",
        reflection: "TEXT NOT NULL DEFAULT ''",
        external_id: "TEXT NOT NULL DEFAULT ''",
        micro: "TEXT NOT NULL DEFAULT ''",
      })) {
        if (!existingColumns.has(column))
          await nativeDb.execute(
            `ALTER TABLE calendar_events ADD COLUMN ${column} ${definition}`,
          );
      }
      db.value = nativeDb;
      const result = await nativeDb.query(
        "SELECT * FROM calendar_events ORDER BY date, time",
      );
      events.value = (result.values || []).map((row) => ({
        id: String(row.id),
        title: String(row.title),
        date: String(row.date),
        time: String(row.time),
        category:
          row.source === "dingtalk" ? "work" : (row.category as Category),
        tags: JSON.parse(String(row.tags || "[]")) as string[],
        source: row.source === "dingtalk" ? "dingtalk" : "personal",
        externalId: String(row.external_id || "") || undefined,
        done: Boolean(row.done),
        important: Boolean(row.important),
        urgent: Boolean(row.urgent),
        voiceNote: String(row.voice_note || ""),
        reflection: String(row.reflection || ""),
        micro: String(row.micro || ""),
        pdca: {
          plan: String(row.pdca_plan || ""),
          do: String(row.pdca_do || ""),
          check: String(row.pdca_check || ""),
          act: String(row.pdca_act || ""),
        },
      }));
      database.value = "Android SQLite";
    } catch (error) {
      dbNotice.value =
        error instanceof Error ? error.message : "SQLite 初始化失败";
      database.value = "SQLite 未连接";
    }
  } else {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(eventsKey) || "[]",
      ) as CalendarEvent[];
      // 旧演示数据缺 micro 字段:读补空串(#16)
      events.value = (Array.isArray(parsed) ? parsed : []).map((item) => ({
        ...item,
        micro: typeof item.micro === "string" ? item.micro : "",
      }));
    } catch {
      events.value = [];
    }
    database.value = "浏览器演示存储";
  }
  if (!events.value.length) {
    events.value = demoEvents();
    await saveEvents();
  }
}

async function saveEvents() {
  if (db.value) {
    try {
      // 逐行 upsert，替代整表清空重写：单行失败不再丢全部数据
      for (const event of events.value)
        await db.value.run(
          `INSERT OR REPLACE INTO calendar_events (id,title,date,time,category,tags,source,done,important,urgent,voice_note,reflection,micro,pdca_plan,pdca_do,pdca_check,pdca_act,external_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            event.id,
            event.title,
            event.date,
            event.time,
            event.source === "dingtalk" ? "work" : event.category,
            JSON.stringify(event.tags),
            event.source,
            event.done ? 1 : 0,
            event.important ? 1 : 0,
            event.urgent ? 1 : 0,
            event.voiceNote,
            event.reflection,
            event.micro || "",
            event.pdca.plan,
            event.pdca.do,
            event.pdca.check,
            event.pdca.act,
            event.externalId || "",
          ],
        );
      const ids = events.value
        .map((event) => `'${event.id.replace(/'/g, "''")}'`)
        .join(",");
      await db.value.execute(
        ids
          ? `DELETE FROM calendar_events WHERE id NOT IN (${ids})`
          : "DELETE FROM calendar_events",
      );
      dbNotice.value = "";
    } catch (error) {
      dbNotice.value =
        error instanceof Error ? error.message : "SQLite 保存失败";
    }
  } else {
    try {
      localStorage.setItem(eventsKey, JSON.stringify(events.value));
      dbNotice.value = "";
    } catch {
      dbNotice.value = "浏览器无法保存数据";
    }
  }
}

function login() {
  const trimmed = name.value.trim();
  if (!trimmed) return;
  name.value = trimmed;
  signedIn.value = true;
  try {
    localStorage.setItem(profileKey, trimmed);
  } catch {
    /* 本地身份也可保留在当前会话 */
  }
}
function logout() {
  signedIn.value = false;
  try {
    localStorage.removeItem(profileKey);
  } catch {
    /* 忽略 */
  }
}
function changePeriod(delta: number) {
  if (view.value === "year") year.value += delta;
  else if (view.value === "month") {
    const next = new Date(year.value, month.value + delta, 1);
    year.value = next.getFullYear();
    month.value = next.getMonth();
  } else if (view.value === "week") {
    const next = new Date(`${selectedDate.value}T12:00:00`);
    next.setDate(next.getDate() + delta * 7);
    selectedDate.value = dateKey(next);
    year.value = next.getFullYear();
    month.value = next.getMonth();
  } else {
    const next = new Date(`${selectedDate.value}T12:00:00`);
    next.setDate(next.getDate() + delta);
    selectedDate.value = dateKey(next);
    year.value = next.getFullYear();
    month.value = next.getMonth();
  }
}
function goDay(key: string) {
  selectedDate.value = key;
  year.value = Number(key.slice(0, 4));
  month.value = Number(key.slice(5, 7)) - 1;
  view.value = "day";
}
const habitAlertShownOn = ref("");
function askHabitSignals() {
  chatOpen.value = true;
  habitAlertShownOn.value = today.value;
  void askPi(habitSignals.value.map((signal) => signal.ask).join(" "));
}
function focusOmnibar() {
  chatOpen.value = true;
  void nextTick(() =>
    document.querySelector<HTMLInputElement>(".omnibar input")?.focus(),
  );
}
// 左右滑动切换时段：日±1天、周±7天、月±1月、年±1年；竖向滚动和输入框不受影响
let swipeStartX = 0;
let swipeStartY = 0;
let swipeOnControl = false;
function onMainTouchStart(e: TouchEvent) {
  const target = e.target as HTMLElement | null;
  swipeOnControl = !!target?.closest("input, textarea, button, a, .chat-card");
  swipeStartX = e.changedTouches[0].clientX;
  swipeStartY = e.changedTouches[0].clientY;
}
function onMainTouchEnd(e: TouchEvent) {
  if (swipeOnControl) return;
  const dx = e.changedTouches[0].clientX - swipeStartX;
  const dy = e.changedTouches[0].clientY - swipeStartY;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5)
    changePeriod(dx < 0 ? 1 : -1);
}
// ── 长语音听写：分段连续识别，最长 3 分钟 ──
// Android 识别器"静音即停"，长口述靠自动续段实现：说完一句自动接下一句，
// 按停止键或到时收尾，全文拼接返回。只存文字，不保存音频。
const MAX_VOICE_MS = 180_000;
let voiceSession: {
  active: boolean;
  startedAt: number;
  text: string;
  timer: number;
} | null = null;
const voiceClock = ref("00:00");
function voiceTick() {
  if (!voiceSession) return;
  const elapsed = Date.now() - voiceSession.startedAt;
  const sec = Math.min(Math.floor(elapsed / 1000), 179);
  voiceClock.value = `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  if (elapsed >= MAX_VOICE_MS) endVoiceSession();
}
function endVoiceSession() {
  if (!voiceSession) return;
  voiceSession.active = false;
  window.clearInterval(voiceSession.timer);
  if (Capacitor.isNativePlatform()) void SpeechRecognition.stop();
  speechRecognition?.stop();
}
async function transcribe(): Promise<string> {
  if (voiceSession) {
    // 已在听写中：这次调用视为"停止"
    endVoiceSession();
    return "";
  }
  voiceSession = {
    active: true,
    startedAt: Date.now(),
    text: "",
    timer: window.setInterval(voiceTick, 500),
  };
  voiceTick();
  let collected = "";
  try {
    if (Capacitor.isNativePlatform()) {
      let permission = await SpeechRecognition.checkPermissions();
      if (permission.speechRecognition !== "granted")
        permission = await SpeechRecognition.requestPermissions();
      if (permission.speechRecognition !== "granted")
        throw new Error("需要麦克风和语音识别权限才能开始录音。");
      let idleRetries = 0;
      while (voiceSession?.active) {
        try {
          const result = await SpeechRecognition.start({
            language: "zh-CN",
            maxResults: 1,
            partialResults: false,
            popup: true,
          });
          idleRetries = 0;
          const piece = result.matches?.[0]?.trim();
          if (piece && voiceSession) voiceSession.text += piece;
        } catch {
          // 静音超时等"无语音"错误：会话还活着就继续听，连续 3 次才收尾
          if (!voiceSession?.active) break;
          idleRetries += 1;
          if (
            idleRetries >= 3 ||
            Date.now() - voiceSession.startedAt >= MAX_VOICE_MS
          )
            break;
        }
      }
    } else {
      const speechWindow = window as SpeechWindow;
      const Recognition =
        speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
      if (!Recognition) throw new Error("当前环境不支持语音识别，请直接输入。");
      await new Promise<void>((resolve) => {
        const recognition = new Recognition();
        speechRecognition = recognition;
        recognition.lang = "zh-CN";
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.onresult = (event) => {
          let piece = "";
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const result = event.results[i];
            if (result.isFinal) piece += result[0]?.transcript || "";
          }
          if (piece && voiceSession) voiceSession.text += piece;
        };
        recognition.onerror = () => {
          /* 段内错误由 onend 统一决定是否续听 */
        };
        recognition.onend = () => {
          if (voiceSession?.active) {
            recognition.start();
            return;
          }
          speechRecognition = undefined;
          resolve();
        };
        recognition.start();
      });
    }
  } finally {
    collected = voiceSession?.text || "";
    endVoiceSession();
  }
  return collected.trim();
}
async function toggleChatVoice() {
  if (chatListening.value) {
    stopVoice();
    chatListening.value = false;
    return;
  }
  chatListening.value = true;
  try {
    const transcript = await transcribe();
    if (transcript) {
      chatText.value = chatText.value
        ? `${chatText.value} ${transcript}`
        : transcript;
      voiceInitiated.value = true; // 语音发起 → 回复自动播报(#18)
    }
  } catch (error) {
    messages.value.push({
      role: "assistant",
      content:
        error instanceof Error ? error.message : "语音识别失败，请再试一次。",
    });
  } finally {
    chatListening.value = false;
  }
}
function stopVoice() {
  endVoiceSession();
}
async function loadAiConfig() {
  if (!Capacitor.isNativePlatform()) return; // 浏览器预览不落盘，密钥只在当前页面内存里
  try {
    const { value } = await SecureStoragePlugin.get({ key: aiStorageKey });
    const parsed = JSON.parse(value) as AiConfig;
    if (parsed?.apiKey) aiConfig.value = parsed;
  } catch {
    /* 尚未配置过 */
  }
}
async function persistAiConfig(config: AiConfig) {
  if (!Capacitor.isNativePlatform()) return; // 真机才写入 Android Keystore 安全存储
  await SecureStoragePlugin.set({
    key: aiStorageKey,
    value: JSON.stringify(config),
  });
}
function openAiSettings() {
  aiForm.value = aiConfig.value
    ? { ...aiConfig.value }
    : {
        provider: "deepseek",
        apiKey: "",
        model: aiProviderList[0].defaultModel,
      };
  aiError.value = "";
  dialog.value = "settings";
}
function chooseProvider(provider: AiProvider) {
  aiForm.value.provider = provider;
  aiForm.value.model = providerInfo(provider).defaultModel;
}
async function saveAiSettings() {
  const apiKey = aiForm.value.apiKey.trim();
  if (!apiKey) return;
  const config: AiConfig = {
    provider: aiForm.value.provider,
    apiKey,
    model:
      aiForm.value.model.trim() ||
      providerInfo(aiForm.value.provider).defaultModel,
  };
  try {
    await persistAiConfig(config);
  } catch {
    aiError.value = "安全存储写入失败，请重试。";
    return;
  }
  aiError.value = "";
  aiConfig.value = config;
  dialog.value = "";
}
async function clearAiSettings() {
  if (Capacitor.isNativePlatform()) {
    try {
      await SecureStoragePlugin.remove({ key: aiStorageKey });
    } catch {
      /* 本地状态仍会清除 */
    }
  }
  aiConfig.value = null;
  dialog.value = "";
}
// ── 钉钉日历同步：企业内部应用直连，只读拉取 ──
async function bootstrapDingTalk() {
  dingConfig.value = await loadDingTalkConfig();
  dingLastSyncAt.value = loadDingTalkSyncStamp();
  // 启动自动同步只发生在真机（浏览器预览凭证不落盘，走手动同步）
  if (dingConfig.value && Capacitor.isNativePlatform())
    void runDingTalkSync();
}
function openDingTalkSettings() {
  dingForm.value = dingConfig.value
    ? { ...dingConfig.value }
    : { clientId: "", clientSecret: "", mobile: "" };
  dingError.value = "";
  dialog.value = "dingtalk";
}
async function saveDingTalkSettings() {
  const config: DingTalkConfig = {
    clientId: dingForm.value.clientId.trim(),
    clientSecret: dingForm.value.clientSecret.trim(),
    mobile: dingForm.value.mobile.trim(),
  };
  if (!config.clientId || !config.clientSecret || !config.mobile) return;
  try {
    await persistDingTalkConfig(config);
  } catch {
    dingError.value = "安全存储写入失败，请重试。";
    return;
  }
  dingConfig.value = config;
  dingError.value = "";
  // 保存后立即试同步一次，通了才算配置成功
  if (await runDingTalkSync()) dialog.value = "";
}
async function clearDingTalkSettings() {
  await clearDingTalkConfig();
  dingConfig.value = null;
  dingLastSyncAt.value = "";
  dialog.value = "";
}
async function runDingTalkSync(): Promise<boolean> {
  if (dingSyncing.value) return false;
  if (!dingConfig.value) {
    dingError.value = "先填写钉钉企业应用凭证。";
    return false;
  }
  dingSyncing.value = true;
  dingError.value = "";
  try {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date();
    to.setDate(to.getDate() + 7);
    to.setHours(23, 59, 59, 999);
    const remote = await fetchDingTalkEvents(dingConfig.value, from, to);
    const remoteIds = new Set(remote.map((item) => item.externalId));
    // 同 externalId 只更新钉钉侧字段，保留本地 done/PDCA/象限标注
    for (const item of remote) {
      const existing = events.value.find(
        (event) => event.externalId === item.externalId,
      );
      if (existing) {
        existing.title = item.title;
        existing.date = item.date;
        existing.time = item.time;
      } else {
        events.value.push({
          id: crypto.randomUUID(),
          title: item.title,
          date: item.date,
          time: item.time,
          category: "work",
          tags: ["钉钉"],
          source: "dingtalk",
          done: false,
          important: false,
          urgent: false,
          voiceNote: "",
          reflection: "",
          micro: "",
          pdca: { plan: "", do: "", check: "", act: "" },
          externalId: item.externalId,
        });
      }
    }
    // 只镜像同步窗口：窗口内钉钉侧已消失的本地条目移除（含无外部 ID 的旧演示数据）；
    // 窗口外的历史事件保留，避免丢掉已写的 PDCA 记录
    const fromKey = dateKey(from);
    const toKey = dateKey(to);
    events.value = events.value.filter((event) => {
      if (event.source !== "dingtalk") return true;
      if (event.date < fromKey || event.date > toKey) return true;
      if (!event.externalId) return false;
      return remoteIds.has(event.externalId);
    });
    dingLastSyncAt.value = saveDingTalkSyncStamp();
    return true;
  } catch (error) {
    dingError.value =
      error instanceof Error ? error.message : "钉钉同步失败，请稍后再试。";
    return false;
  } finally {
    dingSyncing.value = false;
  }
}
function piSystemPrompt() {
  const agenda = events.value
    .filter((event) => event.date === selectedDate.value)
    .sort((a, b) => a.time.localeCompare(b.time))
    .map(
      (event) =>
        `${event.time} ${event.title}（${categoryNames[event.category]}；${
          event.important ? "重要" : "不重要"
        }${event.urgent ? "且紧急" : event.important ? "不紧急" : ""}；${
          event.done ? "已完成" : "未完成"
        }）`,
    );
  return [
    `你是个人日历应用「拾序」里的私人助理 Pi，用户是「${name.value}」。语气像熟悉的朋友：鼓励、不说教、不堆客套话，帮 TA 强化习惯、按自己的节奏生活。`,
    "用简体中文简短、可执行地回答。",
    "回答使用纯文本：不要使用 Markdown 标记（如 ** 加粗、# 标题、` 代码、- 或 * 列表符号），列表直接一行一条写。",
    `今天的日期是 ${selectedDate.value}。`,
    `当天日程：${agenda.length ? agenda.join("；") : "暂无安排"}。`,
    "事项按重要/紧急四象限整理，用户会为事项写 PDCA 循环笔记。",
  ].join("\n");
}
interface ModelChatResult {
  choices?: {
    message?: {
      content?: string;
      tool_calls?: {
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
  }[];
  error?: { message?: string } | string;
}
function modelReply(result: ModelChatResult) {
  const raw = result.choices?.[0]?.message?.content?.trim() || "";
  return raw
    .split("\n")
    .map((line) =>
      line
        .replace(/^#{1,6}\s*/, "")
        .replace(/^[-*]\s+/, "· ")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/`([^`]*)`/g, "$1"),
    )
    .join("\n")
    .replace(/\*\*/g, "")
    .trim();
}
function modelErrorMessage(result: ModelChatResult, status: number) {
  if (typeof result.error === "string") return result.error;
  if (result.error?.message) return result.error.message;
  return `模型服务返回 ${status}`;
}
// 真机走 Capacitor 原生网络栈，不受 WebView CORS 限制；浏览器预览回落到 fetch
async function postModelChat(
  payload: Record<string, unknown>,
): Promise<ModelChatResult> {
  if (!aiConfig.value) throw new Error("未配置模型。");
  const provider = providerInfo(aiConfig.value.provider);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${aiConfig.value.apiKey}`,
  };
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.post({
      url: provider.endpoint,
      headers,
      data: payload,
      connectTimeout: 15000,
      readTimeout: 60000,
    });
    const result = (response.data || {}) as ModelChatResult;
    if (response.status >= 400)
      throw new Error(modelErrorMessage(result, response.status));
    return result;
  }
  const response = await fetch(provider.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const result = ((await response.json().catch(() => ({}))) ||
    {}) as ModelChatResult;
  if (!response.ok) throw new Error(modelErrorMessage(result, response.status));
  return result;
}
// Pi 工具驱动：模型通过工具读写日历，App 本地执行；写入类操作经确认卡落库
const PI_AGENT_PROMPT =
  "你是学习教练，驾驶一个以「学习主题」为核心的 App：日历只是主题在时间里的投影。create_topic 建主题（最多问一个问题，且必须同时给出第一次动手任务写进 next_step，让用户创建完就能立刻做 2 分钟）；update_topic 推进主题状态（在学→能用→能教：能脱稿讲清=能用，能用且真的用过=能教）和下一步；plan_goal 把主题拆成 2-8 个任务（每件 30-90 分钟）写入日历，共用「目标·主题名」标签，每个任务给出 2 分钟微版 micro；query_day 查日程；propose_event 建议新事项；propose_pdca 为事项写 PDCA；start_feynman 用费曼检验用户是否真的学会了；save_feynman_result 记录结果（自动挂到主题证据链）；create_challenge 给学习主题发起百日挑战（问清天数和一句目标笔记，生成确认卡，用户点确认才开始）；draft_cards 把已有事项的记录起草成复习卡（两步：先只传 event_title 读素材，再带 cards 数组交草稿，用户在掌握地图确认）；challenge_reminder 在一天学习收尾时，用一句提醒语气的话概括当日状态，作为今晚复习提醒的文案；assess_teachback 在用户讲完一遍后逐个知识点评估讲清与否（引原话，生成草稿等用户点应用）。你的职责是推着每个主题往前走：讲过（费曼）和用过（完成任务）才算证据，没有证据就不要说用户学会了。学习档案里上次的差距，是这次对话的起点。";
const PI_TOOLS = [
  {
    type: "function",
    function: {
      name: "update_event",
      description:
        "修改用户已有的某个事项（改名/改日期/改时间/改重要紧急）。修改会直接应用，完成后告知用户改了什么。",
      parameters: {
        type: "object",
        properties: {
          event_title: {
            type: "string",
            description: "目标事项的名称或名称的一部分",
          },
          new_title: { type: "string", description: "新名称；不改则留空" },
          date: { type: "string", description: "新日期 YYYY-MM-DD；不改则留空" },
          time: { type: "string", description: "新时间 HH:MM；不改则留空" },
          important: { type: "boolean", description: "是否重要" },
          urgent: { type: "boolean", description: "是否紧急" },
        },
        required: ["event_title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_feynman",
      description:
        "开始费曼学习检验：让用户用自己的话、像讲给 12 岁孩子一样简单讲解一个刚学的概念，用来判断是否真的学会了。用户提到学了什么、想检验学习效果时调用。",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "要检验的概念或知识点" },
          event_title: {
            type: "string",
            description: "关联的学习类事项名称；没有就留空",
          },
        },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_feynman_result",
      description:
        "费曼检验对话结束（用户讲完、你已判断）时调用：记录理解程度、讲清楚了什么、没讲清楚的差距和下一步。会写入学习档案并更新关联事项的 PDCA 检查/调整。",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "检验的概念" },
          level: {
            type: "string",
            enum: ["solid", "shaky", "lost"],
            description: "solid=讲清楚了 shaky=部分卡壳 lost=讲不出来",
          },
          strengths: { type: "string", description: "讲清楚了的部分" },
          gaps: { type: "string", description: "没讲清楚、理解的差距" },
          next_action: {
            type: "string",
            description: "下一步要补什么、怎么补",
          },
          event_title: {
            type: "string",
            description: "关联的学习类事项名称；没有就留空",
          },
        },
        required: ["topic", "level", "gaps"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_topic",
      description:
        "创建学习主题（应用的核心实体）。用户表达「我想学 X /我要掌握 X」时调用；最多问一个问题，且必须同时给出第一次动手任务（next_step）——让用户创建完就能立刻动手 2 分钟，不要连环追问为什么学、在哪用。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "主题名（简短、可辨识）" },
          why: { type: "string", description: "为什么学，一句话；没问到就留空" },
          use_case: {
            type: "string",
            description: "打算在哪里用它，一句话；没问到就留空",
          },
          next_step: {
            type: "string",
            description:
              "第一次动手任务：现在就能做 2 分钟的具体一步，如「读第 3 章」",
          },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_topic",
      description:
        "更新学习主题：推进状态（在学→能用→能教）、改下一步、补为什么学/用例。证据充分时主动升级状态：能脱稿讲清=能用，能用且真的用过=能教。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "主题名或其一部分" },
          status: {
            type: "string",
            enum: ["learning", "usable", "teachable", "paused"],
            description: "learning=在学 usable=能用 teachable=能教 paused=搁置",
          },
          next_step: { type: "string", description: "下一步做什么" },
          why: { type: "string", description: "为什么学" },
          use_case: { type: "string", description: "在哪用" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_day",
      description: "查询某一天的日程安排",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "日期，格式 YYYY-MM-DD；不填默认当前查看的一天",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_event",
      description:
        "建议用户新建一个日历事项。会生成确认卡片，用户点击确认后才会真正加入日历。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "事项名称" },
          date: { type: "string", description: "日期，格式 YYYY-MM-DD" },
          time: { type: "string", description: "时间，格式 HH:MM" },
          category: {
            type: "string",
            enum: ["work", "interest", "plan"],
            description: "归属类别：工作/兴趣/计划",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "标签数组，可为空",
          },
          important: { type: "boolean", description: "是否重要" },
          urgent: { type: "boolean", description: "是否紧急" },
        },
        required: ["title", "date", "category"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_goal",
      description:
        "把用户的一个目标拆分成 n 个合适颗粒度（每件 30-90 分钟能完成、渐进递进）的任务并写入日历。所有任务自动带上目标标签用于追踪进度，每个任务的 plan 会写入它的 PDCA；用户完成任务时会用费曼学习法验收成果。",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string", description: "用户的原始目标" },
          goal_tag: {
            type: "string",
            description: "目标短标签（2-6 字），如「费曼学习」；所有任务共用，用于追踪进度",
          },
          start_date: {
            type: "string",
            description: "第一个任务的日期，格式 YYYY-MM-DD",
          },
          category: {
            type: "string",
            enum: ["work", "interest", "plan"],
            description: "归属类别",
          },
          tasks: {
            type: "array",
            description:
              "拆分后的任务，按时间顺序，2-8 个；颗粒度=每件 30-90 分钟；循序渐进，后一个建立在前一个之上",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "任务名，具体可完成" },
                offset_days: {
                  type: "number",
                  description: "距第一天的天数偏移，0=第一天",
                },
                time: { type: "string", description: "时间 HH:MM，可省略默认 09:00" },
                plan: {
                  type: "string",
                  description: "这个任务的做法/方法论，写入它的 PDCA 计划",
                },
                micro: {
                  type: "string",
                  description:
                    "这个任务的 2 分钟微版：第一次动手时最小的一步，让用户当天就能开始",
                },
              },
              required: ["title", "offset_days", "plan"],
            },
          },
        },
        required: ["goal", "goal_tag", "start_date", "category", "tasks"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_pdca",
      description:
        "为用户已有的某个事项建议 PDCA 内容（计划/执行/检查/调整），应用后告知用户写到了哪个事项。",
      parameters: {
        type: "object",
        properties: {
          event_title: {
            type: "string",
            description: "目标事项的名称或名称的一部分",
          },
          plan: { type: "string", description: "计划；无则留空" },
          do: { type: "string", description: "执行；无则留空" },
          check: { type: "string", description: "检查；无则留空" },
          act: { type: "string", description: "调整；无则留空" },
        },
        required: ["event_title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_challenge",
      description:
        "为学习主题发起百日挑战。会生成确认卡片，用户点击确认后才会真正开始；确认前不要向用户声称挑战已经开始。先确认天数，再问一句目标笔记（挑战成功后用户能用它做成什么）。工作/钉钉事件不参与挑战打卡。",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "学习主题名或其一部分" },
          days: {
            type: "number",
            description: "挑战天数，7-365；不填默认 100",
          },
          goal_note: {
            type: "string",
            description: "目标笔记：挑战成功后用户能用这个主题做成什么，一句话",
          },
        },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_cards",
      description:
        "把用户已有事项里记录的内容（PDCA/语音转录/复盘）起草成复习卡，两步调用：第一步只传 event_title 读取该事项的素材（不写库）；第二步基于素材带上 cards 数组（每张含 front/back，最多 10 张）生成草稿，用户在掌握地图「Pi 起草的卡片」确认后才会进入复习队列。工作/钉钉事件会被拒绝。",
      parameters: {
        type: "object",
        properties: {
          event_title: {
            type: "string",
            description: "目标事项的名称或名称的一部分",
          },
          topic: {
            type: "string",
            description: "卡片归属的学习主题名；不填自动匹配事项关联的主题",
          },
          cards: {
            type: "array",
            description:
              "第二步才传：要起草的复习卡，从素材里提炼问题与答案，按理解顺序排列",
            items: {
              type: "object",
              properties: {
                front: { type: "string", description: "正面：提示或问题" },
                back: { type: "string", description: "背面：答案或展开" },
                source: {
                  type: "string",
                  enum: ["pdca", "transcript", "reflection"],
                  description: "内容来源；不填默认 pdca",
                },
              },
              required: ["front", "back"],
            },
          },
        },
        required: ["event_title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "assess_teachback",
      description:
        "教回评估：用户把自己的理解口头讲一遍后调用。对照该主题的知识点清单逐条判断是否讲清楚，covered=true 必须引用用户原话作为 quote。会生成评估草稿，用户点「应用本次教回」后才更新掌握度；应用前不写任何库。只使用清单里出现的知识点名，不要发明名字。",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "学习主题名或其一部分" },
          results: {
            type: "array",
            description: "逐条评估结果；同一个知识点只评一条",
            items: {
              type: "object",
              properties: {
                point: {
                  type: "string",
                  description: "知识点名，与清单完全一致",
                },
                covered: { type: "boolean", description: "是否讲清楚了" },
                quote: {
                  type: "string",
                  description: "用户原话引文；covered=true 时必填，遗漏可留空",
                },
              },
              required: ["point", "covered"],
            },
          },
          summary: {
            type: "string",
            description: "一句话总评：先补哪个、怎么补",
          },
        },
        required: ["topic", "results"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "challenge_reminder",
      description:
        "在一天的学习聊得差不多时（或用户要求时）调用：用一句面向用户的提醒语气话（不超过 40 字）概括今天的学习状态与今晚该复习什么，作为今晚 21:00 复习提醒的文案。只缓存文案，不写库。",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description:
              "今晚提醒的正文：一句提醒语气的话，贴合今天的实际学习内容，如「今天把假设检验讲顺了，晚上 5 张卡见。」",
          },
        },
        required: ["summary"],
      },
    },
  },
];
function toolQueryDay(args: Record<string, unknown>): Record<string, unknown> {
  const raw = String(args.date || "").trim();
  const key = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : selectedDate.value;
  const agenda = events.value
    .filter((event) => event.date === key)
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((event) => ({
      time: event.time,
      title: event.title,
      category: event.category,
      done: event.done,
    }));
  return { date: key, count: agenda.length, agenda };
}
async function toolPlanGoal(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const goal = String(args.goal || "").trim();
  const goalTag = String(args.goal_tag || "")
    .trim()
    .slice(0, 8);
  const startDate = String(args.start_date || "").trim();
  const category =
    args.category === "work" || args.category === "interest"
      ? args.category
      : "plan";
  const tasks = Array.isArray(args.tasks) ? args.tasks : [];
  if (!goal || !goalTag || !/^\d{4}-\d{2}-\d{2}$/.test(startDate))
    return { error: "goal、goal_tag、start_date(YYYY-MM-DD) 为必填" };
  if (!tasks.length || tasks.length > 8)
    return { error: "tasks 需要 2-8 个任务" };
  const created: { title: string; date: string }[] = [];
  for (const raw of tasks) {
    const task = (raw || {}) as Record<string, unknown>;
    const title = String(task.title || "")
      .trim()
      .slice(0, 60);
    const offset = Number(task.offset_days);
    if (!title || !Number.isFinite(offset) || offset < 0) continue;
    const date = new Date(`${startDate}T12:00:00`);
    date.setDate(date.getDate() + Math.floor(offset));
    const dateKeyStr = dateKey(date);
    const time = /^\d{1,2}:\d{2}$/.test(String(task.time || ""))
      ? String(task.time).padStart(5, "0")
      : "09:00";
    events.value.push({
      id: crypto.randomUUID(),
      title,
      date: dateKeyStr,
      time,
      category,
      tags: [...new Set([`目标·${goalTag}`])],
      source: "personal",
      done: false,
      important: true,
      urgent: false,
      voiceNote: "",
      reflection: "",
      micro: String(task.micro || "").trim().slice(0, 120),
      pdca: {
        plan: String(task.plan || "").trim(),
        do: "",
        check: "",
        act: "",
      },
    });
    created.push({ title, date: dateKeyStr });
  }
  if (!created.length)
    return { error: "没有有效的任务（需要 title 和 offset_days）" };
  await saveEvents();
  return {
    ok: true,
    goal,
    goal_tag: `目标·${goalTag}`,
    created: created.length,
    tasks: created,
    note: "已写入日历。告知用户：每完成一个任务勾选时，会自动进入费曼验收；全部完成即目标达成",
  };
}
function toolProposeEvent(
  args: Record<string, unknown>,
  suggestions: EventSuggestion[],
): Record<string, unknown> {
  const title = String(args.title || "")
    .trim()
    .slice(0, 60);
  const date = String(args.date || "").trim();
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return { error: "title 与 date(YYYY-MM-DD) 为必填" };
  const category =
    args.category === "work" || args.category === "interest"
      ? args.category
      : "plan";
  const tags = Array.isArray(args.tags)
    ? args.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : [];
  suggestions.push({
    title,
    date,
    time: /^\d{1,2}:\d{2}$/.test(String(args.time || ""))
      ? String(args.time).padStart(5, "0")
      : "09:00",
    category,
    tags,
    important: Boolean(args.important),
    urgent: Boolean(args.urgent),
  });
  return {
    ok: true,
    title,
    date,
    note: "已生成确认卡片，等待用户点击加入日历",
  };
}
interface LearningCheck {
  date: string;
  topic: string;
  level: "solid" | "shaky" | "lost";
  strengths: string;
  gaps: string;
  next: string;
}
const LEARNING_KEY = "shixu-learning-v1";
const learningLog = ref<LearningCheck[]>([]);
function loadLearningLog() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(LEARNING_KEY) || "[]",
    ) as LearningCheck[];
    learningLog.value = Array.isArray(parsed) ? parsed : [];
  } catch {
    learningLog.value = [];
  }
}
function saveLearningLog() {
  localStorage.setItem(LEARNING_KEY, JSON.stringify(learningLog.value));
}
// ── 学习主题本体：App 的核心实体。日历事项是主题在时间里的投影 ──
// 证据链只有两类行为：讲过（费曼/复述）、用过（完成关联事项 / PDCA 引用）。
// 刻意不存留存百分比与复测间隔——主题只认行为证据，巩固靠每晚复盘里的一问。
type TopicStatus = "learning" | "usable" | "teachable" | "paused";
interface TopicEvidence {
  at: string;
  kind: "explain" | "apply";
  note: string;
  level?: "solid" | "shaky" | "lost";
}
interface LearningTopic {
  id: string;
  title: string;
  why: string;
  useCase: string;
  goalTag: string;
  status: TopicStatus;
  nextStep: string;
  createdAt: string;
  evidence: TopicEvidence[];
}
const TOPICS_KEY = "shixu-topics-v1";
const topics = ref<LearningTopic[]>([]);
const topicStatusNames: Record<TopicStatus, string> = {
  learning: "在学",
  usable: "能用",
  teachable: "能教",
  paused: "搁置",
};
function loadTopics() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(TOPICS_KEY) || "[]",
    ) as LearningTopic[];
    topics.value = Array.isArray(parsed) ? parsed : [];
  } catch {
    topics.value = [];
  }
}
function saveTopics() {
  localStorage.setItem(TOPICS_KEY, JSON.stringify(topics.value));
}
function findTopic(needle: string): LearningTopic | undefined {
  const key = needle.trim();
  if (!key) return undefined;
  return (
    topics.value.find((topic) => topic.title === key) ||
    topics.value.find((topic) => topic.title.includes(key))
  );
}
// 存量迁移：旧学习条目 + 日历里「目标·」标签 → 主题（只跑一次，幂等）
function migrateToTopics() {
  let changed = false;
  try {
    const legacy = JSON.parse(
      localStorage.getItem("shixu-learning-items-v1") || "[]",
    ) as {
      topic: string;
      learnedAt: string;
      goalTag: string;
      feynmanChecks: { at: string; score: number; gaps: string }[];
      applications: string[];
    }[];
    for (const item of Array.isArray(legacy) ? legacy : []) {
      if (!item.topic || findTopic(item.topic)) continue;
      topics.value.push({
        id: crypto.randomUUID(),
        title: item.topic,
        why: "",
        useCase: "",
        goalTag: item.goalTag || "",
        status: "learning",
        nextStep: "",
        createdAt: item.learnedAt || today.value,
        evidence: [
          ...(item.feynmanChecks || []).map((check) => ({
            at: check.at,
            kind: "explain" as const,
            note: check.gaps || "费曼讲解",
            level:
              check.score >= 3
                ? ("solid" as const)
                : check.score === 2
                  ? ("shaky" as const)
                  : ("lost" as const),
          })),
          ...(item.applications || []).map((eventId) => ({
            at: "",
            kind: "apply" as const,
            note: eventId,
          })),
        ],
      });
      changed = true;
    }
  } catch {
    /* 旧数据坏了就跳过 */
  }
  for (const event of events.value)
    for (const tag of event.tags) {
      if (!tag.startsWith("目标·")) continue;
      const name = tag.replace("目标·", "");
      if (findTopic(name)) continue;
      topics.value.push({
        id: crypto.randomUUID(),
        title: name,
        why: "",
        useCase: "",
        goalTag: tag,
        status: "learning",
        nextStep: "",
        createdAt: event.date,
        evidence: [],
      });
      changed = true;
    }
  if (changed) saveTopics();
}
function topicExplainCount(topic: LearningTopic) {
  return topic.evidence.filter((item) => item.kind === "explain").length;
}
function topicApplyCount(topic: LearningTopic) {
  return topic.evidence.filter((item) => item.kind === "apply").length;
}
function topicLastExplain(topic: LearningTopic) {
  return [...topic.evidence]
    .reverse()
    .find((item) => item.kind === "explain");
}
function topicTaskStats(topic: LearningTopic) {
  const tag = topic.goalTag || `目标·${topic.title}`;
  const scoped = events.value.filter((event) =>
    event.tags.some((item) => item === tag || item === topic.title),
  );
  if (!scoped.length) return null;
  return {
    done: scoped.filter((event) => event.done).length,
    total: scoped.length,
  };
}
function appendTopicEvidence(
  topic: LearningTopic,
  entry: TopicEvidence,
) {
  topic.evidence.push(entry);
  saveTopics();
}
// 行为 → 证据：完成与主题相关的事项即「用过」
function recordApplication(event: CalendarEvent) {
  let changed = false;
  for (const topic of topics.value) {
    const related =
      event.title.includes(topic.title) ||
      event.tags.some(
        (tag) =>
          tag === topic.title || (topic.goalTag && tag === topic.goalTag),
      );
    const marker = `evt:${event.id}`;
    if (
      related &&
      !topic.evidence.some((item) => item.note === marker)
    ) {
      topic.evidence.push({
        at: event.date,
        kind: "apply",
        note: marker,
      });
      changed = true;
    }
  }
  if (changed) saveTopics();
}
// ── 学习闭环:百日挑战 + 复习队列 + 掌握地图(designs/shixu-learning-loop/fsd.md)──
// 数据在 learningLoop.ts(SQLite/降级 localStorage);这里接 Vue 状态与 UI。
// 模块内 store 非 reactive,用 loopTick 触发重渲染。
const loopTick = ref(0);
const loopBackendName = ref("");
const challengeForm = ref<{ topicId: string; days: number }>({ topicId: "", days: 100 });
const mapTopicId = ref("");
const newPointName = ref("");
const newPointBloom = ref<BloomLevel>("recall");
const cardForm = ref({ pointId: "", front: "", back: "" });
const loopError = ref("");
const queue = ref<QueueEntry[]>([]);
const reviewIndex = ref(0);
const showBack = ref(false);
const reviewDoneCount = ref(0);

const pointStatusNames: Record<PointStatus, string> = {
  dark: "未探索",
  touched: "已接触",
  shaky: "边缘",
  mastered: "已掌握",
};
/** 挑战确认卡展示每日门槛(Pi 侧固定 one_event;minutes 结算未生效,FSD §12-2) */
const challengeThresholdNames: Record<"one_event" | "minutes", string> = {
  one_event: "每天至少完成 1 个该主题的事项",
  minutes: "累计学习分钟数",
};
const bloomNames: Record<BloomLevel, string> = {
  recall: "能复述",
  explain: "能解释",
  apply: "能应用",
  create: "能创造",
};

const mapTopic = computed(() =>
  topics.value.find((topic) => topic.id === mapTopicId.value),
);
const mapPoints = computed(() => {
  void loopTick.value;
  return mapTopicId.value ? topicPoints(mapTopicId.value) : [];
});
const draftList = computed(() => {
  void loopTick.value;
  return draftCards();
});
const reviewEntry = computed(() => queue.value[reviewIndex.value] || null);

function masteryPercentOf(topicId: string) {
  void loopTick.value;
  return topicMasteryPercent(topicId);
}
function challengeOf(topicId: string): Challenge | undefined {
  void loopTick.value;
  return activeChallengeForTopic(topicId);
}
function progressOf(topicId: string): ChallengeProgress | null {
  void loopTick.value;
  const challenge = activeChallengeForTopic(topicId);
  return challenge ? challengeProgress(challenge) : null;
}
function streakOf(topicId: string) {
  void loopTick.value;
  const challenge = activeChallengeForTopic(topicId);
  return challenge ? challengeStreak(challenge) : 0;
}
function dueCount() {
  void loopTick.value;
  return buildDailyQueue().length;
}
function bumpLoop() {
  loopTick.value += 1;
}
/** 微版标签(#16):带该标签的事件完成不计 event 打卡,轻打卡由「现在就做」结束流程显式调用 */
const MICRO_TAG = "微版";
/** 事件勾选完成时,给标题/标签能对上的主题记一次挑战打卡 */
function recordLoopCheckin(event: CalendarEvent) {
  if (event.category === "work") return; // PRD 非目标:钉钉/工作事件不参与学习闭环(也不触发任何反馈时刻)
  if (event.tags.includes(MICRO_TAG)) return; // #16:微版起步零门槛,完成走结束流程的 lightCheckin
  for (const topic of topics.value) {
    const related =
      event.tags.includes(topic.title) ||
      event.tags.some((tag) => tag === topic.goalTag) ||
      event.title.includes(topic.title);
    if (!related) continue;
    const challenge = activeChallengeForTopic(topic.id);
    const before = challenge ? challengeStreak(challenge) : 0;
    recordEventDone(topic.id, event.date, event.id);
    if (challenge)
      pushMilestoneIfCrossed(topic.id, before, challengeStreak(challenge)); // #17 里程碑
  }
  bumpLoop();
}
function openChallengeDialog(topic: LearningTopic) {
  challengeForm.value = { topicId: topic.id, days: 100 };
  loopError.value = "";
  dialog.value = "challenge";
}
function createChallengeForTopic() {
  const topic = topics.value.find((item) => item.id === challengeForm.value.topicId);
  if (!topic) return;
  const result = createChallenge({
    topicId: topic.id,
    topicTitle: topic.title,
    totalDays: challengeForm.value.days,
  });
  if ("error" in result) {
    loopError.value = result.error;
    return;
  }
  bumpLoop();
  dialog.value = "";
}
function resumeTopicChallenge(topicId: string) {
  const challenge = activeChallengeForTopic(topicId);
  if (challenge) {
    resumeChallenge(challenge.id);
    bumpLoop();
  }
}
function abandonTopicChallenge(topicId: string) {
  const challenge = activeChallengeForTopic(topicId);
  if (challenge) {
    abandonChallenge(challenge.id);
    bumpLoop();
  }
}
function openMap(topic: LearningTopic) {
  mapTopicId.value = topic.id;
  newPointName.value = "";
  cardForm.value = { pointId: "", front: "", back: "" };
  loopError.value = "";
  dialog.value = "map";
}
function addPointFromForm() {
  if (!mapTopicId.value) return;
  const result = addKnowledgePoint({
    topicId: mapTopicId.value,
    name: newPointName.value,
    bloomLevel: newPointBloom.value,
  });
  if ("error" in result) {
    loopError.value = result.error;
    return;
  }
  newPointName.value = "";
  loopError.value = "";
  bumpLoop();
}
function removePoint(id: string) {
  removeKnowledgePoint(id);
  bumpLoop();
}
function addManualCard() {
  const topic = mapTopic.value;
  if (!topic) return;
  const result = createCard({
    topicId: topic.id,
    pointId: cardForm.value.pointId || null,
    sourceType: "manual",
    sourceId: `manual:${today.value}`,
    sourceTitle: topic.title,
    front: cardForm.value.front,
    back: cardForm.value.back,
    active: true,
  });
  if ("error" in result) {
    loopError.value = result.error;
    return;
  }
  cardForm.value = { pointId: "", front: "", back: "" };
  loopError.value = "";
  bumpLoop();
}
function confirmDraft(id: string) {
  confirmCard(id);
  bumpLoop();
}
function discardDraftCard(id: string) {
  discardDraft(id);
  bumpLoop();
}
/** 主题卡「Pi 起草的卡片」待确认徽标(接线 pendingDraftCount) */
function topicDraftCount(topicId: string) {
  void loopTick.value;
  return pendingDraftCount(topicId);
}
// ── 「现在就做」常驻条(FSD §14,#16):一次点击开始并计时;计时态仅内存不落库 ──
interface NowItem {
  topic: LearningTopic;
  action: NextAction;
}
const nowRunning = ref<{
  topicId: string;
  eventId: string;
  startedAt: number;
} | null>(null);
const nowTick = ref(0);
let nowInterval: ReturnType<typeof setInterval> | null = null;
/** 教回差距:learningLog 最近一条该主题记录(经标题匹配),level 与 gaps 交给 resolveNextAction 判定 */
function lastGapOf(topic: LearningTopic): {
  level: string;
  gaps: string;
} | null {
  for (let i = learningLog.value.length - 1; i >= 0; i -= 1) {
    const item = learningLog.value[i];
    if (
      item.topic === topic.title ||
      topic.title.includes(item.topic) ||
      item.topic.includes(topic.title)
    )
      return { level: item.level, gaps: item.gaps };
  }
  return null;
}
/** 空下一步主题的兜底起步动作(与 Pi create_topic 默认同文案):保证每个非搁置主题恰好一枚 chip(#16 复核修正) */
const NOW_FALLBACK_STEP = "拆第一周的任务";
const nowItems = computed<NowItem[]>(() => {
  void loopTick.value;
  return topics.value
    .filter((topic) => topic.status !== "paused")
    .map((topic) => ({
      topic,
      action: resolveNextAction(topic.id, {
        nextStep: topic.nextStep || NOW_FALLBACK_STEP,
        lastGap: lastGapOf(topic),
      }),
    }))
    .filter((item): item is NowItem => item.action !== null);
});
function nowActionLabel(action: NextAction) {
  if (action.source === "review") return "复习到期卡";
  return action.source === "micro" ? "2 分钟起步" : "2 分钟再讲";
}
const nowElapsedLabel = computed(() => {
  void nowTick.value;
  const running = nowRunning.value;
  if (!running) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - running.startedAt) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;
});
function beginNowTimer(topicId: string, eventId: string) {
  if (nowRunning.value) return; // 单一计时槽:进行中不重复创建/不切换
  nowRunning.value = { topicId, eventId, startedAt: Date.now() };
  if (!nowInterval)
    nowInterval = setInterval(() => {
      nowTick.value += 1;
    }, 1000);
}
function startNow(item: NowItem) {
  if (nowRunning.value) return; // 条上呈现进行中态;重复点击不建第二个事件
  if (item.action.source === "review") {
    openReview(); // 既有复习弹窗:不建事件不计时(#16 边界)
    return;
  }
  const micro =
    item.action.source === "micro"
      ? item.action.micro
      : `2 分钟再讲:${lastGapOf(item.topic)?.gaps || item.topic.nextStep}`.slice(
          0,
          120,
        );
  const title =
    item.action.source === "micro"
      ? `2 分钟起步·${item.topic.title}`
      : `再讲一次·${item.topic.title}`;
  const started = new Date();
  const event: CalendarEvent = {
    id: crypto.randomUUID(),
    title,
    date: today.value,
    time: `${String(started.getHours()).padStart(2, "0")}:${String(
      started.getMinutes(),
    ).padStart(2, "0")}`,
    category: "plan",
    tags: [...new Set([item.topic.title, MICRO_TAG])],
    source: "personal",
    done: false,
    important: false,
    urgent: false,
    voiceNote: "",
    reflection: "",
    micro,
    pdca: { plan: "", do: "", check: "", act: "" },
  };
  events.value.push(event);
  void saveEvents();
  beginNowTimer(item.topic.id, event.id);
}
/** 结束:事件置 done→有活跃挑战则显式轻打卡(当日已有打卡由 lightCheckin 自身拒绝)→PDCA 定位 Do 段 */
function finishNow() {
  const running = nowRunning.value;
  if (!running) return;
  if (nowInterval) {
    clearInterval(nowInterval);
    nowInterval = null;
  }
  nowRunning.value = null;
  const event = events.value.find((item) => item.id === running.eventId);
  if (!event) return;
  event.done = true;
  void saveEvents();
  recordApplication(event); // 微版事件完成计入「用过」证据(FSD §14 决策记录;evt:id 去重)
  if (running.topicId) {
    const challenge = activeChallengeForTopic(running.topicId);
    if (challenge) {
      const before = challengeStreak(challenge);
      lightCheckin(challenge.id);
      pushMilestoneIfCrossed(running.topicId, before, challengeStreak(challenge)); // #17 里程碑
    }
  }
  openPdca(event, "do");
  pdcaHint.value = "这 2 分钟做了什么?写一句 Do,或按住麦克风说 15 秒。";
  bumpLoop();
}
/** 事件详情「先做 2 分钟」:对既有事件走同一计时流程,不新建事件(#16 验收 3) */
function startMicroFromEvent() {
  const event = events.value.find((item) => item.id === pdcaTargetId.value);
  if (!event || event.done || nowRunning.value) return;
  beginNowTimer(matchTopicForEvent(event)?.id || "", event.id);
}
function openReview() {
  queue.value = buildDailyQueue();
  reviewIndex.value = 0;
  showBack.value = false;
  reviewDoneCount.value = 0;
  reviewFeedback.value = null;
  reviewTransition.value = "";
  dialog.value = "review";
}
// ── 反馈即引导(FSD §15,#17):自评后的一行反馈与地图轻提示 ──
interface ReviewFeedback {
  cardId: string;
  kind: "forgot" | "recall";
  /** 所评卡面截断,作反馈行归属标记:反馈在下一张卡面下展示,避免误读为当前卡的间隔 */
  cardFront: string;
  text: string;
}
const reviewFeedback = ref<ReviewFeedback | null>(null);
const reviewTransition = ref("");
const clearedStats = computed(() => {
  void loopTick.value; // 模块 store 非响应式,靠 bumpLoop 失效(gradeCurrent 每次自评后触发)
  return todayReviewStats();
});
/** source 锚定原文:按 sourceId 回查事件 PDCA/转录/反思;manual/无源退化为 back 首句(如实边界) */
function sourceAnchorOf(card: ReviewCard): string {
  const backFirstSentence =
    card.back.split(/[。;;!!??…\n]/)[0].trim() || card.back;
  if (card.sourceType === "manual" || !card.sourceId) return backFirstSentence;
  const event = events.value.find((item) => item.id === card.sourceId);
  if (!event || event.category === "work") return backFirstSentence;
  const anchor = [
    event.pdca.do,
    event.pdca.check,
    event.voiceNote,
    event.reflection,
    event.pdca.plan,
  ]
    .map((text) => (text || "").trim())
    .filter(Boolean)[0];
  return anchor ? anchor.slice(0, 60) : backFirstSentence;
}
/** Pi 一句话回忆线索:不阻塞翻卡,失败或不可用保留模板;仅替换同一张卡的反馈 */
async function fetchRecallHint(card: ReviewCard, anchor: string) {
  if (!aiConfig.value) return;
  try {
    const result = await postModelChat({
      model: aiConfig.value.model,
      messages: [
        {
          role: "system",
          content:
            "你是回忆线索生成器:用户自评「忘了」一张复习卡。基于原文锚点给一句话回忆线索,不超过 40 字,提示思考方向但不直接给答案,不用任何表扬词,不用百分数。",
        },
        {
          role: "user",
          content: `卡片正面:${card.front}\n背面:${card.back}\n原文锚点:${anchor}`,
        },
      ],
      temperature: 0.5,
      max_tokens: 80,
      stream: false,
    });
    const message = result.choices?.[0]?.message;
    const text = message?.content?.trim() || modelReply(result);
    if (text && reviewFeedback.value?.cardId === card.id)
      reviewFeedback.value.text = `原文:「${anchor}」。回忆线索:${text.slice(0, 60)};这张明天会再来。`;
  } catch {
    /* Pi 不可用:模板线索已在展示,不阻塞翻卡 */
  }
}
function gradeCurrent(grade: ReviewGrade) {
  const entry = queue.value[reviewIndex.value];
  if (!entry) return;
  const transition = scheduleCard(entry.card, grade);
  reviewDoneCount.value += 1;
  reviewTransition.value = transition
    ? pointTransitionText(entry.pointName || "知识点", transition)
    : "";
  const cardFront = entry.card.front.trim().slice(0, 16);
  if (grade === "recall") {
    reviewFeedback.value = {
      cardId: entry.card.id,
      kind: "recall",
      cardFront,
      text: `${entry.card.intervalDays} 天后见`,
    };
  } else if (grade === "forgot") {
    const anchor = sourceAnchorOf(entry.card);
    reviewFeedback.value = {
      cardId: entry.card.id,
      kind: "forgot",
      cardFront,
      text: recallHintText(anchor),
    };
    void fetchRecallHint(entry.card, anchor);
  } else {
    reviewFeedback.value = null;
  }
  showBack.value = false;
  if (reviewIndex.value + 1 >= queue.value.length) {
    queue.value = [];
    reviewIndex.value = 0;
  } else {
    reviewIndex.value += 1;
  }
  bumpLoop();
}
// 每日复习提醒(FSD §7:P0 单条,固定 21:00;与定时服务 9100 段分开)
const LOOP_NOTIF_BASE = 9200;
/** 结算昨日缺口,结果以 Pi 消息呈现(冻结保护/红线暂停附选项与可点「继续」;FSD §15.3) */
function runDailySettle() {
  // 冻结行同样推进 challengeStreak(#17 复核补口):结算前快照连续天数,冻结后检测里程碑
  const beforeStreaks = new Map<string, number>();
  for (const topic of topics.value) {
    const challenge = activeChallengeForTopic(topic.id);
    if (challenge) beforeStreaks.set(challenge.id, challengeStreak(challenge));
  }
  const settled = dailySettle();
  for (const item of settled) {
    if (item.paused)
      messages.value.push({
        role: "assistant",
        content: `挑战「${item.challenge.topicTitle}」连着两天没打卡,先帮你暂停了,连续没清零。两个走法:① 点下面「继续挑战」,从今天重新计连续,今天先做一个 2 分钟起步就行;② 直接告诉我你现在的节奏,我把每日门槛和计划重排轻一点(改门槛参数在下个版本)。`,
        resumeTopicId: item.challenge.topicId,
      });
    else if (item.froze) {
      messages.value.push({
        role: "assistant",
        content: `昨天没打卡,冻结卡替「${item.challenge.topicTitle}」保住了连续,还剩 ${item.challenge.freezesLeft} 张。`,
      });
      const before = beforeStreaks.get(item.challenge.id);
      if (before !== undefined)
        pushMilestoneIfCrossed(
          item.challenge.topicId,
          before,
          challengeStreak(item.challenge),
        );
    }
  }
  if (settled.length) bumpLoop();
}
/** 红线消息的「继续」按钮:复用既有恢复逻辑(§15.3,降门槛参数归 #12) */
function resumeFromMessage(message: ChatMessage) {
  if (!message.resumeTopicId || message.resumed) return;
  resumeTopicChallenge(message.resumeTopicId);
  message.resumed = true;
}
/** 里程碑:一行证据变化(done/freeze 计数)+ 下一个节点,无庆祝词(§15.3) */
function pushMilestoneIfCrossed(topicId: string, before: number, after: number) {
  const milestone = milestoneHit(before, after);
  if (!milestone) return;
  const challenge = activeChallengeForTopic(topicId);
  if (!challenge) return;
  const progress = challengeProgress(challenge);
  const next = MILESTONES.find((node) => node > after);
  messages.value.push({
    role: "assistant",
    content: `「${challenge.topicTitle}」连续 ${after} 天(打卡 ${progress.doneCount} 次 · 冻结 ${progress.freezeCount} 次)${
      next ? `;下一个节点 ${next} 天` : ""
    }。今天给主题安排下一步了吗?`,
  });
}
async function syncLoopNotifications() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const permission = await LocalNotifications.checkPermissions();
    if (permission.display !== "granted") {
      const requested = await LocalNotifications.requestPermissions();
      if (requested.display !== "granted") return;
    }
    for (const item of (await LocalNotifications.getPending()).notifications)
      if (item.id >= LOOP_NOTIF_BASE && item.id < LOOP_NOTIF_BASE + 100)
        await LocalNotifications.cancel({ notifications: [{ id: item.id }] });
    if (hasLoopActivity())
      await LocalNotifications.schedule({
        notifications: [
          {
            id: LOOP_NOTIF_BASE,
            // challenge_reminder 缓存的当日文案优先;缺失或过期回退静态模板(FSD §6.1)
            ...pickLoopReminderCopy(loadLoopReminderCopy(), todayKey()),
            schedule: { on: { hour: 21, minute: 0 }, allowWhileIdle: true },
          },
        ],
      });
  } catch {
    /* 通知不可用不阻塞 */
  }
}
const levelLabels: Record<LearningCheck["level"], string> = {
  solid: "讲清楚了",
  shaky: "部分卡壳",
  lost: "还讲不出来",
};
const feynmanWeek = computed(() => {
  const keys = new Set(weekDays.value.map((day) => day.key));
  return learningLog.value.filter((item) => keys.has(item.date)).length;
});
// 诚实的循环状态：今天的计划→完成→复盘→费曼，零就是零，断在哪一眼可见
const loopStatus = computed(() => {
  const dayEvents = events.value.filter(
    (event) => event.date === selectedDate.value,
  );
  return {
    streak: pdcaStreak.value,
    planned: dayEvents.length,
    done: dayEvents.filter((event) => event.done).length,
    reviewed: dayEvents.filter(
      (event) => event.pdca.check || event.pdca.act,
    ).length,
    feynman: learningLog.value.filter(
      (item) => item.date === selectedDate.value,
    ).length,
  };
});
// 习惯信号：全部来自本地数据的客观规则，可解释、不玄学
interface HabitSignal {
  id: string;
  message: string;
  ask: string;
}
const habitSignals = computed<HabitSignal[]>(() => {
  const out: HabitSignal[] = [];
  const dayBefore = dateKey(
    new Date(new Date(`${today.value}T12:00:00`).getTime() - 86400000),
  );
  const yEvents = events.value.filter((event) => event.date === dayBefore);
  const yDone = yEvents.filter((event) => event.done);
  const yReviewed = yEvents.filter(
    (event) => event.pdca.check || event.pdca.act,
  );
  if (yDone.length && !yReviewed.length)
    out.push({
      id: "stale_review",
      message: `昨天完成了 ${yDone.length} 件事但没写复盘`,
      ask: `我昨天完成了 ${yDone.length} 件事但没写复盘，帮我逐一补上 Check（结果与差异）和 Act（下一步）。`,
    });
  const overdue = events.value.filter(
    (event) =>
      !event.done &&
      event.date < today.value &&
      event.tags.some((tag) => tag.startsWith("目标·")),
  );
  if (overdue.length >= 2) {
    const tag =
      overdue[0].tags.find((t) => t.startsWith("目标·")) || "目标";
    out.push({
      id: "goal_behind",
      message: `目标「${tag.replace("目标·", "")}」有 ${overdue.length} 个任务逾期`,
      ask: `我的「${tag.replace("目标·", "")}」目标有 ${overdue.length} 个任务逾期了，帮我按现状重新拆解和安排。`,
    });
  }
  const recorded = new Set(
    events.value
      .filter(
        (event) =>
          Object.values(event.pdca).some(Boolean) || event.reflection,
      )
      .map((event) => event.date),
  );
  let gap = 0;
  const cursor = new Date(`${today.value}T12:00:00`);
  if (!recorded.has(today.value)) {
    cursor.setDate(cursor.getDate() - 1);
    while (gap < 7 && !recorded.has(dateKey(cursor))) {
      gap += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    if (gap >= 2)
      out.push({
        id: "gap",
        message: `已经 ${gap} 天没写 PDCA 了`,
        ask: `我已经 ${gap} 天没写 PDCA 了，帮我从今天最容易的一件小事 restart。`,
      });
  }
  return out;
});
const goalProgress = computed(() => {
  const stats = new Map<string, { done: number; total: number }>();
  for (const event of events.value)
    for (const tag of event.tags)
      if (tag.startsWith("目标·")) {
        const stat = stats.get(tag) || { done: 0, total: 0 };
        stat.total += 1;
        if (event.done) stat.done += 1;
        stats.set(tag, stat);
      }
  const list = [...stats.entries()];
  return list.length ? list[list.length - 1] : null;
});
async function toolStartFeynman(args: Record<string, unknown>) {
  const topic = String(args.topic || "").trim();
  if (!topic) return { error: "topic 必填" };
  const related = events.value.find(
    (event) =>
      event.title.includes(topic) &&
      [event.pdca.check, event.pdca.act, event.reflection].some(Boolean),
  );
  const recent = learningLog.value.slice(-3).map((item) => ({
    date: item.date,
    topic: item.topic,
    level: levelLabels[item.level],
    next: item.next,
  }));
  return {
    topic,
    related_event: related?.title || null,
    related_notes: related
      ? `计划：${related.pdca.plan || "空"}；检查：${related.pdca.check || "空"}`
      : null,
    recent_checks: recent,
    note: "请让用户用自己的话、像讲给 12 岁孩子一样简单讲解这个概念；听完后诚实评估，讲完两轮或明显卡壳时调用 save_feynman_result",
  };
}
const FEYNMAN_LEVEL_LABEL: Record<string, string> = {
  solid: "讲清楚了",
  shaky: "部分卡壳",
  lost: "还讲不出来",
};
async function toolSaveFeynmanResult(args: Record<string, unknown>) {
  const topic = String(args.topic || "").trim();
  const level = String(args.level || "") as LearningCheck["level"];
  if (!topic || !(level in levelLabels))
    return { error: "topic 和 level(solid/shaky/lost) 为必填" };
  const strengths = String(args.strengths || "").trim();
  const gaps = String(args.gaps || "").trim();
  const next = String(args.next_action || "").trim();
  const entry: LearningCheck = {
    date: today.value,
    topic,
    level,
    strengths,
    gaps,
    next,
  };
  learningLog.value.push(entry);
  saveLearningLog();
  const needle = String(args.event_title || "").trim() || topic;
  const event =
    events.value.find((item) => item.date === today.value && item.title.includes(needle)) ||
    events.value.find((item) => item.title.includes(needle));
  if (event) {
    if (gaps) event.pdca.check = `费曼检验（${FEYNMAN_LEVEL_LABEL[level]}）：讲清了 ${strengths || "—"}；卡在 ${gaps}`;
    if (next) event.pdca.act = next;
    await saveEvents();
  }
  const goalTag =
    event?.tags.find((tag) => tag.startsWith("目标·")) || "";
  let learningTopic = findTopic(topic);
  if (!learningTopic) {
    learningTopic = {
      id: crypto.randomUUID(),
      title: topic,
      why: "",
      useCase: "",
      goalTag,
      status: "learning",
      nextStep: gaps ? `补上卡壳点：${gaps}` : "",
      createdAt: entry.date,
      evidence: [],
    };
    topics.value.push(learningTopic);
  }
  if (goalTag && !learningTopic.goalTag) learningTopic.goalTag = goalTag;
  appendTopicEvidence(learningTopic, {
    at: entry.date,
    kind: "explain",
    note: strengths || gaps || "费曼讲解",
    level,
  });
  return {
    ok: true,
    level: FEYNMAN_LEVEL_LABEL[level],
    wrote_to: event ? event.title : "学习档案（无关联事项）",
    note: "已记录。请用一句鼓励的话收尾，并结合 gaps 提醒用户下一步。",
  };
}
function toolCreateTopic(args: Record<string, unknown>) {
  const title = String(args.title || "").trim().slice(0, 40);
  if (!title) return { error: "title 必填" };
  if (findTopic(title)) return { error: `已有相近主题「${findTopic(title)!.title}」，直接推进它即可` };
  const topic: LearningTopic = {
    id: crypto.randomUUID(),
    title,
    why: String(args.why || "").trim().slice(0, 120),
    useCase: String(args.use_case || "").trim().slice(0, 120),
    goalTag: "",
    status: "learning",
    nextStep: String(args.next_step || "").trim() || "拆第一周的任务",
    createdAt: today.value,
    evidence: [],
  };
  topics.value.push(topic);
  saveTopics();
  return {
    ok: true,
    topic: topic.title,
    next_step: topic.nextStep,
    note: "已创建，第一次动手任务已就绪。先推动用户立刻做 2 分钟起步（学习视图顶部「现在就做」），再视情况用 plan_goal 把目标拆成带「目标·」标签的事项。",
  };
}
function toolUpdateTopic(args: Record<string, unknown>) {
  const topic = findTopic(String(args.title || ""));
  if (!topic) return { error: "没有找到这个学习主题" };
  const changed: string[] = [];
  const status = String(args.status || "") as TopicStatus;
  if (status && status in topicStatusNames && status !== topic.status) {
    topic.status = status;
    changed.push(`状态→${topicStatusNames[status]}`);
  }
  const nextStep = String(args.next_step || "").trim();
  if (nextStep && nextStep !== topic.nextStep) {
    topic.nextStep = nextStep.slice(0, 80);
    changed.push("下一步已更新");
  }
  const why = String(args.why || "").trim();
  if (why && why !== topic.why) {
    topic.why = why.slice(0, 120);
    changed.push("为什么学已补");
  }
  const useCase = String(args.use_case || "").trim();
  if (useCase && useCase !== topic.useCase) {
    topic.useCase = useCase.slice(0, 120);
    changed.push("用例已补");
  }
  if (!changed.length) return { ok: true, topic: topic.title, note: "没有需要更新的内容" };
  saveTopics();
  return { ok: true, topic: topic.title, changed };
}
async function toolUpdateEvent(args: Record<string, unknown>) {
  const needle = String(args.event_title || "").trim();
  const event = events.value.find((item) => item.title.includes(needle));
  if (!event) return { error: `没有找到名称包含「${needle}」的事项` };
  const changed: string[] = [];
  const newTitle = String(args.new_title || "").trim();
  if (newTitle && newTitle !== event.title) {
    event.title = newTitle.slice(0, 60);
    changed.push(`名称→${event.title}`);
  }
  const date = String(args.date || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date !== event.date) {
    changed.push(`日期→${date}`);
    event.date = date;
  }
  const time = String(args.time || "").trim();
  if (/^\d{1,2}:\d{2}$/.test(time) && time !== event.time) {
    changed.push(`时间→${time}`);
    event.time = time.padStart(5, "0");
  }
  if (typeof args.important === "boolean" && args.important !== event.important) {
    event.important = args.important;
    changed.push(args.important ? "标记重要" : "取消重要");
  }
  if (typeof args.urgent === "boolean" && args.urgent !== event.urgent) {
    event.urgent = args.urgent;
    changed.push(args.urgent ? "标记紧急" : "取消紧急");
  }
  if (!changed.length) return { ok: true, event: event.title, note: "没有需要修改的内容" };
  await saveEvents();
  return { ok: true, event: event.title, changed };
}
async function toolProposePdca(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const needle = String(args.event_title || "").trim();
  const event = events.value.find((item) => item.title.includes(needle));
  if (!event) return { error: `没有找到名称包含「${needle}」的事项` };
  const applied: string[] = [];
  for (const stage of ["plan", "do", "check", "act"] as Step[]) {
    const value = String(args[stage] || "").trim();
    if (value) {
      event.pdca[stage] = value;
      applied.push(stage);
    }
  }
  if (!applied.length) return { error: "没有提供任何要写入的内容" };
  await saveEvents();
  return { ok: true, event: event.title, applied };
}
// ── Pi 学习闭环三工具(FSD §6.1):create_challenge / draft_cards / challenge_reminder ──
// 建议制:工具只产草稿与文案,落库一律由用户确认触发(confirmChallengeDraft / 掌握地图收下)。
/** 与实时打卡同一条关联规则:标题包含主题名 / 标签等于主题名或 goalTag(§12-2) */
function matchTopicForEvent(event: CalendarEvent): LearningTopic | undefined {
  return topics.value.find(
    (topic) =>
      event.tags.includes(topic.title) ||
      event.tags.some((tag) => tag === topic.goalTag) ||
      event.title.includes(topic.title),
  );
}
function toolCreateChallenge(
  args: Record<string, unknown>,
  drafts: ChallengeSuggestion[],
): Record<string, unknown> {
  const topic = findTopic(String(args.topic || ""));
  if (!topic) return { error: `没有找到学习主题「${String(args.topic || "").trim()}」` };
  // 预检单活跃冲突:有 active/paused 挑战时不产确认卡
  if (activeChallengeForTopic(topic.id))
    return {
      error: "该主题已有进行中的挑战",
      note: "不要生成确认卡;告知用户已有进行中的挑战,可先继续或放弃后再开新的。",
    };
  // 一次只挂一张待确认卡:多张时后到的丢弃会造成模型与界面状态不一致(#8 复核修正)
  if (drafts.length)
    return {
      error: "本轮对话已有一张待确认的挑战卡,未为本主题生成新卡",
      note: "告知用户:先确认手头这张挑战卡,之后可以再开下一个主题的挑战。",
    };
  const normalized = normalizeChallengeSuggestion({
    topicId: topic.id,
    topicTitle: topic.title,
    days: args.days,
    // 不透传 threshold:minutes 门槛结算未生效(FSD §12-2),Pi 侧固定 one_event
    goalNote: String(args.goal_note || ""),
  });
  if ("error" in normalized) return { error: normalized.error };
  drafts.push(normalized);
  return {
    ok: true,
    topic: topic.title,
    days: normalized.days,
    goal_note: normalized.goalNote,
    note: "已生成挑战确认卡,等待用户在会话里点击确认;确认前不要重复调用。",
  };
}
function toolDraftCards(args: Record<string, unknown>): Record<string, unknown> {
  const needle = String(args.event_title || "").trim();
  if (!needle) return { error: "event_title 为必填" };
  const event = events.value.find((item) => item.title.includes(needle));
  if (!event) return { error: `没有找到名称包含「${needle}」的事项` };
  const sources = extractLoopCardSources({
    category: event.category,
    pdca: event.pdca,
    voiceNote: event.voiceNote,
    reflection: event.reflection,
  });
  if ("error" in sources) return { error: sources.error };
  const topic =
    (String(args.topic || "").trim() ? findTopic(String(args.topic || "")) : undefined) ||
    matchTopicForEvent(event);
  if (!Array.isArray(args.cards)) {
    // 第一段:只读来源文本,零写入
    return {
      ok: true,
      stage: "sources",
      event: event.title,
      topic: topic?.title || null,
      sources,
      note: "已读取素材(未写入任何数据)。请基于素材再调用一次 draft_cards,带上 cards 数组(≤10 张,每张含 front/back)生成草稿。",
    };
  }
  // 第二段:逐张落 draft(不动 active,不建日历事件)
  if (!topic)
    return {
      error: "该事项没有关联的学习主题,无法归档卡片;请让用户指明主题或先给事项打上主题标签",
    };
  const batch = normalizePiCardBatch(args.cards);
  let created = 0;
  for (const item of batch.cards) {
    const result = createCard({
      topicId: topic.id,
      pointId: null,
      sourceType: item.source,
      sourceId: event.id,
      sourceTitle: event.title,
      front: item.front,
      back: item.back,
    });
    if (!("error" in result)) created += 1;
  }
  bumpLoop();
  return {
    ok: true,
    event: event.title,
    topic: topic.title,
    created,
    skipped: batch.skipped,
    truncated: batch.truncated,
    note: `已生成 ${created} 张草稿,放在掌握地图「Pi 起草的卡片」,用户收下后才会进入复习队列。提醒用户去确认。`,
  };
}
function toolChallengeReminder(args: Record<string, unknown>): Record<string, unknown> {
  const body = String(args.summary || "").trim();
  if (!body)
    return { error: "summary 为必填:用一句提醒语气的话概括今天的学习状态" };
  const cached = cacheLoopReminderCopy(LOOP_REMINDER_TITLE, body);
  // 同日已按静态文案排入的 9200 通知要立即重排,当晚 21:00 才会用上新文案(#8 复核修正)
  void syncLoopNotifications();
  return {
    ok: true,
    title: cached.title,
    body: cached.body,
    note: "已缓存为今晚 21:00 复习提醒的文案(仅本地缓存,不写库)。告知用户今晚提醒会用这句话。",
  };
}
// ── 教回评估(FSD §13,#9):assess_teachback 只产草稿,应用才走 applyTeachback 写库 ──
function toolAssessTeachback(
  args: Record<string, unknown>,
  drafts: TeachbackDraft[],
): Record<string, unknown> {
  const topic = findTopic(String(args.topic || ""));
  if (!topic)
    return { error: `没有找到学习主题「${String(args.topic || "").trim()}」` };
  if (!topicPoints(topic.id).length)
    return {
      error: "该主题还没有知识点",
      note: "不要生成评估清单;建议用户先在掌握地图拆边界。",
    };
  const resolved = resolveTeachbackResults(topic.id, args.results);
  if (!resolved.results.length)
    return {
      error:
        "评估结果没有任何可解析的知识点;请对照主题知识点清单重新评估,point 须与知识点名完全一致",
      unknown: resolved.unknown,
    };
  drafts.push({
    topicId: topic.id,
    topicTitle: topic.title,
    summary: String(args.summary || "").trim().slice(0, 160),
    items: resolved.results.map((item) => ({
      pointId: item.pointId,
      pointName: pointById(item.pointId)?.name || "",
      covered: item.covered,
      quote: item.quote,
    })),
    unknown: resolved.unknown,
  });
  return {
    ok: true,
    topic: topic.title,
    resolved: resolved.results.length,
    unknown: resolved.unknown,
    note: "评估草稿已生成,等待用户在会话里点「应用本次教回」;应用前不要写库,也不要重复调用。",
  };
}
/** 应用教回草稿:此前 mastery/loop_teachback 零变化;应用走 applyTeachback(covered 项推进,遗漏不自动降级) */
function applyTeachbackDraft(message: ChatMessage) {
  const draft = message.teachbackDraft;
  if (!draft || draft.applied) return;
  applyTeachback(
    draft.topicId,
    `voice:${new Date().toISOString()}`,
    draft.items.map((item) => ({
      pointId: item.pointId,
      covered: item.covered,
      quote: item.quote,
    })),
  );
  draft.applied = true;
  bumpLoop();
}
/** 已应用后遗漏项「记一次没讲清」:一次 forgot 证据,状态由 §5.1 规则重算(不做状态承诺) */
function markTeachbackMiss(message: ChatMessage, index: number) {
  const draft = message.teachbackDraft;
  const item = draft?.items[index];
  if (!draft || !item || item.covered || item.marked) return;
  applyPointEvidence(item.pointId, false);
  item.marked = true;
  bumpLoop();
}
/** 教回差距动作一:加一张卡(createCard 落 draft,走既有草稿确认面板;§15.2);无引文时背面用兜底文案 */
function addGapCard(message: ChatMessage, index: number) {
  const draft = message.teachbackDraft;
  const item = draft?.items[index];
  if (!draft || !item || item.covered || item.actions?.card) return;
  const result = createCard({
    topicId: draft.topicId,
    pointId: item.pointId,
    sourceType: "manual",
    sourceId: `teachback:${draft.topicId}`,
    sourceTitle: "教回差距",
    front: `讲清「${item.pointName}」`,
    back: item.quote || `教回时没讲清「${item.pointName}」,重讲一次补全`,
  });
  if ("error" in result) return;
  if (!item.actions) item.actions = {};
  item.actions.card = true;
  bumpLoop();
}
function addDaysFromToday(days: number): string {
  const shifted = new Date(`${today.value}T12:00:00`);
  shifted.setDate(shifted.getDate() + days);
  return dateKey(shifted);
}
/** 教回差距动作二/三:15 分钟任务、三天后再讲——建议事件,确认(saveSuggestion)才落库,完成后经 recordLoopCheckin 计入挑战 */
function pushGapSuggestion(
  message: ChatMessage,
  index: number,
  kind: "task" | "reteach",
) {
  const draft = message.teachbackDraft;
  const item = draft?.items[index];
  if (!draft || !item || item.covered) return;
  if (kind === "task" ? item.actions?.task : item.actions?.reteach) return;
  const suggestion: EventSuggestion = {
    title:
      kind === "task" ? `15 分钟:${item.pointName}` : `三天后再讲:${item.pointName}`,
    date: kind === "task" ? today.value : addDaysFromToday(3),
    time: kind === "task" ? "20:00" : "09:00",
    category: "plan",
    tags: [draft.topicTitle],
    important: true,
    urgent: false,
  };
  if (!message.suggestions) message.suggestions = [];
  message.suggestions.push(suggestion);
  if (!message.saved) message.saved = [];
  message.saved[message.suggestions.length - 1] = false;
  if (!item.actions) item.actions = {};
  if (kind === "task") item.actions.task = true;
  else item.actions.reteach = true;
}
/** 教回入口(FSD §13):复用 transcribe();无识别结果不调模型零写库;转录+知识点清单走 askPi */
async function startTeachback(topic: LearningTopic) {
  if (!topicPoints(topic.id).length) {
    messages.value.push({
      role: "assistant",
      content: `「${topic.title}」还没有知识点。先在掌握地图拆边界:这个主题里,哪些是你还说不清的?`,
    });
    chatOpen.value = true;
    return;
  }
  let transcript = "";
  let transcribeError: string | null = null;
  try {
    transcript = (await transcribe()) || "";
  } catch (error) {
    // 权限被拒、环境不支持等具体原因要透传,不能统一吞成"没有识别到语音"
    transcribeError =
      error instanceof Error ? error.message : "语音识别失败,请重试。";
  }
  if (!transcript.trim()) {
    messages.value.push({
      role: "assistant",
      content: transcribeError || "没有识别到语音,再按一次「教回」重试。",
    });
    chatOpen.value = true;
    return;
  }
  const points = topicPoints(topic.id)
    .map((point) => `${point.name}(${bloomNames[point.bloomLevel]})`)
    .join("、");
  voiceInitiated.value = true; // 教回是语音行为:评估结果自动播报(#18)
  const teachbackPrompt = `我用 2 分钟讲了「${topic.title}」,请用 assess_teachback 对照知识点清单评估我讲清楚了什么:${transcript}\n(知识点清单:${points})`;
  if (chatBusy.value) {
    // Pi 正在回复上一条:教回内容放进输入框等发送,不静默丢弃
    chatText.value = teachbackPrompt;
    messages.value.push({
      role: "assistant",
      content:
        "你的讲解我收到了,但 Pi 正在回复上一条消息。内容已放进输入框,等它说完按发送即可开始评估。",
    });
    chatOpen.value = true;
    return;
  }
  await askPi(teachbackPrompt);
}
async function executeTool(
  name: string,
  args: Record<string, unknown>,
  suggestions: EventSuggestion[],
  challengeDrafts: ChallengeSuggestion[],
  teachbackDrafts: TeachbackDraft[],
): Promise<Record<string, unknown>> {
  if (name === "query_day") return toolQueryDay(args);
  if (name === "plan_goal") return await toolPlanGoal(args);
  if (name === "update_event") return await toolUpdateEvent(args);
  if (name === "propose_event") return toolProposeEvent(args, suggestions);
  if (name === "propose_pdca") return await toolProposePdca(args);
  if (name === "start_feynman") return await toolStartFeynman(args);
  if (name === "save_feynman_result")
    return await toolSaveFeynmanResult(args);
  if (name === "create_topic") return toolCreateTopic(args);
  if (name === "update_topic") return toolUpdateTopic(args);
  if (name === "create_challenge") return toolCreateChallenge(args, challengeDrafts);
  if (name === "draft_cards") return toolDraftCards(args);
  if (name === "challenge_reminder") return toolChallengeReminder(args);
  if (name === "assess_teachback") return toolAssessTeachback(args, teachbackDrafts);
  return { error: `未知工具 ${name}` };
}
async function runPiAgent(
  userMessage: string,
): Promise<{
  reply: string;
  suggestions: EventSuggestion[];
  challengeDrafts: ChallengeSuggestion[];
  teachbackDrafts: TeachbackDraft[];
}> {
  if (!aiConfig.value) throw new Error("未配置模型。");
  const chat: Record<string, unknown>[] = [
    { role: "system", content: `${piSystemPrompt()} ${PI_AGENT_PROMPT} ${
      learningLog.value.length
        ? `学习档案（最近的费曼检验）：${learningLog.value
            .slice(-3)
            .map(
              (item) =>
                `${item.date}「${item.topic}」${levelLabels[item.level]}${
                  item.next ? `，下次：${item.next}` : ""
                }`,
            )
            .join("；")}。根据档案推着用户进步：衔接上次的差距，别让进步漫无目的。`
        : ""
    } ${
      topics.value.length
        ? `学习主题看板：${topics.value
            .filter((topic) => topic.status !== "paused")
            .slice(-6)
            .map(
              (topic) =>
                `「${topic.title}」${topicStatusNames[topic.status]}（讲${topicExplainCount(
                  topic,
                )}次·用${topicApplyCount(topic)}次${
                  topicLastExplain(topic)?.level === "shaky" ||
                  topicLastExplain(topic)?.level === "lost"
                    ? "·上次没讲清"
                    : ""
                }${topic.nextStep ? `·下一步:${topic.nextStep}` : ""}）`,
            )
            .join("；")}。从证据最少或最久没动的主题开始推动。`
        : ""
    } ${
      habitSignals.value.length
        ? `当前习惯信号（基于客观数据，可主动关心）：${habitSignals.value
            .map((signal) => signal.message)
            .join("；")}。适时温和地提醒用户，给具体的补救建议。`
        : ""
    }` },
    ...messages.value
      .slice(-11, -1)
      .map(({ role, content }) => ({ role, content })),
    { role: "user", content: userMessage },
  ];
  const suggestions: EventSuggestion[] = [];
  const challengeDrafts: ChallengeSuggestion[] = [];
  const teachbackDrafts: TeachbackDraft[] = [];
  for (let round = 0; round < 3; round++) {
    let result: ModelChatResult;
    try {
      result = await postModelChat({
        model: aiConfig.value.model,
        messages: chat,
        tools: PI_TOOLS,
        temperature: 0.5,
        max_tokens: 900,
        stream: false,
      });
    } catch (error) {
      if (round === 0) {
        // 个别服务不支持 tools 参数，降级为纯对话
        result = await postModelChat({
          model: aiConfig.value.model,
          messages: chat,
          temperature: 0.5,
          max_tokens: 900,
          stream: false,
        });
      } else {
        throw error;
      }
    }
    const message = result.choices?.[0]?.message;
    const calls = message?.tool_calls || [];
    if (!calls.length) {
      const reply =
        message?.content?.trim() || modelReply(result) || "暂时没有收到回复。";
      return { reply, suggestions, challengeDrafts, teachbackDrafts };
    }
    chat.push({
      role: "assistant",
      content: message?.content || "",
      tool_calls: calls,
    });
    for (const call of calls) {
      const name = call.function?.name || "";
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}") as Record<
          string,
          unknown
        >;
      } catch {
        args = {};
      }
      const output = await executeTool(
        name,
        args,
        suggestions,
        challengeDrafts,
        teachbackDrafts,
      );
      chat.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(output),
      });
    }
  }
  return {
    reply: "这次调用的工具有点多，先到这里；需要继续随时叫我。",
    suggestions,
    challengeDrafts,
    teachbackDrafts,
  };
}
function extractJsonObject(text: string): { events?: unknown[] } | null {
  const cleaned = text.replace(/```json|```/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as {
      events?: unknown[];
    };
  } catch {
    return null;
  }
}
async function saveSuggestion(message: ChatMessage, index: number) {
  const suggestion = message.suggestions?.[index];
  if (!suggestion || message.saved?.[index]) return;
  events.value.push({
    id: crypto.randomUUID(),
    title: suggestion.title,
    date: suggestion.date || selectedDate.value,
    time: suggestion.time,
    category: suggestion.category,
    tags: [...new Set(suggestion.tags)],
    source: "personal",
    done: false,
    important: suggestion.important,
    urgent: suggestion.urgent,
    voiceNote: "",
    reflection: "",
    micro: "",
    pdca: { plan: "", do: "", check: "", act: "" },
  });
  if (!message.saved) message.saved = [];
  message.saved[index] = true;
  await saveEvents();
}
/** 挑战确认卡:用户点确认才调 createChallenge 落库(含 goal_note);取消零写入(FSD §6.1) */
function confirmChallengeDraft(message: ChatMessage) {
  const draft = message.challengeDraft;
  if (!draft || message.challengeSaved) return;
  const result = createChallenge({
    topicId: draft.topicId,
    topicTitle: draft.topicTitle,
    totalDays: draft.days,
    threshold: draft.threshold,
    goalNote: draft.goalNote,
  });
  if ("error" in result) {
    messages.value.push({
      role: "assistant",
      content: `挑战没有开始:${result.error}`,
    });
    return;
  }
  message.challengeSaved = true;
  bumpLoop();
  void syncLoopNotifications();
}
/** 事件页入口(FSD §6.1):注入固定请求语走 runPiAgent,draft_cards 两段式完成起草 */
function draftCardsFromEvent() {
  const title = pdcaEventTitle.value;
  if (!title) return;
  void askPi(`把事项「${title}」里已经记录的内容起草成复习卡。`);
}
async function askPi(text?: string) {
  const message = (text || chatText.value).trim();
  if (!message || chatBusy.value) return;
  const fromVoice = voiceInitiated.value; // 语音发起 → 回复自动播报(#18)
  voiceInitiated.value = false;
  chatOpen.value = true;
  if (!aiConfig.value) {
    messages.value.push({
      role: "assistant",
      content:
        "先配置一个模型 API Key 吧，下面弹窗里填好就能用。密钥只保存在这台手机的安全存储里。",
    });
    openAiSettings();
    return;
  }
  messages.value.push({ role: "user", content: message });
  chatText.value = "";
  chatBusy.value = true;
  try {
    const { reply, suggestions, challengeDrafts, teachbackDrafts } =
      await runPiAgent(message);
    const replyMessage: ChatMessage = { role: "assistant", content: reply };
    if (suggestions.length) replyMessage.suggestions = suggestions;
    if (challengeDrafts.length) replyMessage.challengeDraft = challengeDrafts[0];
    if (teachbackDrafts.length) replyMessage.teachbackDraft = teachbackDrafts[0];
    messages.value.push(replyMessage);
    void scrollChatToBottom();
    if (fromVoice && reply.trim())
      void toggleSpeak(replyMessage, messages.value.length - 1);
  } catch (error) {
    messages.value.push({
      role: "assistant",
      content:
        error instanceof Error ? error.message : "连接模型失败，请稍后再试。",
    });
  } finally {
    chatBusy.value = false;
  }
}
async function scrollChatToBottom() {
  await nextTick();
  if (chatHistoryEl.value)
    chatHistoryEl.value.scrollTop = chatHistoryEl.value.scrollHeight;
}
watch(() => messages.value.length, scrollChatToBottom);
const currentTaskId = computed(
  () => prioritizedEvents.value.find((event) => !event.done)?.id || "",
);
async function removeEvent(event: CalendarEvent) {
  events.value = events.value.filter((item) => item.id !== event.id);
  await saveEvents();
}
function openPdca(event: CalendarEvent, stage?: Step) {
  pdcaTargetId.value = event.id;
  pdcaForm.value = { ...event.pdca };
  pdcaStage.value =
    stage ||
    (steps.find((step) => !event.pdca[step.id])?.id as Step | undefined) ||
    "act";
  pdcaHint.value = "";
  dialog.value = "pdca";
}
function commitPdca() {
  const event = events.value.find((item) => item.id === pdcaTargetId.value);
  if (!event) return;
  event.pdca = { ...pdcaForm.value };
  void saveEvents();
}
function closePdca() {
  commitPdca();
  dialog.value = "";
}
function pdcaNext() {
  commitPdca();
  const order = steps.map((step) => step.id);
  const index = order.indexOf(pdcaStage.value);
  pdcaStage.value = order[Math.min(index + 1, order.length - 1)];
}
async function recordRoutineVoice(field: "name" | "prompt") {
  if (routineListening.value) {
    stopVoice();
    routineListening.value = null;
    return;
  }
  routineListening.value = field;
  try {
    const transcript = await transcribe();
    if (transcript) {
      const current =
        field === "name"
          ? routineForm.value.name
          : routineForm.value.prompt;
      const merged = current ? `${current} ${transcript}` : transcript;
      if (field === "name") routineForm.value.name = merged;
      else routineForm.value.prompt = merged;
    }
  } catch (error) {
    routineError.value =
      error instanceof Error ? error.message : "语音识别失败，请重试。";
  } finally {
    routineListening.value = null;
  }
}
async function recordPdcaVoice() {
  if (listening.value) {
    stopVoice();
    return;
  }
  listening.value = true;
  try {
    const transcript = await transcribe();
    if (transcript) {
      const current = pdcaForm.value[pdcaStage.value];
      pdcaForm.value[pdcaStage.value] = current
        ? `${current} ${transcript}`
        : transcript;
    }
  } catch (error) {
    pdcaHint.value =
      error instanceof Error ? error.message : "语音识别失败，请再试一次。";
  } finally {
    listening.value = false;
  }
}
const ROUTINE_NOTIF_BASE = 9100;
const firingRoutines = new Set<string>();
async function callRoutineModel(routine: Routine): Promise<string> {
  const result = await postModelChat({
    model: aiConfig.value!.model,
    messages: [
      {
        role: "system",
        content:
          "你是定时内容助手。按用户的固定指令生成当天内容，用简体中文纯文本直接输出内容本身，不要任何解释或前后缀。",
      },
      {
        role: "user",
        content: `今天是 ${today.value}。固定指令：${routine.prompt}${
          topics.value.filter((topic) => topic.status === "learning").length
            ? `\n\n在内容末尾带一句：最近在学 ${topics.value
                .filter((topic) => topic.status === "learning")
                .slice(-3)
                .map((topic) => `「${topic.title}」`)
                .join("、")}，睡前挑一个，两句话讲给自己听。`
            : ""
        }`,
      },
    ],
    temperature: 0.8,
    max_tokens: 1500,
    stream: false,
  });
  const reply = result.choices?.[0]?.message?.content?.trim() || "";
  if (!reply) throw new Error("暂时没有收到回复。");
  return reply;
}
function markRoutineFired(id: string) {
  routineFired.value[id] = today.value;
  saveFiredMap(routineFired.value);
}
async function fireRoutine(routine: Routine) {
  if (firingRoutines.has(routine.id) || !aiConfig.value) return;
  firingRoutines.add(routine.id);
  try {
    const result = await callRoutineModel(routine);
    markRoutineFired(routine.id);
    messages.value.push({
      role: "assistant",
      content: `【${routine.name} ${routine.time}】\n${result}`,
    });
    chatOpen.value = true;
    void scrollChatToBottom();
  } catch (error) {
    markRoutineFired(routine.id);
    messages.value.push({
      role: "assistant",
      content: `【${routine.name}】生成失败：${
        error instanceof Error ? error.message : "请稍后重试。"
      }`,
    });
    chatOpen.value = true;
  } finally {
    firingRoutines.delete(routine.id);
  }
}
function checkDueRoutines() {
  const now = new Date();
  const nowHM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  for (const routine of routines.value)
    if (isDue(routine, nowHM, routineFired.value[routine.id], today.value))
      void fireRoutine(routine);
}
async function syncRoutineNotifications() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const permission = await LocalNotifications.checkPermissions();
    if (permission.display !== "granted") {
      const requested = await LocalNotifications.requestPermissions();
      if (requested.display !== "granted") return;
    }
    for (const item of (await LocalNotifications.getPending()).notifications)
      if (item.id >= ROUTINE_NOTIF_BASE)
        await LocalNotifications.cancel({ notifications: [{ id: item.id }] });
    const notifications = routines.value
      .filter((routine) => routine.enabled)
      .map((routine, index) => {
        const [hour, minute] = routine.time.split(":").map(Number);
        return {
          id: ROUTINE_NOTIF_BASE + index,
          title: routine.name,
          body: "到点了，打开拾序查看今天的内容。",
          schedule: { on: { hour, minute }, allowWhileIdle: true },
        };
      });
    if (notifications.length)
      await LocalNotifications.schedule({ notifications });
  } catch {
    /* 通知不可用时不阻塞应用内的定时生成 */
  }
}
function openRoutines() {
  routineForm.value = { name: "", prompt: "", time: "21:00", endTime: "" };
  routineError.value = "";
  dialog.value = "routines";
}
async function addRoutine() {
  const name = routineForm.value.name.trim();
  const prompt = routineForm.value.prompt.trim();
  const time = routineForm.value.time;
  const endTime = routineForm.value.endTime;
  const missing: string[] = [];
  if (!name) missing.push("名称");
  if (!prompt) missing.push("生成指令");
  if (!time) missing.push("开始时间");
  if (missing.length) {
    routineError.value = `还差：${missing.join("、")}`;
    return;
  }
  if (endTime && endTime <= time) {
    routineError.value = "结束时间需要晚于开始时间。";
    return;
  }
  routines.value.push({
    id: crypto.randomUUID(),
    name,
    prompt,
    time,
    endTime,
    enabled: true,
  });
  routineForm.value = { name: "", prompt: "", time, endTime: "" };
  routineError.value = "";
  saveRoutines(routines.value);
  await syncRoutineNotifications();
}
function toggleRoutine(routine: Routine) {
  routine.enabled = !routine.enabled;
  saveRoutines(routines.value);
  void syncRoutineNotifications();
}
function removeRoutine(routine: Routine) {
  routines.value = routines.value.filter((item) => item.id !== routine.id);
  saveRoutines(routines.value);
  void syncRoutineNotifications();
}
async function recordPdcaAi() {
  if (pdcaAiListening.value) {
    stopVoice();
    pdcaAiListening.value = false;
    return;
  }
  pdcaAiListening.value = true;
  try {
    const transcript = await transcribe();
    if (transcript)
      pdcaAiInput.value = pdcaAiInput.value
        ? `${pdcaAiInput.value} ${transcript}`
        : transcript;
  } catch (error) {
    pdcaHint.value =
      error instanceof Error ? error.message : "语音识别失败，请再试一次。";
  } finally {
    pdcaAiListening.value = false;
  }
}
async function runPdcaAi() {
  if (pdcaAiBusy.value) return;
  if (!aiConfig.value) {
    pdcaHint.value = "先在右上角配置模型 API Key，AI 才能执行循环。";
    return;
  }
  if (
    !pdcaAiInput.value.trim() &&
    !Object.values(pdcaForm.value).some(Boolean)
  ) {
    pdcaHint.value = "口述或输入今天的记录，循环才有素材。";
    return;
  }
  pdcaAiBusy.value = true;
  pdcaHint.value = "";
  try {
    const result = await postModelChat({
      model: aiConfig.value.model,
      messages: [
        {
          role: "system",
          content: `你是 PDCA 执行器，不是聊天伙伴：直接执行循环、输出结果，不要提问和解释。当前事项：「${pdcaEventTitle.value}」。当前循环——计划：${pdcaForm.value.plan || "空"}；执行：${pdcaForm.value.do || "空"}；检查：${pdcaForm.value.check || "空"}；调整：${pdcaForm.value.act || "空"}。${PDCA_AI_PROMPT} 用户的记录：${pdcaAiInput.value.trim() || "（无，仅整理现有内容）"}。只输出 JSON：{"plan":"…","do":"…","check":"…","act":"…"}，值用简体中文纯文本，已经完善的内容保持原样。`,
        },
      ],
      temperature: 0.5,
      max_tokens: 900,
      stream: false,
    });
    const parsed = extractJsonObject(
      result.choices?.[0]?.message?.content?.trim() || "",
    ) as Record<string, unknown> | null;
    if (!parsed) throw new Error("未能解析 AI 结果，请重试。");
    for (const stage of ["plan", "do", "check", "act"] as Step[]) {
      const value = parsed[stage];
      if (typeof value === "string" && value.trim())
        pdcaForm.value[stage] = value.trim();
    }
    pdcaAiInput.value = "";
    pdcaHint.value = "循环已执行，检查无误后保存。";
  } catch (error) {
    pdcaHint.value =
      error instanceof Error ? error.message : "AI 处理失败，请重试。";
  } finally {
    pdcaAiBusy.value = false;
  }
}
async function toggleDone(event: CalendarEvent) {
  event.done = !event.done;
  await saveEvents();
  if (event.done) {
    recordApplication(event);
    recordLoopCheckin(event);
  }
  if (event.done && !event.pdca.check && !event.pdca.act) {
    openPdca(event, "check");
    pdcaHint.value = "事项完成，趁记忆新鲜，Check 一下结果吧。";
  }
  if (
    event.done &&
    event.tags.some((tag) => tag.startsWith("目标·"))
  ) {
    // 目标任务：勾选即触发费曼验收
    chatText.value = `我完成了「${event.title}」，用费曼学习法验收我的成果`;
    chatOpen.value = true;
  }
}
function refreshToday() {
  const key = dateKey(new Date());
  if (key === today.value) return;
  // 跨天回到 App（如过夜后从最近任务打开）：默认回到今天的日视图
  today.value = key;
  selectedDate.value = key;
  view.value = "day";
}
watch(
  events,
  () => {
    void saveEvents();
  },
  { deep: true },
);
onMounted(() => {
  refreshToday();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshToday();
      void checkDueRoutines();
      runDailySettle(); // 跨天回到 App 时补结算昨日
    }
  });
  routines.value = loadRoutines();
  routineFired.value = loadFiredMap();
  loadLearningLog();
  loadTopics();
  window.setInterval(checkDueRoutines, 20000);
  void checkDueRoutines();
  try {
    const profile = localStorage.getItem(profileKey);
    if (profile) {
      name.value = profile;
      signedIn.value = true;
    }
  } catch {
    /* 可在登录页重新输入 */
  }
  void loadAiConfig();
  void bootstrapDingTalk();
  // 学习闭环复用 openDatabase 打开的同一条 SQLite 连接:
  // 同库开第二条 createConnection 会失败并静默退回 localStorage(真机 2026-11-04 实证)
  void openDatabase()
    .then(() => migrateToTopics())
    .then(() => initLoopStorage(db.value))
    .then((backendName) => {
      loopBackendName.value = backendName;
      runDailySettle();
      bumpLoop();
      void syncLoopNotifications();
    });
});
</script>

<template>
  <main v-if="!signedIn" class="login-screen">
    <div class="login-art">
      <span class="login-eyebrow">MAKE LEARNING COUNT</span>
      <div class="login-float">
        <div class="login-fc">
          <b>费曼学习法</b>
          <span class="m"
            ><span class="hot">讲 3</span><span>用 2</span
            ><span class="hot">能教</span></span
          >
        </div>
        <div class="login-fc f2">
          <b>英语词根</b>
          <span class="m"><span>讲 0</span><span>用 0</span><span>在学</span></span>
        </div>
      </div>
      <p>Learn it. Use it.<br />Own it.</p>
    </div>
    <section class="login-panel">
      <a class="brand"
        ><span class="brand-symbol"
          ><svg
            viewBox="0 0 16 16"
            width="16"
            height="16"
            aria-hidden="true"
          ><rect
            x="1.5"
            y="1.5"
            width="13"
            height="13"
            rx="3.2"
            fill="#FCFAF1"
          /><rect
            x="4.2"
            y="4.4"
            width="4.6"
            height="1.7"
            rx="0.85"
            fill="#E28B71"
          /><rect
            x="4.2"
            y="7.1"
            width="5.6"
            height="1.7"
            rx="0.85"
            fill="#46563C"
          /><rect
            x="4.2"
            y="9.8"
            width="3.4"
            height="1.7"
            rx="0.85"
            fill="#46563C"
          /></svg></span>拾序<span
          class="brand-dot"
          >.</span
        ></a
      >
      <div class="login-copy">
        <span class="eyebrow">MAKE LEARNING COUNT</span>
        <h1>把想学的，<br />变成学会的。</h1>
        <p>为每个想学的东西建一个主题——讲过、用过，才算学会。</p>
      </div>
      <form class="login-form" @submit.prevent="login">
        <label for="profile-name">怎么称呼你？</label
        ><input
          id="profile-name"
          v-model="name"
          maxlength="30"
          placeholder="输入你的名字"
          autocomplete="given-name"
          required
        /><button type="submit">开始我的学习 <ArrowRight :size="17" /></button>
      </form>
      <small class="login-privacy">本机登录，数据只存在你的手机上。</small>
    </section>
  </main>

  <div v-else class="app-shell">
    <header class="topbar">
      <a class="brand"
        ><span class="brand-symbol"
          ><svg
            viewBox="0 0 16 16"
            width="16"
            height="16"
            aria-hidden="true"
          ><rect
            x="1.5"
            y="1.5"
            width="13"
            height="13"
            rx="3.2"
            fill="#FCFAF1"
          /><rect
            x="4.2"
            y="4.4"
            width="4.6"
            height="1.7"
            rx="0.85"
            fill="#E28B71"
          /><rect
            x="4.2"
            y="7.1"
            width="5.6"
            height="1.7"
            rx="0.85"
            fill="#46563C"
          /><rect
            x="4.2"
            y="9.8"
            width="3.4"
            height="1.7"
            rx="0.85"
            fill="#46563C"
          /></svg></span>拾序<span
          class="brand-dot"
          >.</span
        ></a
      >
      <div class="topbar-right">
        <span class="db-indicator"></span
        ><span class="db-label">{{ database }}</span
        ><span class="profile-chip">{{ name.slice(0, 1) }}</span
        ><button
          class="top-icon"
          title="退出登录"
          aria-label="退出登录"
          @click="logout"
        >
          <LogOut :size="16" />
        </button>
      </div>
    </header>
    <div class="app-layout">
      <aside class="sidebar">
        <span class="sidebar-label">个人空间</span
        ><button class="side-link active">
          <CalendarDays :size="17" />日历</button
        ><button
          class="side-link"
          @click="
            view = 'day';
            goDay(today);
          "
        >
          <ListChecks :size="17" />今日事项
        </button>
        <div class="sidebar-categories">
          <span class="sidebar-label">事项分类</span>
          <div
            v-for="category in categories"
            :key="category"
            class="category-link"
          >
            <i class="category-dot" :class="category"></i
            >{{ categoryNames[category]
            }}<small>{{
              events.filter((item) => item.category === category).length
            }}</small>
          </div>
        </div>
        <div class="sidebar-lower">
          <span class="sidebar-label">私人助理</span
          ><a href="#pi"
            ><span class="pi-mini"><Sparkles :size="15" /></span>和 Pi
            聊聊<ArrowRight :size="14"
          /></a>
          <p>每天进步一点点，<br />就是很好的节奏。</p>
        </div>
      </aside>
      <section
        class="calendar-main"
        @touchstart.passive="onMainTouchStart"
        @touchend.passive="onMainTouchEnd"
      >
        <div class="calendar-heading">
          <div>
            <span class="eyebrow">{{
              view === "learn"
                ? "YOUR LEARNING"
                : view === "year"
                  ? "YOUR YEAR"
                  : view === "month"
                    ? "YOUR MONTH"
                    : view === "week"
                      ? "YOUR WEEK"
                      : "YOUR DAY"
            }}</span>
            <h1>
              <template v-if="view === 'day'">
                <span v-if="selectedDate === today" class="today-flag"
                  >今天</span
                >
                <button v-else class="back-today" @click="goDay(today)">
                  回到今天</button
                >
              </template>
              {{ title }}
            </h1>
            <p v-if="view === 'day'" class="lunar-line">
              农历{{ selectedDayMeta.lunarText
              }}<template v-if="selectedDayMeta.special">
                · {{ selectedDayMeta.special }}</template
              ><template v-if="selectedDayMeta.rest"> · 休</template>
              <template v-else-if="selectedDayMeta.work"> · 班</template>
            </p>
            <p v-else-if="view === 'learn'">主题为本，日历是它的时间投影。</p>
            <p v-else>工作、兴趣、计划，所有事项都有归属。</p>
          </div>
          <div class="heading-actions">
            <button
              v-if="view !== 'learn'"
              class="nav-learn"
              @click="view = 'learn'"
            >
              <Sparkles :size="14" />学习
            </button>
            <button
              v-else
              class="nav-learn"
              @click="
                view = 'day';
                goDay(today);
              "
            >
              <CalendarDays :size="14" />今天
            </button>
            <button
              v-show="view === 'day'"
              class="month-jump"
              @click="view = 'week'"
            >
              <CalendarDays :size="14" />周历
            </button>
            <div
              v-if="view !== 'day'"
              class="view-switch sub-switch"
            >
              <button
                :class="{ chosen: view === 'week' }"
                @click="view = 'week'"
              >
                周</button
              ><button
                :class="{ chosen: view === 'month' }"
                @click="view = 'month'"
              >
                月</button
              ><button
                :class="{ chosen: view === 'year' }"
                @click="view = 'year'"
              >
                年
              </button>
            </div>
            <div class="view-switch">
              <button
                :class="{ chosen: view === 'day' }"
                @click="view = 'day'"
              >
                日</button
              ><button
                :class="{ chosen: view === 'week' }"
                @click="view = 'week'"
              >
                周</button
              ><button
                :class="{ chosen: view === 'month' }"
                @click="view = 'month'"
              >
                月</button
              ><button
                :class="{ chosen: view === 'year' }"
                @click="view = 'year'"
              >
                年
              </button>
            </div>
          </div>
        </div>
        <div id="pi" class="omnibar">
          <span class="omnibar-mark"><Sparkles :size="15" /></span>
          <input
            v-model="chatText"
            maxlength="2000"
            enterkeyhint="send"
            :placeholder="
              chatListening
                ? '正在听 ' + voiceClock + ' · 再按一次结束（最长 3 分钟）'
                : aiConfig
                  ? '告诉 Pi：新事项、记录、提问…'
                  : '配置模型后，告诉 Pi 你想安排什么'
            "
            aria-label="告诉 Pi"
            @focus="chatOpen = true"
            @keydown.enter.prevent="askPi()"
          /><button
            type="button"
            class="chat-voice"
            :class="{ recording: chatListening }"
            :aria-label="chatListening ? '停止语音' : '语音输入'"
            @click="toggleChatVoice()"
          >
            <Mic :size="16" /></button
          ><button
            type="button"
            class="omnibar-go"
            aria-label="发送"
            :disabled="!chatText.trim() || chatBusy"
            @click="askPi()"
          >
            <Send :size="15" />
          </button>
        </div>
        <section v-if="chatOpen" class="chat-card">
          <header class="chat-card-head">
            <span class="pi-avatar"><Sparkles :size="14" /></span>
            <strong>Pi · 私人助理</strong>
            <button class="model-label" @click.stop="openAiSettings">
              <Settings :size="12" />{{
                aiConfig ? providerInfo(aiConfig.provider).label : "未配置"
              }}
            </button>
            <button
              class="chat-collapse"
              aria-label="收起对话"
              @click="chatOpen = false"
            >
              <X :size="14" />
            </button>
          </header>
          <div v-if="messages.length" ref="chatHistoryEl" class="chat-history">
            <div
              v-for="(message, index) in messages"
              :key="index"
              class="chat-message"
              :class="message.role"
            >
              <span v-if="message.role === 'assistant'" class="chat-mark"
                ><Sparkles :size="13"
              /></span>
              <div class="chat-body">
                <p>{{ message.content }}</p>
                <button
                  v-if="message.role === 'assistant' && message.content"
                  type="button"
                  class="chat-speak"
                  :class="{ on: speakingMsgIndex === index }"
                  :aria-label="speakingMsgIndex === index ? '停止播报' : '播报这条回复'"
                  @click="toggleSpeak(message, index)"
                >
                  <VolumeX v-if="speakingMsgIndex === index" :size="12" /><Volume2
                    v-else
                    :size="12"
                  />
                </button>
                <div
                  v-if="message.suggestions?.length"
                  class="chat-save-list"
                >
                  <button
                    v-for="(suggestion, suggestionIndex) in message.suggestions"
                    :key="suggestionIndex"
                    type="button"
                    class="chat-save"
                    :class="{ saved: message.saved?.[suggestionIndex] }"
                    :disabled="message.saved?.[suggestionIndex]"
                    @click="saveSuggestion(message, suggestionIndex)"
                  >
                    <Check
                      v-if="message.saved?.[suggestionIndex]"
                      :size="11" /><Plus v-else :size="11" />{{
                      message.saved?.[suggestionIndex]
                        ? "已加入日历"
                        : suggestion.date === selectedDate
                          ? `${suggestion.title} ${suggestion.time}`
                          : `${suggestion.title} ${suggestion.date.slice(5)} ${suggestion.time}`
                    }}
                  </button>
                </div>
                <div
                  v-if="message.challengeDraft"
                  class="chat-save-list"
                >
                  <div class="chat-challenge">
                    <p class="chat-challenge-title">
                      <Trophy :size="12" />百日挑战「{{
                        message.challengeDraft.topicTitle
                      }}」· {{ message.challengeDraft.days }} 天
                    </p>
                    <p class="chat-challenge-note">
                      每日门槛：{{
                        challengeThresholdNames[message.challengeDraft.threshold]
                      }}
                    </p>
                    <p
                      v-if="message.challengeDraft.goalNote"
                      class="chat-challenge-note"
                    >
                      目标笔记：{{ message.challengeDraft.goalNote }}
                    </p>
                    <button
                      type="button"
                      class="chat-save"
                      :class="{ saved: message.challengeSaved }"
                      :disabled="message.challengeSaved"
                      @click="confirmChallengeDraft(message)"
                    >
                      <Check
                        v-if="message.challengeSaved"
                        :size="11" /><Trophy v-else :size="11" />{{
                        message.challengeSaved
                          ? "挑战已开始"
                          : `确认开始 ${message.challengeDraft.days} 天挑战`
                      }}
                    </button>
                  </div>
                </div>
                <div
                  v-if="message.teachbackDraft"
                  class="chat-save-list"
                >
                  <div class="chat-teachback">
                    <p class="chat-teachback-title">
                      <Mic :size="12" />教回评估{{
                        message.teachbackDraft.applied ? "(已应用)" : "(未应用,点应用才写入)"
                      }}
                    </p>
                    <p
                      v-if="message.teachbackDraft.summary"
                      class="chat-challenge-note"
                    >
                      {{ message.teachbackDraft.summary }}
                    </p>
                    <div
                      v-for="(item, itemIndex) in message.teachbackDraft.items"
                      :key="item.pointId"
                      class="chat-teachback-item"
                    >
                      <span
                        class="chat-teachback-status"
                        :class="item.covered ? 'ok' : 'miss'"
                        >{{ item.covered ? "讲清" : "遗漏" }}</span
                      >
                      <span class="chat-teachback-text">
                        <b>{{ item.pointName }}</b>
                        <i v-if="item.quote">「{{ item.quote }}」</i>
                        <em v-if="item.marked">已记一次没讲清</em>
                      </span>
                      <button
                        v-if="
                          message.teachbackDraft?.applied &&
                          !item.covered &&
                          !item.marked
                        "
                        type="button"
                        class="chat-save"
                        @click="markTeachbackMiss(message, itemIndex)"
                      >
                        记一次没讲清
                      </button>
                      <div
                        v-if="message.teachbackDraft?.applied && !item.covered"
                        class="chat-teachback-actions"
                      >
                        <button
                          v-if="!item.actions?.card"
                          type="button"
                          class="chat-save"
                          @click="addGapCard(message, itemIndex)"
                        >
                          加一张卡
                        </button>
                        <button
                          v-if="!item.actions?.task"
                          type="button"
                          class="chat-save"
                          @click="
                            pushGapSuggestion(message, itemIndex, 'task')
                          "
                        >
                          安排 15 分钟任务
                        </button>
                        <button
                          v-if="!item.actions?.reteach"
                          type="button"
                          class="chat-save"
                          @click="
                            pushGapSuggestion(message, itemIndex, 'reteach')
                          "
                        >
                          三天后再讲
                        </button>
                      </div>
                    </div>
                    <p
                      v-if="message.teachbackDraft.unknown.length"
                      class="chat-challenge-note"
                    >
                      无法对应知识点:{{ message.teachbackDraft.unknown.join("、") }}
                    </p>
                    <button
                      v-if="!message.teachbackDraft.applied"
                      type="button"
                      class="chat-save"
                      @click="applyTeachbackDraft(message)"
                    >
                      <Check :size="11" />应用本次教回
                    </button>
                  </div>
                </div>
                <div
                  v-if="message.resumeTopicId && !message.resumed"
                  class="chat-save-list"
                >
                  <button
                    type="button"
                    class="chat-save"
                    @click="resumeFromMessage(message)"
                  >
                    <Trophy :size="11" />继续挑战
                  </button>
                </div>
              </div>
            </div>
            <div v-if="chatBusy" class="chat-message assistant">
              <span class="chat-mark"><Sparkles :size="13" /></span>
              <p>正在想一想…</p>
            </div>
          </div>
          <div v-else class="chat-suggestions">
            <button @click="askPi('根据我今天的事项，帮我排一下优先级。')">
              帮我安排今天 <ArrowRight :size="13" /></button
            ><button @click="askPi('用费曼学习法检验我今天学到的东西。')">
              费曼检验今天所学 <ArrowRight :size="13" /></button
            ><button @click="askPi('结合我的 PDCA 记录，帮我回顾一下。')">
              回顾 PDCA <ArrowRight :size="13" /></button
            ><button @click="askPi('我是不是把计划排得太满了？')">
              计划是不是太满？ <ArrowRight :size="13" /></button
            ><button @click="askPi('看看我的学习主题，帮我从证据最少的一个开始推动。')">
              推动学习主题 <ArrowRight :size="13" />
            </button>
          </div>
          </section>
        <section v-if="view === 'learn'" class="learn-wrap">
          <div class="learn-head">
            <span><strong>学习主题</strong><small>说一句就建,讲过、用过才算学会</small></span>
            <button class="learn-add" @click="focusQuickTopic()">
              <Mic :size="15" />说一个
            </button>
          </div>
          <div class="quick-topic">
            <input
              ref="quickTopicInput"
              v-model="quickTopicText"
              maxlength="60"
              placeholder="想学什么?一句话,或按麦说话"
              @keydown.enter.prevent="submitQuickTopic()"
            /><button
              type="button"
              class="qt-voice"
              :class="{ recording: quickTopicListening }"
              :aria-label="quickTopicListening ? '停止语音' : '语音说想学什么'"
              @click="recordQuickTopicVoice()"
            >
              <Mic :size="16" /></button
            ><button
              type="button"
              class="qt-go"
              aria-label="交给 Pi 建主题"
              :disabled="!quickTopicText.trim()"
              @click="submitQuickTopic()"
            >
              <Sparkles :size="15" />
            </button>
          </div>
          <div class="loop-bar">
            <button class="loop-review-go" @click="openReview()">
              <Brain :size="15" />今日复习<b>{{ dueCount() }}</b>张
            </button>
            <button
              v-for="item in nowItems"
              :key="item.topic.id"
              type="button"
              class="now-chip"
              :class="[
                item.action.source,
                { running: nowRunning?.topicId === item.topic.id },
              ]"
              :disabled="!!nowRunning && nowRunning.topicId !== item.topic.id"
              :aria-label="`现在就做:${item.topic.title}`"
              @click="startNow(item)"
            >
              <Clock3 v-if="nowRunning?.topicId === item.topic.id" :size="11" /><Sparkles v-else :size="11" />
              <b>{{ item.topic.title }}</b>
              <span v-if="nowRunning?.topicId === item.topic.id"
                >进行中 {{ nowElapsedLabel }}</span
              >
              <span v-else>{{ nowActionLabel(item.action) }}</span>
            </button>
            <small>边缘优先 · 上限 {{ DAILY_QUEUE_LIMIT }} 张{{ loopBackendName ? "" : " · 存储初始化中" }}</small>
          </div>
          <div v-if="topics.length" class="topic-list">
            <article
              v-for="topic in [...topics].reverse()"
              :key="topic.id"
              class="topic-card"
              :class="topic.status"
            >
              <div class="topic-top">
                <strong>{{ topic.title }}</strong>
                <span class="topic-status">{{ topicStatusNames[topic.status] }}</span>
                <button
                  class="topic-edit"
                  aria-label="编辑主题"
                  @click="openTopicDialog(topic)"
                >
                  <Settings :size="13" />
                </button>
              </div>
              <p v-if="topic.why || topic.useCase" class="topic-why">
                {{ topic.why }}<template v-if="topic.useCase"> · 用在：{{ topic.useCase }}</template>
              </p>
              <div class="topic-evidence">
                <span><b>{{ topicExplainCount(topic) }}</b> 讲过<template v-if="topicLastExplain(topic)"> · 最近{{ levelLabels[topicLastExplain(topic)!.level || "shaky"] }}</template></span>
                <span><b>{{ topicApplyCount(topic) }}</b> 用过</span>
                <span v-if="topicTaskStats(topic)"><b>{{ topicTaskStats(topic)!.done }}</b>/{{ topicTaskStats(topic)!.total }} 任务</span>
              </div>
              <div class="topic-loop">
                <template v-if="challengeOf(topic.id)">
                  <span
                    class="loop-chip"
                    :class="challengeOf(topic.id)!.status === 'paused' ? 'paused' : 'on'"
                  >
                    <Trophy :size="12" />{{ progressOf(topic.id)?.dayNumber ?? 0 }}/{{ progressOf(topic.id)?.totalDays ?? 0 }}
                    · 连续 {{ streakOf(topic.id) }} 天
                    <template v-if="challengeOf(topic.id)!.status === 'paused'"> · 已暂停</template>
                  </span>
                  <button
                    v-if="challengeOf(topic.id)!.status === 'paused'"
                    class="loop-act"
                    @click="resumeTopicChallenge(topic.id)"
                  >
                    继续
                  </button>
                  <button v-else class="loop-act" @click="abandonTopicChallenge(topic.id)">放弃</button>
                </template>
                <button v-else class="loop-chip none" @click="openChallengeDialog(topic)">
                  <Trophy :size="12" />发起百日挑战
                </button>
                <button class="loop-chip map" @click="openMap(topic)">
                  <MapIcon :size="12" />掌握 {{ masteryPercentOf(topic.id) }}%
                  <i
                    v-if="topicDraftCount(topic.id)"
                    class="loop-badge"
                    aria-label="有 Pi 起草的卡片待确认"
                    >{{ topicDraftCount(topic.id) }}</i
                  >
                </button>
              </div>
              <div v-if="topic.nextStep" class="topic-next">
                <ArrowRight :size="13" />{{ topic.nextStep }}
              </div>
              <div class="topic-actions">
                <button @click="askPi(`推动我的学习主题「${topic.title}」：先看证据链，再帮我定下一步并安排到日历。`)">
                  <Sparkles :size="13" />让 Pi 推动</button
                ><button
                  @click="askPi(`用费曼学习法检验我对「${topic.title}」的掌握。`)"
                >
                  <Mic :size="13" />讲一次</button
                ><button @click="startTeachback(topic)">
                  <Mic :size="13" />教回</button
                ><button
                  v-if="topic.status !== 'paused'"
                  aria-label="搁置主题"
                  @click="pauseTopic(topic)"
                >
                  搁置</button
                ><button
                  v-else
                  @click="topic.status = 'learning'; saveTopics();"
                >
                  恢复</button>
              </div>
            </article>
          </div>
          <div v-else class="learn-empty">
            <Sparkles :size="26" />
            <strong>还没有学习主题</strong>
            <span>在上面说一句"我想学 XX",Pi 替你建好并给出第一个动手任务。</span>
            <button class="learn-add big" @click="focusQuickTopic()">
              <Mic :size="15" />说一个想学的
            </button>
          </div>
        </section>
        <section v-else class="calendar-panel">
          <div
            v-if="habitSignals.length"
            class="habit-alert"
            role="status"
            @click="askHabitSignals()"
          >
            <span class="habit-alert-mark">⚠</span>
            <span class="habit-alert-text"
              >{{ habitSignals[0].message
              }}{{
                habitSignals.length > 1
                  ? ` 等 ${habitSignals.length} 个信号`
                  : ""
              }}</span
            ><span class="habit-alert-act">让 Pi 看看 ›</span>
          </div>
          <div class="calendar-toolbar">
            <div class="period-nav">
              <button aria-label="上一个" @click="changePeriod(-1)">
                <ChevronLeft :size="17" /></button
              ><button aria-label="下一个" @click="changePeriod(1)">
                <ChevronRight :size="17" /></button
              ><strong>{{
                view === "year"
                  ? year
                  : view === "month"
                    ? `${year}年${month + 1}月`
                    : view === "week"
                      ? weekTitle
                      : selectedDate
              }}</strong
              ><button class="today-button" @click="goDay(today)">今天</button>
            </div>
            <div class="legend">
              <span><i class="category-dot work"></i>工作</span
              ><span><i class="category-dot interest"></i>兴趣</span
              ><span><i class="category-dot plan"></i>计划</span>
            </div>
          </div>
          <div v-if="view === 'year'" class="year-grid">
            <button
              v-for="monthIndex in 12"
              :key="monthIndex"
              class="mini-month"
              @click="
                month = monthIndex - 1;
                view = 'month';
              "
            >
              <strong
                >{{ monthNames[monthIndex - 1]
                }}<small
                  v-if="
                    monthIndex === Number(today.slice(5, 7)) &&
                    year === Number(today.slice(0, 4))
                  "
                  >本月</small
                ></strong
              >
              <span class="yr-bars">
                <i
                  v-for="category in categories"
                  :key="category"
                  :class="
                    events.some(
                      (item) =>
                        Number(item.date.slice(5, 7)) === monthIndex &&
                        Number(item.date.slice(0, 4)) === year &&
                        item.category === category,
                    )
                      ? category
                      : ''
                  "
                ></i>
              </span>
              <span class="yr-count"
                ><b>{{
                  events.filter(
                    (item) =>
                      Number(item.date.slice(5, 7)) === monthIndex &&
                      Number(item.date.slice(0, 4)) === year,
                  ).length
                }}</b>
                项</span
              >
            </button>
          </div>
          <div v-if="topics.length" class="yr-summary">
            <div class="yr-summary-head">
              <strong>年度学习</strong>
              <small
                >主题 {{ topics.length }} 个 · 讲过
                {{
                  topics.reduce(
                    (sum, topic) =>
                      sum + topic.evidence.filter((item) => item.kind === "explain").length,
                    0,
                  )
                }}
                次 · 用过
                {{
                  topics.reduce(
                    (sum, topic) =>
                      sum + topic.evidence.filter((item) => item.kind === "apply").length,
                    0,
                  )
                }}
                次</small
              >
            </div>
            <div class="yr-summary-chips">
              <span
                v-for="topic in topics.slice(-4).reverse()"
                :key="topic.id"
                class="t-status"
                :class="topic.status"
                >{{ topic.title }} · {{ topicStatusNames[topic.status] }}</span
              >
            </div>
          </div>
          <template v-else-if="view === 'month'"
            ><div class="week-row">
              <span v-for="weekday in weekNames" :key="weekday"
                >周{{ weekday }}</span
              >
            </div>
            <div class="month-grid">
              <button
                v-for="day in days"
                :key="day.key"
                class="month-day"
                :class="{
                  outside: !day.inMonth,
                  today: day.key === today,
                  selected: day.key === selectedDate,
                }"
                @click="goDay(day.key)"
              >
                <span class="day-flag-slot"
                  ><i v-if="day.meta.rest" class="day-flag rest">休</i
                  ><i v-else-if="day.meta.work" class="day-flag work">班</i
                ></span>
                <span class="day-number">{{ day.day }}</span>
                <span
                  class="lunar-tag"
                  :class="{
                    festival: day.meta.kind === 'festival',
                    term: day.meta.kind === 'term',
                  }"
                  >{{ day.meta.label }}</span
                >
                <span class="cal-dots">
                  <i
                    v-for="event in day.events.slice(0, 3)"
                    :key="event.id"
                    :class="event.category"
                  ></i>
                </span>
              </button>
            </div></template
          >
          <div v-else-if="view === 'week'" class="week-view">
            <button
              v-for="day in weekDays"
              :key="day.key"
              class="week-day"
              :class="{ today: day.key === today, selected: day.key === selectedDate }"
              @click="goDay(day.key)"
            >
              <span class="week-date">
                <strong>{{ day.key.slice(5).replace("-", "/") }}</strong>
                <small>{{
                  weekNames[(day.date.getDay() + 6) % 7]
                }}</small>
                <span v-if="day.key === today" class="wk-today">今天</span>
                <small
                  class="lunar-tag"
                  :class="{
                    festival: day.meta.kind === 'festival',
                    term: day.meta.kind === 'term',
                  }"
                  >{{ day.meta.label }}</small
                >
              </span>
              <span class="week-events">
                <span
                  v-for="event in day.events.slice(0, 2)"
                  :key="event.id"
                  class="calendar-event"
                  :class="event.category"
                  ><i></i>{{ event.time }} {{ event.title }}</span
                >
                <span v-if="day.events.length > 2" class="more-items"
                  >+{{ day.events.length - 2 }} 项</span
                >
                <small v-if="!day.events.length" class="week-empty"
                  >暂无安排</small
                >
              </span>
              <b v-if="day.events.length" class="week-count">{{
                day.events.length
              }}</b>
            </button>
          </div>
          <div v-else class="day-agenda">
            <div class="priority-panel">
              <div class="priority-title">
                <span><strong>轻重缓急</strong><small>按重要性与紧急性划分</small></span>
                <span class="priority-actions"
                  ><span
                    class="loop-status"
                    :class="{ closed: loopStatus.reviewed > 0 }"
                  >
                    <span>连续 {{ loopStatus.streak }} 天</span>
                    <span>计划 {{ loopStatus.planned }}</span>
                    <span>完成 {{ loopStatus.done }}</span>
                    <span :class="{ warn: loopStatus.done > 0 && loopStatus.reviewed === 0 }"
                      >复盘 {{ loopStatus.reviewed }}</span
                    >
                    <span
                      v-if="loopStatus.feynman > 0"
                      :class="{ warn: loopStatus.done > 0 && loopStatus.feynman === 0 }"
                      >费曼 {{ loopStatus.feynman }}</span
                    >
                  </span>
                  <span
                    v-if="goalProgress"
                    class="streak-chip goal"
                    >{{ goalProgress[0].replace("目标·", "") }}
                    {{ goalProgress[1].done }}/{{ goalProgress[1].total }}</span
                  ><button v-if="activeQuadrant" @click="activeQuadrant = ''">显示全部</button></span
                >
              </div>
              <div class="priority-grid">
                <button
                  v-for="quadrant in quadrants"
                  :key="quadrant.id"
                  class="priority-cell"
                  :class="[quadrant.id, { selected: activeQuadrant === quadrant.id }]"
                  @click="activeQuadrant = activeQuadrant === quadrant.id ? '' : quadrant.id"
                >
                  <b>{{ quadrant.events.length }}</b>
                  <span><strong>{{ quadrant.title }}</strong></span>
                </button>
              </div>
            </div>
            <template v-for="(event, eventIndex) in prioritizedEvents" :key="event.id">
            <div v-if="event.id === morningEvents[0]?.id" class="period-divider"><span>上午</span><small>{{ morningEvents.length }} 件事项 · 12:00 前</small></div>
            <div v-if="event.id === afternoonEvents[0]?.id" class="period-divider afternoon"><span>下午与晚上</span><small>{{ afternoonEvents.length }} 件事项 · 12:00 后</small></div>
            <article
              class="task-card"
              :class="{
                done: event.done,
                current: event.id === currentTaskId,
                qi: event.important && event.urgent,
                in_: event.important && !event.urgent,
                ui: !event.important && event.urgent,
                nn: !event.important && !event.urgent,
              }"
            >
              <div class="task-card-top">
                <button
                  class="done-toggle"
                  :class="{ checked: event.done }"
                  :aria-label="event.done ? '标记未完成' : '标记完成'"
                  @click="toggleDone(event)"
                >
                  <Check v-if="event.done" :size="14" /></button
                ><span class="event-time"
                  ><Clock3 :size="13" />{{ event.time }}</span
                ><span
                  v-if="event.id === currentTaskId"
                  class="now-chip"
                  >进行中</span
                ><span class="event-labels"
                  ><b class="category-pill" :class="event.category">{{
                    categoryNames[event.category]
                  }}</b></span
                >
              </div>
              <span class="event-name">
                <strong>{{ event.title }}</strong>
              </span>
              <div class="task-card-meta">
                <span class="q-dot"
                  ><i></i>{{
                    event.important && event.urgent
                      ? "重要且紧急"
                      : event.important
                        ? "重要不紧急"
                        : event.urgent
                          ? "紧急不重要"
                          : "不紧急不紧急"
                  }}</span
                ><span v-for="tag in event.tags" :key="tag" class="tag-pill"
                  >#{{ tag }}</span
                ><small v-if="event.source === 'dingtalk'">钉钉</small>
                <button class="pdca-count" @click="openPdca(event)">
                  <span class="pdca-bars"
                    ><i
                      v-for="stepNumber in 4"
                      :key="stepNumber"
                      :class="{
                        f:
                          stepNumber <=
                          Object.values(event.pdca).filter(Boolean).length,
                      }"
                  ></i></span>
                  PDCA {{ Object.values(event.pdca).filter(Boolean).length }}/4
                  <ArrowRight :size="13" /></button
                ><button
                  class="delete-button"
                  title="删除"
                  aria-label="删除事项"
                  @click="removeEvent(event)"
                >
                  <Trash2 :size="15" />
                </button>
              </div>
            </article>
            </template>
            <div v-if="!prioritizedEvents.length" class="empty-day">
              <CalendarDays :size="25" /><strong>这一天还没有安排</strong
              ><span>留白也可以是计划的一部分。</span>
              <button v-if="activeQuadrant" @click="activeQuadrant = ''">清除象限筛选</button>
            </div>
            <button class="inline-add" @click="focusOmnibar()">
              <Mic :size="15" />对 Pi 说，添加到今天
            </button>
          </div>
        </section>

        <footer class="app-footer">
          <span
            :style="dbNotice ? 'color:#c46a4a;font-weight:600' : ''"
            ><i class="db-indicator"></i>{{ dbNotice || database }}</span
          ><button @click="openDingTalkSettings()">
            <CalendarDays :size="14" />钉钉同步
          </button>
          <button @click="openRoutines()">
            <Clock3 :size="14" />定时服务
          </button>
          <span class="app-version">v{{ appVersion }} · {{ buildStamp }}</span>
        </footer>
      </section>
    </div>

    <Transition name="fade"
      ><div
        v-if="dialog === 'settings'"
        class="modal-backdrop"
        @click.self="dialog = ''"
      >
        <section
          class="event-dialog ding-dialog"
          role="dialog"
          aria-modal="true"
        >
          <button
            class="close-button dialog-close"
            aria-label="关闭"
            @click="dialog = ''"
          >
            <X :size="18" /></button
          ><span class="eyebrow">MODEL SETTINGS</span>
          <h2>模型 API Key</h2>
          <p>
            Pi 由 DeepSeek 或智谱 GLM
            提供回答，密钥只通过 HTTPS 发送给对应模型服务。真机上保存在
            Android 安全存储；浏览器预览仅保留在当前页面，关闭即失效。
          </p>
          <fieldset class="category-field">
            <legend>模型服务</legend>
            <div class="category-options">
              <button
                v-for="provider in aiProviderList"
                :key="provider.id"
                type="button"
                :class="{ chosen: aiForm.provider === provider.id }"
                @click="chooseProvider(provider.id)"
              >
                {{ provider.label
                }}<Check
                  v-if="aiForm.provider === provider.id"
                  :size="14" /></button
              >
            </div>
          </fieldset>
          <label class="field-label"
            >API Key <small>{{ providerInfo(aiForm.provider).note }}</small>
            <input
              v-model="aiForm.apiKey"
              type="password"
              autocomplete="off"
              required
              placeholder="粘贴密钥，不会显示明文"
          /></label>
          <label class="field-label"
            >模型名称
            <input
              v-model="aiForm.model"
              :placeholder="providerInfo(aiForm.provider).defaultModel"
          /></label>
          <small v-if="aiError" class="voice-error">{{ aiError }}</small>
          <div class="dialog-actions">
            <button
              v-if="aiConfig"
              type="button"
              class="cancel-button"
              @click="clearAiSettings"
            >
              清除密钥</button
            ><button
              type="button"
              class="primary-button"
              :disabled="!aiForm.apiKey.trim()"
              @click="saveAiSettings"
            >
              保存密钥
            </button>
          </div>
        </section>
      </div></Transition
    >
    <Transition name="fade"
      ><div
        v-if="dialog === 'topic'"
        class="modal-backdrop"
        @click.self="dialog = ''"
      >
        <section
          class="event-dialog ding-dialog"
          role="dialog"
          aria-modal="true"
        >
          <button
            class="close-button dialog-close"
            aria-label="关闭"
            @click="dialog = ''"
          >
            <X :size="18" /></button
          ><span class="eyebrow">LEARNING TOPIC</span>
          <h2>{{ topicForm.id ? "编辑主题" : "新学习主题" }}</h2>
          <label class="field-label"
            >在学什么
            <input
              v-model="topicForm.title"
              maxlength="40"
              placeholder="如：费曼学习法"
          /></label>
          <label class="field-label"
            >为什么学 <small>一句话，学之前先想清楚</small>
            <input
              v-model="topicForm.why"
              maxlength="120"
              placeholder="如：想检验自己是不是真的学会了"
          /></label>
          <label class="field-label"
            >打算在哪用 <small>没有用例就先别学</small>
            <input
              v-model="topicForm.useCase"
              maxlength="120"
              placeholder="如：每次学完新东西都用它自测一次"
          /></label>
          <fieldset class="category-field">
            <legend>状态</legend>
            <div class="category-options">
              <button
                v-for="(label, key) in topicStatusNames"
                :key="key"
                type="button"
                :class="{ chosen: topicForm.status === key }"
                @click="topicForm.status = key"
              >
                {{ label
                }}<Check v-if="topicForm.status === key" :size="14" />
              </button>
            </div>
          </fieldset>
          <label class="field-label"
            >下一步
            <input
              v-model="topicForm.nextStep"
              maxlength="80"
              placeholder="如：本周拆 3 个任务到日历"
          /></label>
          <div class="dialog-actions">
            <button
              v-if="topicForm.id"
              type="button"
              class="cancel-button"
              @click="deleteTopicDialog"
            >
              删除</button
            ><button
              type="button"
              class="cancel-button"
              @click="dialog = ''"
            >
              取消</button
            ><button
              type="button"
              class="primary-button"
              :disabled="!topicForm.title.trim()"
              @click="saveTopicDialog"
            >
              保存
            </button>
          </div>
        </section>
      </div></Transition
    >
    <Transition name="fade"
      ><div
        v-if="dialog === 'dingtalk'"
        class="modal-backdrop"
        @click.self="dialog = ''"
      >
        <section
          class="event-dialog ding-dialog"
          role="dialog"
          aria-modal="true"
        >
          <button
            class="close-button dialog-close"
            aria-label="关闭"
            @click="dialog = ''"
          >
            <X :size="18" /></button
          ><span class="eyebrow">DINGTALK SYNC</span>
          <h2>钉钉日历同步</h2>
          <p>
            用钉钉开放平台企业内部应用的凭证直连拉取日程（只读，不会改动钉钉里的日程）。同步今天起
            7 天内的工作日程，按日程 ID 去重合并；密钥只保存在 Android
            安全存储，不写入日历数据。
          </p>
          <label class="field-label"
            >Client ID
            <input
              v-model="dingForm.clientId"
              autocomplete="off"
              placeholder="开放平台应用的 Client ID"
          /></label>
          <label class="field-label"
            >Client Secret
            <input
              v-model="dingForm.clientSecret"
              type="password"
              autocomplete="off"
              placeholder="粘贴密钥，不会显示明文"
          /></label>
          <label class="field-label"
            >手机号 <small>用于定位你自己的钉钉账号</small>
            <input
              v-model="dingForm.mobile"
              type="tel"
              autocomplete="tel"
              placeholder="注册钉钉的手机号"
          /></label>
          <small v-if="dingError" class="voice-error">{{ dingError }}</small>
          <small v-else-if="dingLastSyncAt" class="routine-empty"
            >上次同步：{{ dingLastSyncAt }}</small
          >
          <div class="dialog-actions">
            <button
              v-if="dingConfig"
              type="button"
              class="cancel-button"
              @click="clearDingTalkSettings"
            >
              清除配置</button
            ><button
              type="button"
              class="cancel-button"
              :disabled="dingSyncing || !dingConfig"
              @click="runDingTalkSync()"
            >
              {{ dingSyncing ? "同步中…" : "立即同步" }}</button
            ><button
              type="button"
              class="primary-button"
              :disabled="
                dingSyncing ||
                !dingForm.clientId.trim() ||
                !dingForm.clientSecret.trim() ||
                !dingForm.mobile.trim()
              "
              @click="saveDingTalkSettings"
            >
              保存并同步
            </button>
          </div>
        </section>
      </div></Transition
    >
    <Transition name="fade"
      ><div
        v-if="dialog === 'pdca'"
        class="modal-backdrop"
        @click.self="closePdca()"
      >
        <section
          class="event-dialog pdca-dialog"
          role="dialog"
          aria-modal="true"
        >
          <button
            class="close-button dialog-close"
            aria-label="关闭"
            @click="closePdca()"
          >
            <X :size="18" /></button
          ><span class="eyebrow">PDCA LOOP</span>
          <h2 class="pdca-title">{{ pdcaEventTitle }}</h2>
          <small v-if="pdcaHint" class="pdca-hint">{{ pdcaHint }}</small>
          <div v-if="pdcaEvent?.micro" class="pdca-micro">
            <span>微版：{{ pdcaEvent.micro }}</span>
            <button
              v-if="!pdcaEvent.done && !nowRunning"
              type="button"
              class="chat-save"
              aria-label="先做 2 分钟"
              @click="startMicroFromEvent()"
            >
              <Sparkles :size="11" />先做 2 分钟
            </button>
            <span
              v-else-if="nowRunning?.eventId === pdcaEvent?.id"
              class="pdca-hint"
              >进行中 {{ nowElapsedLabel }}</span
            >
          </div>
          <div class="pdca-steps">
            <button
              v-for="step in steps"
              :key="step.id"
              type="button"
              class="pdca-step"
              :class="{
                active: pdcaStage === step.id,
                filled: pdcaForm[step.id].trim(),
              }"
              @click="pdcaStage = step.id"
            >
              <Check v-if="pdcaForm[step.id].trim()" :size="11" />{{
                step.short
              }}
            </button>
          </div>
          <label class="field-label"
            >{{ currentStep.label }}
            <textarea
              v-model="pdcaForm[pdcaStage]"
              rows="3"
              :placeholder="currentStep.prompt"
              maxlength="600"
            ></textarea>
            <button
              type="button"
              class="voice-button"
              :class="{ recording: listening }"
              @click="recordPdcaVoice()"
            >
              <Mic :size="14" />{{
                listening ? "停止录音 " + voiceClock : "语音记录"
              }}</button
          ></label>
          <div class="pdca-ai">
            <strong class="pdca-ai-title"
              >口述记录，AI 执行一次完整循环</strong
            >
            <div class="pdca-ai-input">
              <input
                v-model="pdcaAiInput"
                maxlength="500"
                enterkeyhint="done"
                placeholder="今天的记录：做了什么、结果如何…"
                aria-label="PDCA 记录输入"
              /><button
                type="button"
                class="chat-voice"
                :class="{ recording: pdcaAiListening }"
                :aria-label="pdcaAiListening ? '停止语音' : '语音输入'"
                @click="recordPdcaAi()"
              >
                <Mic :size="14" /></button
              ><button
                type="button"
                class="pdca-ai-go"
                :disabled="pdcaAiBusy"
                aria-label="执行 PDCA 循环"
                @click="runPdcaAi()"
              >
                <Sparkles :size="14" />
              </button>
            </div>
            <small v-if="pdcaAiBusy" class="pdca-hint">循环执行中…</small>
          </div>
          <button type="button" class="chat-save" @click="draftCardsFromEvent()">
            <Sparkles :size="11" />让 Pi 把这些记录起草成复习卡
          </button>
          <div class="dialog-actions">
            <button type="button" class="cancel-button" @click="closePdca()">
              完成</button
            ><button
              v-if="pdcaStage !== 'act'"
              type="button"
              class="primary-button"
              @click="pdcaNext()"
            >
              保存并下一阶段 <ArrowRight :size="14" /></button
            ><button
              v-else
              type="button"
              class="primary-button"
              @click="closePdca()"
            >
              循环完成
            </button>
          </div>
        </section>
      </div></Transition
    >
    <Transition name="fade"
      ><div
        v-if="dialog === 'routines'"
        class="modal-backdrop"
        @click.self="dialog = ''"
      >
        <section
          class="event-dialog routines-dialog"
          role="dialog"
          aria-modal="true"
        >
          <button
            class="close-button dialog-close"
            aria-label="关闭"
            @click="dialog = ''"
          >
            <X :size="18" /></button
          ><span class="eyebrow">DAILY ROUTINES</span>
          <h2>定时服务</h2>
          <p>
            每天到点由 Pi 按你的指令自动生成内容并提醒（如睡前儿童故事）。
            App 已关闭时到点只提醒，打开后当天有效时段内自动补生成。
          </p>
          <div v-if="routines.length" class="routine-list">
            <div
              v-for="routine in routines"
              :key="routine.id"
              class="routine-row"
            >
              <div class="routine-info">
                <strong
                  >{{ routine.name }}
                  {{ routine.time
                  }}<template v-if="routine.endTime"
                    >–{{ routine.endTime }}</template
                  ></strong
                >
                <small>{{ routine.prompt }}</small>
              </div>
              <button
                type="button"
                class="rt-switch"
                :class="{ on: routine.enabled }"
                :aria-label="routine.enabled ? '关闭定时任务' : '开启定时任务'"
                @click="toggleRoutine(routine)"
              >
                <i></i></button
              ><button
                type="button"
                class="routine-del"
                aria-label="删除"
                @click="removeRoutine(routine)"
              >
                <Trash2 :size="13" />
              </button>
            </div>
          </div>
          <p v-else class="routine-empty">还没有定时任务。</p>
          <button
            v-if="!routines.some((routine) => routine.name.includes('复盘'))"
            type="button"
            class="routine-preset"
            @click="
              routineForm.name = '每晚复盘';
              routineForm.prompt =
                '回顾我今天的日历事项，逐一引导我写 Check（结果与差异）和 Act（明天怎么调整），用温和提问的方式，一次只问一件事';
              routineForm.time = '21:30';
            "
            ><Sparkles :size="13" />用模板创建：每晚复盘（21:30 引导写 Check/Act）
          </button>
          <div class="routine-form">
            <button
              type="button"
              class="ai-dictate"
              :class="{ recording: formDictating, busy: formParsing }"
              @click="aiDictateRoutine()"
            >
              <Mic :size="14" />{{
                formDictating
                  ? "正在听 " + voiceClock + "，说完点停止…"
                  : formParsing
                    ? "AI 识别填入中…"
                    : "AI 听写：说一句话，自动填单"
              }}
            </button>
            <label class="field-label"
              >名称
              <span class="voice-input"
                ><input
                  v-model="routineForm.name"
                  maxlength="20"
                  placeholder="如：儿童故事"
                /><button
                  type="button"
                  class="voice-button"
                  :class="{ recording: routineListening === 'name' }"
                  :aria-label="routineListening === 'name' ? '停止录音' : '语音输入名称'"
                  @click="recordRoutineVoice('name')"
                >
                  <Mic :size="14" /></button></span
            ></label>
            <label class="field-label"
              >生成指令
              <span class="voice-input"
                ><input
                  v-model="routineForm.prompt"
                  maxlength="300"
                  placeholder="如：生成一个 5 分钟的睡前儿童故事，主角是小兔子"
                /><button
                  type="button"
                  class="voice-button"
                  :class="{ recording: routineListening === 'prompt' }"
                  :aria-label="routineListening === 'prompt' ? '停止录音' : '语音输入指令'"
                  @click="recordRoutineVoice('prompt')"
                >
                  <Mic :size="14" /></button></span
            ></label>
            <div class="field-row">
              <label class="field-label"
                >开始时间（每天）
                <input v-model="routineForm.time" type="time"
              /></label>
              <label class="field-label"
                >结束时间 <small>过期不补</small>
                <input v-model="routineForm.endTime" type="time"
              /></label>
            </div>
            <small v-if="routineError" class="voice-error">{{
              routineError
            }}</small>
            <button
              type="button"
              class="primary-button"
              @click="addRoutine()"
            >
              <Plus :size="15" />添加每日任务
            </button>
          </div>
        </section>
      </div></Transition
    >
    <Transition name="fade"
      ><div
        v-if="dialog === 'review'"
        class="modal-backdrop"
        @click.self="dialog = ''"
      >
        <section class="event-dialog review-dialog" role="dialog" aria-modal="true">
          <button
            class="close-button dialog-close"
            aria-label="关闭"
            @click="dialog = ''"
          >
            <X :size="18" /></button
          ><span class="eyebrow">DAILY REVIEW</span>
          <h2>今日复习</h2>
          <template v-if="reviewEntry">
            <small class="review-meta">{{
              reviewEntry.pointName
                ? `知识点:${reviewEntry.pointName}`
                : reviewEntry.card.sourceTitle
            }}</small>
            <div class="review-card">
              <p class="review-front">{{ reviewEntry.card.front }}</p>
              <p v-if="showBack" class="review-back">{{ reviewEntry.card.back }}</p>
            </div>
            <button
              v-if="!showBack"
              type="button"
              class="primary-button"
              @click="showBack = true"
            >
              翻面看答案
            </button>
            <div v-else class="review-grades">
              <button type="button" class="grade forgot" @click="gradeCurrent('forgot')">忘了</button>
              <button type="button" class="grade fuzzy" @click="gradeCurrent('fuzzy')">模糊</button>
              <button type="button" class="grade recall" @click="gradeCurrent('recall')">记得</button>
            </div>
            <p
              v-if="reviewFeedback"
              class="review-feedback"
              :class="reviewFeedback.kind"
            ><b>「{{ reviewFeedback.cardFront }}」</b>{{ reviewFeedback.text }}</p>
            <small v-if="reviewTransition" class="review-transition">{{
              reviewTransition
            }}</small>
            <small class="review-progress"
              >{{ reviewIndex + 1 }} / {{ queue.length }} · 自评决定下次什么时候再见</small
            >
          </template>
          <div v-else class="review-empty">
            <Brain :size="26" />
            <strong>{{ reviewDoneCount ? `本次完成 ${reviewDoneCount} 张` : "今日队列是空的" }}</strong>
            <span>有限容器:今天到这里,明天再来。</span>
            <small v-if="clearedStats.count" class="review-summary">{{
              reviewSummaryText(clearedStats)
            }}</small>
          </div>
        </section>
      </div></Transition
    >
    <Transition name="fade"
      ><div
        v-if="dialog === 'challenge'"
        class="modal-backdrop"
        @click.self="dialog = ''"
      >
        <section class="event-dialog ding-dialog" role="dialog" aria-modal="true">
          <button
            class="close-button dialog-close"
            aria-label="关闭"
            @click="dialog = ''"
          >
            <X :size="18" /></button
          ><span class="eyebrow">LEARNING CHALLENGE</span>
          <h2>发起学习挑战</h2>
          <p>
            把学习装进时间容器:周期一定结束。自带 2
            张冻结卡(漏卡自动保连续),连漏两天才暂停,永不清零。
          </p>
          <fieldset class="category-field">
            <legend>周期</legend>
            <div class="category-options">
              <button
                v-for="days in [21, 30, 66, 100]"
                :key="days"
                type="button"
                :class="{ chosen: challengeForm.days === days }"
                @click="challengeForm.days = days"
              >
                {{ days }} 天<Check v-if="challengeForm.days === days" :size="14" />
              </button>
            </div>
          </fieldset>
          <p class="challenge-rule">
            每日门槛:当天完成至少 1
            个该主题的事项。勾选完成即自动打卡;实在没学,也可以第二天补一张轻打卡。
          </p>
          <small v-if="loopError" class="voice-error">{{ loopError }}</small>
          <div class="dialog-actions">
            <button type="button" class="cancel-button" @click="dialog = ''">取消</button>
            <button type="button" class="primary-button" @click="createChallengeForTopic()">
              开始挑战
            </button>
          </div>
        </section>
      </div></Transition
    >
    <Transition name="fade"
      ><div
        v-if="dialog === 'map'"
        class="modal-backdrop"
        @click.self="dialog = ''"
      >
        <section class="event-dialog map-dialog" role="dialog" aria-modal="true">
          <button
            class="close-button dialog-close"
            aria-label="关闭"
            @click="dialog = ''"
          >
            <X :size="18" /></button
          ><span class="eyebrow">MASTERY MAP</span>
          <h2>{{ mapTopic?.title || "掌握地图" }}</h2>
          <div class="map-bar">
            <i :style="{ width: `${masteryPercentOf(mapTopicId)}%` }"></i>
          </div>
          <small class="map-bar-note"
            >掌握 {{ masteryPercentOf(mapTopicId) }}% · 只数「边缘」以上,接触过不算学会</small
          >
          <div v-if="mapPoints.length" class="map-points">
            <div
              v-for="point in mapPoints"
              :key="point.id"
              class="map-point"
              :class="point.status"
            >
              <div class="map-point-text">
                <strong>{{ point.name }}</strong>
                <span>{{ bloomNames[point.bloomLevel] }} · {{ pointStatusNames[point.status] }}</span>
              </div>
              <button
                type="button"
                class="map-point-del"
                aria-label="删除知识点"
                @click="removePoint(point.id)"
              >
                <Trash2 :size="12" />
              </button>
            </div>
          </div>
          <p v-else class="routine-empty">
            还没有知识点。先拆边界:这个主题里,哪些是你还说不清的?
          </p>
          <div class="map-add">
            <input
              v-model="newPointName"
              maxlength="40"
              placeholder="新知识点,如:p 值的含义"
              @keydown.enter.prevent="addPointFromForm()"
            /><select
              :value="newPointBloom"
              aria-label="掌握层级"
              @change="
                newPointBloom = ($event.target as HTMLSelectElement).value as BloomLevel
              "
            >
              <option value="recall">能复述</option>
              <option value="explain">能解释</option>
              <option value="apply">能应用</option>
              <option value="create">能创造</option>
            </select>
            <button type="button" class="primary-button" aria-label="添加知识点" @click="addPointFromForm()">
              <Plus :size="14" />
            </button>
          </div>
          <div class="map-card-form">
            <strong class="pdca-ai-title">加一张复习卡</strong>
            <input
              v-model="cardForm.front"
              maxlength="200"
              placeholder="正面:提示或问题"
            /><input
              v-model="cardForm.back"
              maxlength="500"
              placeholder="背面:答案或展开"
            /><button
              type="button"
              class="primary-button"
              :disabled="!cardForm.front.trim() || !cardForm.back.trim()"
              @click="addManualCard()"
            >
              加入复习队列
            </button>
          </div>
          <template v-if="draftList.length">
            <strong class="pdca-ai-title">Pi 起草的卡片({{ draftList.length }})</strong>
            <div v-for="draft in draftList" :key="draft.id" class="map-draft">
              <span>{{ draft.front }}</span>
              <button type="button" class="chat-save" @click="confirmDraft(draft.id)">
                <Check :size="11" />收下
              </button>
              <button
                type="button"
                class="map-point-del"
                aria-label="丢弃草稿"
                @click="discardDraftCard(draft.id)"
              >
                <X :size="11" />
              </button>
            </div>
          </template>
          <small v-if="loopError" class="voice-error">{{ loopError }}</small>
        </section>
      </div></Transition
    >
  </div>
</template>
