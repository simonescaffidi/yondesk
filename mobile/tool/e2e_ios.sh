#!/usr/bin/env bash
# App iOS su simulatore come OPERATORE verso un dispositivo remoto nel browser (client web):
# password errata, video, chiusura. Il simulatore condivide la rete del Mac (127.0.0.1).
# A volte il simulatore non avvia l'app dopo la build: la prova ha un limite di tempo e un secondo tentativo.
cd "$(dirname "$0")/.."
OUT=../agent-desktop/e2e-out; mkdir -p $OUT
UDID=${1:?UDID del simulatore}
LIMITE=${E2E_IOS_LIMITE:-1500}   # secondi per tentativo (la prima build Xcode, pod + WebRTC, dura oltre 10 minuti)
export E2E_PEER_TIMEOUT=$LIMITE

tentativo() {
  rm -f $OUT/peer.json
  ( cd ../agent-desktop && node test/e2e/mobile-peer.js host-web ) & PEER=$!
  for i in $(seq 1 120); do [ -f $OUT/peer.json ] && break; sleep 1; done
  ID=$(node -p "require('$OUT/peer.json').id"); PASS=$(node -p "require('$OUT/peer.json').pass")
  flutter test integration_test/app_test.dart -d $UDID \
    --dart-define=YONDESK_SERVER=http://127.0.0.1:${E2E_PORT:-8787} \
    --dart-define=E2E_TARGET_ID=$ID --dart-define=E2E_TARGET_PASS=$PASS & APP=$!
  for i in $(seq 1 $((LIMITE / 5))); do kill -0 $APP 2>/dev/null || break; sleep 5; done
  if kill -0 $APP 2>/dev/null; then
    echo "::warning::prova iOS oltre il limite di ${LIMITE}s: la interrompo"
    pkill -P $APP 2>/dev/null; kill $APP 2>/dev/null; kill $PEER 2>/dev/null; wait $APP $PEER 2>/dev/null
    return 2
  fi
  wait $APP; A=$?; wait $PEER; R=$?
  echo "operatore iOS: app=$A dispositivo remoto=$R"
  [ $A -eq 0 ] && [ $R -eq 0 ]
}

tentativo && exit 0
echo "::warning::primo tentativo iOS fallito: riavvio il simulatore e riprovo"
xcrun simctl shutdown "$UDID" 2>/dev/null; xcrun simctl boot "$UDID" 2>/dev/null; xcrun simctl bootstatus "$UDID" -b
tentativo
