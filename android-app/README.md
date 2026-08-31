# Android app

This project packages the HTTPS deployment as a small Android application. The
building tiles remain on GitHub Pages so UI and data updates do not require a
large APK update.

Build a test APK from this directory:

```sh
./gradlew assembleDebug
```

The output is `app/build/outputs/apk/debug/app-debug.apk`.

The debug build connects to the local preview server at `192.168.3.145:4175`.
Release builds connect to the HTTPS GitHub Pages deployment.
