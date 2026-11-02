// 画布组合：三分区十二屏
const App = () => (
  <DesignCanvas>
    <DCSection
      id="core"
      title="① 核心流"
      subtitle="登录 → 学习首页（Home）→ 今天：每个屏幕都在回答「学习走到哪了、下一步做什么」"
    >
      <DCArtboard id="login" label="登录页 · 学习叙事" width={390} height={844} style={{ borderRadius: 14 }}>
        <ScreenLogin />
      </DCArtboard>
      <DCArtboard id="home" label="学习首页 · 主题为本体" width={390} height={930} style={{ borderRadius: 14 }}>
        <ScreenHome />
      </DCArtboard>
      <DCArtboard id="today" label="今天 · 日程投影" width={390} height={1250} style={{ borderRadius: 14 }}>
        <ScreenToday />
      </DCArtboard>
    </DCSection>
    <DCSection
      id="calendar"
      title="② 日历投影"
      subtitle="主题在时间里的视图：周 / 月 / 年，同一套卡片语言"
    >
      <DCArtboard id="week" label="周视图" width={390} height={848} style={{ borderRadius: 14 }}>
        <ScreenWeek />
      </DCArtboard>
      <DCArtboard id="month" label="月视图" width={390} height={786} style={{ borderRadius: 14 }}>
        <ScreenMonth />
      </DCArtboard>
      <DCArtboard id="year" label="年视图" width={390} height={826} style={{ borderRadius: 14 }}>
        <ScreenYear />
      </DCArtboard>
    </DCSection>
    <DCSection
      id="overlays"
      title="③ Pi 与对话框系统"
      subtitle="对话卡 + 主题 / PDCA / 定时服务 / 钉钉同步 / 模型设置：同一套 sheet 语言"
    >
      <DCArtboard id="chat" label="Pi 对话卡 · 推动主题" width={390} height={848} style={{ borderRadius: 14 }}>
        <ScreenChat />
      </DCArtboard>
      <DCArtboard id="d-topic" label="对话框 · 主题" width={390} height={844} style={{ borderRadius: 14 }}>
        <DialogTopic />
      </DCArtboard>
      <DCArtboard id="d-pdca" label="对话框 · PDCA" width={390} height={844} style={{ borderRadius: 14 }}>
        <DialogPdca />
      </DCArtboard>
      <DCArtboard id="d-routines" label="对话框 · 定时服务" width={390} height={844} style={{ borderRadius: 14 }}>
        <DialogRoutines />
      </DCArtboard>
      <DCArtboard id="d-ding" label="对话框 · 钉钉同步" width={390} height={844} style={{ borderRadius: 14 }}>
        <DialogDing />
      </DCArtboard>
      <DCArtboard id="d-settings" label="对话框 · 模型设置" width={390} height={844} style={{ borderRadius: 14 }}>
        <DialogSettings />
      </DCArtboard>
    </DCSection>
  </DesignCanvas>
);

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
