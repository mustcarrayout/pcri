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
-- 挑战定义
CREATE TABLE challenge (
  id           TEXT PRIMARY KEY,
  topic_id     TEXT NOT NULL,        -- 绑定学习主题(单主题)
  start_date   TEXT NOT NULL,        -- YYYY-MM-DD,本地时区
  total_days   INTEGER NOT NULL,     -- 默认 100,可选 21/30/66/100
  threshold    TEXT NOT NULL,        -- 'one_event' | 'minutes'
  threshold_minutes INTEGER,         -- threshold='minutes' 时生效
  freezes_left INTEGER NOT NULL DEFAULT 2,
  status       TEXT NOT NULL DEFAULT 'active',
               -- active | paused | finished | abandoned
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- 打卡记录(显式落表;miss 不落表)
CREATE TABLE challenge_checkin (
  id           TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES challenge(id),
  date         TEXT NOT NULL,        -- 归属挑战日(补签时 ≠ created 日期)
  kind         TEXT NOT NULL,        -- 'event' | 'light' | 'freeze'
  event_id     TEXT,                 -- kind='event' 时关联
  note_id      TEXT,                 -- 轻打卡的 PDCA/转录引用
  created_at   TEXT NOT NULL,
  UNIQUE(challenge_id, date)         -- 每挑战日最多一条
);

-- 知识点(掌握地图节点)
CREATE TABLE knowledge_point (
  id           TEXT PRIMARY KEY,
  topic_id     TEXT NOT NULL,
  name         TEXT NOT NULL,
  bloom_level  TEXT NOT NULL,        -- 'recall' | 'explain' | 'apply' | 'create'
  mastery      REAL NOT NULL DEFAULT 0,       -- BKT 掌握概率
  status       TEXT NOT NULL DEFAULT 'dark',  -- dark | touched | shaky | mastered
  last_evidence_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(topic_id, name)
);

-- 复习卡
CREATE TABLE review_card (
  id           TEXT PRIMARY KEY,
  topic_id     TEXT NOT NULL,
  point_id     TEXT REFERENCES knowledge_point(id),  -- 手动建卡可为空
  source_type  TEXT NOT NULL,        -- 'pdca' | 'transcript' | 'reflection' | 'manual'
  source_id    TEXT NOT NULL,        -- 锚定的事件笔记/转录,保证可溯源
  front        TEXT NOT NULL,
  back         TEXT NOT NULL,
  ease         REAL NOT NULL DEFAULT 2.5,     -- SM-2 EF,范围 [1.3, 3.0]
  interval_days REAL NOT NULL DEFAULT 0,
  due_date     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
               -- draft | active | suspended | archived
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- 复习日志
CREATE TABLE review_log (
  id           TEXT PRIMARY KEY,
  card_id      TEXT NOT NULL REFERENCES review_card(id),
  reviewed_at  TEXT NOT NULL,
  grade        TEXT NOT NULL         -- 'forgot' | 'fuzzy' | 'recall'
);

-- 教回评估结果
CREATE TABLE teachback_log (
  id           TEXT PRIMARY KEY,
  topic_id     TEXT NOT NULL,
  transcript_id TEXT NOT NULL,       -- 语音转录引用
  result_json  TEXT NOT NULL,        -- [{point_id, covered, quote}]
  created_at   TEXT NOT NULL
);
```

索引:`challenge(topic_id, status)`、`review_card(due_date, status)`、`review_log(card_id, reviewed_at)`。

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

## 7. 通知规格(汇总)

- 每日 ≤2 条;22:30 后不推送;时段用户可配。
- 优先级:红线询问 > 冻结告知 > 挑战提醒 / 复习提醒(当日只发一条复习或挑战提醒,按 due 与门槛状态择一)。

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
