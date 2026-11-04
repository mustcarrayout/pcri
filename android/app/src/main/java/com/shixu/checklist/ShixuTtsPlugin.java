package com.shixu.checklist;

import android.content.Context;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;

/**
 * 系统中文 TTS 播报(issue #18)。
 * 不引入社区插件:capacitor-community/text-to-speech 无 Capacitor 7 版本(6.1 直接跳 8)。
 * speak 在播完(或被打断/失败)时 resolve,便于前端收起"播报中"状态。
 */
@CapacitorPlugin(name = "ShixuTts")
public class ShixuTtsPlugin extends Plugin {
  private TextToSpeech tts;
  private boolean ready = false;
  private PluginCall pending;
  private String pendingUtterance = "";

  private synchronized void speakNow(PluginCall call, String text) {
    if (!ready || tts == null) {
      call.reject("TTS_NOT_READY");
      return;
    }
    if (pending != null && pending != call) {
      PluginCall prev = pending;
      pending = null;
      prev.resolve(); // 新播报打断旧播报:旧的按完成收尾
    }
    pending = call;
    tts.stop();
    final String utteranceId = "shixu-" + System.nanoTime();
    pendingUtterance = utteranceId;
    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
      @Override
      public void onStart(String id) {
      }

      @Override
      public void onDone(String id) {
        finishIfCurrent(id);
      }

      @Override
      public void onError(String id) {
        finishIfCurrent(id);
      }

      @Override
      public void onError(String id, int errorCode) {
        finishIfCurrent(id);
      }

      private void finishIfCurrent(String id) {
        synchronized (ShixuTtsPlugin.this) {
          if (!id.equals(pendingUtterance)) return;
          pendingUtterance = "";
          PluginCall c = pending;
          pending = null;
          if (c != null) c.resolve();
        }
      }
    });
    int result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId);
    if (result != TextToSpeech.SUCCESS) {
      pending = null;
      pendingUtterance = "";
      call.reject("TTS_SPEAK_FAIL");
    }
  }

  @PluginMethod
  public void speak(PluginCall call) {
    String text = call.getString("text", "");
    if (text == null || text.trim().isEmpty()) {
      call.resolve();
      return;
    }
    if (tts == null) {
      Context context = getContext();
      pending = call;
      tts = new TextToSpeech(context, status -> {
        synchronized (this) {
          ready = status == TextToSpeech.SUCCESS;
          if (ready) {
            tts.setLanguage(Locale.SIMPLIFIED_CHINESE);
          }
          PluginCall waiting = pending;
          if (waiting != null) {
            pending = null;
            if (ready) {
              speakNow(waiting, text);
            } else {
              waiting.reject("TTS_INIT_FAIL", "系统 TTS 初始化失败");
            }
          }
        }
      });
      return;
    }
    speakNow(call, text);
  }

  @PluginMethod
  public void stop(PluginCall call) {
    synchronized (this) {
      if (tts != null) tts.stop();
      PluginCall c = pending;
      pending = null;
      pendingUtterance = "";
      if (c != null) c.resolve();
    }
    call.resolve();
  }

  @Override
  protected void handleOnDestroy() {
    synchronized (this) {
      if (tts != null) {
        tts.stop();
        tts.shutdown();
        tts = null;
        ready = false;
        pending = null;
        pendingUtterance = "";
      }
    }
    super.handleOnDestroy();
  }
}
