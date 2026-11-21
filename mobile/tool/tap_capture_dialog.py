#!/usr/bin/env python3
"""Tocca il consenso di sistema alla condivisione schermo (Android) durante i test.

Android 14+: menu a tendina ("Una sola app" / "Tutto lo schermo") e pulsante di avvio.
Android <= 13: solo il pulsante "Avvia adesso". Usa uiautomator via adb.
"""
import re, subprocess, sys, time

dev = sys.argv[1] if len(sys.argv) > 1 else 'emulator-5554'
ENTIRE = re.compile(r'entire screen|tutto lo schermo|intero schermo', re.I)
START = re.compile(r'^(start now|start|share screen|start sharing|share|avvia adesso|avvia|condividi schermo|condividi)$', re.I)
NODE = re.compile(r'<node [^>]*?>')

def adb(*a, timeout=30):
    return subprocess.run(['adb', '-s', dev, *a], capture_output=True, text=True, timeout=timeout).stdout

def dump():
    out = adb('exec-out', 'uiautomator', 'dump', '/dev/tty')
    nodes = []
    for m in NODE.finditer(out):
        s = m.group(0)
        g = lambda k: (re.search(k + r'="([^"]*)"', s) or [None, ''])[1]
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', s)
        if not b: continue
        x1, y1, x2, y2 = map(int, b.groups())
        nodes.append({'text': g('text'), 'cls': g('class'), 'pkg': g('package'), 'x': (x1 + x2) // 2, 'y': (y1 + y2) // 2})
    return nodes

def tap(n, why):
    print(f'tocco "{n["text"] or n["cls"]}" ({why}) in {n["x"]},{n["y"]}', flush=True)
    adb('shell', 'input', 'tap', str(n['x']), str(n['y']))

state = 0  # 0 = da iniziare, 1 = tendina aperta, 2 = "tutto lo schermo" scelto
end = time.time() + 900
while time.time() < end:
    try:
        nodes = [n for n in dump() if 'systemui' in n['pkg'] or 'mediaprojection' in n['pkg'].lower()]
    except Exception as e:
        print('dump fallito:', e, flush=True); time.sleep(2); continue
    texts = [n['text'] for n in nodes if n['text']]
    spinner = next((n for n in nodes if n['cls'].endswith('Spinner')), None)
    entire = next((n for n in nodes if ENTIRE.search(n['text'] or '') and not n['cls'].endswith('Spinner')), None)
    start = next((n for n in nodes if START.match((n['text'] or '').strip())), None)
    if not (spinner or start):
        state = 0; time.sleep(1); continue
    print('finestra di sistema:', texts, flush=True)
    if spinner and state < 2:
        if entire and state == 1:
            tap(entire, 'tutto lo schermo'); state = 2
        else:
            tap(spinner, 'apro la scelta'); state = 1
    elif start:
        tap(start, 'avvio condivisione'); state = 0; time.sleep(3)
    time.sleep(1.2)
