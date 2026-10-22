<script setup lang="ts">
import { Capacitor } from "@capacitor/core";
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from "@capacitor-community/sqlite";
import { SpeechRecognition } from "@capacitor-community/speech-recognition";
import { computed, onMounted, ref, watch } from "vue";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  CloudDownload,
  ListChecks,
  LogOut,
  Mic,
  MessageCircle,
  Plus,
  Send,
  Sparkles,
  Tag,
  Trash2,
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
  done: boolean;
  important: boolean;
  urgent: boolean;
  voiceNote: string;
  reflection: string;
  pdca: Record<Step, string>;
}
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const categoryNames: Record<Category, string> = {
  work: "工作",
  interest: "兴趣",
  plan: "计划",
};
const categories: Category[] = ["work", "interest", "plan"];
const steps: { id: Step; label: string; prompt: string }[] = [
  { id: "plan", label: "Plan 计划", prompt: "目标是什么？打算怎么做？" },
  { id: "do", label: "Do 执行", prompt: "实际做了什么？" },
  { id: "check", label: "Check 检查", prompt: "结果如何？有哪些差异？" },
  { id: "act", label: "Act 调整", prompt: "下一轮如何改进？" },
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
const today = dateKey(now);

const name = ref("");
const signedIn = ref(false);
const events = ref<CalendarEvent[]>([]);
const view = ref<"year" | "month" | "day">("day");
const activeQuadrant = ref("");
const year = ref(now.getFullYear());
const month = ref(now.getMonth());
const selectedDate = ref(today);
const database = ref("初始化日历…");
const dbNotice = ref("");
const db = ref<SQLiteDBConnection | null>(null);
const dialog = ref<"event" | "dingtalk" | "">("");
const pdcaOpen = ref(false);
const search = ref("");
const form = ref({
  id: "",
  title: "",
  date: today,
  time: "09:00",
  category: "" as Category | "",
  tags: "",
  important: false,
  urgent: false,
  voiceNote: "",
  reflection: "",
  pdca: { plan: "", do: "", check: "", act: "" },
});
const messages = ref<ChatMessage[]>([]);
const chatText = ref("");
const chatBusy = ref(false);
const voiceError = ref("");
const listening = ref(false);
let speechRecognition: SpeechRecognitionLike | undefined;

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
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
  view.value === "year"
    ? `${year.value} 年`
    : view.value === "month"
      ? `${year.value} 年 ${month.value + 1} 月`
      : dateTitle.value,
);
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
    };
  });
});

