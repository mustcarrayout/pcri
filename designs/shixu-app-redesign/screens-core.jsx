// 核心流：登录 → 学习首页 → 今天
// 图标（Lucide 风格）+ 共享内容数据 + 三个屏幕

const Ico = ({ children, size = 16, sw = 2, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
    {children}
  </svg>
);
const IcCheck = ({ size, sw }) => <Ico size={size} sw={sw}><path d="M20 6 9 17l-5-5" /></Ico>;
const IcMic = ({ size = 16 }) => (
  <Ico size={size}>
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><path d="M12 19v3" />
  </Ico>
);
const IcStar = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2c.62 4.9 2.48 6.9 7.5 8-5.02 1.1-6.88 3.1-7.5 8-.62-4.9-2.48-6.9-7.5-8 5.02-1.1 6.88-3.1 7.5-8Z" />
  </svg>
);
const IcSend = ({ size = 16 }) => <Ico size={size}><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></Ico>;
const IcClock = ({ size = 13 }) => (
  <Ico size={size} sw={2.2}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Ico>
);
const IcCal = ({ size = 14 }) => (
  <Ico size={size}><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M8 2v4M16 2v4M3 9.5h18" /></Ico>
);
const IcWarn = ({ size = 15 }) => (
  <Ico size={size}><path d="M12 3 2.8 18.8a1.9 1.9 0 0 0 1.7 2.8h15a1.9 1.9 0 0 0 1.7-2.8L12 3Z" /><path d="M12 10v4M12 17.6h.01" /></Ico>
);
const IcTrash = ({ size = 14 }) => (
  <Ico size={size} sw={1.8}><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></Ico>
);
const IcPlus = ({ size = 15 }) => <Ico size={size}><path d="M12 5v14M5 12h14" /></Ico>;
const IcCog = ({ size = 13 }) => (
  <Ico size={size}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></Ico>
);
const IcX = ({ size = 14 }) => <Ico size={size}><path d="M18 6 6 18M6 6l12 12" /></Ico>;
const IcArrowR = ({ size = 13 }) => <Ico size={size}><path d="M5 12h14M13 6l6 6-6 6" /></Ico>;
const IcPause = ({ size = 13 }) => <Ico size={size}><rect x="7" y="5" width="3.5" height="14" rx="1" /><rect x="13.5" y="5" width="3.5" height="14" rx="1" /></Ico>;
const BrandMark = ({ size = 22 }) => (
  <span className="brand-mark" style={{ width: size, height: size, borderRadius: size * 0.3 }}>
    <svg viewBox="0 0 16 16" width={size * 0.68} height={size * 0.68} aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="3.2" fill="#FCFAF1" />
      <rect x="4.2" y="4.4" width="4.6" height="1.7" rx="0.85" fill="#E28B71" />
      <rect x="4.2" y="7.1" width="5.6" height="1.7" rx="0.85" fill="#46563C" />
      <rect x="4.2" y="9.8" width="3.4" height="1.7" rx="0.85" fill="#46563C" />
    </svg>
  </span>
);

// ── 共享内容（2026-10-31 周六 · 农历九月廿二） ──
const CATNAME = { work: "工作", interest: "兴趣", plan: "计划" };
const STATUS_LABEL = { learning: "在学", usable: "能用", teachable: "能教", paused: "搁置" };
const TOPICS = [
  {
    title: "英语词根", status: "learning", why: "看文献不再被生词卡住", useCase: "每天精读一篇论文时验证",
    explain: 0, apply: 0, task: [0, 3], next: "今天背第一组 30 个词根（09:00 已排）",
  },
  {
    title: "费曼学习法", status: "teachable", why: "检验自己是否真的学会了", useCase: "每学完新东西自测一次",
    explain: 3, apply: 2, task: [3, 3], next: "带一次团队分享，教别人一遍",
  },
  {
    title: "OKR 与 KPI", status: "usable", why: "给团队定更有效的目标", useCase: "下季度规划时用",
    explain: 1, apply: 1, task: [2, 4], next: "把部门下季度目标改成 OKR 草稿",
  },
];
const TODAY_EVENTS = [
  { time: "09:00", title: "背第一组 30 个英语词根", cat: "interest", q: "in", tags: ["#目标·英语词根"], task: [0, 3] },
  { time: "10:00", title: "定位 ai实验室组会", cat: "work", q: "qi", ding: true, current: true },
  { time: "14:00", title: "评审 Q4 预算方案", cat: "work", q: "ui", pdca: 1 },
  { time: "17:00", title: "跑步 5 公里", cat: "plan", q: "in", done: true, pdca: 4 },
  { time: "21:30", title: "每晚复盘：写今日 Check / Act", cat: "plan", q: "in" },
];
const QCOUNTS = { qi: 1, in: 3, ui: 1, nn: 0 };
const QLABEL = { qi: "重要且紧急", in: "重要不紧急", ui: "紧急不重要", nn: "不紧急不重要" };
const QCOLOR = { qi: "var(--coral)", in_: "#8cac58", ui: "var(--blue)", nn: "#c4c9bf" };
const QNAME = { qi: "in", in: "in_", ui: "ui", nn: "nn" };

