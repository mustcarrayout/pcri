// 日历投影：周 / 月 / 年（数据延续 2026-10-31 周六）

const WEEK_DAYS = [
  { key: "10/26", wd: "一", events: [] },
  { key: "10/27", wd: "二", events: [{ t: "预算预审", c: "work" }] },
  { key: "10/28", wd: "三", events: [{ t: "词根第二组", c: "interest" }, { t: "论文精读", c: "interest" }] },
  { key: "10/29", wd: "四", events: [{ t: "1v1 ×3", c: "work" }] },
  { key: "10/30", wd: "五", events: [{ t: "定位 ai实验室组会", c: "work" }, { t: "跑步 5 公里", c: "plan" }] },
  { key: "10/31", wd: "六", today: true, events: [
    { t: "背词根第一组", c: "interest" }, { t: "ai实验室组会", c: "work" },
    { t: "预算评审", c: "work" }, { t: "跑步", c: "plan" }, { t: "复盘", c: "plan" },
  ] },
  { key: "11/01", wd: "日", events: [{ t: "OKR 草稿", c: "plan" }] },
];

const ScreenWeek = () => (
  <div className="screen paper" data-screen-label="周视图" style={{ minHeight: 844 }}>
    <TopBar />
    <div className="head">
      <div className="row1">
        <span className="date">10月26日</span>
        <span className="week">– 11月1日</span>
        <button className="nav-pill"><IcStar size={13} />学习</button>
        <button className="nav-pill"><IcCal />月历</button>
      </div>
    </div>
    <div className="omni">
      <span className="ava"><IcStar size={19} /></span>
      <span className="ph">告诉 Pi：新事项、记录、提问…</span>
      <button className="mic"><IcMic size={17} /></button>
      <button className="go"><IcSend size={16} /></button>
    </div>
    <div style={{ margin: "14px 16px 10px", display: "flex", alignItems: "center", gap: 8 }}>
      <strong style={{ fontSize: 14 }}>本周</strong>
      <small style={{ fontSize: 11, color: "var(--ink3)" }}>12 件 · 学习任务 4 件</small>
      <i style={{ flex: 1, height: 1, background: "rgba(120,140,100,.18)" }} />
      <button className="nav-pill" style={{ height: 26 }}>回到今天</button>
    </div>
    {WEEK_DAYS.map((d) => (
      <div key={d.key} className={"card wk-day" + (d.today ? " today" : "")}>
        <span className="wk-date">
          <b>{d.key}</b>
          <small>周{d.wd}</small>
          {d.today && <span className="wk-todaychip">今天</span>}
        </span>
        <span className="wk-evs">
          {d.events.length ? d.events.slice(0, 2).map((e, i) => (
            <span key={i} className="wk-ev"><i className={e.c} /><span>{e.t}</span></span>
          )) : <span style={{ fontSize: 10.5, color: "#c2c7bf" }}>留白</span>}
          {d.events.length > 2 && (
            <span className="wk-ev" style={{ color: "var(--ink3)" }}>+{d.events.length - 2} 项</span>
          )}
        </span>
        {d.events.length > 0 && <span className="wk-count">{d.events.length}</span>}
      </div>
    ))}
    <footer className="foot"><span>本机数据库</span><span>v0.3.0</span></footer>
  </div>
);

// 月视图：2026 年 11 月（11/1 周日；周一为一周之首）
const MONTH_CELLS = (() => {
  const cells = [];
  for (let i = 0; i < 6; i++) cells.push({ n: 26 + i, out: true, lunar: i === 0 ? "九月十七" : "", dots: [] });
  const lunarOf = (d) =>
    ({ 1: "九月十八", 2: "十九", 3: "二十", 4: "廿一", 5: "廿二", 6: "廿三", 7: "廿四", 8: "廿五", 9: "廿六", 10: "廿七", 11: "廿八", 12: "廿九", 13: "三十", 14: "十月", 15: "初二", 16: "初三", 17: "初四", 18: "初五", 19: "初六", 20: "初七", 21: "立冬", 22: "初九", 23: "初十", 24: "十一", 25: "十二", 26: "十三", 27: "十四", 28: "十五", 29: "十六", 30: "十七" }[d] || "");
  const dots = { 1: ["work"], 2: ["interest"], 4: ["work", "work"], 5: ["plan"], 7: ["work", "interest"], 10: ["work", "interest", "plan"], 11: ["work"], 12: ["work", "work"], 14: ["interest", "interest", "plan"], 17: ["work"], 18: ["work", "plan"], 19: ["plan", "plan"], 21: ["work", "work"], 24: ["work"], 26: ["interest"], 28: ["plan"] };
  for (let d = 1; d <= 30; d++)
    cells.push({
      n: d, lunar: lunarOf(d), dots: dots[d] || [],
      sel: d === 10, rest: d === 1 || d === 7 || d === 8 || d === 14 || d === 15 || d === 21 || d === 22 || d === 28 || d === 29,
    });
  return cells;
})();

