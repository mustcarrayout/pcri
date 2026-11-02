// 拾序日视图 · 三个方向的高保真屏幕
// 内容共用同一份数据（改这里，三个方向同步变化）；结构各自独立，便于对比。

// ── 图标（Lucide 风格线性图标） ──────────────────────────────
const Ic = ({ children, size = 16, sw = 2, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={style}
    aria-hidden="true"
  >
    {children}
  </svg>
);
const IcCheck = ({ size, sw }) => (
  <Ic size={size} sw={sw}>
    <path d="M20 6 9 17l-5-5" />
  </Ic>
);
const IcMic = ({ size = 16 }) => (
  <Ic size={size}>
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <path d="M12 19v3" />
  </Ic>
);
const IcStar = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2c.62 4.9 2.48 6.9 7.5 8-5.02 1.1-6.88 3.1-7.5 8-.62-4.9-2.48-6.9-7.5-8 5.02-1.1 6.88-3.1 7.5-8Z" />
  </svg>
);
const IcSend = ({ size = 16 }) => (
  <Ic size={size}>
    <path d="M12 19V5" />
    <path d="m5 12 7-7 7 7" />
  </Ic>
);
const IcClock = ({ size = 13 }) => (
  <Ic size={size} sw={2.2}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Ic>
);
const IcCal = ({ size = 14 }) => (
  <Ic size={size}>
    <rect x="3" y="4" width="18" height="17" rx="3" />
    <path d="M8 2v4" />
    <path d="M16 2v4" />
    <path d="M3 9.5h18" />
  </Ic>
);
const IcWarn = ({ size = 15 }) => (
  <Ic size={size}>
    <path d="M12 3 2.8 18.8a1.9 1.9 0 0 0 1.7 2.8h15a1.9 1.9 0 0 0 1.7-2.8L12 3Z" />
    <path d="M12 10v4" />
    <path d="M12 17.6h.01" />
  </Ic>
);
const IcTrash = ({ size = 14 }) => (
  <Ic size={size} sw={1.8}>
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </Ic>
);
// 品牌符号（同真实 App：叶绿底 + 米白圆角卡 + 三分类色条）
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

// ── 共用内容（2026-10-30 周五 · 农历九月廿一 · 休） ──────────
const CATNAME = { work: "工作", interest: "兴趣", plan: "计划" };
const QLABEL = { qi: "重要且紧急", in: "重要不紧急", ui: "紧急不重要", nn: "不紧急不紧急" };
const QCOLOR = {
  qi: "var(--coral-ink)",
  in: "var(--interest-ink)",
  ui: "var(--blue-ink)",
  nn: "var(--gray-ink)",
};
const MORNING = [
  { time: "09:00", title: "站会与周报同步", cat: "work", tags: ["#团队"], q: "nn", done: true, dingtalk: true, pdca: 0 },
  { time: "10:30", title: "评审 Q4 预算方案", cat: "work", tags: ["#评审", "#Q4"], q: "qi", current: true, pdca: 1 },
  { time: "11:00", title: "《经济学人》精读 30 分钟", cat: "interest", tags: ["#英语"], q: "in", pdca: 2 },
];
const AFTERNOON = [
  { time: "14:00", title: "和设计师过首页视觉稿", cat: "work", tags: ["#协作"], q: "ui", pdca: 0 },
  { time: "16:30", title: "跑步 5 公里", cat: "plan", tags: ["#健康"], q: "in", pdca: 0 },
  { time: "21:30", title: "每晚复盘：写今日 Check / Act", cat: "plan", tags: ["#复盘"], q: "in", pdca: 0 },
];
const QCOUNTS = { qi: 1, in: 3, ui: 1, nn: 1 };

// PDCA 进度短杠（4 格）
const PdcaBars = ({ n, cls }) => (
  <span className={cls}>
    {[0, 1, 2, 3].map((i) => (
      <i key={i} className={i < n ? "f" : ""} />
    ))}
  </span>
);

const HabitAlertText = (
  <React.Fragment>
    <span className="txt">「每晚复盘」已 2 天未执行</span>
    <span className="act">让 Pi 看看 ›</span>
  </React.Fragment>
);

// ══════════════════ A · 纸感精修 ══════════════════
const ACard = ({ e }) => (
  <article className={"a-card " + e.q + (e.done ? " done" : "") + (e.current ? " current" : "")}>
    {e.current && <span className="a-nowflag">当前</span>}
    <div className="a-top">
      <button className={"a-check" + (e.done ? " on" : "")}>
        {e.done && <IcCheck size={13} sw={2.6} />}
      </button>
      <span className="a-time">
        <IcClock />
        {e.time}
      </span>
      <span className="a-tags">
        {e.dingtalk && <span className="a-src">钉钉</span>}
        <span className={"a-cat " + e.cat}>{CATNAME[e.cat]}</span>
        {e.tags.map((t) => (
          <span key={t} className="a-tag">
            {t}
          </span>
        ))}
      </span>
    </div>
    <p className="a-title">{e.title}</p>
    <div className="a-foot">
      <button className="a-pdca">
        <PdcaBars n={e.pdca} cls="a-pdca-bars" />
        <em>PDCA {e.pdca}/4</em>
      </button>
      <button className="a-del" aria-label="删除事项">
        <IcTrash />
      </button>
    </div>
  </article>
);

