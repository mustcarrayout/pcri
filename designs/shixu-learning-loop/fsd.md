# 拾序 · 学习闭环 FSD(功能规格说明书)

| | |
| --- | --- |
| 版本 | v0.1(草案,待评审) |
| 日期 | 2026-11-03 |
| 关联文档 | [prd.md](./prd.md)(需求) · [design-draft.md](./design-draft.md)(设计推演) |

本文给出可实现的精确规格:概念模型、数据模型、状态机、算法与交互流程。UI 呈现待 C 系统 12 屏设计稿对齐。

## 1. 术语与概念模型

```
学习主题(topic)── 日历事件(event,含 PDCA/转录/反思,本体,只读)
      │
      ├── 挑战(challenge)── 打卡记录(challenge_checkin)
      ├── 知识点(knowledge_point)──[掌握地图]
      │       ↑ 挂接
      └── 复习卡(review_card)── 复习日志(review_log)
```

- **事件(event)**:既有的日历事件,是唯一记录本体;挑战、卡片、知识点均不修改事件。
- **知识点(point)**:掌握地图的节点,由 Pi 拆解、用户可编辑;证据来自复习日志与教回。
- **挑战日**:挑战周期内的一个自然日(本地时区);状态为 `done | freeze | miss` 之一,`miss` 不落表(缺席即无记录)。

## 2. 数据模型(SQLite,Android 真身;浏览器降级用 localStorage 模拟)

```sql
-- As-built:与 src/learningLoop.ts 的 SCHEMA 常量逐字对齐(loop_ 前缀避免与事件表混淆)
CREATE TABLE IF NOT EXISTS loop_challenge (
  id TEXT PRIMARY KEY NOT NULL, topic_id TEXT NOT NULL, topic_title TEXT NOT NULL,
  start_date TEXT NOT NULL, total_days INTEGER NOT NULL,
  threshold TEXT NOT NULL, threshold_minutes INTEGER,
  freezes_left INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'active', settled_on TEXT NOT NULL DEFAULT ''
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
```

- `loop_challenge.settled_on`:daily_settle 的幂等标记(已结算到的"结算执行日"),见 §3.3 与 §12-1。
- `loop_checkin` 无 created_at:归属日即业务时间,补签由 `date` 字段表达。
- 索引:P0 不建显式索引——个人规模数据整表加载进内存、规则在应用层计算;数据量上来后再补。

## 3. 百日挑战规格

### 3.1 状态机

```
active ──连漏 2 miss──▶ paused ──用户确认继续──▶ active
   │  ▲                     └──用户放弃──▶ abandoned
   │  └────补签(仅未暂停时)────
   └──到达 end_date──▶ finished(附达成标记:全程无未覆盖 miss)
active/paused ──用户手动──▶ abandoned
```

### 3.2 创建流程

1. 用户在主题详情页发起(对话式或表单);参数:主题(必选)、天数(默认 100)、门槛(默认 `one_event`)。
2. Pi 起草目标笔记(PDCA 格式),用户确认后作为 `note_id` 存档。
3. 同一主题已有 `active/paused` 挑战时,拒绝重复创建(P0 默认单活跃)。

### 3.3 每日结算 `daily_settle`(幂等,每次打开 App 或通知触发时执行一次)

对每个 `active` 挑战,检查**昨日**(本地自然日):

```
已有 checkin 行(前一天实时落表)        → done,无事
无行 且 freezes_left > 0                → 落 kind='freeze' 行,
                                          freezes_left -= 1,发"冻结保护"通知
无行 且 freezes_left = 0                → miss(不落表),miss_streak += 1
miss_streak ≥ 2                         → status='paused',发红线询问通知
```

- `done` 的实时判定(打开 App 当天即可触发):当日该主题存在 ≥1 个**已完成**事件(category ∈ {interests, plan})→ 落 `kind='event'`;`minutes` 模式按当日该主题完成事件累计时长 ≥ `threshold_minutes` 判定。
- **轻打卡**:用户手动,`kind='light'`,可附一句 PDCA 或语音转录;与自动打卡同表互斥(UNIQUE 约束)。
- **补签**:仅对昨日、24h 内、每天限 1 次;将昨日 `miss` 补为 `light`(`date`=昨日)。若昨日已被 `freeze` 覆盖则拒绝补签(冻结优先,不重复消耗)。
- **里程碑**:连续 `done`(含 `freeze`)天数达到 3/7/21/50/100 时展示徽标;`freeze` 保持连续但当日不计入 `done` 计数。

