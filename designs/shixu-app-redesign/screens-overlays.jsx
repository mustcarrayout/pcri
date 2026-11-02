// Pi 与对话框系统：对话卡 + 主题 / PDCA / 定时服务 / 钉钉同步 / 模型设置
// 对话框渲染为「浮层截图」：纸底 + 压暗 + 居中 sheet

const Shot = ({ label, children, sheetW }) => (
  <div className="shot" data-screen-label={label}>
    <div className="paper-bg" />
    <div className="dim" />
    <section className="sheet" style={sheetW ? { left: `calc(50% - ${sheetW / 2}px)`, right: "auto", width: sheetW } : undefined}>
      {children}
    </section>
  </div>
);

// ══════════ Pi 对话卡（推动主题的实战场景） ══════════
const ScreenChat = () => (
  <div className="screen paper" data-screen-label="Pi 对话卡" style={{ minHeight: 844 }}>
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
      <span className="ph">告诉 Pi：想学什么、记录、提问…</span>
      <button className="mic"><IcMic size={17} /></button>
      <button className="go"><IcSend size={16} /></button>
    </div>
    <div className="card chat">
      <header className="chat-head">
        <span className="ava"><IcStar size={14} /></span>
        <strong>Pi · 学习教练</strong>
        <span className="chat-model"><IcCog size={11} />DeepSeek</span>
        <button className="chat-x"><IcX size={14} /></button>
      </header>
      <div className="chat-msgs">
        <div className="cmsg user">
          <div className="cbub"><p>推动我的学习主题「英语词根」</p></div>
        </div>
        <div className="cmsg">
          <span className="mark"><IcStar size={12} /></span>
          <div className="cbub">
            <p>看了下证据链：还没讲过、也没用过，今天 09:00 排了第一组词根。两个建议：
              {"\n"}1. 明早精读论文时挑 5 个刚背的词根验证——用一次，证据就成立了。
              {"\n"}2. 今晚复盘时两句话讲给我听「词根怎么帮你猜词义」。</p>
            <button className="csave"><IcCheck size={11} />已创建：明晚 21:00 词根小测</button>
          </div>
        </div>
        <div className="cmsg user">
          <div className="cbub"><p>好，把小测挂到词根主题下</p></div>
        </div>
        <div className="cmsg">
          <span className="mark"><IcStar size={12} /></span>
          <div className="cbub">
            <p>已挂上。英语词根的下一步更新为：明晚小测 30 词根。主题现在有 1 个待办任务。</p>
          </div>
        </div>
      </div>
      <div className="cinput">
        <span className="ph">回复 Pi…</span>
        <button className="mic"><IcMic size={15} /></button>
        <button className="go"><IcSend size={14} /></button>
      </div>
    </div>
    <footer className="foot"><span>Pi 只在对话时联网 · 数据本机</span><span>v0.3.0</span></footer>
  </div>
);

// ══════════ 主题对话框 ══════════
const DialogTopic = () => (
  <Shot label="主题对话框">
    <button className="close"><IcX size={14} /></button>
    <span className="eyebrow">LEARNING TOPIC</span>
    <h2>新学习主题</h2>
    <div className="field">在学什么<input placeholder="如：费曼学习法" /></div>
    <div className="field">为什么学 <small>一句话，学之前先想清楚</small><input placeholder="如：想检验自己是不是真的学会了" /></div>
    <div className="field">打算在哪用 <small>没有用例就先别学</small><input placeholder="如：每次学完新东西都用它自测一次" /></div>
    <div className="field" style={{ marginBottom: -4 }}>状态</div>
    <div className="seg">
      <button className="t-chosen-learning"><IcCheck size={13} />在学</button>
      <button>能用</button>
      <button>能教</button>
      <button>搁置</button>
    </div>
    <div className="field">下一步<input placeholder="如：本周拆 3 个任务到日历" /></div>
    <div className="sheet-actions">
      <button className="ghost">取消</button>
      <button className="solid">保存</button>
    </div>
  </Shot>
);

// ══════════ PDCA 对话框 ══════════
const DialogPdca = () => (
  <Shot label="PDCA 对话框">
    <button className="close"><IcX size={14} /></button>
    <span className="eyebrow">PDCA LOOP</span>
    <h2>跑步 5 公里</h2>
    <div className="pdca-steps">
      <button className="filled"><IcCheck size={11} />P</button>
      <button className="filled"><IcCheck size={11} />D</button>
      <button className="active">C 检查</button>
      <button>A 调整</button>
    </div>
    <div className="pdca-ta">
      5 公里跑完了，配速 6'10"，比计划的 6'30" 快。最后一公里有点撑，明天试试只快不冲……
    </div>
    <button className="voice-btn"><IcMic size={13} />语音记录</button>
    <div className="status-line">AI 一次循环：口述这段，Pi 自动补全 Check 与 Act，并给出明天的调整建议。</div>
    <div className="sheet-actions">
      <button className="ghost">完成</button>
      <button className="solid">保存并下一阶段 <IcArrowR size={14} /></button>
    </div>
  </Shot>
);

