// 学习闭环纯逻辑冒烟测试(esbuild 打桩 @capacitor/* 后在 Node 运行)
// 覆盖 FSD P0 验收清单中的规则部分:幂等结算、冻结、补签、SM-2、BKT 四态、队列截断
import * as loop from "../src/learningLoop";

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
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
