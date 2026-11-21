// Test di integrazione dell'app mobile contro un dispositivo remoto reale
// (avviato da agent-desktop/test/e2e/mobile-peer.js). Parametri via --dart-define.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:integration_test/integration_test.dart';
import 'package:yondesk/main.dart' as app;

const targetId = String.fromEnvironment('E2E_TARGET_ID');
const targetPass = String.fromEnvironment('E2E_TARGET_PASS');
const hostMode = bool.fromEnvironment('E2E_HOST');
const expectControl = bool.fromEnvironment('E2E_EXPECT_CONTROL');
const expectedHostId = String.fromEnvironment('E2E_EXPECTED_ID');
// punto dello schermo remoto (0..1) dove l'operatore tocca: lì c'è un campo di testo di prova
final tapX = double.parse(const String.fromEnvironment('E2E_TAP_X', defaultValue: '0.1875'));
final tapY = double.parse(const String.fromEnvironment('E2E_TAP_Y', defaultValue: '0.23125'));

String statusOf(WidgetTester t) {
  final f = find.byKey(const Key('status'));
  return f.evaluate().isEmpty ? '(nessuna sessione)' : (t.widget<Text>(f).data ?? '');
}

Future<void> until(WidgetTester t, bool Function() cond, String what, {int seconds = 45}) async {
  final end = DateTime.now().add(Duration(seconds: seconds));
  while (DateTime.now().isBefore(end)) {
    await t.pump(const Duration(milliseconds: 250));
    if (cond()) return;
  }
  fail('timeout: $what — stato app: "${statusOf(t)}"');
}

bool has(Key k) => find.byKey(k).evaluate().isNotEmpty;

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('operatore: collegamento, video, controllo, chiusura', (t) async {
    app.main();
    await t.pumpAndSettle(const Duration(seconds: 1));
    expect(find.text('Offri assistenza'), findsOneWidget);

    // password errata
    await t.enterText(find.byKey(const Key('id')), targetId);
    await t.enterText(find.byKey(const Key('pass')), 'sbagliata9');
    await t.tap(find.byKey(const Key('connect')));
    await until(t, () => statusOf(t) == 'Password errata', 'messaggio di password errata');
    await t.tap(find.byKey(const Key('hangup')));
    await until(t, () => has(const Key('connect')) && !has(const Key('status')), 'ritorno alla schermata iniziale');

    // password giusta: video (prima un altro campo: il binding di test riattiva l'input solo cambiando fuoco)
    await t.enterText(find.byKey(const Key('id')), targetId);
    await t.enterText(find.byKey(const Key('pass')), targetPass);
    await t.pump(const Duration(milliseconds: 300));
    expect(t.widget<TextField>(find.byKey(const Key('pass'))).controller!.text, targetPass);
    await t.tap(find.byKey(const Key('connect')));
    await until(t, () => has(const Key('video')), 'arrivo del video');
    RTCVideoRenderer r() => t.widget<RTCVideoView>(find.byKey(const Key('video'))).videoRenderer;
    await until(t, () => r().videoWidth > 0 && r().videoHeight > 0, 'primo frame decodificato');
    // ignore: avoid_print
    print('E2E video ${r().videoWidth}x${r().videoHeight} · stato "${statusOf(t)}"');

    if (expectControl) {
      await until(t, () => statusOf(t) == 'Controllo attivo' && has(const Key('touchpad')), 'controllo attivo');
      // tocco sul campo di testo remoto: il cursore remoto si sposta e fa clic
      final box = t.getRect(find.byKey(const Key('touchpad')));
      final vw = r().videoWidth.toDouble(), vh = r().videoHeight.toDouble();
      final scale = (box.width / vw) < (box.height / vh) ? box.width / vw : box.height / vh;
      final w = vw * scale, h = vh * scale;
      final origin = Offset(box.left + (box.width - w) / 2, box.top + (box.height - h) / 2);
      await t.pump(const Duration(seconds: 2));
      await t.tapAt(origin + Offset(tapX * w, tapY * h));
      await t.pump(const Duration(seconds: 2));
      // tastiera: testo scritto sul dispositivo remoto
      await t.tap(find.byKey(const Key('kbd')));
      await t.pumpAndSettle(const Duration(milliseconds: 400));
      await t.enterText(find.byKey(const Key('kbdText')), 'yd42');
      await t.tap(find.byKey(const Key('kbdSend')));
      await t.pump(const Duration(seconds: 3));
      await t.tapAt(const Offset(20, 60)); // chiude il pannello tastiera
      await t.pumpAndSettle(const Duration(milliseconds: 400));
    } else {
      await t.pump(const Duration(seconds: 3));
    }

    await t.tap(find.byKey(const Key('hangup')));
    await until(t, () => has(const Key('connect')) && !has(const Key('status')), 'chiusura sessione e ritorno alla schermata iniziale');
  }, skip: hostMode || targetId.isEmpty);

  testWidgets('assistito (Android): ID, consenso, condivisione schermo', (t) async {
    app.main();
    await t.pumpAndSettle(const Duration(seconds: 1));
    await t.tap(find.byKey(const Key('tabHost')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('startShare')));
    await until(t, () {
      final f = find.byKey(const Key('myId'));
      if (f.evaluate().isEmpty) return false;
      final id = (t.widget<SelectableText>(f).data ?? '').replaceAll(RegExp(r'\D'), '');
      return id.length == 9 && (expectedHostId.isEmpty || id == expectedHostId);
    }, 'ID assegnato');
    // l'operatore di prova si collega: consenso nell'app, poi consenso di sistema (toccato via adb dal test)
    await until(t, () => has(const Key('consentAllow')), 'richiesta di consenso', seconds: 90);
    await t.tap(find.byKey(const Key('consentAllow')));
    await until(t, () => statusOf(t) == 'Stai condividendo lo schermo', 'condivisione avviata', seconds: 90);
    // l'operatore di prova chiude quando ha ricevuto il video
    await until(t, () => has(const Key('startShare')) && !has(const Key('status')), 'fine sessione da parte dell\'operatore', seconds: 120);
  }, skip: !hostMode);
}
