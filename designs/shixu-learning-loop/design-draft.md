# 拾序 · 学习闭环(挑战 + 复习 + 掌握边界)设计草案

> 参考来源:
> - [#100DaysOfCode](https://www.100daysofcode.com) 的挑战机制 → 解决"坚持"
> - [Anki](https://docs.ankiweb.net/manual/background) 的间隔重复 → 解决"不忘"
> - [Khan Academy](https://support.khanacademy.org/hc/en-us/articles/5548760867853--How-do-Khan-Academy-s-Mastery-levels-work) 的掌握地图 → 解决"学到哪了、还差哪"
>
> 三者组合成完整闭环:**承诺机制驱动投入,复习机制守住成果,掌握地图让成果可见其边界**。
>
> **核心命题:有边界才有学习的动力。** 无边无界、无穷无尽的东西没法学——学习必须被装进有限的容器:挑战是**时间容器**(100 天一定会结束),复习队列是**数量容器**(今天 N 张,做得完),掌握地图是**空间容器**(主题边界可见,知道"学会"长什么样)。终身学习在元层面无限,但拾序保证每一个交互单元都是有限、可完成的——每次打开都有"收尾"的体验。([目标梯度效应:越接近终点动力越强,前提是终点看得见](https://www.ux-strategy.ch/en/effects/goal-gradient.html))
> 状态:推演完成,已拆解为 [prd.md](./prd.md)(需求)与 [fsd.md](./fsd.md)(功能规格);UI 待与 C 系统 12 屏设计稿对齐。

## 一、参考机制的拆解

### 1.1 #100DaysOfCode

| 机制 | 原版做法 | 为什么有效 |
| --- | --- | --- |
| 公开承诺 + 低门槛规则 | 每天至少 1 小时,连续 100 天 | 门槛低到"没有借口",周期长到足以形成习惯 |
| 每日公开打卡 | 带话题标签发进度 | 公开承诺产生社交问责(learning in public) |
| 日志模板 + 每日 commit | fork 官方日志仓库,每天 commit | 打卡有仪式感,顺手点亮 GitHub 贡献格子 |
| 容错规则 | freeCodeCamp 变体:两周可漏一天,**绝不连漏两天** | 宽严结合,断一天不清零 |

### 1.2 Anki

| 机制 | 原版做法 | 为什么有效 |
| --- | --- | --- |
| 调度即服务 | 算法决定"今天复习什么",打开就是队列 | 免除"今天该学什么"的决策负担([Borretti 的评论](https://borretti.me/article/effective-spaced-repetition)) |
| 主动回忆 | 出示提示→自行回忆→对答案 | 检索练习比重读有效(测试效应,[Andy Matuschak](https://notes.andymatuschak.org/z2D1qPwddPktBjpNuwYFVva)) |
| 间隔效应 + 自适应调度 | 快忘时才复习;评分越容易间隔越长 | 保留投入最小化,按遗忘曲线个性化 |
| 笔记级复习(Obsidian 插件延伸) | 整篇笔记/待读清单也排进复习队列 | "重新浮现"不限于卡片,适用于任何知识单元 |

**Anki 最大的现实摩擦是"做卡片"成本高、流失于此。拾序的差异化机会:PDCA、语音转录、反思本来就在事件里——由 Pi 起草卡片,用户确认入库,卡片成本趋近于零。**

### 1.3 Khan Academy 掌握地图(与战争迷雾隐喻)

| 机制 | 原版做法 | 为什么有效 |
| --- | --- | --- |
| 四级技能状态 | Attempted → Familiar → Proficient → Mastered,逐级晋升 | 掌握是过程,不是一次考试成绩 |
| 掌握百分比只数高级状态 | 仅 Proficient/Mastered 计入课程掌握度,"接触过"不计入 | 防止把"见过"当"学会" |
| 技能地图 | 课程→单元→技能逐层展开,每个技能独立状态图标 | 学习范围可见、可导航 |
| 战争迷雾 | 探索过的地方点亮,未探索处保留轮廓 | 把"未知的未知"变成"已知的未知"([学习体验设计文献](https://files.eric.ed.gov/fulltext/ED603521.pdf)) |

## 二、映射到拾序的设计原则

1. **学习主题为本体。** 挑战和卡片都挂在主题下;进度与复习队列从日历事件/笔记派生,不另造记录体系。
2. **离线优先,公开是可选动作。** 打卡、复习、热力图全部本地完成;分享是导出图片的显式行为,不内置社交后端。
3. **AI 只做生成和提醒,不做审判。** Pi 起草卡片、拟提醒、写复盘;调度与成败判定交给规则。
4. **宽容的失败观。** 冻结卡 + 不清零;复习队列没有"惩罚",忘掉的卡片只是排得更近。
5. **成果可见边界。** 掌握地图同时呈现亮区与暗区——"学到了什么"和"还没学到什么"同等重要;边界用推进叙事呈现,不用焦虑叙事。
6. **一切皆有限容器。** 每个交互单元(挑战、每日复习队列、一个主题的地图)都必须可完成、可收尾;拒绝无限信息流式的设计——没做完的永远做不完,就永远不会有下一次动力。

## 三、功能设计

### 3.1 百日挑战(承诺机制)

- 入口:主题详情页(具体位置待 12 屏对齐)。
- 参数:绑定主题(必选 1 个;钉钉 `work` 事件不参与)、周期天数(默认 100,可 21/30/66/100)、每日门槛(当天 ≥1 个该主题完成事件,或累计 ≥N 分钟)。
- **打卡 = 事实,不是按钮**:满足门槛自动打卡;也可手动"轻打卡"(一句 PDCA 或语音转录)。
- 容错:自带 2 张冻结卡;24h 内可补签;连漏 2 天进暂停态(不清零,Pi 询问"继续或重排")。
- 可视化:进度条、里程碑徽标(3/7/21/50/100 天,早期权重高)、年视图 GitHub 风格热力图(挑战日描边)。
- 公开分享(可选):本地渲染打卡卡片图片(第 N 天 + 一句话 PDCA + 热力图切片),显式分享,无账号无排行榜。

### 3.2 复习队列(抗遗忘机制,参考 Anki)

- **卡片来源**:Pi 从事件绑定的 PDCA / 语音转录 / 反思中起草"提示-展开"卡,必须锚定来源(引用你自己的记录,借鉴 Khoj 的信任设计);用户确认后才入库;也支持手动建卡。
- **调度**:简化 SM-2(三档自评:忘 / 模糊 / 记得;忘→间隔重置,记得→间隔拉长),预留升级到 FSRS 的空间。每卡独立记录 ease 与间隔。
- **每日队列**:打开即"今日复习 N 张";队列设上限(建议 20 张/天)防止堆积弃疗——这是 Anki 用户的头号流失原因。
- **复习动作**:App 内出示提示→回忆→翻面自评,全程离线;支持整篇笔记级复习(PDCA 长文也可入队,参考 Obsidian 插件)。
- **推送**:本地通知"今日有 N 张复习",时段由用户自选,不做深夜轰炸。
- **与挑战的互动**:当天完成复习可计入挑战分钟门槛(复习算"轻学习"),让两个机制互相喂。

### 3.3 掌握地图与边界呈现(成果可见化)

- **理念:成果的呈现必须包含边界。** 只呈现"亮了的部分"(打卡数、掌握分)会制造虚假完整感;地图同时呈现亮区(已掌握)、边缘(正在摇晃)、暗区(已拆解但未触碰),把"不知道自己不知道"变成"知道自己不知道"。
- **知识点地图**:创建学习目标时,Pi 按逆向设计拆出知识点/证据清单(Bloom 分级:能复述 < 能解释 < 能应用 < 能创造),初始全为暗区。四态:未探索 → 已接触(有事件或卡片)→ 边缘(BKT 概率 0.5~0.85,或连续两次"忘")→ 已掌握(≥0.85 且预测保留达标)。
- **掌握度量化(简化)**:知识点掌握概率由复习日志(检索)+ 教回覆盖(费曼)+ 里程碑产物(Bloom 高层)三路证据更新;主题掌握度 = 各知识点按 Bloom 层级加权。
- **视觉:战争迷雾。** 亮区实色、边缘呼吸高亮、暗区只渲染轮廓不渲染内容;入口在主题详情页(待 12 屏对齐)。年视图热力图呈现"密度",掌握地图呈现"深度",互补而非重复。
- **边界的三个用途**:① 复习队列优先从边缘区取卡;② 教回(费曼)通道逐条对照知识点清单,输出"覆盖了哪些、漏了哪些",直接点亮或标摇;③ Pi 周/阶段报告讲"边界本周推进到哪里",用推进叙事替代总分叙事。
- **防坑**:暗区永远可见轮廓,但不倒计时、不制造焦虑;掌握百分比只数"已掌握 + 边缘"以上状态(Khan 的经验);边界的可信度取决于知识点拆解质量——知识点允许用户增删改,拆解是协商而非审判。

### 3.4 Pi Agent 角色(工具驱动)

| 工具 | 行为 |
| --- | --- |
| `create_challenge` | 对话式创建挑战并起草目标笔记 |
| `draft_cards` | 从指定事件/主题的 PDCA、转录起草复习卡,用户确认入库 |
| `challenge_reminder` | 挑战与复习的本日通知文案个性化生成 |
| `challenge_review` | 阶段复盘:拉取周期内事件 + PDCA + 复习日志,产出复盘草稿 |
| `challenge_pause/resume` | 连漏红线触发后的继续/重排对话 |
| `assess_teachback` | 语音教回对照知识点清单评分:输出覆盖/遗漏,更新掌握状态与边界 |
| `frontier_report` | 周/阶段边界报告:亮区扩大、边缘摇晃、暗区轮廓变化 |

## 四、数据模型草案(SQLite)

```sql
-- 挑战定义
CREATE TABLE challenge (
  id           TEXT PRIMARY KEY,
  topic_id     TEXT NOT NULL,        -- 绑定学习主题
  start_date   TEXT NOT NULL,        -- YYYY-MM-DD,本地时区
  total_days   INTEGER NOT NULL,
  threshold    TEXT NOT NULL,        -- 'one_event' | 'minutes'
  threshold_minutes INTEGER,         -- threshold='minutes' 时生效
  freezes_left INTEGER NOT NULL DEFAULT 2,
  status       TEXT NOT NULL DEFAULT 'active',  -- active|paused|finished|abandoned
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- 打卡记录:显式落表(轻打卡可以没有事件,因此不能纯派生)
CREATE TABLE challenge_checkin (
  id           TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES challenge(id),
  date         TEXT NOT NULL,        -- 归属挑战日(补签时 ≠ created 日期)
  kind         TEXT NOT NULL,        -- 'event'(派生自事件)|'light'(轻打卡)|'freeze'
  event_id     TEXT,                 -- kind='event' 时关联
  note_id      TEXT,                 -- PDCA/转录笔记引用
  created_at   TEXT NOT NULL,
  UNIQUE(challenge_id, date)
);

-- 知识点(掌握地图的节点,Pi 拆解 + 用户可编辑)
CREATE TABLE knowledge_point (
  id           TEXT PRIMARY KEY,
  topic_id     TEXT NOT NULL,        -- 所属学习主题
  name         TEXT NOT NULL,
  bloom_level  TEXT NOT NULL,        -- 'recall'|'explain'|'apply'|'create'
  mastery      REAL NOT NULL DEFAULT 0,       -- BKT 掌握概率
  status       TEXT NOT NULL DEFAULT 'dark',  -- dark|touched|shaky|mastered
  last_evidence_at TEXT,             -- 最近一次证据时间
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(topic_id, name)
);

-- 复习卡
CREATE TABLE review_card (
  id           TEXT PRIMARY KEY,
  topic_id     TEXT NOT NULL,        -- 必须挂在学习主题下
  source_type  TEXT NOT NULL,        -- 'pdca'|'transcript'|'reflection'|'manual'
  source_id    TEXT NOT NULL,        -- 锚定的事件笔记/转录,保证可溯源
  point_id     TEXT,                 -- 挂接的知识点(手动建卡可为空)
  front        TEXT NOT NULL,        -- 提示
  back         TEXT NOT NULL,        -- 展开/答案
  ease         REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0,
  due_date     TEXT NOT NULL,        -- 下次复习日
  status       TEXT NOT NULL DEFAULT 'active',  -- active|suspended|archived
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- 复习日志(供复盘与算法调参)
CREATE TABLE review_log (
  id           TEXT PRIMARY KEY,
  card_id      TEXT NOT NULL REFERENCES review_card(id),
  reviewed_at  TEXT NOT NULL,
  grade        TEXT NOT NULL         -- 'forgot'|'fuzzy'|'recall'
);
```

- 日视图/年视图读取以上表渲染进度、描边与"今日复习"入口;主题详情页读取 `knowledge_point` 渲染掌握地图;**日历事件本体不被挑战、卡片或知识点修改**。

## 五、边界(明确不做)

- 不做服务端、账号、排行榜;分享仅导出图片。
- 不做牌组市场、云端同步、卡片外发——卡片是个人记录的投影。
- 不做惩罚性机制(掉血、清零、破产);复习忘掉不惩罚,只重排。
- 挑战与复习不改变事件的 category/tag 既有规则,钉钉 `work` 事件不参与。

## 六、开放问题

1. 一个主题同时只允许一个活跃挑战?(建议:单活跃,避免进度歧义)
2. 轻打卡是否强制带一句 PDCA?完全空的打卡会稀释学习闭环。
3. 复习算法起点:简化 SM-2 是否够用,还是直接上 FSRS 开源实现?(建议:先 SM-2 三档,表结构已预留)
4. 笔记级复习(整篇 PDCA 入队)在移动端的信息密度如何呈现,需设计稿定夺。
5. 挑战与既有"习惯"功能的关系:挑战是习惯的特例还是并列概念?
6. 每日复习队列上限(20?)与挑战"当日门槛"的耦合方式需要数值调优。
7. 知识点拆解的粒度由谁定、拆多细?(太粗则边界失真,太细则管理负担重;建议 Pi 拆初稿、用户删减)
8. 掌握地图在主题详情页的入口层级与暗区视觉强度,待 C 系统设计稿定夺。
