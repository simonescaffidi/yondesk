import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'signaling.dart';
import 'main.dart' show kServer;

enum Role { host, viewer }

class SessionPage extends StatefulWidget {
  final Role role;
  final String? targetId;
  final String password;
  const SessionPage({super.key, required this.role, this.targetId, required this.password});
  @override
  State<SessionPage> createState() => _SessionPageState();
}

class _SessionPageState extends State<SessionPage> {
  final _remote = RTCVideoRenderer();
  late Yondesk _sig;
  Peer? _peer;
  MediaStream? _local;
  String _status = 'Connessione…';
  String _myId = '';
  String _sessionId = '';

  @override
  void initState() {
    super.initState();
    _remote.initialize().then((_) => _start());
  }

  Future<void> _start() async {
    _sig = Yondesk(kServer);
    final ice = await _sig.iceConfig();
    _sig.events.listen((m) => _onEvent(m, ice));
    _sig.connect();
    if (widget.role == Role.host) {
      _sig.send({'type': 'register', 'name': 'Mobile', 'platform': 'mobile', 'deviceKey': _deviceKey()});
    } else {
      _sig.send({'type': 'connect', 'target': widget.targetId, 'password': widget.password, 'name': 'Operatore mobile'});
      setState(() => _status = 'In attesa di conferma…');
    }
  }

  String _deviceKey() => List.generate(24, (i) => (DateTime.now().microsecond + i).toRadixString(16)).join();

  Future<void> _onEvent(Map<String, dynamic> m, Map<String, dynamic> ice) async {
    switch (m['type']) {
      case 'registered':
        setState(() { _myId = m['id']; _status = 'Pronto · ID ${Yondesk.formatId(_myId)}'; });
        break;
      case 'incoming': // host: verifica password + consenso
        if (m['password'] != widget.password) { _sig.send({'type': 'reject', 'sessionId': m['sessionId'], 'reason': 'auth'}); return; }
        final ok = await _askConsent(m['viewerName'] ?? 'Un operatore');
        if (!ok) { _sig.send({'type': 'reject', 'sessionId': m['sessionId'], 'reason': 'declined'}); return; }
        _sessionId = m['sessionId'];
        _sig.send({'type': 'accept', 'sessionId': _sessionId, 'mode': 'view'});
        await _startHost(ice);
        break;
      case 'accepted': // viewer
        _sessionId = m['sessionId'];
        await _startViewer(ice);
        break;
      case 'rejected':
        setState(() => _status = m['reason'] == 'auth' ? 'Password errata' : 'Rifiutato');
        break;
      case 'signal':
        await _peer?.onSignal(Map<String, dynamic>.from(m['data']));
        break;
      case 'hangup':
      case '_closed':
        _end('Sessione terminata');
        break;
    }
  }

  Future<bool> _askConsent(String who) async {
    return await showDialog<bool>(context: context, barrierDismissible: false, builder: (ctx) => AlertDialog(
      title: const Text('Richiesta di assistenza'),
      content: Text('$who vuole vedere il tuo schermo. Consenti?'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Rifiuta')),
        FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Consenti')),
      ],
    )) ?? false;
  }

  Future<void> _startHost(Map<String, dynamic> ice) async {
    // getDisplayMedia -> il sistema Android chiede conferma per la cattura schermo
    _local = await navigator.mediaDevices.getDisplayMedia({'video': true, 'audio': false});
    _peer = Peer(_sig, _sessionId, true);
    await _peer!.init(ice);
    _peer!.onClosed = () => _end('Sessione terminata');
    await _peer!.addStream(_local!);
    setState(() => _status = 'Stai condividendo lo schermo');
  }

  Future<void> _startViewer(Map<String, dynamic> ice) async {
    _peer = Peer(_sig, _sessionId, false);
    await _peer!.init(ice);
    _peer!.onTrack = (stream) => setState(() => _remote.srcObject = stream);
    _peer!.onClosed = () => _end('Sessione terminata');
    await _peer!.createChannel('ctrl');
    setState(() => _status = 'Sessione attiva');
  }

  void _end(String msg) {
    _peer?.close(); _peer = null;
    _local?.getTracks().forEach((t) => t.stop());
    if (mounted) { setState(() => _status = msg); Future.delayed(const Duration(milliseconds: 600), () { if (mounted) Navigator.pop(context); }); }
  }

  void _hangup() { if (_sessionId.isNotEmpty) _sig.send({'type': 'hangup', 'sessionId': _sessionId}); _end('Chiuso'); }

  @override
  void dispose() { _peer?.close(); _local?.getTracks().forEach((t) => t.stop()); _remote.dispose(); _sig.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    final sharing = widget.role == Role.host;
    return Scaffold(
      appBar: AppBar(title: Text(sharing ? 'Condivisione' : 'Schermo remoto'),
        backgroundColor: sharing ? Colors.red.shade700 : null),
      body: Column(children: [
        if (sharing)
          Container(width: double.infinity, color: Colors.red.shade700, padding: const EdgeInsets.all(8),
            child: const Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              Icon(Icons.fiber_manual_record, size: 14), SizedBox(width: 6),
              Text('Sessione di assistenza attiva', style: TextStyle(fontWeight: FontWeight.bold))])),
        Expanded(child: Container(color: Colors.black,
          child: sharing
              ? const Center(child: Text('Stai condividendo lo schermo', style: TextStyle(color: Colors.white54)))
              : (_remote.srcObject != null ? RTCVideoView(_remote) : Center(child: Text(_status, style: const TextStyle(color: Colors.white54)))))),
        Padding(padding: const EdgeInsets.all(12),
          child: Row(children: [
            Expanded(child: Text(_status)),
            FilledButton.icon(style: FilledButton.styleFrom(backgroundColor: Colors.red),
              onPressed: _hangup, icon: const Icon(Icons.call_end), label: const Text('Termina')),
          ])),
      ]),
    );
  }
}