const TopBar = ({ showToday }) => (
  <header className="topbar">
    <BrandMark size={22} />
    <span className="bname">拾序<i>.</i></span>
    <span className="db-chip"><i />SQLite</span>
    <span className="avatar">李</span>
  </header>
);

// ══════════════ 登录页 ══════════════
const ScreenLogin = () => (
  <div className="login" data-screen-label="登录页">
    <div className="login-hero">
      <span className="eyebrow">MAKE LEARNING COUNT</span>
      <p className="en">Learn it.<br />Use it.<br /><i>Own it.</i></p>
      <div className="login-float">
        <div className="fc">
          <b>费曼学习法</b>
          <span className="m"><span className="hot">讲 3</span><span>用 2</span><span className="hot">能教</span></span>
        </div>
        <div className="fc f2">
          <b>英语词根</b>
          <span className="m"><span>讲 0</span><span>用 0</span><span>在学</span></span>
        </div>
      </div>
    </div>
    <div className="login-body">
      <div className="login-brandrow" style={{ marginBottom: 18 }}>
        <BrandMark size={26} />
        <span className="bname" style={{ fontSize: 17 }}>拾序<i>.</i></span>
      </div>
      <h1>把想学的，<br />变成学会的。</h1>
      <p className="sub">为每个想学的东西建一个主题——讲过、用过，才算学会。日历是它的时间投影。</p>
      <form className="login-form">
        <label>怎么称呼你？</label>
        <input placeholder="输入你的名字" defaultValue="李禾" />
        <button type="button" className="go">开始我的学习 <IcArrowR size={17} /></button>
      </form>
      <small className="login-privacy">本机登录，数据只存在你的手机上。</small>
    </div>
  </div>
);

// ══════════════ 学习首页（Home） ══════════════
const TopicCard = ({ t }) => (
  <article className={"card topic-card" + (t.status === "paused" ? " paused" : "")}>
    <div className="t-top">
      <strong>{t.title}</strong>
      <span className={"t-status " + t.status}>{STATUS_LABEL[t.status]}</span>
      <button className="t-edit" aria-label="编辑主题"><IcCog /></button>
    </div>
    {(t.why || t.useCase) && (
      <p className="t-why">{t.why}{t.useCase ? ` · 用在：${t.useCase}` : ""}</p>
    )}
    <div className="t-evidence">
      <span className={t.explain ? "hot" : ""}><b>{t.explain}</b> 讲过</span>
      <span className={t.apply ? "hot" : ""}><b>{t.apply}</b> 用过</span>
      {t.task && <span><b>{t.task[0]}</b>/{t.task[1]} 任务</span>}
    </div>
    {t.next && (
      <div className="t-next"><IcArrowR />{t.next}</div>
    )}
    <div className="t-actions">
      <button className="solid"><IcStar size={13} />让 Pi 推动</button>
      <button><IcMic size={13} />讲一次</button>
      <button aria-label="搁置"><IcPause /></button>
    </div>
  </article>
);

