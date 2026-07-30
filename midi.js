'use strict';
// Music player for the MZ port: streams the RPG Maker MZ .ogg BGM tracks from
// assets/bgm/ on a looping <audio> element. Keeps the old MidiPlayer API
// (play/stop/setEnabled/isEnabled/nowPlaying) so the client code is unchanged.
const MidiPlayer = (() => {
  let enabled = true;
  let current = null; // { name, audio }

  function play(name) {
    if (!enabled) { current = { name, audio: null }; return; }
    if (current && current.name === name && current.audio) return;
    stopAudio();
    const audio = new Audio('assets/bgm/' + name + '.ogg');
    audio.loop = true;
    audio.volume = 0.35;
    audio.play().catch(() => {});
    current = { name, audio };
  }
  function stopAudio() {
    if (current && current.audio) {
      current.audio.pause();
      current.audio.src = '';
    }
  }
  function stop() { stopAudio(); current = null; }
  function setEnabled(on) {
    enabled = on;
    if (!on) stopAudio();
    else if (current) { const n = current.name; current = null; play(n); }
  }
  function isEnabled() { return enabled; }
  function nowPlaying() { return current ? current.name : null; }

  return { play, stop, setEnabled, isEnabled, nowPlaying };
})();
