// Tiny self-contained MIDI player on WebAudio.
// Parses SMF format 0/1, plays notes with oscillator voices picked per GM
// instrument family, and synthesizes channel-10 drums (no soundfont needed).
'use strict';

const MidiPlayer = (() => {
  let ac = null, master = null, noise = null;
  let song = null, timer = null, enabled = true;
  let voices = [];
  const chan = [];

  // ------------------------------------------------------------ parsing
  function parse(bytes) {
    const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let p = 0;
    const u32 = () => { const v = d.getUint32(p); p += 4; return v; };
    const u16 = () => { const v = d.getUint16(p); p += 2; return v; };
    const u8 = () => d.getUint8(p++);
    const varint = () => { let v = 0, b; do { b = u8(); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

    if (u32() !== 0x4D546864) throw new Error('not a MIDI file');
    u32();
    u16(); // format
    const ntr = u16(), div = u16();
    const tracks = [];
    for (let i = 0; i < ntr; i++) {
      if (u32() !== 0x4D54726B) throw new Error('bad track chunk');
      const end = u32() + p, ev = [];
      let tick = 0, status = 0;
      while (p < end) {
        tick += varint();
        let s = d.getUint8(p);
        if (s & 0x80) { p++; status = s; } else s = status;
        if (s === 0xFF) {
          const type = u8(), len = varint();
          if (type === 0x51)
            ev.push({ tick, type: 'tempo', us: (d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2) });
          p += len;
        } else if (s === 0xF0 || s === 0xF7) {
          p += varint();
        } else {
          const hi = s & 0xF0, ch = s & 0x0F, a = u8();
          const b = (hi === 0xC0 || hi === 0xD0) ? 0 : u8();
          if (hi === 0x90 && b > 0) ev.push({ tick, type: 'on', ch, note: a, vel: b });
          else if (hi === 0x80 || hi === 0x90) ev.push({ tick, type: 'off', ch, note: a });
          else if (hi === 0xC0) ev.push({ tick, type: 'prog', ch, prog: a });
          else if (hi === 0xB0 && a === 7) ev.push({ tick, type: 'vol', ch, vel: b });
        }
      }
      p = end;
      tracks.push(ev);
    }
    // merge tracks, then bake the tempo map into absolute seconds
    const all = [].concat(...tracks).sort((a, b) => a.tick - b.tick);
    let tempo = 500000, lastTick = 0, lastT = 0;
    for (const e of all) {
      e.t = lastT + (e.tick - lastTick) * tempo / 1e6 / div;
      lastT = e.t; lastTick = e.tick;
      if (e.type === 'tempo') tempo = e.us;
    }
    return { events: all, duration: lastT + 1.5 };
  }

  const cache = {};
  function songData(name) {
    if (!cache[name]) {
      const b = atob(MUSIC_DATA[name]);
      const u = new Uint8Array(b.length);
      for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
      cache[name] = parse(u);
    }
    return cache[name];
  }

  // ------------------------------------------------------------ synth
  function ctx() {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const comp = ac.createDynamicsCompressor();
      master = ac.createGain();
      master.gain.value = 0.16;
      master.connect(comp);
      comp.connect(ac.destination);
      noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const nd = noise.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function resetChannels() {
    for (let i = 0; i < 16; i++) chan[i] = { prog: 0, vol: 100 };
  }
  function waveFor(prog) {
    if (prog >= 32 && prog <= 39) return 'sawtooth'; // bass
    if (prog >= 40 && prog <= 55) return 'sawtooth'; // strings / ensemble
    if (prog >= 56 && prog <= 71) return 'square';   // brass / reed
    if (prog >= 72 && prog <= 79) return 'sine';     // pipe
    if (prog >= 80 && prog <= 87) return 'square';   // synth lead
    return 'triangle';                               // piano & the rest
  }
  const active = {};
  function noteOn(t, ch, note, vel) {
    const st = chan[ch];
    const v = (vel / 127) * (st.vol / 127);
    if (ch === 9) { drum(t, note, v); return; }
    noteOff(t, ch, note);
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = waveFor(st.prog);
    osc.frequency.value = 440 * Math.pow(2, (note - 69) / 12);
    const atk = st.prog >= 40 && st.prog <= 55 ? 0.05 : 0.006;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v * 0.5, t + atk);
    g.gain.setTargetAtTime(v * 0.3, t + atk, 0.3);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + 12);
    const voice = { osc, g, end: t + 12 };
    active[ch * 128 + note] = voice;
    voices.push(voice);
  }
  function noteOff(t, ch, note) {
    const a = active[ch * 128 + note];
    if (!a) return;
    a.g.gain.setTargetAtTime(0.0001, t, 0.07);
    a.osc.stop(t + 0.6);
    a.end = t + 0.6;
    delete active[ch * 128 + note];
  }
  function drum(t, note, v) {
    if (note === 35 || note === 36) { // kick
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(v * 0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.18);
      voices.push({ osc: o, g, end: t + 0.18 });
      return;
    }
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noise;
    let dur = 0.06, gain = v * 0.25, type = 'highpass', freq = 7000;
    if (note === 38 || note === 40) { type = 'bandpass'; freq = 1800; dur = 0.14; gain = v * 0.45; } // snare
    else if (note === 46) dur = 0.25;                                     // open hat
    else if (note >= 41 && note <= 50 && note !== 42 && note !== 44) {    // toms
      type = 'bandpass'; freq = 250 + (note - 41) * 60; dur = 0.18; gain = v * 0.4;
    }
    f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
    voices.push({ osc: src, g, end: t + dur + 0.02 });
  }

  // ------------------------------------------------------------ scheduler
  function tick() {
    if (!song || !ac) return;
    const now = ac.currentTime, horizon = now + 0.45;
    voices = voices.filter(v => v.end > now);
    for (;;) {
      if (song.idx >= song.data.events.length) {
        if (!song.loop) { if (now > song.start + song.data.duration) song = null; break; }
        if (song.start + song.data.duration <= horizon) {
          song.start += song.data.duration;
          song.idx = 0;
          resetChannels();
          continue;
        }
        break;
      }
      const e = song.data.events[song.idx];
      const t = song.start + e.t;
      if (t > horizon) break;
      song.idx++;
      const at = Math.max(t, now + 0.005);
      if (e.type === 'on') noteOn(at, e.ch, e.note, e.vel);
      else if (e.type === 'off') noteOff(at, e.ch, e.note);
      else if (e.type === 'prog') chan[e.ch].prog = e.prog;
      else if (e.type === 'vol') chan[e.ch].vol = e.vel;
    }
  }

  // ------------------------------------------------------------ api
  function play(name, loop = true) {
    if (!enabled) return;
    if (song && song.name === name) return;
    stop();
    ctx();
    resetChannels();
    song = { name, data: songData(name), start: ac.currentTime + 0.1, idx: 0, loop };
    if (!timer) timer = setInterval(tick, 120);
  }
  function stop() {
    if (!ac) { song = null; return; }
    const now = ac.currentTime;
    for (const v of voices) {
      try { v.g.gain.cancelScheduledValues(now); v.g.gain.setTargetAtTime(0.0001, now, 0.03); v.osc.stop(now + 0.2); } catch (e) {}
    }
    voices = [];
    for (const k in active) delete active[k];
    song = null;
  }
  function setEnabled(on) { enabled = on; if (!on) stop(); }
  function isEnabled() { return enabled; }
  function nowPlaying() { return song ? song.name : null; }

  resetChannels();
  return { play, stop, setEnabled, isEnabled, nowPlaying, parse };
})();
