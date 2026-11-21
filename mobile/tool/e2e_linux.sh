#!/usr/bin/env bash
# App mobile (compilata per desktop Linux) come OPERATORE verso l'app desktop Yondesk:
# password errata, video, controllo mouse e tastiera, chiusura.
# Serve un display X (xvfb-run -a) e un server audio anche finto (pulseaudio con sink nullo).
cd "$(dirname "$0")/.."
OUT=../agent-desktop/e2e-out; mkdir -p $OUT; rm -f $OUT/peer.json
( cd ../agent-desktop && node test/e2e/mobile-peer.js host-desktop ) & PEER=$!
for i in $(seq 1 90); do [ -f $OUT/peer.json ] && break; sleep 1; done
[ -f $OUT/peer.json ] || { echo "dispositivo remoto di prova non partito"; kill $PEER 2>/dev/null; exit 1; }
ID=$(node -p "require('$OUT/peer.json').id"); PASS=$(node -p "require('$OUT/peer.json').pass")
flutter test integration_test/app_test.dart -d linux \
  --dart-define=YONDESK_SERVER=http://127.0.0.1:${E2E_PORT:-8787} \
  --dart-define=E2E_TARGET_ID=$ID --dart-define=E2E_TARGET_PASS=$PASS --dart-define=E2E_EXPECT_CONTROL=true
APP=$?
wait $PEER; REMOTE=$?
echo "esito app=$APP dispositivo remoto=$REMOTE"
[ $APP -eq 0 ] && [ $REMOTE -eq 0 ]
