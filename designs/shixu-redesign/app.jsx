// 设计画布：三个方向并排对比
// 假设与理由（见 HTML 顶部注释）：内容完全一致，只比较视觉气质与信息层级。
const App = () => (
  <DesignCanvas>
    <DCSection
      id="day"
      title="拾序 · 手机日视图优化"
      subtitle="同一天的内容（2026-10-30 周五 · 6 件事项）· 三种气质 · 均延续纸感 / 叶绿 / 三分类色基因"
    >
      <DCArtboard id="a" label="A · 纸感精修（最贴近现状）" width={390} height={1276} style={{ borderRadius: 14 }}>
        <ScreenA />
      </DCArtboard>
      <DCArtboard id="b" label="B · 手账时间轴" width={390} height={952} style={{ borderRadius: 14 }}>
        <ScreenB />
      </DCArtboard>
      <DCArtboard id="c" label="C · 清爽卡片" width={390} height={1376} style={{ borderRadius: 14 }}>
        <ScreenC />
      </DCArtboard>
    </DCSection>
  </DesignCanvas>
);

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
