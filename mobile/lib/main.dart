import 'dart:io';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'signaling.dart';
import 'session.dart';

const _serverNew = String.fromEnvironment('YONDESK_SERVER');
const _serverOld = String.fromEnvironment('TELEASSIST_SERVER');
const kServer = _serverNew != '' ? _serverNew : (_serverOld != '' ? _serverOld : 'https://yondesk.com');

// Valori fissi usati solo dai test automatici (vuoti nelle build normali)
const kTestDeviceKey = String.fromEnvironment('E2E_DEVICE_KEY');
const kTestHostPass = String.fromEnvironment('E2E_HOST_PASS');

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const YondeskApp());
}

/// Chiave del dispositivo: resta la stessa tra un avvio e l'altro, così l'ID non cambia.
Future<String> deviceKey() async {
  if (kTestDeviceKey.isNotEmpty) return kTestDeviceKey;
  final p = await SharedPreferences.getInstance();
  var k = p.getString('deviceKey');
  if (k == null || k.length < 16) {
    k = Yondesk.genKey();
    await p.setString('deviceKey', k);
  }
  return k;
}

class YondeskApp extends StatelessWidget {
  const YondeskApp({super.key});
  @override
  Widget build(BuildContext context) {
    const brand = Color(0xFF3B82F6);
    return MaterialApp(
      title: 'Yondesk',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: brand, brightness: Brightness.dark),
        scaffoldBackgroundColor: const Color(0xFF0B1020),
      ),
      home: const HomePage(),
    );
  }
}

class HomePage extends StatelessWidget {
  const HomePage({super.key});
  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Yondesk'),
          bottom: const TabBar(tabs: [
            Tab(key: Key('tabOperator'), text: 'Offri assistenza', icon: Icon(Icons.desktop_windows)),
            Tab(key: Key('tabHost'), text: 'Fatti assistere', icon: Icon(Icons.screen_share)),
          ]),
        ),
        body: const SafeArea(child: TabBarView(children: [ViewerTab(), HostTab()])),
      ),
    );
  }
}

/// OPERATORE: inserisce ID e password, vede lo schermo remoto e (se consentito) lo controlla.
class ViewerTab extends StatefulWidget {
  const ViewerTab({super.key});
  @override
  State<ViewerTab> createState() => _ViewerTabState();
}

class _ViewerTabState extends State<ViewerTab> with AutomaticKeepAliveClientMixin {
  final _id = TextEditingController();
  final _pass = TextEditingController();
  String? _error;

  @override
  bool get wantKeepAlive => true;

  @override
  void dispose() { _id.dispose(); _pass.dispose(); super.dispose(); }

  void _connect() {
    final id = _id.text.replaceAll(RegExp(r'\D'), '');
    final pass = _pass.text.trim();
    if (id.length != 9 || pass.isEmpty) {
      setState(() => _error = 'Inserisci l\'ID di 9 cifre e la password');
      return;
    }
    setState(() => _error = null);
    FocusScope.of(context).unfocus();
    Navigator.push(context, MaterialPageRoute(
        builder: (_) => SessionPage(role: Role.viewer, targetId: id, password: pass)));
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        TextField(key: const Key('id'), controller: _id, keyboardType: TextInputType.number,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(labelText: 'ID del dispositivo remoto', hintText: '123 456 789', border: OutlineInputBorder())),
        const SizedBox(height: 12),
        TextField(key: const Key('pass'), controller: _pass, obscureText: true, autocorrect: false, enableSuggestions: false,
            onSubmitted: (_) => _connect(),
            decoration: const InputDecoration(labelText: 'Password', border: OutlineInputBorder())),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 10),
            child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
        const SizedBox(height: 16),
        FilledButton.icon(key: const Key('connect'), icon: const Icon(Icons.login), label: const Text('Connetti'), onPressed: _connect),
        const SizedBox(height: 12),
        const Text('Vedrai lo schermo remoto. Il controllo parte solo se l\'altra persona lo consente.',
            style: TextStyle(color: Colors.white54)),
      ]),
    );
  }
}

/// ASSISTITO: condivide lo schermo del telefono (Android), sempre con consenso e banner.
class HostTab extends StatelessWidget {
  const HostTab({super.key});
  @override
  Widget build(BuildContext context) {
    final canShare = Platform.isAndroid;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (!canShare)
          const Card(child: Padding(padding: EdgeInsets.all(14),
            child: Text('Su questo dispositivo Yondesk funziona come operatore: usa la scheda '
                '"Offri assistenza". La condivisione dello schermo del telefono è disponibile su Android.'))),
        if (canShare) ...[
          const Text('Mostra lo schermo di questo telefono a un operatore di cui ti fidi. '
              'Riceverai un ID e una password da comunicargli.'),
          const SizedBox(height: 16),
          FilledButton.icon(
            key: const Key('startShare'),
            icon: const Icon(Icons.screen_share),
            label: const Text('Ricevi assistenza'),
            onPressed: () => Navigator.push(context, MaterialPageRoute(
                builder: (_) => SessionPage(role: Role.host,
                    password: kTestHostPass.isNotEmpty ? kTestHostPass : Yondesk.genPassword()))),
          ),
          const SizedBox(height: 12),
          const Text('Nessuno può collegarsi senza la tua conferma. Android ti chiederà di autorizzare '
              'la condivisione e una notifica resterà visibile per tutta la sessione.',
              style: TextStyle(color: Colors.white54)),
        ],
      ]),
    );
  }
}
