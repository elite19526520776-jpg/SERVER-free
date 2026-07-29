// 程序化音效：全部用 WebAudio 合成，不需要任何音频文件

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
    this.noiseBuffer = null;
  }

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
    // 预生成白噪声
    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  resume() {
    this.ensure();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  noise(dur, freq, q, gain, type = 'bandpass', sweep = 0) {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  tone(dur, freq, gain, type = 'sine', endFreq = null) {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  play(name, material = 'stone') {
    if (!this.enabled) return;
    switch (name) {
      case 'dig': {
        const cfg = {
          stone: [700, 4, 0.16], wood: [420, 3, 0.16], dirt: [260, 1.4, 0.18],
          sand: [1600, 0.9, 0.12], grass: [320, 1.2, 0.16], metal: [1400, 8, 0.12],
          glass: [2600, 6, 0.14], wool: [200, 1, 0.12], plant: [900, 1.5, 0.1],
        }[material] || [600, 3, 0.15];
        this.noise(0.09, cfg[0], cfg[1], cfg[2], 'bandpass', 0.7);
        break;
      }
      case 'break':
        this.noise(0.22, 900, 1.6, 0.22, 'bandpass', 0.35);
        this.tone(0.1, 180, 0.05, 'triangle', 90);
        break;
      case 'place':
        this.noise(0.11, 520, 2.5, 0.2, 'bandpass', 0.6);
        break;
      case 'step':
        this.noise(0.07, 340, 1.1, 0.09, 'bandpass', 0.7);
        break;
      case 'hurt':
        this.tone(0.18, 320, 0.16, 'square', 150);
        break;
      case 'mobhurt':
        this.tone(0.15, 420, 0.12, 'sawtooth', 200);
        break;
      case 'eat':
        this.noise(0.12, 400, 1.2, 0.14, 'bandpass', 0.8);
        break;
      case 'craft':
        this.tone(0.09, 620, 0.1, 'square', 880);
        break;
      case 'pickup':
        this.tone(0.07, 900, 0.08, 'sine', 1400);
        break;
      case 'explode':
        this.noise(0.9, 180, 0.7, 0.5, 'lowpass', 0.15);
        this.tone(0.6, 90, 0.25, 'sine', 30);
        break;
      case 'bow':
        this.noise(0.16, 1200, 2, 0.14, 'bandpass', 0.4);
        break;
      case 'splash':
        this.noise(0.3, 1400, 1, 0.18, 'bandpass', 0.25);
        break;
      case 'fuse':
        this.noise(0.5, 2400, 1.5, 0.1, 'highpass', 0.9);
        break;
      case 'door':
        this.noise(0.2, 300, 2, 0.14, 'bandpass', 1.6);
        break;
      default:
        break;
    }
  }
}

/** 方块名 → 音效材质 */
export function soundMaterial(name) {
  if (!name) return 'stone';
  if (/wool/.test(name)) return 'wool';
  if (/glass|ice/.test(name)) return 'glass';
  if (/log|planks|table|chest|bookshelf|ladder|slab/.test(name)) return 'wood';
  if (/sand|gravel/.test(name)) return 'sand';
  if (/dirt|clay|farmland|podzol|mycelium|path/.test(name)) return 'dirt';
  if (/grass|leaves|flower|mushroom|sapling|cane|cactus|wheat|fern|bush/.test(name)) return 'grass';
  if (/iron|gold|diamond|emerald|copper|redstone_block|coal_block/.test(name)) return 'metal';
  return 'stone';
}
