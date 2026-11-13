/**
 * Auto-reconnecting WebSocket client.
 * Emits: 'status' ('connecting' | 'online' | 'offline'), 'open', and one event per message type.
 */
import { Emitter } from './Emitter.js';

export class Socket extends Emitter {
  constructor(url) {
    super();
    this.url = url;
    this.ws = null;
    this.retry = 0;
    this.queue = [];
    this.connect();
    window.addEventListener('online', () => this.connect());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && (!this.ws || this.ws.readyState > 1)) this.connect();
    });
  }

  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    this.emit('status', 'connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.retry = 0;
      this.emit('status', 'online');
      this.emit('open');
      const pending = this.queue.splice(0);
      pending.forEach((m) => ws.send(m));
    });

    ws.addEventListener('message', (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      this.emit(msg.type, msg.payload);
    });

    ws.addEventListener('close', (e) => {
      if (this.ws !== ws) return;
      this.emit('status', 'offline');
      if (e.code === 4000) return; // replaced by another tab: don't fight it
      const delay = Math.min(8000, 400 * 2 ** this.retry++) + Math.random() * 300;
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });
  }

  send(type, payload = {}) {
    const data = JSON.stringify({ type, payload });
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
    else this.queue.push(data);
  }
}