const ScreenHome = () => (
  <div className="screen paper" data-screen-label="学习首页" style={{ minHeight: 844 }}>
    <TopBar />
    <div className="head">
      <div className="row1">
        <span className="date">10月31日</span>
        <span className="week">周六</span>
        <button className="nav-pill"><IcCal />今天</button>
      </div>
      <span className="lunar-chip">农历九月廿二<b>休</b></span>
    </div>
    <div className="omni">
      <span className="ava"><IcStar size={19} /></span>
      <span className="ph">告诉 Pi：想学什么、记录、提问…</span>
      <button className="mic"><IcMic size={17} /></button>
      <button className="go"><IcSend size={16} /></button>
    </div>
    <div className="learn-head">
      <span><strong>学习主题</strong> <small>讲过、用过，才算学会</small></span>
      <button className="btn-add"><IcPlus />新主题</button>
    </div>
    <div className="topic-list">
      {TOPICS.map((t) => <TopicCard key={t.title} t={t} />)}
      <button className="t-new"><IcPlus size={15} />再学一个？先想清楚在哪用</button>
    </div>
    <footer className="foot">
      <span>本机数据库</span><button>钉钉同步</button><button>定时服务</button><span>v0.3.0</span>
    </footer>
  </div>
);

// ══════════════ 今天视图 ══════════════
const TodayCard = ({ e }) => (
  <article className={"card tcard" + (e.current ? " current" : "") + (e.done ? " done" : "")}>
    <div className="tc-r1">
      <button className={"tc-check" + (e.done ? " on" : "")}>{e.done && <IcCheck size={13} sw={2.6} />}</button>
      <span className="tc-time"><IcClock />{e.time}</span>
      {e.current && <span className="tc-now">进行中</span>}
      <span className={"tc-cat " + e.cat}>{CATNAME[e.cat]}</span>
    </div>
    <p className="tc-title">{e.title}</p>
    <div className="tc-r2">
      <span className="tc-qdot"><i style={{ background: QCOLOR[e.q] }} />{QLABEL[e.q]}</span>
      {e.ding && <span className="tc-tag">钉钉</span>}
      {(e.tags || []).map((t) => <span key={t} className="tc-tag">{t}</span>)}
      <span className="tc-pdca">
        {[0, 1, 2, 3].map((i) => <i key={i} className={e.pdca && i < e.pdca ? "f" : ""} />)}
        PDCA {e.pdca || 0}/4
      </span>
      <button className="tc-del"><IcTrash /></button>
    </div>
  </article>
);

const ScreenToday = () => (
  <div className="screen paper" data-screen-label="今天视图" style={{ minHeight: 844 }}>
    <TopBar />
    <div className="head">
      <div className="row1">
        <span className="date">10月31日</span>
        <span className="week">周六</span>
        <button className="nav-pill"><IcStar size={13} />学习</button>
        <button className="nav-pill"><IcCal />周历</button>
      </div>
      <span className="lunar-chip">农历九月廿二<b>休</b></span>
    </div>
    <div className="omni">
      <span className="ava"><IcStar size={19} /></span>
      <span className="ph">告诉 Pi：新事项、记录、提问…</span>
      <button className="mic"><IcMic size={17} /></button>
      <button className="go"><IcSend size={16} /></button>
    </div>
    <div className="loop-pill">
      <span>连续 3 天</span><span>计划 5</span><span>完成 1</span>
      <span className="warn">复盘 0</span><span>费曼 1</span>
    </div>
    <div className="qgrid">
      {Object.keys(QCOUNTS).map((q) => (
        <button key={q} className={"qcell " + (q === "in" ? "in" : q)}>
          <small>{QLABEL[q]}</small><b>{QCOUNTS[q]}</b>
        </button>
      ))}
    </div>
    <div className="alert">
      <IcWarn /><span>「每晚复盘」已 2 天未执行</span><span className="act">让 Pi 看看 ›</span>
    </div>
    <div className="period"><strong>上午</strong><small>2 件 · 12:00 前</small><i /></div>
    {TODAY_EVENTS.filter((e) => Number(e.time.slice(0, 2)) < 12).map((e) => <TodayCard key={e.time} e={e} />)}
    <div className="period"><strong>下午与晚上</strong><small>3 件 · 12:00 后</small><i /></div>
    {TODAY_EVENTS.filter((e) => Number(e.time.slice(0, 2)) >= 12).map((e) => <TodayCard key={e.time} e={e} />)}
    <button className="btn-cta"><IcMic size={16} />对 Pi 说，添加到今天</button>
    <footer className="foot">
      <span>本机数据库</span><button>钉钉同步</button><button>定时服务</button><span>v0.3.0</span>
    </footer>
  </div>
);

Object.assign(window, { ScreenLogin, ScreenHome, ScreenToday });
