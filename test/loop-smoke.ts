// 学习闭环纯逻辑冒烟测试(esbuild 打桩 @capacitor/* 后在 Node 运行)
// 覆盖 FSD P0 验收清单中的规则部分:幂等结算、冻结、补签、SM-2、BKT 四态、队列截断
// 以及 §6.1 Issue #8:Pi 三工具纯逻辑(草稿规整/确认幂等/来源读取/批量校验/文案选择/goal_note 迁移)
// 以及 §14 Issue #16:启动零摩擦(microStepOf/resolveNextAction/轻打卡幂等依赖)
// 以及 §13 Issue #9:费曼教回(resolveTeachbackResults/遗漏不降级/BKT forgot 数值锁定)
import * as loop from "../src/learningLoop";
import { native } from "./stubs/core.mjs";
import { fakeDb } from "./stubs/sqlite.mjs";

let pass = 0;
let fail = 0;
function ok(condition: boolean, name: string, detail?: unknown) {
  if (condition) {
    pass += 1;
    console.log("  PASS", name);
  } else {
    fail += 1;
    console.log("  FAIL", name, detail === undefined ? "" : JSON.stringify(detail));
  }
}

const topicId = "t1";
const today = loop.todayKey();

// ── 挑战创建(起始日提前 3 天,让「昨日」落在周期内)──
const c1 = loop.createChallenge({
  topicId,
  topicTitle: "统计学基础",
  startDate: loop.addDays(today, -3),
});
ok(!("error" in c1), "创建挑战成功");
const c1r = c1 as Exclude<typeof c1, { error: string }>;
const dup = loop.createChallenge({ topicId, topicTitle: "统计学基础" });
ok("error" in dup, "同主题重复创建被拒绝");

// ── 实时打卡 ──
loop.recordEventDone(topicId, today, "e1");
ok(loop.challengeProgress(c1r).doneCount === 1, "完成事件自动打卡");
loop.recordEventDone(topicId, today, "e2");
ok(loop.challengeProgress(c1r).doneCount === 1, "同日打卡幂等");
ok(loop.lightCheckin(c1r.id) !== true, "已有打卡时轻打卡被拒");

// ── 知识点与 BKT 四态 ──
const p = loop.addKnowledgePoint({ topicId, name: "p 值的含义" });
ok(!("error" in p), "新增知识点");
const pDup = loop.addKnowledgePoint({ topicId, name: "p 值的含义" });
ok("error" in pDup, "同名知识点被拒");
const p1 = p as Exclude<typeof p, { error: string }>;

const card = loop.createCard({
  topicId,
  pointId: p1.id,
  sourceType: "manual",
  sourceId: `manual:${today}`,
  sourceTitle: "手动",
  front: "p 值是什么?",
  back: "在原假设为真时,观察到当前或更极端结果的概率",
  active: true,
});
ok(!("error" in card), "建卡入队");
const cardR = card as Exclude<typeof card, { error: string }>;

// SM-2 间隔逐步断言:1 → 6 → round(6 × ease)
loop.scheduleCard(cardR, "recall");
let point = loop.pointById(p1.id)!;
ok(cardR.intervalDays === 1, "首答间隔 1 天", cardR.intervalDays);
ok(point.status === "touched", "一次正确 → touched", point.status);

loop.scheduleCard(cardR, "recall");
point = loop.pointById(p1.id)!;
ok(cardR.intervalDays === 6, "二次间隔 6 天", cardR.intervalDays);
ok(point.status === "shaky", "两次正确 → shaky", point.status);

loop.scheduleCard(cardR, "recall");
point = loop.pointById(p1.id)!;
ok(cardR.intervalDays === Math.round(6 * cardR.ease), "三次间隔 = 6×ease", cardR.intervalDays);
ok(point.status === "mastered", "三次正确 → mastered", point.status);

