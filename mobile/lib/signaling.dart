import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';

/// Client di signaling + WebRTC per l'app mobile.
/// Modello consensuale: l'host (chi è assistito) deve accettare; sessione cifrata E2E.
class Yondesk {
  final String serverBase;
  late final String _wsUrl;
  WebSocketChannel? _ch;
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

  static String formatId(String id) =>
      id.replaceAllMapped(RegExp(r'(\d{3})(?=\d)'), (m) => '${m[1]} ');

  Future<Map<String, dynamic>> iceConfig() async {
    try {
      final r = await http.get(Uri.parse('$serverBase/api/ice'));
      return jsonDecode(r.body) as Map<String, dynamic>;
    } catch (_) {
      return {'iceServers': [{'urls': 'stun:stun.l.google.com:19302'}]};
    }
  }

  void connect() {
    _ch = WebSocketChannel.connect(Uri.parse(_wsUrl));
    _ch!.stream.listen((raw) {
      try {
        final m = jsonDecode(raw as String) as Map<String, dynamic>;
        _events.add(m);
      } catch (_) {}
    }, onDone: () => _events.add({'type': '_closed'}), onError: (_) => _events.add({'type': '_closed'}));
  }

  void send(Map<String, dynamic> m) => _ch?.sink.add(jsonEncode(m));

  void dispose() {
    _ch?.sink.close();
    _events.close();
  }
}

/// Wrapper RTCPeerConnection condiviso (perfect negotiation).
class Peer {
  final Yondesk sig;
  final String sessionId;
  final bool polite;
  late RTCPeerConnection pc;
  bool makingOffer = false, ignoreOffer = false;
  final Map<String, RTCDataChannel> channels = {};
  void Function(MediaStream)? onTrack;
  void Function(String label, String data)? onData;
  void Function()? onClosed;

  Peer(this.sig, this.sessionId, this.polite);

  Future<void> init(Map<String, dynamic> ice) async {
    pc = await createPeerConnection({'iceServers': ice['iceServers']});
    pc.onIceCandidate = (c) {
      if (c.candidate != null) {
        sig.send({'type': 'signal', 'sessionId': sessionId, 'data': {'candidate': c.toMap()}});
      }
    };
    pc.onTrack = (e) { if (e.streams.isNotEmpty) onTrack?.call(e.streams[0]); };
    pc.onDataChannel = (ch) => _bind(ch);
    pc.onConnectionState = (s) {
      if (s == RTCPeerConnectionState.RTCPeerConnectionStateFailed ||
          s == RTCPeerConnectionState.RTCPeerConnectionStateClosed ||
          s == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected) {
        onClosed?.call();
      }
    };
  }

  void _bind(RTCDataChannel ch) {
    channels[ch.label!] = ch;
    ch.onMessage = (m) => onData?.call(ch.label!, m.text);
  }

  Future<RTCDataChannel> createChannel(String label) async {
    final ch = await pc.createDataChannel(label, RTCDataChannelInit()..ordered = true);
    _bind(ch);
    return ch;
  }

  Future<void> addStream(MediaStream stream) async {
    for (final t in stream.getTracks()) {
      await pc.addTrack(t, stream);
    }
  }

  Future<void> onSignal(Map<String, dynamic> data) async {
    try {
      if (data['description'] != null) {
        final d = data['description'];
        final desc = RTCSessionDescription(d['sdp'], d['type']);
        final collision = d['type'] == 'offer' &&
            (makingOffer || pc.signalingState != RTCSignalingState.RTCSignalingStateStable);
        ignoreOffer = !polite && collision;
        if (ignoreOffer) return;
        await pc.setRemoteDescription(desc);
        if (d['type'] == 'offer') {
          final answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sig.send({'type': 'signal', 'sessionId': sessionId, 'data': {'description': answer.toMap()}});
        }
      } else if (data['candidate'] != null) {
        final c = data['candidate'];
        await pc.addCandidate(RTCIceCandidate(c['candidate'], c['sdpMid'], c['sdpMLineIndex']));
      }
    } catch (_) {}
  }

  Future<void> makeOffer() async {
    makingOffer = true;
    final offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sig.send({'type': 'signal', 'sessionId': sessionId, 'data': {'description': offer.toMap()}});
    makingOffer = false;
  }

  void close() {
    for (final c in channels.values) { c.close(); }
    pc.close();
  }
}
