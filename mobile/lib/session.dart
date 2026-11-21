import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'capture.dart';
import 'main.dart' show kServer, deviceKey;
import 'signaling.dart';

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
  Yondesk? _sig;
  StreamSubscription<Map<String, dynamic>>? _sub;
  Map<String, dynamic> _ice = const {};
  Peer? _peer;
  MediaStream? _local;
  String _status = 'Connessione…';
  String _myId = '';
  String _sessionId = '';
  String _mode = 'view';
  bool _live = false; // sessione in corso
  bool _hasVideo = false;
  bool _ended = false;
  bool _starting = false; // host: avvio cattura in corso
  bool _ctrlOpen = false;

  bool get _isHost => widget.role == Role.host;
  bool get _canControl => !_isHost && _mode == 'control' && _ctrlOpen;

  @override
  void initState() {
    super.initState();
    _remote.onResize = () { if (mounted) setState(() {}); };
    _remote.initialize().then((_) => _start());
  }

  Future<void> _start() async {
    final sig = Yondesk(kServer);
    _sig = sig;
    _ice = await sig.iceConfig();
    if (!mounted) return;
    _sub = sig.events.listen(_onEvent);
    sig.connect();
    if (_isHost) {
      sig.send({'type': 'register', 'name': 'Telefono', 'platform': 'mobile', 'deviceKey': await deviceKey()});
    } else {
      sig.send({'type': 'connect', 'target': widget.targetId, 'password': widget.password, 'name': 'Operatore (telefono)'});
    }
  }

  void _set(String s) { if (mounted) setState(() => _status = s); }

  Future<void> _onEvent(Map<String, dynamic> m) async {
    switch (m['type']) {
      case 'registered':
        if (mounted) setState(() { _myId = '${m['id']}'; _status = 'In attesa dell\'operatore…'; });
        break;
      case 'pending':
        _set('In attesa di conferma sul dispositivo remoto…');
        break;
      case 'incoming':
        await _onIncoming(m);
        break;
      case 'accepted': // operatore: il peer deve esistere subito, l'offerta dell'host arriva a breve
        _sessionId = '${m['sessionId']}';
        _mode = m['mode'] == 'control' ? 'control' : 'view';
        _startViewer();
        break;
      case 'rejected':
        _finish(const {
              'auth': 'Password errata',
              'busy': 'Dispositivo occupato in un\'altra sessione',
              'capture': 'Il dispositivo remoto non può condividere lo schermo',
            }['${m['reason']}'] ?? 'Richiesta rifiutata', pop: false);
        break;
      case 'error':
        _finish(const {
              'offline': 'Dispositivo non in linea',
              'blocked': 'Troppi tentativi, riprova più tardi',
              'self': 'ID non valido',
            }['${m['code']}'] ?? 'Errore di connessione', pop: false);
        break;
      case 'signal':
        if ('${m['sessionId']}' == _sessionId && m['data'] is Map) {
          _peer?.onSignal(Map<String, dynamic>.from(m['data'] as Map));
        }
        break;
      case 'hangup':
        if (_starting && '${m['sessionId']}' == _sessionId) { _starting = false; _sessionId = ''; break; }
        if (!_isHost && !_live) { _finish(m['reason'] == 'timeout' ? 'Nessuna risposta dal dispositivo remoto' : 'Richiesta annullata', pop: false); break; }
        if (_live) _finish('Sessione terminata');
        break;
      case 'replaced':
        _finish('Yondesk è stato aperto su un altro dispositivo con lo stesso profilo', pop: false);
        break;
      case '_closed':
        if (!_ended) _finish('Connessione al server persa', pop: false);
        break;
    }
  }

  // ---------------- ASSISTITO (Android) ----------------
  Future<void> _onIncoming(Map<String, dynamic> m) async {
    final sig = _sig!;
    final sid = '${m['sessionId']}';
    if (_live || _starting) { sig.send({'type': 'reject', 'sessionId': sid, 'reason': 'busy'}); return; }
    if ('${m['password']}' != widget.password) { sig.send({'type': 'reject', 'sessionId': sid, 'reason': 'auth'}); return; }
    _starting = true;
    _sessionId = sid;
    final ok = await _askConsent('${m['viewerName'] ?? 'Un operatore'}');
    if (!_starting || _sessionId != sid) return; // richiesta scaduta nel frattempo
    if (!ok) { _starting = false; _sessionId = ''; sig.send({'type': 'reject', 'sessionId': sid, 'reason': 'declined'}); return; }

    // Ordine importante: cattura -> peer con video e canale -> "accept" -> offerta.
    MediaStream stream;
    try {
      _set('Autorizza la condivisione dello schermo…');
      stream = await ScreenCapture.start();
    } catch (e) {
      debugPrint('[yondesk] cattura: $e');
      await ScreenCapture.stop();
      _starting = false; _sessionId = '';
      sig.send({'type': 'reject', 'sessionId': sid, 'reason': 'capture'});
      _set('Condivisione non autorizzata. In attesa dell\'operatore…');
      return;
    }
    if (!_starting || _sessionId != sid || !mounted) { // l'operatore ha rinunciato
      for (final t in stream.getTracks()) { await t.stop(); }
      await ScreenCapture.stop();
      return;
    }
    _local = stream;
    final peer = Peer(sig, sid);
    _peer = peer;
    peer.onClosed = () => _finish('Sessione terminata');
    await peer.init(_ice);
    await peer.createChannel('ctrl');
    await peer.addStream(stream);
    sig.send({'type': 'accept', 'sessionId': sid, 'mode': 'view'});
    await peer.makeOffer();
    _starting = false;
    if (mounted) setState(() { _live = true; _status = 'Stai condividendo lo schermo'; });
  }

  Future<bool> _askConsent(String who) async {
    if (!mounted) return false;
    return await showDialog<bool>(context: context, barrierDismissible: false, builder: (ctx) => AlertDialog(
      title: const Text('Richiesta di assistenza'),
      content: Text('$who vuole vedere lo schermo di questo telefono. Consenti?'),
      actions: [
        TextButton(key: const Key('consentDeny'), onPressed: () => Navigator.pop(ctx, false), child: const Text('Rifiuta')),
        FilledButton(key: const Key('consentAllow'), onPressed: () => Navigator.pop(ctx, true), child: const Text('Consenti')),
      ],
    )) ?? false;
  }

  // ---------------- OPERATORE ----------------
  void _startViewer() {
    final peer = Peer(_sig!, _sessionId);
    _peer = peer;
    peer.onTrack = (stream) {
      _remote.srcObject = stream;
      if (mounted) setState(() => _hasVideo = true);
    };
    peer.onChannelOpen = (label) { if (label == 'ctrl' && mounted) setState(() => _ctrlOpen = true); };
    peer.onClosed = () => _finish('Sessione terminata');
    peer.init(_ice); // i messaggi in arrivo restano in coda finché non è pronto
    if (mounted) setState(() { _live = true; _status = _mode == 'control' ? 'Controllo attivo' : 'Sola visione'; });
  }

  void _send(Map<String, dynamic> ev) { if (_canControl) _peer?.send('ctrl', ev); }

  /// Converte un punto toccato nel riquadro video in coordinate 0..1 dello schermo remoto.
  Offset? _rel(Offset p, Size box) {
    final vw = _remote.videoWidth.toDouble(), vh = _remote.videoHeight.toDouble();
    if (vw <= 0 || vh <= 0) return null;
    final scale = (box.width / vw) < (box.height / vh) ? box.width / vw : box.height / vh;
    final w = vw * scale, h = vh * scale;
    final x = (p.dx - (box.width - w) / 2) / w, y = (p.dy - (box.height - h) / 2) / h;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return Offset(x, y);
  }

  void _click(Offset p, Size box, {int button = 0, bool dbl = false}) {
    final r = _rel(p, box);
    if (r == null) return;
    _send({'t': 'move', 'x': r.dx, 'y': r.dy});
    if (dbl) { _send({'t': 'dblclick'}); return; }
    _send({'t': 'down', 'b': button});
    _send({'t': 'up', 'b': button});
  }

  Widget _videoArea() {
    return LayoutBuilder(builder: (ctx, c) {
      final box = Size(c.maxWidth, c.maxHeight);
      final view = RTCVideoView(_remote, key: const Key('video'), objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitContain);
      if (!_canControl) return view;
      Offset? dbl;
      return GestureDetector(
        key: const Key('touchpad'),
        behavior: HitTestBehavior.opaque,
        onTapUp: (d) => _click(d.localPosition, box),
        onDoubleTapDown: (d) => dbl = d.localPosition,
        onDoubleTap: () { final p = dbl; if (p != null) _click(p, box, dbl: true); },
        onLongPressStart: (d) { HapticFeedback.selectionClick(); _click(d.localPosition, box, button: 2); },
        onPanStart: (d) { final r = _rel(d.localPosition, box); if (r != null) { _send({'t': 'move', 'x': r.dx, 'y': r.dy}); _send({'t': 'down', 'b': 0}); } },
        onPanUpdate: (d) { final r = _rel(d.localPosition, box); if (r != null) _send({'t': 'move', 'x': r.dx, 'y': r.dy}); },
        onPanEnd: (_) => _send({'t': 'up', 'b': 0}),
        onPanCancel: () => _send({'t': 'up', 'b': 0}),
        child: view,
      );
    });
  }

  Future<void> _keyboard() async {
    final ctl = TextEditingController();
    void key(String k) { _send({'t': 'key', 'key': k, 'down': true}); _send({'t': 'key', 'key': k, 'down': false}); }
    await showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (ctx) => Padding(
      padding: EdgeInsets.only(left: 16, right: 16, top: 16, bottom: MediaQuery.of(ctx).viewInsets.bottom + 16),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(key: const Key('kbdText'), controller: ctl, autofocus: true, autocorrect: false,
          decoration: InputDecoration(labelText: 'Testo da scrivere sul dispositivo remoto', border: const OutlineInputBorder(),
            suffixIcon: IconButton(key: const Key('kbdSend'), icon: const Icon(Icons.send), onPressed: () {
              if (ctl.text.isNotEmpty) { _send({'t': 'text', 'text': ctl.text}); ctl.clear(); }
            })),
          onSubmitted: (v) { if (v.isNotEmpty) _send({'t': 'text', 'text': v}); key('Enter'); ctl.clear(); }),
        const SizedBox(height: 8),
        Wrap(spacing: 8, children: [
          for (final k in const [['Invio', 'Enter'], ['⌫', 'Backspace'], ['Tab', 'Tab'], ['Esc', 'Escape'], ['←', 'Left'], ['↑', 'Up'], ['↓', 'Down'], ['→', 'Right']])
            OutlinedButton(onPressed: () => key(k[1]), child: Text(k[0])),
        ]),
      ]),
    ));
  }

  // ---------------- comune ----------------
  void _cleanup() {
    _peer?.close(); _peer = null;
    final l = _local; _local = null;
    if (l != null) { for (final t in l.getTracks()) { t.stop(); } l.dispose(); }
    if (_isHost) ScreenCapture.stop();
    _remote.srcObject = null;
  }

  void _finish(String msg, {bool pop = true}) {
    if (_ended) return;
    _ended = true;
    _cleanup();
    _sig?.send({'type': 'unregister'});
    if (!mounted) return;
    setState(() { _live = false; _hasVideo = false; _status = msg; });
    if (pop) Future.delayed(const Duration(milliseconds: 900), () { if (mounted) Navigator.maybePop(context); });
  }

  void _hangup() {
    if (_sessionId.isNotEmpty) _sig?.send({'type': 'hangup', 'sessionId': _sessionId});
    if (_ended) { Navigator.maybePop(context); return; }
    _finish('Chiuso');
  }

  @override
  void dispose() {
    _ended = true;
    _cleanup();
    _sub?.cancel();
    _sig?.dispose();
    _remote.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sharing = _isHost && _live;
    return Scaffold(
      appBar: AppBar(
        title: Text(_isHost ? 'Fatti assistere' : 'Schermo remoto'),
        backgroundColor: sharing ? Colors.red.shade700 : null,
        actions: [
          if (_canControl) IconButton(key: const Key('kbd'), tooltip: 'Tastiera', icon: const Icon(Icons.keyboard), onPressed: _keyboard),
        ],
      ),
      body: SafeArea(child: Column(children: [
        if (sharing)
          Container(width: double.infinity, color: Colors.red.shade700, padding: const EdgeInsets.all(8),
            child: const Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              Icon(Icons.fiber_manual_record, size: 14), SizedBox(width: 6),
              Text('Sessione di assistenza attiva', style: TextStyle(fontWeight: FontWeight.bold))])),
        Expanded(child: _isHost ? _hostBody() : Container(color: Colors.black,
            child: _hasVideo ? _videoArea() : Center(child: Padding(padding: const EdgeInsets.all(24),
                child: Text(_status, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70)))))),
        Padding(padding: const EdgeInsets.all(12),
          child: Row(children: [
            Expanded(child: Text(_status, key: const Key('status'))),
            FilledButton.icon(key: const Key('hangup'), style: FilledButton.styleFrom(backgroundColor: Colors.red),
              onPressed: _hangup, icon: const Icon(Icons.call_end), label: Text(_live ? 'Termina' : 'Chiudi')),
          ])),
      ])),
    );
  }

  Widget _hostBody() {
    if (_live) {
      // L'indicatore animato non è solo estetica: Android invia un fotogramma solo quando lo schermo cambia,
      // quindi con una schermata ferma l'operatore resterebbe senza immagine fino al primo tocco.
      return const Center(child: Padding(padding: EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          SizedBox(width: 160, child: LinearProgressIndicator(key: Key('sharingPulse'), color: Color(0xFF22D3EE), backgroundColor: Colors.white12)),
          SizedBox(height: 20),
          Text('L\'operatore vede lo schermo di questo telefono.\nPuoi usare le altre app: la condivisione continua finché non premi Termina.',
              textAlign: TextAlign.center, style: TextStyle(color: Colors.white70)),
        ])));
    }
    return Padding(padding: const EdgeInsets.all(20), child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      const Text('Il tuo ID', style: TextStyle(color: Colors.white54)),
      const SizedBox(height: 6),
      SelectableText(_myId.isEmpty ? '— — —' : Yondesk.formatId(_myId), key: const Key('myId'),
          style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800, fontFamily: 'monospace', color: Color(0xFF22D3EE))),
      const SizedBox(height: 20),
      const Text('Password', style: TextStyle(color: Colors.white54)),
      const SizedBox(height: 6),
      SelectableText(widget.password, key: const Key('myPass'), style: const TextStyle(fontSize: 24, fontFamily: 'monospace')),
      const SizedBox(height: 24),
      const Text('Comunica ID e password all\'operatore. Ti verrà chiesta conferma prima che possa vedere lo schermo.',
          textAlign: TextAlign.center, style: TextStyle(color: Colors.white54)),
    ]));
  }
}