function demoEvents(): CalendarEvent[] {
  return [
    {
      id: crypto.randomUUID(),
      title: "产品迭代周会",
      date: today,
      time: "10:00",
      category: "work",
      tags: ["周会", "项目"],
      source: "dingtalk",
      done: false,
      important: true,
      urgent: true,
      voiceNote: "",
      reflection: "",
      pdca: { plan: "对齐本周迭代目标", do: "", check: "", act: "" },
    },
    {
      id: crypto.randomUUID(),
      title: "下班后慢跑 5 公里",
      date: today,
      time: "18:30",
      category: "interest",
      tags: ["跑步", "健康"],
      source: "personal",
      done: false,
      important: true,
      urgent: false,
      voiceNote: "",
      reflection: "",
      pdca: { plan: "轻松完成 5 公里，不追配速", do: "", check: "", act: "" },
    },
    {
      id: crypto.randomUUID(),
      title: "阅读 20 分钟",
      date: today,
      time: "20:30",
      category: "plan",
      tags: ["阅读"],
      source: "personal",
      done: true,
      important: true,
      urgent: false,
      voiceNote: "",
      reflection: "比计划多读了 5 分钟，睡前阅读很适合我。",
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
        pdca_check TEXT NOT NULL DEFAULT '', pdca_act TEXT NOT NULL DEFAULT ''
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
        done: Boolean(row.done),
        important: Boolean(row.important),
        urgent: Boolean(row.urgent),
        voiceNote: String(row.voice_note || ""),
        reflection: String(row.reflection || ""),
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
      events.value = JSON.parse(
        localStorage.getItem(eventsKey) || "[]",
      ) as CalendarEvent[];
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
      await db.value.execute("DELETE FROM calendar_events");
      for (const event of events.value)
        await db.value.run(
          `INSERT INTO calendar_events (id,title,date,time,category,tags,source,done,important,urgent,voice_note,reflection,pdca_plan,pdca_do,pdca_check,pdca_act) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
            event.pdca.plan,
            event.pdca.do,
            event.pdca.check,
            event.pdca.act,
          ],
        );
    } catch (error) {
      dbNotice.value =
        error instanceof Error ? error.message : "SQLite 保存失败";
    }
  } else {
    try {
      localStorage.setItem(eventsKey, JSON.stringify(events.value));
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
function newEvent(key = selectedDate.value) {
  form.value = {
    id: "",
    title: "",
    date: key,
    time: "09:00",
    category: "",
    tags: "",
    important: false,
    urgent: false,
    voiceNote: "",
    reflection: "",
    pdca: { plan: "", do: "", check: "", act: "" },
  };
  pdcaOpen.value = false;
  dialog.value = "event";
}
function editEvent(event: CalendarEvent) {
  form.value = {
    id: event.id,
    title: event.title,
    date: event.date,
    time: event.time,
    category: event.category,
    tags: event.tags.join(", "),
    important: event.important,
    urgent: event.urgent,
    voiceNote: event.voiceNote,
    reflection: event.reflection,
    pdca: { ...event.pdca },
  };
  pdcaOpen.value = true;
  dialog.value = "event";
}
async function saveEvent() {
  const tags = form.value.tags
    .split(/[,，、#]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (!form.value.title.trim() || !form.value.category || !tags.length) return;
  const old = events.value.find((event) => event.id === form.value.id);
  const source = old?.source || "personal";
  const event: CalendarEvent = {
    id: old?.id || crypto.randomUUID(),
    title: form.value.title.trim(),
    date: form.value.date,
    time: form.value.time,
    category:
      source === "dingtalk" ? "work" : (form.value.category as Category),
    tags: [...new Set(tags)],
    source,
    done: old?.done || false,
    important: form.value.important,
    urgent: form.value.urgent,
    voiceNote: form.value.voiceNote,
    reflection: form.value.reflection,
    pdca: { ...form.value.pdca },
  };
  const index = events.value.findIndex((item) => item.id === event.id);
  if (index < 0) events.value.push(event);
  else events.value[index] = event;
  goDay(event.date);
  dialog.value = "";
  await saveEvents();
}
function applyTranscript(target: "title" | "plan" | "reflection" | "check", transcript: string) {
  if (!transcript) return;
  if (target === "title")
    form.value.title = `${form.value.title}${form.value.title ? " " : ""}${transcript}`;
  else if (target === "plan")
    form.value.pdca.plan = `${form.value.pdca.plan}${form.value.pdca.plan ? " " : ""}${transcript}`;
  else if (target === "check")
    form.value.pdca.check = `${form.value.pdca.check}${form.value.pdca.check ? " " : ""}${transcript}`;
  else
    form.value.reflection = `${form.value.reflection}${form.value.reflection ? " " : ""}${transcript}`;
  form.value.voiceNote = `${form.value.voiceNote}${form.value.voiceNote ? "\n" : ""}${transcript}`;
}

async function recordVoice(target: "title" | "plan" | "reflection" | "check") {
  voiceError.value = "";
  if (Capacitor.isNativePlatform()) {
    try {
      let permission = await SpeechRecognition.checkPermissions();
      if (permission.speechRecognition !== "granted")
        permission = await SpeechRecognition.requestPermissions();
      if (permission.speechRecognition !== "granted") {
        voiceError.value = "需要麦克风和语音识别权限才能开始录音。";
        return;
      }
      listening.value = true;
      const result = await SpeechRecognition.start({
        language: "zh-CN",
        maxResults: 1,
        partialResults: false,
        popup: true,
      });
      applyTranscript(target, result.matches?.[0]?.trim() || "");
    } catch {
      voiceError.value = "语音识别未能启动，请检查设备语音服务和麦克风权限。";
    } finally {
      listening.value = false;
    }
    return;
  }

  const speechWindow = window as SpeechWindow;
  const Recognition =
    speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
  if (!Recognition) {
    voiceError.value = "当前浏览器不支持语音识别，请使用 Android Chrome。";
    return;
  }
  voiceError.value = "";
  const recognition = new Recognition();
  speechRecognition = recognition;
  recognition.lang = "zh-CN";
  recognition.interimResults = false;
  listening.value = true;
  recognition.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map((result) => result[0]?.transcript || "")
      .join("")
      .trim();
    applyTranscript(target, transcript);
  };
  recognition.onerror = () => {
    voiceError.value = "没有识别到语音，请检查麦克风权限。";
    listening.value = false;
  };
  recognition.onend = () => {
    listening.value = false;
    speechRecognition = undefined;
  };
  recognition.start();
}
function stopVoice() {
  speechRecognition?.stop();
  if (Capacitor.isNativePlatform()) void SpeechRecognition.stop();
}
async function importDingTalkDemo() {
  events.value.push({
    id: crypto.randomUUID(),
    title: "钉钉同步：项目进度沟通",
    date: selectedDate.value,
    time: "14:00",
    category: "work",
    tags: ["钉钉", "项目"],
    source: "dingtalk",
    done: false,
    important: true,
    urgent: false,
    voiceNote: "",
    reflection: "",
    pdca: { plan: "同步项目进度和风险", do: "", check: "", act: "" },
  });
  dialog.value = "";
  await saveEvents();
}
async function askPi(text?: string) {
  const message = (text || chatText.value).trim();
  if (!message || chatBusy.value) return;
  messages.value.push({ role: "user", content: message });
  chatText.value = "";
  chatBusy.value = true;
  try {
    const response = await fetch(
      `${import.meta.env.VITE_API_BASE_URL || ""}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          today: selectedDate.value,
          events: events.value,
          history: messages.value.slice(-11, -1),
        }),
      },
    );
    const result = (await response.json()) as {
      reply?: string;
      error?: string;
    };
    if (!response.ok) throw new Error(result.error || "Pi 暂时无法回复。");
    messages.value.push({
      role: "assistant",
      content: result.reply || "暂时没有收到回复。",
    });
  } catch (error) {
    messages.value.push({
      role: "assistant",
      content:
        error instanceof Error ? error.message : "连接 Pi 失败，请检查服务端。",
    });
  } finally {
    chatBusy.value = false;
  }
}
async function removeEvent(event: CalendarEvent) {
  events.value = events.value.filter((item) => item.id !== event.id);
  await saveEvents();
}
async function toggleDone(event: CalendarEvent) {
  event.done = !event.done;
  await saveEvents();
}
watch(
  events,
  () => {
    void saveEvents();
  },
  { deep: true },
);
onMounted(() => {
  try {
    const profile = localStorage.getItem(profileKey);
    if (profile) {
      name.value = profile;
      signedIn.value = true;
    }
  } catch {
    /* 可在登录页重新输入 */
  }
  void openDatabase();
});
</script>