const ScreenA = () => (
  <div className="screen dir-a" data-screen-label="A 纸感精修">
    <header className="a-bar">
      <BrandMark size={22} />
      <span className="bname">
        拾序<i>.</i>
      </span>
      <span className="db">
        <i />
        SQLite
      </span>
      <span className="avatar">李</span>
    </header>

    <div className="a-head">
      <div className="a-date-row">
        <span className="a-date">10月30日</span>
        <span className="a-weekday">周五</span>
        <button className="a-pill-today">今天</button>
        <button className="a-pill-week">
          <IcCal />
          周历
        </button>
      </div>
      <p className="a-lunar">
        农历九月廿一 · <b>休</b>
      </p>
    </div>

    <div className="a-omni">
      <span className="star">
        <IcStar size={17} />
      </span>
      <span className="ph">告诉 Pi：新事项、记录、提问…</span>
      <button className="mic" aria-label="语音输入">
        <IcMic size={17} />
      </button>
      <button className="go" aria-label="发送">
        <IcSend size={16} />
      </button>
    </div>

    <section className="a-qcard">
      <div className="a-qhead">
        <strong>轻重缓急</strong>
        <em>按重要性与紧急性</em>
      </div>
      <div className="a-grid">
        {Object.keys(QCOUNTS).map((q) => (
          <button key={q} className={"a-cell " + q}>
            <b>{QCOUNTS[q]}</b>
            <span>{QLABEL[q]}</span>
          </button>
        ))}
      </div>
      <div className="a-loop">
        <span>连续 3 天</span>
        <span>计划 6</span>
        <span>完成 1</span>
        <span className="warn">复盘 0</span>
        <span>费曼 1</span>
      </div>
    </section>

    <div className="a-alert">
      <IcWarn />
      {HabitAlertText}
    </div>

    <div className="a-period">
      上午<i />
      <small>3 件 · 12:00 前</small>
    </div>
    {MORNING.map((e) => (
      <ACard key={e.time} e={e} />
    ))}

    <div className="a-period">
      下午与晚上<i />
      <small>3 件 · 12:00 后</small>
    </div>
    {AFTERNOON.map((e) => (
      <ACard key={e.time} e={e} />
    ))}

    <button className="a-add">
      <IcMic size={16} />
      对 Pi 说，添加到今天
    </button>

    <footer className="a-footer">
      <span className="db">
        <i />
        本机数据库已连接
      </span>
      <span className="sp" />
      <button>定时服务</button>
      <span>v0.2.0</span>
    </footer>
  </div>
);

// ══════════════════ B · 手账时间轴 ══════════════════
const BItem = ({ e }) => (
  <div
    className={"b-item " + e.q + (e.done ? " done" : "") + (e.current ? " current" : "")}
    style={{ "--qc": QCOLOR[e.q] }}
  >
    <span className="b-time">{e.time}</span>
    <span className="b-rail">
      <i className="b-dot" />
    </span>
    <div className="b-body">
      <p className="b-title">
        {e.title}
        {e.current && <span className="b-now">当前</span>}
      </p>
      <div className="b-meta">
        <span className={"b-stamp " + e.cat}>{CATNAME[e.cat]}</span>
        {e.dingtalk && <span className="b-src">钉钉</span>}
        {e.tags.map((t) => (
          <span key={t} className="b-tag">
            {t}
          </span>
        ))}
        <PdcaBars n={e.pdca} cls="b-pdca" />
      </div>
    </div>
  </div>
);