// ══════════ 定时服务对话框 ══════════
const DialogRoutines = () => (
  <Shot label="定时服务对话框">
    <button className="close"><IcX size={14} /></button>
    <span className="eyebrow">DAILY ROUTINES</span>
    <h2>定时服务</h2>
    <p className="desc">每天到点由 Pi 按你的指令自动生成内容并提醒。App 关闭时到点只提醒，打开后自动补生成。</p>
    <div className="rt-row">
      <span className="info"><b>每晚复盘 21:30</b><small>回顾今天的日历事项，引导写 Check 和 Act</small></span>
      <span className="toggle on"><i /></span>
      <button className="rt-del"><IcTrash size={12} /></button>
    </div>
    <div className="rt-row">
      <span className="info"><b>睡前儿童故事 21:00</b><small>给 5 岁孩子讲 5 分钟故事，主角是小兔子</small></span>
      <span className="toggle"><i /></span>
      <button className="rt-del"><IcTrash size={12} /></button>
    </div>
    <button className="preset"><IcStar size={13} />用模板创建：每晚复盘（21:30 引导写 Check/Act）</button>
    <div className="field">名称<input placeholder="如：儿童故事" /></div>
    <div className="field">生成指令<input placeholder="如：生成一个 5 分钟的睡前儿童故事…" /></div>
    <div className="time-row">
      <div className="field">开始时间（每天）<input placeholder="21:00" /></div>
      <div className="field">结束时间 <small>过期不补</small><input placeholder="22:00" /></div>
    </div>
    <div className="sheet-actions">
      <button className="ghost">关闭</button>
      <button className="solid"><IcPlus size={14} />添加每日任务</button>
    </div>
  </Shot>
);

// ══════════ 钉钉同步对话框 ══════════
const DialogDing = () => (
  <Shot label="钉钉同步对话框">
    <button className="close"><IcX size={14} /></button>
    <span className="eyebrow">DINGTALK SYNC</span>
    <h2>钉钉日历同步</h2>
    <p className="desc">用钉钉开放平台企业内部应用凭证直连拉取日程（只读）。同步今天起 7 天内的工作日程，按日程 ID 去重合并；密钥只保存在 Android 安全存储。</p>
    <div className="field">Client ID<input placeholder="开放平台应用的 Client ID" /></div>
    <div className="field">Client Secret<input type="password" placeholder="粘贴密钥，不会显示明文" /></div>
    <div className="field">手机号 <small>用于定位你自己的钉钉账号</small><input placeholder="注册钉钉的手机号" /></div>
    <div className="status-line">上次同步：10-31 08:02 · 拉取 3 件 · 新增 1 件</div>
    <div className="sheet-actions">
      <button className="ghost">清除配置</button>
      <button className="ghost">立即同步</button>
      <button className="solid">保存并同步</button>
    </div>
  </Shot>
);

// ══════════ 模型设置对话框 ══════════
const DialogSettings = () => (
  <Shot label="模型设置对话框">
    <button className="close"><IcX size={14} /></button>
    <span className="eyebrow">MODEL SETTINGS</span>
    <h2>模型 API Key</h2>
    <p className="desc">Pi 由 DeepSeek 或智谱 GLM 提供回答，密钥只通过 HTTPS 发送给对应模型服务。真机上保存在 Android 安全存储；浏览器预览仅保留在当前页面。</p>
    <div className="field" style={{ marginBottom: -4 }}>模型服务</div>
    <div className="seg">
      <button className="chosen"><IcCheck size={13} />DeepSeek</button>
      <button>智谱 GLM</button>
    </div>
    <div className="field">API Key <small>在 platform.deepseek.com 获取</small><input type="password" placeholder="粘贴密钥，不会显示明文" /></div>
    <div className="field">模型名称<input placeholder="deepseek-chat" /></div>
    <div className="sheet-actions">
      <button className="ghost">清除密钥</button>
      <button className="solid">保存密钥</button>
    </div>
  </Shot>
);

Object.assign(window, { ScreenChat, DialogTopic, DialogPdca, DialogRoutines, DialogDing, DialogSettings });