### 3.4 通知触发(挑战侧)

| 通知 | 条件 | 时段 |
| --- | --- | --- |
| 挑战提醒 | 当日门槛未满足 | 用户设定(默认 21:30) |
| 冻结保护告知 | 结算消耗了冻结卡 | 结算完成时 |
| 红线询问 | 进入 `paused` | 结算完成时 |

## 4. 复习队列规格

### 4.1 卡片生命周期

```
draft ──用户确认──▶ active ──用户暂停──▶ suspended ──恢复──▶ active
                      └──用户归档──▶ archived(保留可溯源,不再入队)
```

`draft_cards` 产物一律 `draft`,逐张确认后转 `active`。

### 4.2 调度算法(简化 SM-2,三档)

| 自评 | 等效 q | interval | ease(EF) |
| --- | --- | --- | --- |
| 忘 | 0 | 重置为 1 天 | EF − 0.2 |
| 模糊 | 3 | 按正确晋升 | EF − 0.14 |
| 记得 | 5 | 按正确晋升 | EF + 0.1 |

正确晋升序列:首次 1 天 → 第 2 次 6 天 → 之后 `round(interval × EF)`。EF 初始 2.5,下限 1.3,上限 3.0。每次复习写 `review_log`;`due_date = 今日 + interval`。

### 4.3 每日队列构建

1. 候选:`status='active' 且 due_date ≤ 今日`。
2. 排序:① 挂接知识点 `status='shaky'` 优先 → ② 逾期天数降序 → ③ EF 低优先。
3. 截断:上限 20 张;新卡(`interval_days=0`)每日入队 ≤10 张。
4. 队列为空时展示"今日已清空"完成态(有限容器,可收尾)。

### 4.4 复习交互

出示 `front` → 用户回忆 → 翻面看 `back` → 三档自评 → 下一张;全程离线。卡片详情可跳转 `source_id` 查看原文(可溯源)。

## 5. 掌握地图规格

### 5.1 知识点四态(精确条件)

| 状态 | 进入条件 |
| --- | --- |
| `dark` | 初始;无任何证据 |
| `touched` | 挂接了事件/卡片,或首次教回覆盖;或 `mastery > 0 且 < 0.5` |
| `shaky` | `0.5 ≤ mastery < 0.85`;或挂接卡最近连续 2 次 `grade='forgot'` |
| `mastered` | `mastery ≥ 0.85` 且挂接卡最近一次 `grade='recall'` 且 `interval_days ≥ 7` |

退出:`mastered` 后其卡连续 2 次 `forgot` → 降为 `shaky`。状态变更只由上述规则驱动,Pi 仅建议。

### 5.2 BKT 简化更新(知识点掌握概率)

默认参数:`P0=0.1, learn=0.15, guess=0.2, slip=0.1`(可在主题级覆盖,上线后调参)。

```
证据 correct(fuzzy 或 recall):
  P posterior = P·(1−slip) / (P·(1−slip) + (1−P)·guess)
  P ← posterior + (1−posterior)·learn
证据 forgot:
  P posterior = P·slip / (P·slip + (1−P)·(1−guess))
  P ← posterior + (1−posterior)·learn
```

无挂接卡的知识点仅由教回覆盖驱动(`covered` 视作一次 `correct`)。

### 5.3 掌握百分比与呈现

- 掌握百分比 = `(shaky + mastered 数) / 知识点总数`(只数边缘以上,防止"接触过"计入)。
- 亮区 = mastered;边缘 = shaky(呼吸高亮);暗区 = dark/touched(只渲染轮廓、不渲染内容、无倒计时)。
- 边缘优先供卡:见 4.3 排序 ①。

### 5.4 费曼教回流程

1. 用户在主题详情页选择"教回"(目标 ≤2 分钟语音)。
2. 语音识别转文字(原生 Capacitor speech recognition;浏览器降级)。
3. Pi `assess_teachback`:输入 = 转录文本 + 该主题知识点清单;输出 = `[{point_id, covered, quote}]` 及一句总评。
4. 呈现"覆盖了哪些(引原话为证)/ 漏了哪些";`covered` 项触发 5.2 的 correct 更新;遗漏项**不自动降级**,生成"标摇建议"由用户确认应用。
5. 全过程落 `teachback_log`。

## 6. Pi 工具规格(建议制:输出一律为草稿/建议,用户确认才生效)

