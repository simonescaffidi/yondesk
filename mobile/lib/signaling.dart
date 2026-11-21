import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';

/// Client di signaling per l'app mobile.
/// Modello consensuale: chi è assistito deve accettare; la sessione è cifrata end-to-end.
class Yondesk {
  final String serverBase;
  late final String _wsUrl;
  WebSocketChannel? _ch;
  bool _disposed = false;
  final _events = StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get events => _events.stream;

  Yondesk(this.serverBase) {
    final u = Uri.parse(serverBase);
    final scheme = u.scheme == 'https' ? 'wss' : 'ws';
    _wsUrl = '$scheme://${u.authority}/ws';
  }

  static String genPassword([int len = 8]) {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    final r = Random.secure();
    return List.generate(len, (_) => chars[r.nextInt(chars.length)]).join();
  }

  static String genKey() {
    final r = Random.secure();
    return List.generate(24, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  }

  static String formatId(String id) =>
      id.replaceAll(RegExp(r'\D'), '').replaceAllMapped(RegExp(r'(\d{3})(?=\d)'), (m) => '${m[1]} ');

  Future<Map<String, dynamic>> iceConfig() async {
    try {
      final r = await http.get(Uri.parse('$serverBase/api/ice')).timeout(const Duration(seconds: 8));
      return jsonDecode(r.body) as Map<String, dynamic>;
    } catch (_) {
      return {
        'iceServers': [
          {'urls': 'stun:stun.l.google.com:19302'}
        ]
      };
    }
  }

  void connect() {
    _ch = WebSocketChannel.connect(Uri.parse(_wsUrl));
    _ch!.stream.listen((raw) {
      try {
        final m = jsonDecode(raw as String) as Map<String, dynamic>;
        if (!_disposed) _events.add(m);
      } catch (_) {}
    },
        onDone: () { if (!_disposed) _events.add({'type': '_closed'}); },
        onError: (_) { if (!_disposed) _events.add({'type': '_closed'}); });
  }

  void send(Map<String, dynamic> m) {
    if (_disposed) return;
    try { _ch?.sink.add(jsonEncode(m)); } catch (_) {}
  }

  void dispose() {
    _disposed = true;
    _ch?.sink.close();
    _events.close();
  }
}

/// Wrapper di RTCPeerConnection.
///
/// Regola di protocollo (uguale su desktop e web): è SEMPRE il dispositivo assistito (host)
/// ad aggiungere video e canali dati e quindi a fare l'offerta; l'operatore risponde soltanto.
/// I messaggi di signaling vengono elaborati uno alla volta e solo quando la connessione è
/// pronta: niente candidati persi se arrivano prima della descrizione remota.
class Peer {
  final Yondesk sig;
  final String sessionId;
  RTCPeerConnection? _pc;
  final _ready = Completer<void>();
  Future<void> _chain = Future.value();
  final List<RTCIceCandidate> _pending = [];
  bool _remoteSet = false;
  bool _closed = false;
  Timer? _disconnectTimer;
  final Map<String, RTCDataChannel> channels = {};

  void Function(MediaStream stream)? onTrack;
  void Function(String label)? onChannelOpen;
  void Function(String label, String data)? onData;
  void Function()? onClosed;

  Peer(this.sig, this.sessionId);

  Future<void> init(Map<String, dynamic> ice) async {
    final pc = await createPeerConnection({
      'iceServers': ice['iceServers'] ?? [],
      'sdpSemantics': 'unified-plan',
    });
    if (_closed) { await pc.close(); return; }
    _pc = pc;
    pc.onIceCandidate = (c) {
      final cand = c.candidate;
      if (cand == null || cand.isEmpty) return;
      sig.send({
        'type': 'signal',
        'sessionId': sessionId,
        'data': {
          'candidate': {'candidate': cand, 'sdpMid': c.sdpMid, 'sdpMLineIndex': c.sdpMLineIndex}
        }
      });
    };
    pc.onTrack = (e) {
      if (e.track.kind != 'video') return;
      if (e.streams.isNotEmpty) onTrack?.call(e.streams[0]);
    };
    pc.onDataChannel = _bind;
    pc.onConnectionState = (s) {
      debugPrint('[yondesk] connessione $s');
      _disconnectTimer?.cancel();
      if (s == RTCPeerConnectionState.RTCPeerConnectionStateFailed ||
          s == RTCPeerConnectionState.RTCPeerConnectionStateClosed) {
        if (!_closed) onClosed?.call();
      } else if (s == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected) {
        // rete instabile: aspetta qualche secondo prima di chiudere
        _disconnectTimer = Timer(const Duration(seconds: 8), () {
          if (!_closed && _pc?.connectionState == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected) onClosed?.call();
        });
      }
    };
    _ready.complete();
  }

