/**
 * Synthesised sound effects via the Web Audio API - no audio files to load.
 */
import { storage } from './storage.js';

class SoundEngine {
  constructor() {
    this.enabled = storage.get('sound', true);
    this.ctx = null;
  }

  ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  toggle() {
    this.enabled = !this.enabled;
    storage.set('sound', this.enabled);
    return this.enabled;
  }

  tone({ freq = 440, to = null, type = 'sine', dur = 0.12, vol = 0.15, delay = 0 }) {
    if (!this.enabled || document.hidden) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise(dur = 0.08, vol = 0.08, delay = 0) {
    if (!this.enabled || document.hidden) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.buffer = buffer;
    src.connect(gain).connect(ctx.destination);
    src.start(ctx.currentTime + delay);
  }

  dice() {
    for (let i = 0; i < 5; i++) this.noise(0.05, 0.06, i * 0.09);
    this.tone({ freq: 300, to: 520, type: 'triangle', dur: 0.1, vol: 0.08, delay: 0.55 });
  }
  step() { this.tone({ freq: 620, to: 760, type: 'triangle', dur: 0.07, vol: 0.06 }); }
  enter() { this.tone({ freq: 380, to: 900, type: 'square', dur: 0.18, vol: 0.06 }); }
  capture() {
    this.tone({ freq: 220, to: 70, type: 'sawtooth', dur: 0.35, vol: 0.12 });
    this.noise(0.2, 0.1, 0.02);
  }
  home() { [523, 659, 784, 1046].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.16, vol: 0.09, delay: i * 0.08 })); }
  turn() { this.tone({ freq: 880, type: 'sine', dur: 0.12, vol: 0.08 }); this.tone({ freq: 1320, type: 'sine', dur: 0.14, vol: 0.06, delay: 0.1 }); }
  bad() { this.tone({ freq: 300, to: 160, type: 'square', dur: 0.25, vol: 0.06 }); }
  win() { [523, 659, 784, 659, 784, 1046].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.22, vol: 0.1, delay: i * 0.13 })); }
  click() { this.tone({ freq: 700, type: 'sine', dur: 0.05, vol: 0.05 }); }
}

export const sound = new SoundEngine();