// 连续两次忘 → mastered 降级 shaky,间隔重置 1
loop.scheduleCard(cardR, "forgot");
loop.scheduleCard(cardR, "forgot");
point = loop.pointById(p1.id)!;
ok(
  point.status === "shaky",
  "连续两忘 → 降回 shaky",
  { status: point.status, mastery: point.mastery },
);
ok(cardR.intervalDays === 1, "忘 → 间隔重置 1 天", cardR.intervalDays);

// ── 队列构建与截断 ──
// cardR 两忘后 due=明天,不在今日队列;card2 due=今天
const card2 = loop.createCard({
  topicId,
  pointId: null,
  sourceType: "manual",
  sourceId: `manual:${today}`,
  sourceTitle: "手动",
  front: "中心极限定理",
  back: "样本均值分布随 n 增大趋近正态",
  active: true,
});
ok(!("error" in card2), "第二张卡入队");
const card2r = card2 as Exclude<typeof card2, { error: string }>;
const queue = loop.buildDailyQueue(topicId);
ok(
  queue.length === 1 && queue[0].card.id === card2r.id,
  "已排到明天的卡不进今日队列",
  queue.map((entry) => entry.card.front),
);

// 队列上限:15 张旧卡(due=今天)+ card2 与 14 张新卡 → 队列 = 15 旧 + 5 新 = 20
for (let i = 0; i < 15; i += 1) {
  const old = loop.createCard({
    topicId,
    pointId: null,
    sourceType: "manual",
    sourceId: `manual:${today}`,
    sourceTitle: "旧卡",
    front: `旧问题 ${i}`,
    back: `旧答案 ${i}`,
    active: true,
  });
  if (!("error" in old)) {
    // 模拟已排期过的卡:间隔 5 天、今天到期
    old.intervalDays = 5;
    old.dueDate = today;
  }
}
for (let i = 0; i < 14; i += 1)
  loop.createCard({
    topicId,
    pointId: null,
    sourceType: "manual",
    sourceId: `manual:${today}`,
    sourceTitle: "批量",
    front: `问题 ${i}`,
    back: `答案 ${i}`,
    active: true,
  });
const bigQueue = loop.buildDailyQueue(topicId);
ok(bigQueue.length === loop.DAILY_QUEUE_LIMIT, "队列截断到 20", bigQueue.length);
const freshInQueue = bigQueue.filter((entry) => entry.card.intervalDays <= 0).length;
ok(freshInQueue === 5, "旧卡填满后新卡只补余量(≤10)", freshInQueue);
ok(bigQueue[0].card.id === card2r.id, "旧卡优先于新卡", bigQueue[0].card.front);

// ── daily_settle:冻结与红线 ──
const settled = loop.dailySettle();
const s1 = settled.find((item) => item.challenge.id === c1r.id);
ok(!!s1?.froze, "昨日缺席 → 冻结卡保护", settled.map((item) => ({ id: item.challenge.id, froze: item.froze })));
ok(loop.challengeProgress(c1r).freezeCount === 1, "冻结行落表");
ok(loop.dailySettle().length === 0, "同日重复结算幂等");
ok(loop.makeupCheckin(c1r.id) === "昨日已由冻结卡保护,无需补签", "冻结日拒绝补签");

// 红线:冻结耗尽 + 昨日/前日均缺席
const c2 = loop.createChallenge({
  topicId: "t2",
  topicTitle: "英语词根",
  startDate: loop.addDays(today, -3),
});
const c2r = c2 as Exclude<typeof c2, { error: string }>;
c2r.freezesLeft = 0;
c2r.settledOn = ""; // 允许本日重结算
const settled2 = loop.dailySettle();
const s2 = settled2.find((item) => item.challenge.id === c2r.id);
ok(!!s2?.paused, "连漏两日 → 暂停红线");
ok(c2r.status === "paused", "状态转 paused");
loop.resumeChallenge(c2r.id);
ok(c2r.status === "active", "恢复继续");
ok(loop.makeupCheckin(c2r.id) === true, "恢复后可补签昨日");
ok(loop.challengeProgress(c2r).doneCount === 1, "补签落表");

