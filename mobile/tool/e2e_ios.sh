#!/usr/bin/env bash
# App iOS su simulatore come OPERATORE verso un dispositivo remoto nel browser (client web):
# password errata, video, chiusura. Il simulatore condivide la rete del Mac (127.0.0.1).
cd "$(dirname "$0")/.."
OUT=../agent-desktop/e2e-out; mkdir -p $OUT; rm -f $OUT/peer.json
UDID=${1:?UDID del simulatore}
# la prima build Xcode (pod + WebRTC) dura oltre 10 minuti: il dispositivo remoto aspetta l'app fino a 30
export E2E_PEER_TIMEOUT=${E2E_PEER_TIMEOUT:-1800}
( cd ../agent-desktop && node test/e2e/mobile-peer.js host-web ) & PEER=$!
for i in $(seq 1 120); do [ -f $OUT/peer.json ] && break; sleep 1; done
ID=$(node -p "require('$OUT/peer.json').id"); PASS=$(node -p "require('$OUT/peer.json').pass")
flutter test integration_test/app_test.dart -d $UDID \
  --dart-define=YONDESK_SERVER=http://127.0.0.1:${E2E_PORT:-8787} \
  --dart-define=E2E_TARGET_ID=$ID --dart-define=E2E_TARGET_PASS=$PASS
A=$?; wait $PEER; R=$?
echo "operatore iOS: app=$A dispositivo remoto=$R"
[ $A -eq 0 ] && [ $R -eq 0 ]
