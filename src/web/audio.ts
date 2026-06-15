/**
 * Procedural cockpit/engine audio using the Web Audio API.
 *
 * NOTE ON SOURCING: DCS World's own engine and switch sounds are copyrighted
 * assets owned by Eagle Dynamics and are NOT bundled here. Instead the F110
 * turbine, afterburner roar, and airflow are synthesized procedurally so they
 * react to actual engine RPM / throttle / airspeed and require no external
 * files or licenses. If you want recorded samples, drop CC0/CC-BY clips (e.g.
 * from freesound.org) into `loadSample()` and they will replace the synth.
 */

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;

  // Engine: two detuned saw oscillators (core + fan whine) + filtered noise.
  private fanOsc!: OscillatorNode;
  private coreOsc!: OscillatorNode;
  private engineGain!: GainNode;
  private whineFilter!: BiquadFilterNode;

  // Afterburner: low-frequency rumble (noise through a lowpass).
  private abGain!: GainNode;

  // Wind / airflow noise.
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;

  private noiseBuf!: AudioBuffer;
  private started = false;

  // Sampled engine bed (LEGO Star Wars X-wing engine clip) — loops, and its
  // level + pitch follow throttle. Replaces the synth engine once loaded.
  private engineSampleGain: GainNode | null = null;
  private engineSampleSrc: AudioBufferSourceNode | null = null;
  private engineSampleBuf: AudioBuffer | null = null;
  private engineSampleReady = false;

  // Sampled blaster (LEGO X-wing fire clip) — a fresh one-shot voice per shot.
  private fireBuf: AudioBuffer | null = null;
  // Sampled TIE-fighter cannon clip.
  private tieFireBuf: AudioBuffer | null = null;

  /** Must be called from a user gesture (click/keydown) to satisfy autoplay. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(ctx.destination);

    // Shared white-noise buffer.
    const n = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;

    // --- Engine tonal components ---
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0;
    this.engineGain.connect(this.master);

    this.fanOsc = ctx.createOscillator();
    this.fanOsc.type = "sawtooth";
    this.fanOsc.frequency.value = 120;
    this.coreOsc = ctx.createOscillator();
    this.coreOsc.type = "sawtooth";
    this.coreOsc.frequency.value = 240;

    this.whineFilter = ctx.createBiquadFilter();
    this.whineFilter.type = "bandpass";
    this.whineFilter.frequency.value = 2200;
    this.whineFilter.Q.value = 4;

    const engineNoise = ctx.createBufferSource();
    engineNoise.buffer = this.noiseBuf;
    engineNoise.loop = true;
    engineNoise.connect(this.whineFilter);
    this.whineFilter.connect(this.engineGain);
    this.fanOsc.connect(this.engineGain);
    this.coreOsc.connect(this.engineGain);

    // --- Afterburner rumble ---
    this.abGain = ctx.createGain();
    this.abGain.gain.value = 0.0;
    this.abGain.connect(this.master);
    const abNoise = ctx.createBufferSource();
    abNoise.buffer = this.noiseBuf;
    abNoise.loop = true;
    const abFilter = ctx.createBiquadFilter();
    abFilter.type = "lowpass";
    abFilter.frequency.value = 320;
    abNoise.connect(abFilter);
    abFilter.connect(this.abGain);

    // --- Wind ---
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.0;
    this.windGain.connect(this.master);
    const windNoise = ctx.createBufferSource();
    windNoise.buffer = this.noiseBuf;
    windNoise.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windFilter.frequency.value = 600;
    windNoise.connect(this.windFilter);
    this.windFilter.connect(this.windGain);

    this.fanOsc.start();
    this.coreOsc.start();
    engineNoise.start();
    abNoise.start();
    windNoise.start();

    // --- Sampled engine bed ---
    this.engineSampleGain = ctx.createGain();
    this.engineSampleGain.gain.value = 0.0;
    this.engineSampleGain.connect(this.master);
    this.loadEngineSample("./assets/engine.mp3");

    // Preload the blaster fire clip (played per shot in laser()).
    fetch("./assets/fire.mp3")
      .then((r) => r.arrayBuffer())
      .then((d) => this.ctx!.decodeAudioData(d))
      .then((buf) => { this.fireBuf = buf; })
      .catch(() => { this.fireBuf = null; });
    // Preload the TIE-fighter cannon clip (played per shot in enemyLaser()).
    fetch("./assets/tie-blast.mp3")
      .then((r) => r.arrayBuffer())
      .then((d) => this.ctx!.decodeAudioData(d))
      .then((buf) => { this.tieFireBuf = buf; })
      .catch(() => { this.tieFireBuf = null; });
  }

  /** Fetch + decode the engine clip and start it looping (gain/pitch follow throttle). */
  private async loadEngineSample(url: string): Promise<void> {
    if (!this.ctx) return;
    try {
      const res = await fetch(url);
      const data = await res.arrayBuffer();
      this.engineSampleBuf = await this.ctx.decodeAudioData(data);
      const src = this.ctx.createBufferSource();
      src.buffer = this.engineSampleBuf;
      src.loop = true;
      src.connect(this.engineSampleGain!);
      src.start();
      this.engineSampleSrc = src;
      this.engineSampleReady = true;
    } catch {
      // Fall back to the synthesized engine if the sample can't load.
      this.engineSampleReady = false;
    }
  }

  /**
   * Update the soundscape from flight state.
   * @param powerPct engine power level state, 0..100
   * @param throttle commanded throttle 0..1
   * @param mach Mach number (drives wind/airflow)
   */
  update(powerPct: number, throttle: number, mach: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = powerPct / 100; // 0..1 proxy for N2

    if (this.engineSampleReady && this.engineSampleSrc && this.engineSampleGain) {
      // Sampled X-wing engine: level + pitch ride throttle/RPM. Synth engine muted.
      this.engineGain.gain.setTargetAtTime(0, t, 0.2);
      this.engineSampleGain.gain.setTargetAtTime(0.35 + rpm * 0.5, t, 0.2);
      this.engineSampleSrc.playbackRate.setTargetAtTime(0.85 + rpm * 0.5, t, 0.2);
    } else {
      // Fallback: synthesized engine tone climbs with RPM (fan + core an octave apart).
      const fanF = 90 + rpm * 320;
      this.fanOsc.frequency.setTargetAtTime(fanF, t, 0.15);
      this.coreOsc.frequency.setTargetAtTime(fanF * 2.02, t, 0.15);
      this.whineFilter.frequency.setTargetAtTime(1500 + rpm * 4500, t, 0.2);
      this.engineGain.gain.setTargetAtTime(0.08 + rpm * 0.32, t, 0.2);
    }

    // Afterburner engages roughly above mil power (throttle > ~0.85).
    const ab = Math.max(0, (throttle - 0.85) / 0.15);
    this.abGain.gain.setTargetAtTime(ab * 0.5, t, 0.1);

    // Wind rises with Mach.
    const w = Math.min(1, mach / 1.5);
    this.windGain.gain.setTargetAtTime(w * w * 0.25, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(400 + w * 3000, t, 0.2);
  }

  /** Short synthesized switch click for UI/cockpit interactions. */
  click(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "square";
    o.frequency.value = 1400;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.06);
  }

  /** Single cannon round (called rapidly while firing). */
  gunShot(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = 900; f.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.07);
  }

  /** Missile motor whoosh. */
  missileLaunch(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.setValueAtTime(2000, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.7); f.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.95);
  }

  /** Explosion boom. */
  explosion(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.setValueAtTime(800, t);
    f.frequency.exponentialRampToValueAtTime(80, t + 0.8);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 1.2);
  }

  /** Player blaster cannon: the LEGO X-wing fire clip (synth "pew" fallback). */
  laser(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.fireBuf) {
      // Fresh one-shot voice per shot, slight random pitch so rapid fire varies.
      const src = this.ctx.createBufferSource();
      src.buffer = this.fireBuf;
      src.playbackRate.value = 0.95 + Math.random() * 0.12;
      const g = this.ctx.createGain();
      g.gain.value = 0.6;
      src.connect(g); g.connect(this.master);
      src.start(t);
      return;
    }
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(1400, t);
    o.frequency.exponentialRampToValueAtTime(280, t + 0.12);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.15);
  }

  /** Enemy TIE cannon: the sampled blast clip (synth fallback). */
  enemyLaser(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.tieFireBuf) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.tieFireBuf;
      src.playbackRate.value = 0.9 + Math.random() * 0.14;
      const g = this.ctx.createGain();
      g.gain.value = 0.5;
      src.connect(g); g.connect(this.master);
      src.start(t);
      return;
    }
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(700, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.16);
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.19);
  }

  /** Proton torpedo launch whoosh (reuses the missile synth). */
  torpedo(): void { this.missileLaunch(); }

  /** Short rising beep when the radar acquires a hard lock. */
  lockTone(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(1700, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.24);
  }

  /** Soft search blip while the lock is building. */
  lockSearch(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "square";
    o.frequency.value = 720;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.07);
  }

  /** Warning tone (e.g. overstress / stall). */
  warning(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sawtooth";
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.26);
  }
}