// ── 掌握百分比:只数 shaky+mastered ──
// 当前点:p1=shaky(两忘后);再加一个 dark 点 → 1/2
const p3 = loop.addKnowledgePoint({ topicId, name: "置信区间" });
ok(!("error" in p3), "新增第二个知识点");
ok(loop.topicMasteryPercent(topicId) === 50, "shaky 计入、dark 不计入", loop.topicMasteryPercent(topicId));
// 把 p3 推到 mastered → 2/2
const p3r = p3 as Exclude<typeof p3, { error: string }>;
loop.applyPointEvidence(p3r.id, true);
loop.applyPointEvidence(p3r.id, true);
loop.applyPointEvidence(p3r.id, true);
ok(
  loop.pointById(p3r.id)!.status === "mastered",
  "p3 三次正确 → mastered",
  loop.pointById(p3r.id)!.status,
);
ok(loop.topicMasteryPercent(topicId) === 100, "mastered 计入百分比", loop.topicMasteryPercent(topicId));

// ── 教回 ──
loop.applyTeachback(topicId, "tr1", [
  { pointId: p1.id, covered: true, quote: "p 值就是…" },
  { pointId: p3r.id, covered: false, quote: "" },
]);
ok(loop.pointById(p1.id)!.mastery > 0.4, "教回覆盖推进掌握度");