const ScreenB = () => (
  <div className="screen dir-b" data-screen-label="B 手账时间轴">
    <header className="b-bar">
      <span className="bname">
        拾序<i>.</i>
      </span>
      <span className="db">
        <i />
        SQLite
      </span>
      <span className="avatar">李</span>
    </header>

    <div className="b-head">
      <div className="b-headcol">
        <div className="b-eyebrow">OCT · 2026</div>
        <div className="b-date">
          十月三十日<small>星期五</small>
          <span className="b-seal">今日</span>
        </div>
        <p className="b-lunar">
          农历九月廿一 · <b>休</b>
        </p>
      </div>
      <button className="b-weekbtn" aria-label="周历">
        <IcCal size={16} />
      </button>
    </div>

    <div className="b-omni">
      <span className="star">
        <IcStar size={17} />
      </span>
      <span className="ph">告诉 Pi：新事项、记录、提问…</span>
      <button className="mic" aria-label="语音输入">
        <IcMic size={16} />
      </button>
      <button className="go" aria-label="发送">
        <IcSend size={15} />
      </button>
    </div>

    <section className="b-rhythm">
      {Object.keys(QCOUNTS).map((q) => (
        <div key={q} className={"b-r " + q}>
          <b>{QCOUNTS[q]}</b>
          <span>{QLABEL[q]}</span>
        </div>
      ))}
    </section>
    <div className="b-loop">
      <span>连续 3 天</span>
      <span>计划 6</span>
      <span>完成 1</span>
      <span className="warn">复盘 0</span>
      <span>费曼 1</span>
    </div>

    <div className="b-note">
      <IcWarn size={14} />
      {HabitAlertText}
    </div>

    <div className="b-period">
      <span>上午</span>
      <i />
      <small>3 件 · 12:00 前</small>
    </div>
    {MORNING.map((e) => (
      <BItem key={e.time} e={e} />
    ))}

    <div className="b-period">
      <span>下午与晚上</span>
      <i />
      <small>3 件 · 12:00 后</small>
    </div>
    {AFTERNOON.map((e) => (
      <BItem key={e.time} e={e} />
    ))}

    <button className="b-add">
      <IcMic size={15} />
      对 Pi 说，添加到今天
    </button>

    <footer className="b-footer">
      <span>本机数据库已连接</span>
      <span>定时服务</span>
      <span>v0.2.0</span>
    </footer>
  </div>
);

// ══════════════════ C · 清爽卡片 ══════════════════
const CCard = ({ e }) => (
  <article className={"c-card" + (e.done ? " done" : "") + (e.current ? " current" : "")}>
    <div className="c-row1">
      <button className={"c-check" + (e.done ? " on" : "")}>
        {e.done && <IcCheck size={13} sw={2.6} />}
      </button>
      <span className="c-timechip">
        <IcClock />
        {e.time}
      </span>
      {e.current && <span className="c-nowchip">进行中</span>}
      <span className="c-cattag">
        <span className={"c-cat " + e.cat}>{CATNAME[e.cat]}</span>
      </span>
    </div>
    <p className="c-title">{e.title}</p>
    <div className="c-row2">
      <span className="c-qdot">
        <i style={{ background: QCOLOR[e.q] }} />
        {QLABEL[e.q]}
      </span>
      {e.dingtalk && <span className="c-tag">钉钉</span>}
      {e.tags.map((t) => (
        <span key={t} className="c-tag">
          {t}
        </span>
      ))}
      <span className="c-pdca">
        <PdcaBars n={e.pdca} cls="c-pdca-bars" />
        PDCA {e.pdca}/4
      </span>
      <button className="c-del" aria-label="删除事项">
        <IcTrash />
      </button>
    </div>
  </article>
);

const ScreenC = () => (
  <div className="screen dir-c" data-screen-label="C 清爽卡片">
    <header className="c-bar">
      <BrandMark size={22} />
      <span className="bname">
        拾序<i>.</i>
      </span>
      <span className="db">
        <i />
        SQLite
      </span>
      <span className="avatar">李</span>
    </header>

    <div className="c-head">
      <div className="c-date-row">
        <span className="c-date">10月30日</span>
        <span className="c-week">周五</span>
        <button className="c-pill-today">今天</button>
        <button className="c-pill-week">
          <IcCal />
          周历
        </button>
      </div>
      <span className="c-lunar-chip">
        农历九月廿一<b>休</b>
      </span>
    </div>

    <div className="c-omni">
      <span className="ava">
        <IcStar size={19} />
      </span>
      <span className="ph">告诉 Pi：新事项、记录、提问…</span>
      <button className="mic" aria-label="语音输入">
        <IcMic size={17} />
      </button>
      <button className="go" aria-label="发送">
        <IcSend size={16} />
      </button>
    </div>

    <div className="c-looprow">
      <span>连续 3 天</span>
      <span>计划 6</span>
      <span>完成 1</span>
      <span className="warn">复盘 0</span>
      <span>费曼 1</span>
    </div>

    <div className="c-qgrid">
      {Object.keys(QCOUNTS).map((q) => (
        <button key={q} className={"c-cell " + q}>
          <small>{QLABEL[q]}</small>
          <b>{QCOUNTS[q]}</b>
        </button>
      ))}
    </div>

    <div className="c-alert">
      <IcWarn />
      {HabitAlertText}
    </div>

    <div className="c-period">
      <strong>上午</strong>
      <small>3 件 · 12:00 前</small>
      <i />
    </div>
    {MORNING.map((e) => (
      <CCard key={e.time} e={e} />
    ))}

    <div className="c-period">
      <strong>下午与晚上</strong>
      <small>3 件 · 12:00 后</small>
      <i />
    </div>
    {AFTERNOON.map((e) => (
      <CCard key={e.time} e={e} />
    ))}

    <button className="c-add">
      <IcMic size={16} />
      对 Pi 说，添加到今天
    </button>

    <footer className="c-footer">
      <span className="db">
        <i />
        本机数据库
      </span>
      <button>定时服务</button>
      <span>v0.2.0</span>
    </footer>
  </div>
);

Object.assign(window, { ScreenA, ScreenB, ScreenC });