const ScreenMonth = () => (
  <div className="screen paper" data-screen-label="月视图" style={{ minHeight: 780 }}>
    <TopBar />
    <div className="head">
      <div className="row1">
        <span className="date">2026年11月</span>
        <span className="week" style={{ marginRight: 0 }} />
        <button className="nav-pill"><IcStar size={13} />学习</button>
        <button className="nav-pill"><IcCal />周历</button>
      </div>
    </div>
    <div className="card cal-card">
      <div className="cal-nav">
        <button className="mini-btn">‹ 上月</button>
        <b>2026 年 11 月</b>
        <button className="mini-btn" style={{ background: "var(--leaf-deep)", color: "#fff", border: 0 }}>今天</button>
      </div>
      <div className="cal-week">{["一", "二", "三", "四", "五", "六", "日"].map((w) => <span key={w}>周{w}</span>)}</div>
      <div className="cal-grid">
        {MONTH_CELLS.map((c, i) => (
          <button key={i} className={"cal-cell" + (c.out ? " out" : "") + (c.sel ? " sel" : "")}>
            {c.rest && !c.out ? <i className="cal-flag rest">休</i> : <span style={{ height: 10 }} />}
            <span className="n">{c.n}</span>
            <span className="cal-lunar">{c.lunar}</span>
            <span className="cal-dots">
              {c.dots.map((d, j) => (
                <i key={j} style={{ background: d === "work" ? "var(--coral)" : d === "interest" ? "#8cac58" : "var(--blue)" }} />
              ))}
            </span>
          </button>
        ))}
      </div>
      <div className="cal-legend">
        <span><i style={{ background: "var(--coral)" }} />工作</span>
        <span><i style={{ background: "#8cac58" }} />兴趣</span>
        <span><i style={{ background: "var(--blue)" }} />计划</span>
        <span style={{ marginLeft: "auto" }}>11/10 有 3 件 · 已选中</span>
      </div>
    </div>
    <div className="card" style={{ margin: "10px 16px 0", padding: "11px 13px", display: "flex", alignItems: "center", gap: 8 }}>
      <span className="tc-cat interest" style={{ margin: 0 }}>兴趣</span>
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>11月10日 · 3 件事项</span>
      <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--leaf-deep)", fontWeight: 600 }}>查看 ›</span>
    </div>
    <footer className="foot"><span>本机数据库</span><span>v0.3.0</span></footer>
  </div>
);

// 年视图：2026，类别分布条
const YEAR_MONTHS = [
  { m: "一月", n: 38 }, { m: "二月", n: 31 }, { m: "三月", n: 45 }, { m: "四月", n: 41 },
  { m: "五月", n: 36 }, { m: "六月", n: 52 }, { m: "七月", n: 44 }, { m: "八月", n: 30 },
  { m: "九月", n: 47 }, { m: "十月", n: 42 }, { m: "十一月", n: 35, now: true }, { m: "十二月", n: 0 },
];
const ScreenYear = () => (
  <div className="screen paper" data-screen-label="年视图" style={{ minHeight: 820 }}>
    <TopBar />
    <div className="head">
      <div className="row1">
        <span className="date">2026年</span>
        <span className="week" style={{ marginRight: 0 }} />
        <button className="nav-pill"><IcStar size={13} />学习</button>
        <button className="nav-pill"><IcCal />月历</button>
      </div>
    </div>
    <div className="yr-grid">
      {YEAR_MONTHS.map((y) => (
        <button key={y.m} className={"card yr-month" + (y.now ? " now" : "")}>
          <b>{y.m}{y.now && <small>本月</small>}</b>
          <span className="yr-bars">
            <i className={y.m === "十一月" ? "work" : ""} />
            <i className={y.m === "十一月" ? "interest" : ""} />
            <i className={y.m === "十一月" ? "plan" : ""} />
          </span>
          <span className="yr-count"><b>{y.n}</b> 项</span>
        </button>
      ))}
    </div>
    <div className="card" style={{ margin: "12px 16px 0", padding: "12px 14px", display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <strong style={{ fontSize: 14 }}>年度学习</strong>
        <small style={{ fontSize: 11, color: "var(--ink3)" }}>主题 3 个 · 讲过 4 次 · 用过 3 次</small>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {TOPICS.map((t) => (
          <span key={t.title} className={"t-status " + t.status} style={{ padding: "3px 9px" }}>
            {t.title} · {STATUS_LABEL[t.status]}
          </span>
        ))}
      </div>
    </div>
    <footer className="foot"><span>本机数据库</span><span>v0.3.0</span></footer>
  </div>
);

Object.assign(window, { ScreenWeek, ScreenMonth, ScreenYear });
