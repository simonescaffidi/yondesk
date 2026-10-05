/*
 * Yondesk client library (browser + agent nativo).
 * Modello: assistenza SOLO consensuale.
 *  - Signaling: WebSocket (/ws). Il server mette in contatto le parti, non vede i contenuti.
 *  - Media/dati: WebRTC peer-to-peer, cifrati end-to-end (DTLS-SRTP).
 *  - Nessuna sessione parte senza consenso verificabile sul dispositivo assistito.
 */
(function (global) {
  'use strict';

  const CHUNK = 16 * 1024;

  function genPassword(len = 8) {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    const a = new Uint32Array(len);
    crypto.getRandomValues(a);
    return Array.from(a, n => chars[n % chars.length]).join('');
  }
  function genKey() {
    const a = new Uint8Array(24);
    crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  }
  function formatId(id) {
    return String(id || '').replace(/\D/g, '').replace(/(\d{3})(?=\d)/g, '$1 ');
  }
  // Confronto a tempo costante
  function safeEqual(a, b) {
    a = String(a || ''); b = String(b || '');
    let diff = a.length ^ b.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return diff === 0;
  }

  class Emitter {
    constructor() { this._h = {}; }
    on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return this; }
    emit(ev, ...a) { (this._h[ev] || []).forEach(fn => { try { fn(...a); } catch (e) { console.error(e); } }); }
  }

  /* ---------------- Signaling ---------------- */
  class Signal extends Emitter {
    constructor(url) {
      super();
      this.url = url || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
      this.queue = []; this.closed = false; this.retry = 0;
      this._open();
    }
    _open() {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => { this.retry = 0; this.emit('open'); this.queue.splice(0).forEach(m => this.ws.send(m)); };
      this.ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } this.emit('message', m); this.emit(m.type, m); };
      this.ws.onclose = () => { this.emit('close'); if (!this.closed) setTimeout(() => this._open(), Math.min(15000, 1000 * 2 ** this.retry++)); };
      this.ws.onerror = () => {};
    }
    send(m) { const s = JSON.stringify(m); if (this.ws.readyState === 1) this.ws.send(s); else this.queue.push(s); }
    close() { this.closed = true; try { this.ws.close(); } catch {} }
  }

  async function iceConfig(base) {
    try { return await (await fetch((base || '') + '/api/ice')).json(); }
    catch { return { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }; }
  }

  /* ---------------- Trasferimento file su data channel ---------------- */
  class FileTransfer extends Emitter {
    constructor(channel) {
      super();
      this.ch = channel; this.ch.binaryType = 'arraybuffer'; this.incoming = null;
      this.ch.onmessage = (e) => this._onMessage(e.data);
    }
    async send(file) {
      const id = genKey().slice(0, 8);
      this.ch.send(JSON.stringify({ t: 'start', id, name: file.name, size: file.size, mime: file.type }));
      let offset = 0;
      while (offset < file.size) {
        if (this.ch.bufferedAmount > 1024 * 1024)
          await new Promise(r => { this.ch.bufferedAmountLowThreshold = 256 * 1024; this.ch.onbufferedamountlow = r; });
        const slice = await file.slice(offset, offset + CHUNK).arrayBuffer();
        this.ch.send(slice); offset += slice.byteLength;
        this.emit('progress', { id, name: file.name, sent: offset, size: file.size, dir: 'out' });
      }
      this.ch.send(JSON.stringify({ t: 'end', id }));
      this.emit('sent', { id, name: file.name });
    }
    _onMessage(data) {
      if (typeof data === 'string') {
        const m = JSON.parse(data);
        if (m.t === 'start') this.incoming = { ...m, parts: [], received: 0 };
        else if (m.t === 'end' && this.incoming) {
          const blob = new Blob(this.incoming.parts, { type: this.incoming.mime || 'application/octet-stream' });
          this.emit('file', { name: this.incoming.name, size: this.incoming.size, blob });
          this.incoming = null;
        }
        return;
      }
      if (!this.incoming) return;
      this.incoming.parts.push(data); this.incoming.received += data.byteLength;
      this.emit('progress', { id: this.incoming.id, name: this.incoming.name, sent: this.incoming.received, size: this.incoming.size, dir: 'in' });
    }
  }

  const QUALITY = {
    low:      { maxBitrate: 600000,  scaleResolutionDownBy: 2, maxFramerate: 15 },
    balanced: { maxBitrate: 2500000, scaleResolutionDownBy: 1, maxFramerate: 30 },
    high:     { maxBitrate: 8000000, scaleResolutionDownBy: 1, maxFramerate: 60 }
  };

  /*
   * Peer: wrapper RTCPeerConnection condiviso da host e viewer.
   * Canali dati: "ctrl" (eventi input/comandi), "chat", "file".
   */
  class Peer extends Emitter {
    constructor(sig, sessionId, polite, ice) {
      super();
      this.sig = sig; this.sessionId = sessionId; this.polite = polite;
      this.pc = new RTCPeerConnection(ice);
      this.makingOffer = false; this.ignoreOffer = false;
      this.channels = {};
      this.pc.onicecandidate = ({ candidate }) => { if (candidate) this._sig({ candidate }); };
      this.pc.ontrack = (e) => this.emit('track', e.streams[0] || new MediaStream([e.track]));
      this.pc.onconnectionstatechange = () => {
        this.emit('state', this.pc.connectionState);
        if (['failed', 'closed', 'disconnected'].includes(this.pc.connectionState)) this.emit('closed');
      };
      this.pc.ondatachannel = (e) => this._bind(e.channel);
      this.pc.onnegotiationneeded = async () => {
        try { this.makingOffer = true; await this.pc.setLocalDescription(); this._sig({ description: this.pc.localDescription }); }
        catch (e) { console.error(e); } finally { this.makingOffer = false; }
      };
    }
    createChannel(label, opts) { const ch = this.pc.createDataChannel(label, opts); this._bind(ch); return ch; }
    _bind(ch) {
      this.channels[ch.label] = ch;
      ch.onopen = () => this.emit('channel', ch);
      ch.onmessage = (e) => this.emit('data:' + ch.label, e.data, ch);
    }
    _sig(data) { this.sig.send({ type: 'signal', sessionId: this.sessionId, data }); }
    async onSignal({ description, candidate }) {
      try {
        if (description) {
          const offerCollision = description.type === 'offer' && (this.makingOffer || this.pc.signalingState !== 'stable');
          this.ignoreOffer = !this.polite && offerCollision;
          if (this.ignoreOffer) return;
          await this.pc.setRemoteDescription(description);
          if (description.type === 'offer') { await this.pc.setLocalDescription(); this._sig({ description: this.pc.localDescription }); }
        } else if (candidate) {
          try { await this.pc.addIceCandidate(candidate); } catch (e) { if (!this.ignoreOffer) throw e; }
        }
      } catch (e) { console.error('signal', e); }
    }
    async addStream(stream, quality) {
      for (const track of stream.getTracks()) {
        const sender = this.pc.addTrack(track, stream);
        if (track.kind === 'video' && quality && QUALITY[quality]) {
          const p = sender.getParameters(); p.encodings = [QUALITY[quality]];
          try { await sender.setParameters(p); } catch {}
        }
      }
    }
    close() { try { Object.values(this.channels).forEach(c => c.close()); this.pc.close(); } catch {} }
  }

  global.Yondesk = {
    Signal, Peer, FileTransfer, iceConfig,
    genPassword, genKey, formatId, safeEqual, QUALITY
  };
})(typeof window !== 'undefined' ? window : globalThis);