// ══ FSD §6.1 Issue #8:Pi 三工具纯逻辑 ══
async function piToolTests() {
  // 1) ChallengeSuggestion 规整
  const noTopic = loop.normalizeChallengeSuggestion({
    topicTitle: "无主题",
    days: 30,
    goalNote: "n",
  });
  ok("error" in noTopic, "ChallengeSuggestion 缺 topicId 报错", noTopic);
  const high = loop.normalizeChallengeSuggestion({
    topicId: "t-sug",
    topicTitle: "上限",
    days: 9999,
    goalNote: "g".repeat(500),
  });
  ok(!("error" in high) && high.days === 365, "days 夹取上界 365", high);
  const low = loop.normalizeChallengeSuggestion({
    topicId: "t-sug",
    topicTitle: "下限",
    days: 0,
  });
  ok(!("error" in low) && low.days === 7, "days 夹取下界 7", low);
  const fallback = loop.normalizeChallengeSuggestion({
    topicId: "t-sug",
    topicTitle: "默认",
  });
  ok(
    !("error" in fallback) &&
      fallback.days === 100 &&
      fallback.threshold === "one_event",
    "days 非法默认 100,threshold 默认 one_event",
    fallback,
  );
  ok(
    !("error" in high) && high.goalNote.length === loop.GOAL_NOTE_LIMIT,
    "goalNote 截断至固定上限",
    !("error" in high) ? high.goalNote.length : high,
  );

  // 2) 确认幂等(store 级):同一 challengeDraft 二次确认不产生第二条挑战
  const draft = loop.normalizeChallengeSuggestion({
    topicId: "t-pi",
    topicTitle: "挑战幂等",
    days: 30,
    goalNote: "能独立讲清 p 值",
  });
  ok(!("error" in draft), "Pi 挑战草稿规整通过", draft);
  if ("error" in draft) return;
  const firstConfirm = loop.createChallenge({
    topicId: draft.topicId,
    topicTitle: draft.topicTitle,
    totalDays: draft.days,
    threshold: draft.threshold,
    goalNote: draft.goalNote,
  });
  ok(!("error" in firstConfirm), "确认首次落库");
  ok(
    !("error" in firstConfirm) && firstConfirm.goalNote === draft.goalNote,
    "goal_note 等于草稿文本",
    firstConfirm,
  );
  const secondConfirm = loop.createChallenge({
    topicId: draft.topicId,
    topicTitle: draft.topicTitle,
    totalDays: draft.days,
    goalNote: draft.goalNote,
  });
  ok(
    "error" in secondConfirm &&
      secondConfirm.error === "该主题已有进行中的挑战",
    "同一草稿二次确认被单活跃拦截",
    secondConfirm,
  );
  ok(loop.challengesForTopic("t-pi").length === 1, "库中只有一条挑战");
  const manualConfirm = loop.createChallenge({
    topicId: "t-pi",
    topicTitle: "挑战幂等",
  });
  ok("error" in manualConfirm, "手动入口共享 createChallenge 单活跃拦截");

  // 3) 来源读取纯函数:work 拒绝 / 全空报错 / 各截断 400 / 零写入
  ok(
    "error" in
      loop.extractLoopCardSources({
        category: "work",
        pdca: { plan: "有内容" },
        voiceNote: "x",
        reflection: "y",
      }),
    "work(钉钉)类别被拒",
  );
  ok(
    "error" in
      loop.extractLoopCardSources({
        category: "plan",
        pdca: { plan: "", do: "", check: "", act: "" },
        voiceNote: "   ",
        reflection: "",
      }),
    "pdca/voiceNote/reflection 全空报错",
  );
  const draftsBefore = loop.draftCards().length;
  const sources = loop.extractLoopCardSources({
    category: "plan",
    pdca: { plan: "P".repeat(300), do: "D".repeat(300) },
    voiceNote: "v".repeat(500),
    reflection: "r".repeat(500),
  });
  ok(!("error" in sources), "非空来源读取成功");
  ok(
    !("error" in sources) &&
      sources.pdca.length === loop.PI_SOURCE_TEXT_LIMIT &&
      sources.voiceNote.length === loop.PI_SOURCE_TEXT_LIMIT &&
      sources.reflection.length === loop.PI_SOURCE_TEXT_LIMIT,
    "非空字段各截断至 400 字",
    !("error" in sources)
      ? { pdca: sources.pdca.length, voice: sources.voiceNote.length, refl: sources.reflection.length }
      : sources,
  );
  ok(loop.draftCards().length === draftsBefore, "来源读取零写入");

  // 4) 草稿批量校验:截断为前 10 张;空 front/back 跳过计入 skipped,不中断
  const oversized = loop.normalizePiCardBatch(
    Array.from({ length: 13 }, (_, i) => ({ front: `F${i}`, back: `B${i}` })),
  );
  ok(
    oversized.cards.length === loop.PI_CARD_BATCH_LIMIT && oversized.truncated,
    "cards 超 10 张截断为前 10 张",
    { count: oversized.cards.length, truncated: oversized.truncated },
  );
  ok(oversized.cards[9].front === "F9", "截断保留的是前 10 张", oversized.cards[9]);
  const mixed = loop.normalizePiCardBatch([
    { front: "a", back: "b" },
    { front: "", back: "有背面" },
    { front: "有正面", back: "   " },
    { front: "c", back: "d" },
  ]);
  ok(
    mixed.cards.length === 2 && mixed.skipped === 2,
    "空 front/back 跳过且计入 skipped",
    mixed,
  );
  ok(
    mixed.cards[0]?.front === "a" && mixed.cards[1]?.front === "c",
    "跳过空卡不中断整批",
    mixed.cards,
  );

  // 5) 通知文案选择:缓存命中取缓存,未命中/为空回退静态模板
  ok(
    loop.LOOP_REMINDER_TITLE === "拾序 · 今日复习" &&
      loop.LOOP_REMINDER_BODY ===
        "复习队列已就绪,几分钟就能清空;边缘知识点优先。",
    "静态模板与 CalendarApp 既有文案逐字一致",
  );
  const hit = loop.pickLoopReminderCopy(
    { date: today, title: "定制标题", body: "定制正文" },
    today,
  );
  ok(hit.title === "定制标题" && hit.body === "定制正文", "缓存命中返回缓存文案", hit);
  ok(
    loop.pickLoopReminderCopy(null, today).title === loop.LOOP_REMINDER_TITLE,
    "未命中回退静态模板",
  );
  ok(
    loop.pickLoopReminderCopy({ date: "2000-01-01", title: "旧", body: "旧文案" }, today)
      .body === loop.LOOP_REMINDER_BODY,
    "过期缓存回退静态模板",
  );
  ok(
    loop.pickLoopReminderCopy({ date: today, title: "", body: "有正文" }, today)
      .title === loop.LOOP_REMINDER_TITLE,
    "缓存标题为空回退静态模板",
  );
  ok(
    loop.pickLoopReminderCopy({ date: today, title: "标题", body: "  " }, today)
      .body === loop.LOOP_REMINDER_BODY,
    "缓存正文为空回退静态模板",
  );

  // 6a) localStorage 旧数据缺 goalNote 字段:读取后为空串而非 undefined
  const memoryStorage = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memoryStorage.set(key, value);
    },
    removeItem: (key: string) => {
      memoryStorage.delete(key);
    },
  };
  const legacyStore = {
    challenges: [
      {
        id: "old-local-1",
        topicId: "t-old-local",
        topicTitle: "本地旧挑战",
        startDate: today,
        totalDays: 100,
        threshold: "one_event",
        thresholdMinutes: null,
        freezesLeft: 2,
        status: "active",
        settledOn: "",
        // 旧数据没有 goalNote 字段
      },
    ],
    checkins: [],
    points: [],
    cards: [],
    reviewLogs: [],
    teachbacks: [],
  };
  memoryStorage.set(
    "shixu-learning-loop-v1", // learningLoop 的 LOOP_KEY
    JSON.stringify(legacyStore),
  );
  await loop.initLoopStorage();
  const localOld = loop.challengesForTopic("t-old-local")[0];
  ok(
    !!localOld && localOld.goalNote === "",
    "localStorage 旧数据缺 goalNote 读为空串",
    localOld,
  );
  const localNew = loop.createChallenge({
    topicId: "t-local-new",
    topicTitle: "本地新挑战",
    goalNote: "本地目标",
  });
  ok(!("error" in localNew), "localStorage 路径创建带 goalNote 挑战");
  const persisted = JSON.parse(memoryStorage.get("shixu-learning-loop-v1") || "{}");
  ok(
    Array.isArray(persisted.challenges) &&
      persisted.challenges.some(
        (item: { goalNote?: string }) => item.goalNote === "本地目标",
      ),
    "goalNote 持久化进 localStorage",
  );
  // 通知文案缓存读写(challenge_reminder 同路径)
  const cachedCopy = loop.cacheLoopReminderCopy(
    loop.LOOP_REMINDER_TITLE,
    "今天把假设检验讲顺了,晚上见。",
  );
  ok(
    cachedCopy.date === today && cachedCopy.body === "今天把假设检验讲顺了,晚上见。",
    "缓存当日文案",
    cachedCopy,
  );
  ok(
    loop.loadLoopReminderCopy()?.body === "今天把假设检验讲顺了,晚上见。",
    "读回当日缓存文案",
  );
  ok(
    loop.pickLoopReminderCopy(loop.loadLoopReminderCopy(), today).body ===
      "今天把假设检验讲顺了,晚上见。",
    "sync 取当日缓存而非静态模板",
  );

  // 6b) SQLite 打桩路径:旧库缺 goal_note 列 → PRAGMA 探测 ALTER → 可正常读写
  native.enabled = true;
  await loop.initLoopStorage();
  const sqlDb = fakeDb();
  ok(!!sqlDb, "SQLite 桩已连接");
  const challengeTable = sqlDb?.tables.get("loop_challenge");
  ok(
    !!challengeTable && challengeTable.columns.includes("goal_note"),
    "旧库缺列被 ALTER 补上",
    challengeTable?.columns,
  );
  const sqlOld = loop.challengesForTopic("t-old-sqlite")[0];
  ok(
    !!sqlOld && sqlOld.goalNote === "",
    "SQLite 旧行 goalNote 读为空串",
    sqlOld,
  );
  const sqlNew = loop.createChallenge({
    topicId: "t-sql-new",
    topicTitle: "打桩新挑战",
    goalNote: "能教别人",
  });
  ok(!("error" in sqlNew), "SQLite 路径创建带 goalNote 挑战");
  await new Promise((resolve) => setTimeout(resolve, 0)); // 等异步 saveSqlite 完成
  await loop.initLoopStorage(); // 重开连接重读
  const reloaded = loop.challengesForTopic("t-sql-new")[0];
  ok(
    reloaded?.goalNote === "能教别人",
    "SQLite 缺列 ALTER 后可正常读写 goal_note",
    reloaded,
  );
  ok(
    loop.challengesForTopic("t-old-sqlite")[0]?.goalNote === "",
    "重读后旧行 goalNote 仍为空串",
  );
}