  void _bind(RTCDataChannel ch) {
    final label = ch.label ?? '';
    channels[label] = ch;
    ch.onMessage = (m) { if (!m.isBinary) onData?.call(label, m.text); };
    ch.onDataChannelState = (s) {
      if (s == RTCDataChannelState.RTCDataChannelOpen) onChannelOpen?.call(label);
    };
    if (ch.state == RTCDataChannelState.RTCDataChannelOpen) onChannelOpen?.call(label);
  }

  /// Solo host: apre un canale dati (prima dell'offerta).
  Future<RTCDataChannel> createChannel(String label) async {
    await _ready.future;
    final ch = await _pc!.createDataChannel(label, RTCDataChannelInit()..ordered = true);
    _bind(ch);
    return ch;
  }

  /// Solo host: aggiunge lo schermo catturato.
  Future<void> addStream(MediaStream stream) async {
    await _ready.future;
    for (final t in stream.getTracks()) {
      await _pc!.addTrack(t, stream);
    }
  }

  /// Solo host: invia l'offerta (dopo "accept").
  Future<void> makeOffer() async {
    await _ready.future;
    final pc = _pc!;
    final offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sig.send({
      'type': 'signal',
      'sessionId': sessionId,
      'data': {
        'description': {'type': offer.type, 'sdp': offer.sdp}
      }
    });
  }

  bool send(String label, Map<String, dynamic> msg) {
    final ch = channels[label];
    if (ch == null || ch.state != RTCDataChannelState.RTCDataChannelOpen) return false;
    ch.send(RTCDataChannelMessage(jsonEncode(msg)));
    return true;
  }

  /// Messaggio di signaling dall'altra parte: in coda, uno alla volta.
  void onSignal(Map<String, dynamic> data) {
    _chain = _chain.then((_) => _handle(data)).catchError((Object e) {
      debugPrint('[yondesk] errore signaling: $e');
    });
  }

  Future<void> _handle(Map<String, dynamic> data) async {
    await _ready.future;
    final pc = _pc;
    if (_closed || pc == null) return;
    if (data['description'] != null) {
      final d = Map<String, dynamic>.from(data['description'] as Map);
      final type = d['type'] as String?;
      await pc.setRemoteDescription(RTCSessionDescription(d['sdp'] as String?, type));
      _remoteSet = true;
      for (final c in _pending) {
        await pc.addCandidate(c);
      }
      _pending.clear();
      if (type == 'offer') {
        final answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sig.send({
          'type': 'signal',
          'sessionId': sessionId,
          'data': {
            'description': {'type': answer.type, 'sdp': answer.sdp}
          }
        });
      }
    } else if (data['candidate'] != null) {
      final c = Map<String, dynamic>.from(data['candidate'] as Map);
      final cand = RTCIceCandidate(c['candidate'] as String?, c['sdpMid'] as String?, (c['sdpMLineIndex'] as num?)?.toInt());
      if (_remoteSet) {
        await pc.addCandidate(cand);
      } else {
        _pending.add(cand);
      }
    }
  }

  void close() {
    if (_closed) return;
    _closed = true;
    _disconnectTimer?.cancel();
    channels.clear();
    // chiudere la connessione chiude anche i canali dati; gli errori di chiusura non interessano
    final pc = _pc;
    _pc = null;
    if (pc != null) {
      pc.close().catchError((Object _) {});
    }
  }
}
