# Project Guidelines

## Code Style
- Use TypeScript for application and server code. Vue components use Vue 3 Composition API and `<script setup lang="ts">`.
- Keep changes focused and follow the existing Vue and Capacitor patterns. Prefer the existing Lucide Vue icon package for interface icons.
- Keep user-facing text in Simplified Chinese. Preserve responsive layouts for Android-sized screens and browser previews.

## Architecture
- The client is a Vue 3 + Vite app wrapped for Android with Capacitor 7. Calendar records belong in the Android SQLite database; browser storage is only a development/demo fallback.
- Calendar views are year, month, and day, with day view as the default. Day view separates morning from afternoon/evening and groups events by the four important/urgent quadrants.
- Every calendar event must have a category and at least one tag. Categories distinguish work, interests, and plans. Events imported from DingTalk must always have category `work`; do not allow changing that category while the event remains DingTalk-sourced.
- Keep PDCA notes, voice transcripts, and self-reflections attached to their event and persisted locally. Use native Capacitor speech recognition on Android, with browser speech recognition only as a preview fallback.
- The intended assistant runtime is Pi Agent, with DeepSeek and Zhipu BigModel GLM as the supported model providers. Do not add a provider without updating model selection and provider-specific configuration.
- Model API keys are secrets: never commit them, log them, or store them in SQLite or browser local storage. On Android, use Android Keystore-backed secure storage. Send credentials only over HTTPS to the configured inference runtime and do not persist them server-side.
- Installed Skills are reviewed Markdown capability instructions. Validate their metadata and content, and do not execute arbitrary code bundled with a Skill. Keep tool access allow-listed and least-privileged.
- Real DingTalk authentication/calendar sync requires company app credentials and trusted-domain configuration. Do not present demo/import examples as a live DingTalk connection.

## Build and Test
- Install dependencies with `npm install`.
- Run the browser demo with `npm run dev`.
- Check TypeScript with `npm run typecheck` and create a production web build with `npm run build`.
- Add/sync the Android platform with `npm run android:add` and `npm run android:sync`.
- Build a debug APK from the repository root with `cd android && ./gradlew assembleDebug`. This requires a supported JDK (17 or 21) and an installed Android SDK. The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.
