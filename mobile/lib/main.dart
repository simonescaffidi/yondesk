import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'signaling.dart';
import 'session.dart';

const kServer = String.fromEnvironment('TELEASSIST_SERVER',
    defaultValue: 'https://yondesk.com');

void main() => runApp(const YondeskApp());

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

class HomePage extends StatefulWidget {
  const HomePage({super.key});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Yondesk'),
          bottom: const TabBar(tabs: [
            Tab(text: 'Offri assistenza', icon: Icon(Icons.desktop_windows)),
            Tab(text: 'Fatti assistere', icon: Icon(Icons.screen_share)),
          ]),
        ),
        body: const TabBarView(children: [ViewerTab(), HostTab()]),
      ),
    );
  }
}

/// OPERATORE: inserisce ID+password, vede lo schermo remoto.
class ViewerTab extends StatefulWidget {
  const ViewerTab({super.key});
  @override
  State<ViewerTab> createState() => _ViewerTabState();
}

class _ViewerTabState extends State<ViewerTab> {
  final _id = TextEditingController();
  final _pass = TextEditingController();
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(children: [
        TextField(controller: _id, keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'ID dispositivo', border: OutlineInputBorder())),
        const SizedBox(height: 12),
        TextField(controller: _pass, obscureText: true,
            decoration: const InputDecoration(labelText: 'Password', border: OutlineInputBorder())),
        const SizedBox(height: 16),
        FilledButton.icon(
          icon: const Icon(Icons.login),
          label: const Text('Connetti'),
          onPressed: () {
            final id = _id.text.replaceAll(RegExp(r'\D'), '');
            if (id.length < 6 || _pass.text.isEmpty) return;
            Navigator.push(context, MaterialPageRoute(
              builder: (_) => SessionPage(role: Role.viewer, targetId: id, password: _pass.text)));
          },
        ),
      ]),
    );
  }
}

/// HOST: mostra ID+password, condivide lo schermo (Android) previo consenso di sistema.
class HostTab extends StatefulWidget {
  const HostTab({super.key});
  @override
  State<HostTab> createState() => _HostTabState();
}

class _HostTabState extends State<HostTab> {
  String _pass = Yondesk.genPassword();
  @override
  Widget build(BuildContext context) {
    final androidOk = Platform.isAndroid;
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (!androidOk)
          const Card(child: Padding(padding: EdgeInsets.all(14),
            child: Text('La condivisione schermo come host è disponibile su Android. '
                'Su iOS usa la scheda "Offri assistenza" come operatore.'))),
        const SizedBox(height: 8),
        const Text('Password sessione'),
        const SizedBox(height: 6),
        Row(children: [
          Expanded(child: SelectableText(_pass, style: const TextStyle(fontSize: 22, fontFamily: 'monospace'))),
          IconButton(onPressed: () => setState(() => _pass = Yondesk.genPassword()), icon: const Icon(Icons.refresh)),
        ]),
        const SizedBox(height: 16),
        FilledButton.icon(
          icon: const Icon(Icons.screen_share),
          label: const Text('Avvia condivisione'),
          onPressed: androidOk
              ? () => Navigator.push(context, MaterialPageRoute(
                  builder: (_) => SessionPage(role: Role.host, password: _pass)))
              : null,
        ),
        const SizedBox(height: 12),
        const Text('Ti verrà chiesto di confermare la condivisione schermo dal sistema. '
            'Un banner resta visibile durante la sessione.', style: TextStyle(color: Colors.white54)),
      ]),
    );
  }
}
