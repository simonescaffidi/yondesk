import 'dart:io';
import 'package:flutter_background/flutter_background.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

/// Cattura dello schermo del telefono (solo Android).
///
/// Da Android 14 l'ordine è obbligato: 1) consenso di sistema alla cattura,
/// 2) servizio in primo piano di tipo "mediaProjection" (con notifica visibile),
/// 3) avvio della cattura. Un ordine diverso fa chiudere l'app dal sistema.
class ScreenCapture {
  static Future<MediaStream> start() async {
    if (Platform.isAndroid) {
      final granted = await Helper.requestCapturePermission();
      if (!granted) throw Exception('consenso alla cattura negato');
      await _enableForeground();
    }
    return navigator.mediaDevices.getDisplayMedia({'video': true, 'audio': false});
  }

  static Future<void> _enableForeground() async {
    const cfg = FlutterBackgroundAndroidConfig(
      notificationTitle: 'Yondesk',
      notificationText: 'Stai condividendo lo schermo in una sessione di assistenza',
      notificationImportance: AndroidNotificationImportance.normal,
      notificationIcon: AndroidResource(name: 'ic_launcher', defType: 'mipmap'),
      enableWifiLock: true,
      showBadge: false,
      shouldRequestBatteryOptimizationsOff: false,
    );
    var ok = await FlutterBackground.initialize(androidConfig: cfg);
    if (!ok) ok = await FlutterBackground.initialize(androidConfig: cfg);
    if (!ok) throw Exception('servizio in primo piano non disponibile');
    if (!FlutterBackground.isBackgroundExecutionEnabled) {
      final started = await FlutterBackground.enableBackgroundExecution();
      if (!started) throw Exception('servizio in primo piano non avviato');
    }
  }

  static Future<void> stop() async {
    if (!Platform.isAndroid) return;
    try {
      if (FlutterBackground.isBackgroundExecutionEnabled) await FlutterBackground.disableBackgroundExecution();
    } catch (_) {}
  }
}
