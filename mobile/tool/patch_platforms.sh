#!/usr/bin/env bash
# Applica permessi e requisiti minimi dopo `flutter create .`
set -e

# --- Android: permessi ---
MANIFEST=android/app/src/main/AndroidManifest.xml
if [ -f "$MANIFEST" ] && ! grep -q "FOREGROUND_SERVICE_MEDIA_PROJECTION" "$MANIFEST"; then
  perm='    <uses-permission android:name="android.permission.INTERNET"/>\n    <uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>\n    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION"/>\n    <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>'
  sed -i.bak "s#<application#$perm\n    <application#" "$MANIFEST"
  echo "AndroidManifest.xml aggiornato"
fi

# --- Android: minSdk 23 (flutter_webrtc) su build.gradle o build.gradle.kts ---
for GRADLE in android/app/build.gradle android/app/build.gradle.kts; do
  [ -f "$GRADLE" ] || continue
  sed -i.bak -E \
    -e 's/minSdkVersion[[:space:]]+(flutter\.minSdkVersion|[0-9]+)/minSdkVersion 23/g' \
    -e 's/minSdk[[:space:]]*=[[:space:]]*(flutter\.minSdkVersion|[0-9]+)/minSdk = 23/g' \
    "$GRADLE" || true
  echo "minSdk impostato in $GRADLE"
done

# --- iOS: platform minima + permessi ---
POD=ios/Podfile
if [ -f "$POD" ]; then
  if grep -q "^# platform :ios" "$POD"; then
    sed -i.bak "s/^# platform :ios.*/platform :ios, '13.0'/" "$POD"
  elif ! grep -q "^platform :ios" "$POD"; then
    printf "platform :ios, '13.0'\n%s" "$(cat "$POD")" > "$POD"
  else
    sed -i.bak "s/^platform :ios.*/platform :ios, '13.0'/" "$POD"
  fi
  echo "Podfile platform iOS 13.0"
fi

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
