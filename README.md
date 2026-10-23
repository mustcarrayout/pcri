# 拾序 · 安卓个人清单

基于 Vue 3、Vite 和 Capacitor 的安卓个人清单应用，计划接入钉钉工作台和 DeepSeek 对话助手。

## 本地运行

```sh
npm install
npm run dev
```

## Pi 助手

在日历页 Pi 面板右上角配置模型 API Key，支持 DeepSeek 与智谱 GLM，App 直连模型服务的 HTTPS 接口、不走中间服务器。真机上密钥保存在 Android 安全存储（Keystore 加密），浏览器预览仅保留在当前页面内存中，不会写入日历数据或日志。

## 数据本地化

日历、PDCA、语音转写和反思全部保存在手机本机（Android SQLite）。应用没有任何自有后端：唯一的对外请求是 Pi 对话时发给所选模型服务商的内容（对话消息、最近聊天记录和当天日程摘要），不包含 PDCA 正文、语音转写和反思。语音识别由 Android 系统语音服务处理。
