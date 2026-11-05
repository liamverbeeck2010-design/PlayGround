export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambient = [];
    this.enabled = true;
    this.started = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.32 : 0;
    this.master.connect(this.ctx.destination);
    this.startAmbient();
    this.started = true;
  }

  startAmbient() {
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.gain.value = 0.0001;
    bus.connect(this.master);
    bus.gain.exponentialRampToValueAtTime(0.055, ctx.currentTime + 4);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 380;
    filter.Q.value = 0.6;
    filter.connect(bus);

    const frequencies = [43.65, 65.41, 87.31, 98.0];
    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 ? "sine" : "triangle";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.2 : 0.035;
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.035 + i * 0.013;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = i === 0 ? 0.04 : 0.028;
      lfo.connect(lfoGain);
      lfoGain.connect(g.gain);
      lfo.start();
      osc.connect(g);
      g.connect(filter);
      osc.start();
      this.ambient.push(osc, lfo);
    });

    // Very quiet filtered noise gives the simulation a sense of depth.
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.985 + white * 0.015;
      data[i] = last * 3.2;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 220;
    noiseFilter.Q.value = 0.5;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.028;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(bus);
    noise.start();
    this.ambient.push(noise);
    this.ambientBus = bus;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!this.master) return;
    const time = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(time);
    this.master.gain.setTargetAtTime(enabled ? 0.32 : 0, time, 0.08);
  }

  blip(freq = 460, duration = 0.08, type = "sine", gain = 0.055) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  chord(freqs, spacing = 0.065, duration = 0.45, gain = 0.035) {
    freqs.forEach((f, i) => {
      setTimeout(() => this.blip(f, duration, "sine", gain), i * spacing * 1000);
    });
  }

  deploy() {
    this.chord([392, 523.25, 659.25], 0.055, 0.4, 0.04);
  }

  select() {
    this.blip(880, 0.045, "sine", 0.025);
    this.blip(1320, 0.035, "sine", 0.012);
  }

  impact() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(130, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.7);
    g.gain.setValueAtTime(0.15, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
    osc.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.9);

    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 700;
    const ng = ctx.createGain();
    ng.gain.value = 0.13;
    src.connect(filter);
    filter.connect(ng);
    ng.connect(this.master);
    src.start(now);
  }

  whoosh() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 1.3);
    g.gain.setValueAtTime(0.001, now);
    g.gain.exponentialRampToValueAtTime(0.055, now + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 480;
    osc.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + 1.5);
  }

  complete() {
    this.chord([523.25, 659.25, 783.99, 1046.5], 0.085, 0.65, 0.038);
  }

  reset() {
    this.blip(320, 0.2, "triangle", 0.04);
    setTimeout(() => this.blip(220, 0.35, "triangle", 0.03), 120);
  }
}
