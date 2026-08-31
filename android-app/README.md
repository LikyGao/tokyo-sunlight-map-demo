# Android app

This project packages the HTTPS deployment as a small Android application. The
building tiles remain on GitHub Pages so UI and data updates do not require a
large APK update.

Build a test APK from this directory:

```sh
./gradlew assembleDebug
```

The output is `app/build/outputs/apk/debug/app-debug.apk`.
