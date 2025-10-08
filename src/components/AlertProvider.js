// src/alerts/AlertProvider.jsx
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { MetricsContext } from '../MetricsContext';
import { StyleSheet, css } from 'aphrodite';

/**
 * AlertProvider
 * - Keep this mounted at the top of your app (wrap <App /> or inside it).
 * - It watches `devices` from MetricsContext and fires:
 *    - in-app persistent popup (user must press Dismiss),
 *    - system notification (Notification API),
 *    - attention-grabbing repeating siren (Web Audio API) while popups exist.
 *
 * The siren plays once per cycle; the cycle repeats every 3000 ms while popups exist.
 * Note: browsers often require a user gesture before audio will play.
 */

export const AlertContext = createContext({
  muted: false,
  setMuted: () => {},
  requestPermission: async () => {},
});

export default function AlertProvider({ children }) {
  const { devices } = useContext(MetricsContext);

  // popup queue (persistent until user dismisses)
  const [popups, setPopups] = useState([]);
  const addPopup = (message) => {
    const id = Math.random().toString(36).slice(2, 9);
    const ts = Date.now();
    setPopups((p) => [{ id, message, ts }, ...p]); // keep until dismissed
  };
  const dismissPopup = (id) => {
    setPopups((p) => p.filter((x) => x.id !== id));
  };

  // mute persistence
  const LS_MUTE_KEY = 'alerts_muted_v1';
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem(LS_MUTE_KEY) === '1'; } catch (e) { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(LS_MUTE_KEY, muted ? '1' : '0'); } catch (e) {}
  }, [muted]);

  // dedupe map: message -> last fired timestamp
  const alertedRef = useRef(new Map());
  const ALERT_DEBOUNCE_MS = 20_000;

  // -----------------------
  // WebAudio: siren & repeating while popups exist
  // -----------------------
  const audioCtxRef = useRef(null);
  const audioLoopRef = useRef(null); // interval id
  const ensureAudioContext = () => {
    if (audioCtxRef.current) return audioCtxRef.current;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtxRef.current = new Ctx();
      return audioCtxRef.current;
    } catch (e) {
      return null;
    }
  };

  /**
   * playSirenOnce:
   * - creates an oscillator that sweeps frequency up then down over `durationMs`.
   * - uses a small low-frequency oscillator (LFO) to modulate pitch slightly for realism.
   * - strong amplitude envelope for attention grabbing.
   *
   * Parameters tuned for loud, urgent siren while avoiding extreme clipping.
   */
  const playSirenOnce = async (opts = {}) => {
    if (muted) return;
    const {
      startFreq = 600,   // Hz
      peakFreq = 1400,   // Hz
      durationMs = 1200, // total ms for one up-and-down sweep
      peakGain = 0.45,   // amplitude peak (0.0 - 1.0)
      lfoFreq = 5.5,     // vibrato freq in Hz
      lfoDepth = 10,     // vibrato depth in Hz
    } = opts;

    const ctx = ensureAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (e) { /* ignore - may require user gesture */ }
    }

    try {
      const now = ctx.currentTime;
      // main oscillator + gain
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      // set a waveform that sounds urgent but not piercing; triangle or sawtooth are options.
      o.type = 'sine'; // smooth; change to 'triangle' or 'sawtooth' for different timbre

      // LFO for vibrato
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(lfoFreq, now);
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(lfoDepth, now); // in Hz

      // Connect LFO to main oscillator frequency param
      lfo.connect(lfoGain);
      lfoGain.connect(o.frequency);

      // connect main oscillator -> gain -> destination
      o.connect(g);
      g.connect(ctx.destination);

      // amplitude envelope: ramp up quickly then ramp down at end
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(Math.max(0.02, peakGain), now + 0.02);
      // schedule ramp down at end
      const stopTime = now + durationMs / 1000;
      g.gain.exponentialRampToValueAtTime(0.0001, stopTime + 0.02);

      // schedule frequency sweep: up then down
      // ramp up to peak at halfway, then back to start
      o.frequency.setValueAtTime(startFreq, now);
      const half = now + (durationMs / 1000) / 2;
      o.frequency.linearRampToValueAtTime(peakFreq, half);
      o.frequency.linearRampToValueAtTime(startFreq, stopTime);

      // start everything
      o.start(now);
      lfo.start(now);

      // stop after completion + small buffer
      const stopBuffer = 0.04;
      o.stop(stopTime + stopBuffer);
      lfo.stop(stopTime + stopBuffer);

      // cleanup when ended
      o.onended = () => {
        try {
          o.disconnect();
        } catch (e) {}
        try {
          lfo.disconnect();
        } catch (e) {}
        try {
          lfoGain.disconnect();
        } catch (e) {}
        try {
          g.disconnect();
        } catch (e) {}
      };
    } catch (e) {
      // ignore if audio scheduling fails
      console.warn('siren play failed', e);
    }
  };

  // start repeating siren while there are popups (runs until all dismissed or muted)
  const startAlarmLoop = () => {
    if (audioLoopRef.current) return;
    if (muted) return;
    // immediate initial siren
    try { playSirenOnce(); } catch (e) {}
    // repeat every 3000ms (user requested)
    audioLoopRef.current = window.setInterval(() => {
      try { playSirenOnce(); } catch (e) {}
    }, 3000);
  };

  const stopAlarmLoop = () => {
    if (audioLoopRef.current) {
      clearInterval(audioLoopRef.current);
      audioLoopRef.current = null;
    }
  };

  useEffect(() => {
    if (muted) {
      stopAlarmLoop();
      return;
    }
    if (popups.length > 0) startAlarmLoop();
    else stopAlarmLoop();

    return () => stopAlarmLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popups.length, muted]);

  useEffect(() => {
    return () => {
      stopAlarmLoop();
      try {
        if (audioCtxRef.current && typeof audioCtxRef.current.close === 'function') {
          audioCtxRef.current.close().catch(() => {});
        }
      } catch (e) {}
    };
  }, []);

  // -----------------------
  // Notifications
  // -----------------------
  const safeShowNotification = (title, body) => {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'granted') {
        const n = new Notification(title, { body, silent: true });
        setTimeout(() => { try { n.close(); } catch (e) {} }, 10000);
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then((perm) => {
          if (perm === 'granted') {
            const n = new Notification(title, { body, silent: true });
            setTimeout(() => { try { n.close(); } catch (e) {} }, 10000);
          }
        }).catch(() => {});
      }
    } catch (e) {}
  };

  const requestPermission = async () => {
    if (!('Notification' in window)) return;
    try {
      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    } catch (e) {}
  };

  // -----------------------
  // Reuse device detection from earlier (simple)
  // -----------------------
  const boolish = (v) => {
    if (v === true) return true;
    if (v === false) return false;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (s === 'true' || s === '1' || s === '"true"') return true;
      if (s === 'false' || s === '0' || s === '"false"') return false;
      return false;
    }
    return Boolean(v);
  };

  // Build and fire alerts from devices; dedupe similar messages for ALERT_DEBOUNCE_MS
  useEffect(() => {
    if (!devices || devices.length === 0) return;
    const msgs = [];
    devices.forEach((d) => {
      if (boolish(d.binFull)) msgs.push(`⚠️ Bin Full at Device ${d.id}`);
      if (boolish(d.flooded)) msgs.push(`🌊 Flood Alert at Device ${d.id}`);
    });

    if (msgs.length === 0) return;
    const now = Date.now();
    msgs.forEach((m) => {
      const last = alertedRef.current.get(m) || 0;
      if (now - last < ALERT_DEBOUNCE_MS) return;
      alertedRef.current.set(m, now);

      // add persistent popup (user must dismiss)
      addPopup(m);

      // show system notification
      safeShowNotification('Alert', m);

      // try to resume audio context (may still require user gesture)
      const ctx = ensureAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(devices)]);

  // stop alarms when user dismisses a popup — handled by popup effect above
  useEffect(() => {
    if (popups.length === 0) stopAlarmLoop();
  }, [popups.length]);

  // -----------------------
  // Render
  // -----------------------
  return (
    <AlertContext.Provider value={{ muted, setMuted, requestPermission }}>
      {children}

      {/* popup container (persistent until dismissed) */}
      <div className={css(styles.popupContainer)} aria-hidden={popups.length === 0}>
        {popups.map((p) => (
          <div key={p.id} className={css(styles.popup)}>
            <div className={css(styles.popupText)}>{p.message}</div>
            <div className={css(styles.popupActions)}>
              <button
                onClick={() => dismissPopup(p.id)}
                className={css(styles.popupDismiss)}
                aria-label="Dismiss alert"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </AlertContext.Provider>
  );
}

const styles = StyleSheet.create({
  popupContainer: {
    position: 'fixed',
    right: '18px',
    bottom: '18px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    zIndex: 1200,
    maxWidth: '420px',
    pointerEvents: 'none',
  },
  popup: {
    pointerEvents: 'auto',
    backgroundColor: '#111827',
    border: '1px solid rgba(255,255,255,0.06)',
    color: '#E6EEF8',
    padding: '14px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    boxShadow: '0 10px 30px rgba(2,6,23,0.6)',
  },
  popupText: { flex: 1, fontSize: '0.98rem', lineHeight: 1.2 },
  popupActions: { marginLeft: '8px', display: 'flex', gap: '8px', alignItems: 'center' },
  popupDismiss: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.06)',
    padding: '6px 8px',
    borderRadius: '6px',
    color: '#F87171',
    cursor: 'pointer',
    fontSize: '0.95rem',
  },

  /* Settings tab styles (kept if you later add a settings UI) */
  settingsCard: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.04)',
    padding: '12px',
    borderRadius: '10px',
    maxWidth: '640px',
    color: '#E6EEF8',
    margin: '6px 0',
  },
  settingsTitle: {
    margin: '0 0 8px 0',
    fontSize: '1.05rem',
  },
  settingsRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 0',
    borderTop: '1px solid rgba(255,255,255,0.02)',
    ':first-of-type': { borderTop: 'none' },
  },
  settingsLabel: { fontSize: '0.95rem', marginBottom: '4px' },
  settingsHelp: { fontSize: '0.82rem', color: 'rgba(226,232,240,0.75)' },
  settingsBtn: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    color: '#E2E8F0',
    padding: '6px 10px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.85rem',
  },

  /* simple toggle (styles useful if you implement a settings tab) */
  toggle: {
    display: 'inline-block',
    width: '46px',
    height: '26px',
    position: 'relative',
    input: {
      display: 'none',
    },
  },
  toggleSlider: {
    position: 'absolute',
    cursor: 'pointer',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(255,255,255,0.08)',
    borderRadius: '999px',
    transition: '0.2s',
    // the knob
    '::after': {
      content: "''",
      position: 'absolute',
      height: '20px',
      width: '20px',
      left: '3px',
      top: '3px',
      background: '#fff',
      borderRadius: '50%',
      transition: '0.2s',
    },
  },

  /* small utilities (if you want to reuse) */
  settingsSmall: { fontSize: '0.85rem' },
});
