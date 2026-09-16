# Family Learning Hub Android WebView POC

This Android shell loads the live Family Learning Hub frontend from:

`https://fadiaboalward.github.io/family-learning-hub/`

The learning content and learner state remain database-driven through the existing Supabase backend. Normal content and frontend updates therefore do not require rebuilding the APK.

## Build

From the `android/` directory with JDK 17, Android SDK 36, Android Gradle Plugin 8.13.2 and Gradle 8.13:

```bash
gradle :app:assembleDebug
```

Debug APK output:

`app/build/outputs/apk/debug/app-debug.apk`

The debug APK is suitable for direct sideload testing. A future Google Play internal-test build should use a separately signed release AAB.
