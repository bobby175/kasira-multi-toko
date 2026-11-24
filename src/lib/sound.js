// Tiny Web Audio chimes (no audio files needed).
let ctx = null;

function getContext() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** Browsers only allow audio after a user gesture; call this on the first tap/click. */
export function unlockAudioOnFirstGesture() {
  const unlock = () => {
    getContext();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

const PATTERNS = {
  success: [784, 1046.5, 1318.5],
  notify: [880, 660],
};

export function playChime(type = 'success') {
  try {
    const audio = getContext();
    if (!audio || audio.state !== 'running') return;
    const start = audio.currentTime + 0.02;
    PATTERNS[type].forEach((freq, i) => {
      const t = start + i * 0.11;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  } catch {
    /* audio is optional */
  }
}
