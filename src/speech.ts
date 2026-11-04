// ── Pi 回复语音播报(issue #18):说完能听答 ──
// 真机:自研 ShixuTts 原生插件(android.speech.tts,无社区插件可用——无 Cap7 版本);
// 浏览器预览:Web Speech API 降级。播完(或被打断)resolve,前端据此收起状态。

import { Capacitor, registerPlugin } from "@capacitor/core";

interface ShixuTtsPluginInterface {
  speak(options: { text: string }): Promise<void>;
  stop(): Promise<void>;
}

const ShixuTts = registerPlugin<ShixuTtsPluginInterface>("ShixuTts");

const MAX_SPEAK_CHARS = 2000; // 超长 Pi 回复截断,Android TTS 自身上限 4000

function webSpeak(text: string): Promise<void> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) {
      resolve();
      return;
    }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    synth.speak(utterance);
  });
}

export async function speak(text: string): Promise<void> {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_SPEAK_CHARS);
  if (!clean) return;
  if (Capacitor.isNativePlatform()) {
    try {
      await ShixuTts.speak({ text: clean });
      return;
    } catch {
      // 引擎初始化失败等:落到 Web Speech(WebView 不支持则静默结束)
    }
  }
  await webSpeak(clean);
}

export async function stopSpeak(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await ShixuTts.stop();
    } catch {
      /* 引擎未初始化即无可停 */
    }
  }
  window.speechSynthesis?.cancel();
}