// ══ FSD §14 Issue #16:启动零摩擦纯逻辑 ══
async function zeroFrictionTests() {
  // 1) microStepOf:首句截断 / 无句读长句 ≤40 / 空串
  ok(
    loop.microStepOf("读第 3 章。做完课后习题") === "读第 3 章",
    "microStepOf 取首句",
    loop.microStepOf("读第 3 章。做完课后习题"),
  );
  const longStep = "这是一个没有任何句读特别长的下一步描述需要被截断到四十个字以内".repeat(2);
  const longMicro = loop.microStepOf(longStep);
  ok(
    longMicro.length === 40 && longMicro === longStep.slice(0, 40),
    "无句读长句截断至 40 字",
    longMicro.length,
  );
  ok(
    loop.microStepOf("") === "" && loop.microStepOf("   ") === "",
    "空串 microStepOf → 空串",
  );

  // 2) resolveNextAction 优先级
  const t = "t-f10";
  const f10card = loop.createCard({
    topicId: t,
    pointId: null,
    sourceType: "manual",
    sourceId: `manual:${today}`,
    sourceTitle: "F10",
    front: "零摩擦卡",
    back: "答案",
    active: true,
  });
  ok(!("error" in f10card), "#16 建到期卡(active,due=今日)");
  const f10cardR = f10card as Exclude<typeof f10card, { error: string }>;
  const dueAction = loop.resolveNextAction(t, {
    nextStep: "读第 3 章",
    lastGap: null,
  });
  ok(
    dueAction?.source === "review",
    "存在到期卡时 review 优先(即使有 nextStep)",
    dueAction,
  );
  ok(
    dueAction?.source === "review" &&
      dueAction.cardId === loop.buildDailyQueue(t)[0]?.card.id,
    "review 的 cardId 等于 buildDailyQueue 首张",
    dueAction,
  );
  loop.archiveCard(f10cardR.id);
  const microAction = loop.resolveNextAction(t, {
    nextStep: "读第 3 章。做完课后习题",
    lastGap: { level: "lost", gaps: "讲不出来" },
  });
  ok(
    microAction?.source === "micro" && microAction.micro === "读第 3 章",
    "无到期卡且 nextStep 非空 → micro(微版取首句)",
    microAction,
  );
  const reteachAction = loop.resolveNextAction(t, {
    nextStep: "",
    lastGap: { level: "shaky", gaps: "没讲清 p 值" },
  });
  ok(
    reteachAction?.source === "reteach",
    "nextStep 为空 + 教回差距 → reteach",
    reteachAction,
  );
  ok(
    loop.resolveNextAction(t, { nextStep: "", lastGap: null }) === null,
    "三者皆无 → null",
  );

  // 3) 第三档边界:level='solid' 或 gaps 为空不产生 re-teach
  ok(
    loop.resolveNextAction(t, {
      nextStep: "",
      lastGap: { level: "solid", gaps: "有差距但已讲清" },
    }) === null,
    "lastGap.level='solid' 不产生 reteach",
  );
  ok(
    loop.resolveNextAction(t, {
      nextStep: "",
      lastGap: { level: "shaky", gaps: "   " },
    }) === null,
    "gaps 为空不产生 reteach",
  );

  // 4) 微版完成幂等依赖:当日已有 kind='event' 打卡行时,结束流程调 lightCheckin 被拒且不落第二行
  const f10ch = loop.createChallenge({ topicId: t, topicTitle: "零摩擦挑战" });
  ok(!("error" in f10ch), "#16 创建挑战(默认今日起始)");
  const f10chr = f10ch as Exclude<typeof f10ch, { error: string }>;
  loop.recordEventDone(t, today, "e-f10");
  ok(
    loop.challengeProgress(f10chr).doneCount === 1,
    "前置:事件完成已落 kind='event' 打卡",
  );
  const rejected = loop.lightCheckin(f10chr.id);
  ok(
    rejected === "今天已有打卡记录",
    "当日已有 event 打卡时 lightCheckin 被拒",
    rejected,
  );
  ok(
    loop.challengeProgress(f10chr).doneCount === 1 &&
      loop.challengeProgress(f10chr).freezeCount === 0,
    "被拒后不落第二行(轻打卡也不产生)",
  );
}

