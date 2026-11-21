#!/usr/bin/env bash
# App Android su emulatore contro dispositivi remoti veri sul computer che ospita l'emulatore.
#  1) OPERATORE: il telefono si collega all'app desktop Yondesk, vede lo schermo, muove il mouse e scrive
#  2) ASSISTITO: il telefono condivide il proprio schermo a un operatore nel browser
# L'emulatore raggiunge il computer ospite all'indirizzo 10.0.2.2.
cd "$(dirname "$0")/.."
OUT=../agent-desktop/e2e-out; mkdir -p $OUT
DEV=${ANDROID_SERIAL:-emulator-5554}
SERVER=http://10.0.2.2:${E2E_PORT:-8787}
FAIL=0

echo "::group::1) Telefono come operatore verso l'app desktop"
rm -f $OUT/peer.json
( cd ../agent-desktop && xvfb-run -a -s "-screen 0 1280x800x24" node test/e2e/mobile-peer.js host-desktop ) & PEER=$!
for i in $(seq 1 120); do [ -f $OUT/peer.json ] && break; sleep 1; done
ID=$(node -p "require('$OUT/peer.json').id"); PASS=$(node -p "require('$OUT/peer.json').pass")
flutter test integration_test/app_test.dart -d $DEV \
  --dart-define=YONDESK_SERVER=$SERVER \
  --dart-define=E2E_TARGET_ID=$ID --dart-define=E2E_TARGET_PASS=$PASS --dart-define=E2E_EXPECT_CONTROL=true
A=$?; wait $PEER; R=$?
echo "operatore: app=$A dispositivo remoto=$R"; [ $A -eq 0 ] && [ $R -eq 0 ] || FAIL=1
echo "::endgroup::"

echo "::group::2) Telefono come assistito: condivisione schermo verso il browser"
rm -f $OUT/peer.json
export E2E_DEVICE_KEY=e2e-device-key-0123456789abcdef E2E_HOST_PASS=e2emobile9
( cd ../agent-desktop && node test/e2e/mobile-peer.js viewer-web ) & PEER=$!
for i in $(seq 1 120); do [ -f $OUT/peer.json ] && break; sleep 1; done
python3 tool/tap_capture_dialog.py $DEV > $OUT/tap-dialog.log 2>&1 & TAPPER=$!
# istantanee dello schermo durante la condivisione: diventano il video dimostrativo chiesto da Google Play
# per il servizio in primo piano (screenrecord non va bene: disturba la cattura dello schermo dell'app)
mkdir -p $OUT/rec; rm -f $OUT/rec/*.png
( n=0; while true; do n=$((n+1)); adb -s $DEV exec-out screencap -p > $OUT/rec/$(printf %04d $n).png 2>/dev/null; sleep 1; done ) & REC=$!
flutter test integration_test/app_test.dart -d $DEV \
  --dart-define=YONDESK_SERVER=$SERVER --dart-define=E2E_HOST=true \
  --dart-define=E2E_DEVICE_KEY=$E2E_DEVICE_KEY --dart-define=E2E_HOST_PASS=$E2E_HOST_PASS --dart-define=E2E_EXPECTED_ID=424242424
A=$?; wait $PEER; R=$?; kill $TAPPER 2>/dev/null
kill $REC 2>/dev/null
find $OUT/rec -name '*.png' -size -2k -delete
(command -v ffmpeg >/dev/null && ffmpeg -loglevel error -y -framerate 2 -pattern_type glob -i "$OUT/rec/*.png" -vf "scale=540:-2,format=yuv420p" -c:v libx264 $OUT/condivisione-android.mp4 && rm -rf $OUT/rec) || echo "video non creato: restano le istantanee in rec/"
cat $OUT/tap-dialog.log
echo "assistito: app=$A dispositivo remoto=$R"; [ $A -eq 0 ] && [ $R -eq 0 ] || FAIL=1
adb -s $DEV logcat -d -t 6000 2>/dev/null | grep -iE "yondesk|flutter|IsolateHolder|MediaProjection|AndroidRuntime|ForegroundService|FGS|SecurityException" | tail -400 > $OUT/logcat.txt || true
echo "::endgroup::"
exit $FAIL
