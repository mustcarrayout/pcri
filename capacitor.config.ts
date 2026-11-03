import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.shixu.checklist",
  appName: "拾序",
  webDir: "dist",
  android: {
    adjustMarginsForEdgeToEdge: "auto",
  },
};

export default config;
