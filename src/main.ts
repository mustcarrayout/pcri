import { createApp } from 'vue'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import App from './App.vue'
import './style.css'

// 刘海屏/挖孔适配：保持边到边渲染（触摸不受影响），由
// capacitor.config.json 的 adjustMarginsForEdgeToEdge=auto 让原生层
// 给 WebView 加系统安全边距；状态栏与 App 同色、图标深色。
if (Capacitor.isNativePlatform()) {
  void StatusBar.setStyle({ style: Style.Light })
  void StatusBar.setBackgroundColor({ color: '#f5f6f2' })
}

createApp(App).mount('#app')