| 工具 | 触发 | 输入 | 输出 | 写库(确认后) |
| --- | --- | --- | --- | --- |
| `create_challenge` | 对话 | topic, days, threshold | 目标笔记草稿 | challenge、目标 PDCA |
| `draft_cards` | 对话/事件页 | topic_id 或 event_id | 卡片草稿数组 | review_card(draft→active) |
| `challenge_reminder` | 通知前 | 当日状态摘要 | 通知文案 | 无 |
| `challenge_review` | 手动/周期 | 挑战 id | 复盘草稿 | 可存为目标笔记附件 |
| `challenge_pause/resume` | 红线后 | 挑战 id | 继续/重排建议 | challenge.status |
| `assess_teachback` | 教回后 | transcript, topic_id | 覆盖/遗漏清单 | teachback_log、knowledge_point.mastery |
| `frontier_report` | 周/手动 | topic_id, 周期 | 边界报告草稿 | 可存为主题笔记 |

离线降级:Pi 不可用时,通知走固定模板;教回、拆解、复盘入口隐藏并提示"需要 AI 服务"。

### 6.1 Issue #8:Pi 三工具接入(create_challenge / draft_cards / challenge_reminder)

§6 表前三行的对话流落地,一律建议制:工具只产草稿与文案,用户确认才生效。

- **create_challenge**:先以 `activeChallengeForTopic` 预检单活跃冲突,再向会话回填确认卡(新增 `ChallengeSuggestion`:topicId/topicTitle/days/threshold/goalNote 草稿,挂 `ChatMessage.challengeDraft` 可选字段)。用户点确认才调 `createChallenge`(learningLoop.ts:369)落库,目标笔记存 `loop_challenge` 新列 `goal_note`(同步 `Challenge.goalNote`;旧库 PRAGMA 缺列即 ALTER,localStorage 读补空串)。不建日历事件、不写事件 PDCA。
- **draft_cards**:两段式同名单工具——首调仅 event_title,返回截断来源文本(pdca/voiceNote/reflection,各≤400 字);复调带 cards[](≤10 张)逐张走 `createCard`(learningLoop.ts:719)落 draft。`category='work'`(钉钉)拒绝,同 §12-2 排除规则;草稿进掌握地图「Pi 起草的卡片」面板,收下/丢弃复用 `confirmCard`/`discardDraft`;主题卡加待确认徽标(接线未用的 `pendingDraftCount`)。事件页入口=注入固定请求语走 `runPiAgent`。
- **challenge_reminder**:入参当日摘要,输出 `{title, body}`,不写库;文案本地缓存,`syncLoopNotifications`(CalendarApp.vue:1979)优先取缓存,缺失或 Pi 不可用退回现有静态模板(1995);不改时段、条数与 9200 段 ID。

边界:不做 assess_teachback / frontier_report / challenge_review、提醒时段配置;卡片草稿永不由工具直接激活;不修改日历事件本体;模型密钥不经任何工具触达。

## 7. 通知规格(汇总)

- As-built(P0):单条复习提醒,每日 21:00(通知 ID 9200 段,与定时服务 9100 段隔离),仅当存在活跃挑战或激活卡时安排;冻结告知与红线暂停以 App 内 Pi 消息即时呈现(不额外占通知额度)。
- 规划(可迭代到 ≤2 条):挑战提醒 21:30 与复习提醒按 due/门槛状态择一;时段用户可配;红线询问升级为系统通知。见 issue「P1 通知择一与时段配置」。

## 8. 分享卡片(P1)

- 内容:挑战名/主题名、第 N 天、一句话 PDCA(用户自选)、年视图热力图切片、里程碑徽标。
- 本地渲染为图片导出,无网络请求、无水印服务;不含掌握度数据(避免分数外泄与攀比)。

## 9. 隐私与安全

- 模型凭据仅存 Android Keystore 安全存储,不落 SQLite、不进日志(AGENTS.md 约束)。
- 转录、教回文本仅存本地库;分享卡片内容完全由用户选择。
- 学习闭环数据不参与任何统计上报。

## 10. 浏览器降级(开发预览)

SQLite → localStorage 模拟;本地通知 → 不发(控制台提示);语音识别 → 浏览器 SpeechRecognition;Pi → 依赖所配置运行时,不可用时按第 6 节降级。

## 11. P0 验收清单