<template>
  <main v-if="!signedIn" class="login-screen">
    <div class="login-art">
      <div class="art-calendar">
        <span>OCT</span
        ><strong>{{ String(now.getDate()).padStart(2, "0") }}</strong
        ><i></i><i></i><i></i>
      </div>
      <p>Make room for<br />what matters.</p>
    </div>
    <section class="login-panel">
      <a class="brand"
        ><span class="brand-symbol"><CalendarDays :size="18" /></span>拾序<span
          class="brand-dot"
          >.</span
        ></a
      >
      <div class="login-copy">
        <span class="eyebrow">YOUR PERSONAL RHYTHM</span>
        <h1>安排事情，<br />也安排生活。</h1>
        <p>工作、兴趣和计划，都值得有自己的位置。</p>
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
        /><button type="submit">进入我的日历 <ArrowRight :size="17" /></button>
      </form>
      <small class="login-privacy">本机演示登录，不代表钉钉账号验证。</small>
    </section>
  </main>

  <div v-else class="app-shell">
    <header class="topbar">
      <a class="brand"
        ><span class="brand-symbol"><CalendarDays :size="18" /></span>拾序<span
          class="brand-dot"
          >.</span
        ></a
      >
      <div class="topbar-right">
        <span class="db-indicator"></span
        ><span class="db-label">{{ database }}</span
        ><button
          class="top-icon"
          title="钉钉接入"
          aria-label="钉钉接入"
          @click="dialog = 'dingtalk'"
        >
          <CloudDownload :size="18" /></button
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
      <section class="calendar-main">
        <div class="calendar-heading">
          <div>
            <span class="eyebrow">{{
              view === "year"
                ? "YOUR YEAR"
                : view === "month"
                  ? "YOUR MONTH"
                  : "YOUR DAY"
            }}</span>
            <h1>{{ title }}</h1>
            <p>工作、兴趣、计划，所有事项都有归属。</p>
          </div>
          <div class="heading-actions">
            <div class="view-switch">
              <button
                :class="{ chosen: view === 'year' }"
                @click="view = 'year'"
              >
                年</button
              ><button
                :class="{ chosen: view === 'month' }"
                @click="view = 'month'"
              >
                月</button
              ><button
                :class="{ chosen: view === 'day' }"
                @click="view = 'day'"
              >
                日
              </button>
            </div>
            <button class="primary-button" @click="newEvent()">
              <Plus :size="17" />新建事项
            </button>
          </div>
        </div>
        <section class="calendar-panel">
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
              <strong>{{ monthNames[monthIndex - 1] }}</strong>
              <div class="mini-event-count">
                {{
                  events.filter(
                    (item) =>
                      Number(item.date.slice(5, 7)) === monthIndex &&
                      Number(item.date.slice(0, 4)) === year,
                  ).length
                }}<small>项</small>
              </div>
              <div class="mini-dots">
                <i
                  v-for="category in categories"
                  :key="category"
                  :class="category"
                  :style="{
                    opacity: events.some(
                      (item) =>
                        Number(item.date.slice(5, 7)) === monthIndex &&
                        item.category === category,
                    )
                      ? 1
                      : 0.18,
                  }"
                ></i>
              </div>
            </button>
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
                <span class="day-number">{{ day.day }}</span
                ><span
                  v-for="event in day.events.slice(0, 3)"
                  :key="event.id"
                  class="calendar-event"
                  :class="event.category"
                  ><i></i>{{ event.title }}</span
                ><span v-if="day.events.length > 3" class="more-items"
                  >+{{ day.events.length - 3 }} 项</span
                >
              </button>
            </div></template
          >
          <div v-else class="day-agenda">
            <div class="priority-panel">
              <div class="priority-title">
                <span><strong>轻重缓急</strong><small>按重要性与紧急性划分</small></span>
                <button v-if="activeQuadrant" @click="activeQuadrant = ''">显示全部</button>
              </div>
              <div class="priority-grid">
                <button
                  v-for="quadrant in quadrants"
                  :key="quadrant.id"
                  class="priority-cell"
                  :class="[quadrant.id, { selected: activeQuadrant === quadrant.id }]"
                  @click="activeQuadrant = activeQuadrant === quadrant.id ? '' : quadrant.id"
                >
                  <span><strong>{{ quadrant.title }}</strong><small>{{ quadrant.hint }}</small></span>
                  <b>{{ quadrant.events.length }}</b>
                  <small class="quadrant-preview">{{ quadrant.events.slice(0, 2).map((event) => event.title).join(' · ') || '暂无事项' }}</small>
                </button>
              </div>
            </div>
            <div class="agenda-head">
              <span>时间</span><span>事项</span><span>类别 · 标签</span
              ><span>PDCA</span>
            </div>
            <template v-for="(event, eventIndex) in prioritizedEvents" :key="event.id">
            <div v-if="event.id === morningEvents[0]?.id" class="period-divider"><span>上午</span><small>{{ morningEvents.length }} 件事项 · 12:00 前</small></div>
            <div v-if="event.id === afternoonEvents[0]?.id" class="period-divider afternoon"><span>下午与晚上</span><small>{{ afternoonEvents.length }} 件事项 · 12:00 后</small></div>
            <article
              class="agenda-row"
              :class="{ done: event.done }"
            >
              <button
                class="done-toggle"
                :class="{ checked: event.done }"
                :aria-label="event.done ? '标记未完成' : '标记完成'"
                @click="toggleDone(event)"
              >
                <Check v-if="event.done" :size="13" /></button
              ><span class="event-time"
                ><Clock3 :size="13" />{{ event.time }}</span
              ><button class="event-name" @click="editEvent(event)">
                <strong>{{ event.title }}</strong
                ><small v-if="event.source === 'dingtalk'">钉钉</small></button
              ><span class="event-labels"
                ><b class="category-pill" :class="event.category">{{
                  categoryNames[event.category]
                }}</b
                ><span v-for="tag in event.tags" :key="tag" class="tag-pill"
                  >#{{ tag }}</span
                ></span
              ><button class="pdca-count" @click="editEvent(event)">
                {{ Object.values(event.pdca).filter(Boolean).length }}/4 PDCA
                <ArrowRight :size="13" /></button
              ><button
                class="delete-button"
                title="删除"
                aria-label="删除事项"
                @click="removeEvent(event)"
              >
                <Trash2 :size="15" />
              </button>
            </article>
            </template>
            <div v-if="!prioritizedEvents.length" class="empty-day">
              <CalendarDays :size="25" /><strong>这一天还没有安排</strong
              ><span>留白也可以是计划的一部分。</span>
              <button v-if="activeQuadrant" @click="activeQuadrant = ''">清除象限筛选</button>
            </div>
            <button class="inline-add" @click="newEvent(selectedDate)">
              <Plus :size="15" />添加当天事项
            </button>
          </div>
        </section>

        <section id="pi" class="pi-panel">
          <div class="pi-header">
            <span class="pi-avatar"><Sparkles :size="16" /></span
            ><span
              ><strong>Pi · 私人助理</strong
              ><small>聊聊任务，也聊聊今天</small></span
            ><b class="model-label">DeepSeek</b>
          </div>
          <div v-if="messages.length" class="chat-history">
            <div
              v-for="(message, index) in messages"
              :key="index"
              class="chat-message"
              :class="message.role"
            >
              <span v-if="message.role === 'assistant'" class="chat-mark"
                ><Sparkles :size="13"
              /></span>
              <p>{{ message.content }}</p>
            </div>
            <div v-if="chatBusy" class="chat-message assistant">
              <span class="chat-mark"><Sparkles :size="13" /></span>
              <p>正在想一想…</p>
            </div>
          </div>
          <div v-else class="chat-suggestions">
            <button @click="askPi('根据我今天的事项，帮我排一下优先级。')">
              帮我安排今天 <ArrowRight :size="13" /></button
            ><button @click="askPi('结合我的 PDCA 记录，帮我回顾一下。')">
              回顾 PDCA <ArrowRight :size="13" /></button
            ><button @click="askPi('我是不是把计划排得太满了？')">
              计划是不是太满？ <ArrowRight :size="13" />
            </button>
          </div>
          <form class="chat-form" @submit.prevent="askPi()">
            <input
              v-model="chatText"
              maxlength="2000"
              placeholder="问问 Pi：今天先做哪件事？"
              aria-label="向 Pi 提问"
            /><button
              type="submit"
              aria-label="发送"
              :disabled="!chatText.trim() || chatBusy"
            >
              <Send :size="16" />
            </button>
          </form>
          <small class="ai-note"
            >首次使用需要在服务端配置 DeepSeek API Key。</small
          >
        </section>
        <footer class="app-footer">
          <span><i class="db-indicator"></i>{{ dbNotice || database }}</span
          ><button @click="dialog = 'dingtalk'">
            <CircleHelp :size="14" />钉钉接入说明
          </button>
        </footer>
      </section>
    </div>

    <Transition name="fade"
      ><div
        v-if="dialog === 'event'"
        class="modal-backdrop"
        @click.self="dialog = ''"
      >
        <section class="event-dialog" role="dialog" aria-modal="true">
          <header class="dialog-header">
            <div>
              <span class="eyebrow">CALENDAR ITEM</span>
              <h2>{{ form.id ? "编辑事项" : "新建事项" }}</h2>
            </div>
            <button class="close-button" aria-label="关闭" @click="dialog = ''">
              <X :size="18" />
            </button>
          </header>
          <form class="event-form" @submit.prevent="saveEvent">
            <label class="field-label">事项名称
              <span class="voice-input"><input v-model="form.title" required maxlength="120" placeholder="比如：练习吉他 30 分钟" /><button type="button" :class="{ recording: listening }" :aria-label="listening ? '停止录音' : '语音记录事项'" @click="listening ? stopVoice() : recordVoice('title')"><Mic :size="16" /></button></span>
            </label>
            <div class="field-row">
              <label class="field-label"
                >日期<input v-model="form.date" type="date" required /></label
              ><label class="field-label"
                >时间<input v-model="form.time" type="time" required
              /></label>
            </div>
            <fieldset class="category-field">
              <legend>归属类别 <b>*</b></legend>
              <div class="category-options">
                <button
                  v-for="category in categories"
                  :key="category"
                  type="button"
                  :class="[{ chosen: form.category === category }, category]"
                  @click="form.category = category"
                >
                  <i class="category-dot" :class="category"></i
                  >{{ categoryNames[category]
                  }}<Check v-if="form.category === category" :size="14" />
                </button>
              </div>
            </fieldset>
            <fieldset class="priority-options">
              <legend>轻重缓急</legend>
              <label><input v-model="form.important" type="checkbox" />重要</label>
              <label><input v-model="form.urgent" type="checkbox" />紧急</label>
              <span>{{ form.important ? (form.urgent ? '重要且紧急 · 立即处理' : '重要不紧急 · 安排计划') : (form.urgent ? '紧急不重要 · 尽量委托' : '不重要不紧急 · 考虑减少') }}</span>
            </fieldset>
            <label class="field-label"
              >标签 <small>至少一个，逗号分隔</small
              ><span class="tag-input"
                ><Tag :size="15" /><input
                  v-model="form.tags"
                  required
                  placeholder="例如：运动、健康" /></span
            ></label>
            <section class="pdca-editor">
              <button
                type="button"
                class="pdca-heading"
                @click="pdcaOpen = !pdcaOpen"
              >
                <span
                  ><strong>PDCA 循环</strong
                  ><small>计划 · 执行 · 检查 · 调整</small></span
                ><ChevronRight :size="16" :class="{ expanded: pdcaOpen }" />
              </button>
              <div v-if="pdcaOpen" class="pdca-fields">
                <label v-for="step in steps" :key="step.id"
                  >{{ step.label
                  }}<textarea
                    v-model="form.pdca[step.id]"
                    rows="2"
                    :placeholder="step.prompt"
                    maxlength="600"
                  ></textarea>
                  <button v-if="step.id === 'plan' || step.id === 'check'" type="button" class="voice-button" :class="{ recording: listening }" @click="listening ? stopVoice() : recordVoice(step.id)"><Mic :size="14" />{{ listening ? '停止录音' : '语音记录' }}</button>
                </label>
                <label class="reflection-field">自我反思<textarea v-model="form.reflection" rows="3" maxlength="1000" placeholder="记录感受、收获和下次想调整的地方"></textarea><button type="button" class="voice-button" :class="{ recording: listening }" @click="listening ? stopVoice() : recordVoice('reflection')"><Mic :size="14" />{{ listening ? '停止录音' : '语音记录反思' }}</button></label>
                <small v-if="voiceError" class="voice-error">{{ voiceError }}</small>
                <small v-if="form.voiceNote" class="voice-saved">已保存 {{ form.voiceNote.split('\n').length }} 条语音转写</small>
              </div>
            </section>
            <div class="dialog-actions">
              <button type="button" class="cancel-button" @click="dialog = ''">
                取消</button
              ><button
                type="submit"
                class="primary-button"
                :disabled="
                  !form.title.trim() || !form.category || !form.tags.trim()
                "
              >
                保存事项
              </button>
            </div>
          </form>
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
          ><span class="ding-icon">D</span
          ><span class="eyebrow">DINGTALK WORKSPACE</span>
          <h2>钉钉事项，只归工作</h2>
          <p>
            钉钉来源的事项会固定归类为“工作”，并保留来源。连接真实企业日历还需管理员配置应用凭证与服务端授权。
          </p>
          <div class="ding-rule">
            <i class="category-dot work"></i><strong>工作</strong
            ><span>钉钉事项不可更改分类</span>
          </div>
          <button
            class="primary-button demo-button"
            @click="importDingTalkDemo"
          >
            <CloudDownload :size="16" />添加钉钉演示事项</button
          ><small>演示事项保存在当前设备。</small>
        </section>
      </div></Transition
    >
  </div>
</template>
