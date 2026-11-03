// 冒烟测试桩:learningLoop 默认走 localStorage 降级路径;
// 测试置 native.enabled = true 可切到 SQLite 打桩路径(迁移用例)
export const native = { enabled: false };
export const Capacitor = { isNativePlatform: () => native.enabled };