1. 离线状态下完成:创建挑战 → 当日自动打卡 → 次日冻结保护 → 连漏暂停 → 补签恢复 → 到期完成,全流程无网络。
2. 复习一轮后:卡片 due 按 SM-2 后移;忘掉不清零只重排;队列 20 张上限生效;"队列清空"呈现完成态。
3. 知识点四态仅凭复习/教回数据自动流转;掌握百分比不含 dark/touched。
4. 通知每日 ≤2 条、22:30 后不触发、时段可配。
5. 任何闭环写入不修改日历事件本体;钉钉 `work` 事件不参与判定。
6. `daily_settle` 幂等:同一天重复执行不产生重复行或重复通知。

## 12. As-built 实现差异记录(P0)

实现以 `src/learningLoop.ts` + `CalendarApp.vue` 为准(commit 651dad5 起),与上文规格的差异:

1. **结算幂等标记落库**(§3.3):`challenge.settled_on` 字段记录"当天已结算",跨多天未打开 App 时只结算昨日一天(简化;连续多天缺席的累积判定由红线回数循环覆盖)。
2. **实时打卡匹配规则**(§3.3):以「事件标题包含主题名 / 标签等于主题名或 goalTag」判定关联,且显式排除 `work` 类别(钉钉事件不参与);`minutes` 门槛模式模块已支持、UI 未暴露,默认 `one_event`。
3. **通知策略**(§7):P0 为单条静态复习提醒 21:00;"择一触发"与时段配置延后。
4. **Pi 工具**(§6/§6.1,#8;§13,#9):`create_challenge` / `draft_cards` / `challenge_reminder` / `assess_teachback` 已接入对话流(建议制:确认卡、掌握地图收下、文案缓存、教回草稿应用门);`frontier_report`、`challenge_review` 等仍未接入,提醒时段配置延后。
5. **里程碑徽标**(§3.3):连续天数已在数据层可算(`challengeStreak`),徽标 UI 与 finished 达成标记呈现待补。
6. **smoke 测试**:`npm run test:loop`(esbuild 打桩电容模块)126 项断言覆盖 §11 全部规则类验收、§6.1 三工具纯逻辑(含 `goal_note` 迁移的 localStorage 与 SQLite 打桩路径)、§13 教回纯逻辑(BKT forgot 数值锁定)、§14 启动零摩擦纯逻辑与 §15 反馈即引导纯逻辑。
7. **启动零摩擦**(#16,§14):「再讲」微动作与微版起步同样建 `微版` 标签事件走统一结束流(规格未指明其点击行为,取同流最小实现);计时为单一内存槽,进行中点击其他主题 chip 忽略;空 `nextStep` 主题由条上兜底「拆第一周的任务」保证每非搁置主题恰好一枚 chip;浏览器演示路径读补 `micro` 空串;微版事件完成由结束流程显式 `recordApplication`、经既有 `topicTaskStats` 计入任务统计(「用过」证据,§14 决策记录已接受)。

## 13. 费曼教回实现增补(P1,#9,落实 §5.4 与 §6)

**流程与复用点**

1. 主题卡操作区加「教回」按钮(`.topic-actions`,CalendarApp.vue:3309),复用 `transcribe()`(CalendarApp.vue:865)语音转录;转录文本连同该主题知识点清单(名+层级)作为用户消息走既有 `askPi` 通道;主题无知识点时仅提示先拆边界,不调模型。
2. `PI_TOOLS` 注册 `assess_teachback(topic, results[{point,covered,quote}], summary)`;`executeTool` 新分支只校验、**不写库**:新增纯函数 `resolveTeachbackResults(topicId, raw)` 按主题内 UNIQUE 的知识点名(learningLoop.ts:142)解析 pointId,剔除未知名;covered 须带非空引文,否则按未覆盖处理。
3. 评估草稿挂到回复消息(复用 suggestions 累加器与消息内按钮模式,CalendarApp.vue:101、2407、2433):覆盖项引原话呈现;「应用本次教回」→ 复用 `applyTeachback`(learningLoop.ts:683,covered 项走 `applyPointEvidence(pointId,true)`,全量 results 落 `loop_teachback`,`transcript_id` 用 `voice:<ISO>` 合成值);遗漏项呈「标摇」按钮,确认后逐条 `applyPointEvidence(pointId,false)`,状态由 §5.1 规则重算,之后 `bumpLoop()` 刷新。应用前 mastery 与 `loop_teachback` 均不变。

**边界(不做)**:遗漏项绝不自动降级;不存音频、转录全文不落库(只留引文);不改日历事件本体、不写学习档案(LearningCheck)与事件 PDCA、不自动轻打卡;模型不可用或输出不可解析时零写库;「讲一次」(save_feynman_result 通路)并存,两路数据不交叉。

## 14. 启动零摩擦(F10,issue #16)

每个非搁置主题任意时刻恰好一个「现在就做」,来源优先级:到期复习卡 > nextStep 的 2 分钟微版 > 教回差距微动作;一次点击开始并计时。

**数据**:`calendar_events` 增列 `micro TEXT NOT NULL DEFAULT ''`,走既有 ALTER 迁移循环(CalendarApp.vue:656),`CalendarEvent` 增 `micro` 字段,承载 plan_goal 每任务的 2 分钟微版;计时态仅存内存不落库。

**UI**:学习视图顶部 loop-bar(CalendarApp.vue:3248)扩为常驻条,每主题一枚 chip;新增纯函数 `resolveNextAction(topicId,{nextStep,lastGap})` 与 `microStepOf(nextStep)`(首句截断 ≤40 字)落 learningLoop.ts。①有到期卡→进既有 openReview()(CalendarApp.vue:1939),不建事件不计时;②否则按微版建 category='plan'、tags=[主题名,「微版」] 的事件并计时;③learningLog 最近一条 level≠solid 且 gaps 非空→「2 分钟再讲」。事件详情展示 micro 与「先做 2 分钟」入口。结束:事件置 done→当日无打卡则 lightCheckin(kind='light',learningLoop.ts:443)→复用 openPdca(event,"do")(CalendarApp.vue:2500)定位 Do 段,提示 15 秒语音(recordPdcaVoice,CalendarApp.vue:2551)。

**Pi 提示词**:系统提示(CalendarApp.vue:1228)与 create_topic 描述(CalendarApp.vue:1307)改为「最多问一个问题,且必须同时给出第一次动手任务」;create_topic schema 补声明 next_step(处理函数 CalendarApp.vue:2204 已支持);plan_goal 每任务增可选 micro(CalendarApp.vue:1413);创建成功 note(CalendarApp.vue:2213)改为告知动手任务已就绪。

**边界**:计时状态不持久化、无后台提醒;复习入口不加计时与打卡联动(归 #12/#17);教回差距的加卡/排任务归 #17;手动表单不暴露 micro;work/钉钉事件不入来源。

## 15. 反馈即引导(四个反馈时刻,F11 · #17,依赖 #9;P1)

出处:prd F11、design-draft §6.2/6.3。四时刻全部落在既有函数/组件上,零新弹窗、零新通知额度。

1. **复习自评后**(`gradeCurrent`):忘→卡下追加 source 原文一句(按 `sourceId` 回查事件 PDCA/转录/反思;manual 卡退化为 `back` 首句)+ Pi 一句话回忆线索(Pi 不可用走同模板,不阻塞翻卡);记得→显示间隔延长值(`card.intervalDays`,如"6 天后见")。清空态在现"本次完成 N 张"上补三档分布与"明天见",数据用新增纯函数 `todayReviewStats()`。
2. **教回后**(依赖 #9 产出 assess 清单):每条差距 = 知识点名 + 引用原话陈述(`TeachbackResult.quote`,取 covered=false 条目,现类型已支持),每条配动作按钮:加一张卡(`createCard` 落 draft,走既有草稿确认)/安排 15 分钟任务/三天后再讲(后两者复用聊天建议制 `suggestions`+`saveSuggestion` 落事件,完成后经 `recordLoopCheckin` 计入挑战)。呈现不含任何分数。
3. **结算/里程碑**:红线消息(`runDailySettle`)附降门槛选项文案与"继续"(复用 `resumeChallenge` 与 paused 徽标按钮);里程碑按 `challengeStreak` 跨 3/7/21/50/100 以一行证据变化呈现(纯函数 `milestoneHit(prev,next)`),不庆祝。
4. **地图变化**:`applyPointEvidence` 改为返回 `{from,to}` 迁移(现 void),迁移发生在复习时于弹窗内一行轻提示,不新增弹窗/通知。

反反馈铁律(全部时刻):无人格表扬、无红点倒计时、不弹窗打断、分数只对用户可见且永远与下一步动作同现。

边界(不做):不新增表与通知;降门槛数据字段不做(依赖 #12);教回流程与 Pi assess 接入归 #9;知识点状态仍只由规则驱动,Pi 不自动改库。