// ══ FSD §13 Issue #9:费曼教回纯逻辑 ══
async function teachbackTests() {
  const t = "t-teach";
  const pa = loop.addKnowledgePoint({ topicId: t, name: "p 值的含义" });
  const pb = loop.addKnowledgePoint({ topicId: t, name: "置信区间" });
  ok(!("error" in pa) && !("error" in pb), "#9 建两个知识点");
  const paR = pa as Exclude<typeof pa, { error: string }>;
  const pbR = pb as Exclude<typeof pb, { error: string }>;

  // 1) 名称精确匹配 → pointId;不存在的名进 unknown 且不产生应用条目
  const resolved = loop.resolveTeachbackResults(t, [
    { point: "p 值的含义", covered: true, quote: "p 值就是…" },
    { point: "不存在的知识点", covered: true, quote: "引文" },
  ]);
  ok(
    resolved.results.length === 1 &&
      resolved.results[0]?.pointId === paR.id &&
      resolved.results[0]?.covered === true,
    "知识点名精确匹配解析为 pointId",
    resolved,
  );
  ok(
    resolved.unknown.length === 1 && resolved.unknown[0] === "不存在的知识点",
    "主题内不存在的名进 unknown 且不产生应用条目",
    resolved.unknown,
  );

  // 2) covered 空引文归一化 / quote trim 后截 120 / 重复点名保留首条
  const longQuote = "很长的引文".repeat(40); // 200 字
  const normalized = loop.resolveTeachbackResults(t, [
    { point: "p 值的含义", covered: true, quote: "   " },
    { point: "置信区间", covered: true, quote: `  ${longQuote}  ` },
    { point: "p 值的含义", covered: false, quote: "重复条目应被丢弃" },
  ]);
  ok(normalized.results.length === 2, "同一知识点重复出现只保留首条", normalized);
  const firstItem = normalized.results[0];
  const secondItem = normalized.results[1];
  ok(
    !!firstItem && firstItem.covered === false && firstItem.quote === "",
    "covered 但引文为空白 → 按未覆盖处理",
    firstItem,
  );
  ok(
    !!secondItem &&
      secondItem.covered === true &&
      secondItem.quote === longQuote.slice(0, 120),
    "quote 先 trim 再截 120 字",
    secondItem?.quote.length,
  );

  // 3) 归一化结果经 applyTeachback:covered 推进,遗漏项 mastery/lastEvidenceAt 不变
  const missingBefore = {
    mastery: loop.pointById(pbR.id)!.mastery,
    lastEvidenceAt: loop.pointById(pbR.id)!.lastEvidenceAt,
  };
  const draft = loop.resolveTeachbackResults(t, [
    { point: "p 值的含义", covered: true, quote: "p 值越小越有理由拒绝原假设" },
    { point: "置信区间", covered: false, quote: "" },
  ]);
  const rowsBefore = loop.teachbacksForTopic(t).length;
  loop.applyTeachback(
    t,
    "voice:test-1",
    draft.results.map((item) => ({ ...item })),
  );
  ok(loop.pointById(paR.id)!.mastery > 0, "covered 项经 applyTeachback 推进 mastery");
  const pbAfter = loop.pointById(pbR.id)!;
  ok(
    pbAfter.mastery === missingBefore.mastery &&
      pbAfter.lastEvidenceAt === missingBefore.lastEvidenceAt,
    "遗漏项 mastery 与 lastEvidenceAt 前后相等(不自动降级)",
    { before: missingBefore, after: { mastery: pbAfter.mastery, lastEvidenceAt: pbAfter.lastEvidenceAt } },
  );
  const rows = loop.teachbacksForTopic(t);
  ok(rows.length === rowsBefore + 1, "loop_teachback 恰增 1 行", rows.length);
  ok(
    rows[rows.length - 1]?.result.length === draft.results.length &&
      JSON.stringify(rows[rows.length - 1]?.result) ===
        JSON.stringify(draft.results),
    "result 回读与入参 results 全量一致",
  );

  // 4) applyPointEvidence(pointId,false) 数值锁定(防 BKT 参数漂移)
  const pc = loop.addKnowledgePoint({ topicId: t, name: "标准差" });
  const pd = loop.addKnowledgePoint({ topicId: t, name: "抽样偏差" });
  ok(!("error" in pc) && !("error" in pd), "#9 建数值锁定用知识点");
  const pcR = pc as Exclude<typeof pc, { error: string }>;
  const pdR = pd as Exclude<typeof pd, { error: string }>;
  const pcPoint = loop.pointById(pcR.id)!;
  pcPoint.mastery = 0.85;
  pcPoint.status = "mastered";
  loop.applyPointEvidence(pcR.id, false);
  ok(
    Math.abs(pcPoint.mastery - 0.5024) < 0.001 && pcPoint.status === "shaky",
    "mastery=0.85 一次 forgot → ≈0.5024 → shaky",
    { mastery: pcPoint.mastery, status: pcPoint.status },
  );
  const pdPoint = loop.pointById(pdR.id)!;
  pdPoint.mastery = 0.99;
  pdPoint.status = "mastered";
  loop.applyPointEvidence(pdR.id, false);
  ok(
    Math.abs(pdPoint.mastery - 0.9364) < 0.001 && pdPoint.status === "mastered",
    "mastery=0.99 一次 forgot → ≈0.9364 仍 mastered",
    { mastery: pdPoint.mastery, status: pdPoint.status },
  );
  loop.applyPointEvidence(pdR.id, false);
  ok(
    Math.abs(pdPoint.mastery - 0.7008) < 0.001 && pdPoint.status === "shaky",
    "mastery=0.99 两次 forgot → ≈0.7008 → shaky",
    { mastery: pdPoint.mastery, status: pdPoint.status },
  );

  // 5) 空清单主题(全部条目 unknown):results 空、仍可写 1 行全遗漏记录
  const emptyResolved = loop.resolveTeachbackResults(t, [
    { point: "不存在甲", covered: true, quote: "x" },
    { point: "不存在乙", covered: false, quote: "" },
  ]);
  ok(
    emptyResolved.results.length === 0 && emptyResolved.unknown.length === 2,
    "全部条目未知 → results 空数组、全进 unknown",
    emptyResolved,
  );
  const rowsBeforeEmpty = loop.teachbacksForTopic(t).length;
  loop.applyTeachback(t, "voice:test-empty", emptyResolved.results);
  ok(
    loop.teachbacksForTopic(t).length === rowsBeforeEmpty + 1,
    "全遗漏记录仍写入 1 行 loop_teachback",
  );
}

void (async () => {
  try {
    await piToolTests();
    await zeroFrictionTests();
    await teachbackTests();
  } catch (error) {
    fail += 1;
    console.log("  FAIL Pi 工具用例异常", error);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
