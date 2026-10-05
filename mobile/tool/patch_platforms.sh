#!/usr/bin/env bash
# Applica i permessi necessari dopo `flutter create .`
set -e
MANIFEST=android/app/src/main/AndroidManifest.xml
if [ -f "$MANIFEST" ] && ! grep -q "FOREGROUND_SERVICE_MEDIA_PROJECTION" "$MANIFEST"; then
  perm='    <uses-permission android:name="android.permission.INTERNET"/>\n    <uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>\n    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION"/>\n    <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>'
  sed -i.bak "s#<application#$perm\n    <application#" "$MANIFEST"
  echo "AndroidManifest.xml aggiornato"
fi
# minSdk 23 per flutter_webrtc
GRADLE=android/app/build.gradle
if [ -f "$GRADLE" ]; then
  sed -i.bak 's/minSdkVersion [0-9]*/minSdkVersion 23/; s/minSdk = [0-9]*/minSdk = 23/' "$GRADLE" || true
fi
# iOS: permessi microfono/camera + nota broadcast extension
PLIST=ios/Runner/Info.plist
if [ -f "$PLIST" ] && ! grep -q NSCameraUsageDescription "$PLIST"; then
  python3 - "$PLIST" <<'PY'
import sys,plistlib
p=sys.argv[1]
with open(p,'rb') as f: d=plistlib.load(f)
d['NSCameraUsageDescription']='Necessario per le sessioni di assistenza remota.'
d['NSMicrophoneUsageDescription']='Necessario per l audio durante le sessioni.'
with open(p,'wb') as f: plistlib.dump(d,f)
print('Info.plist aggiornato')
PY
fi
