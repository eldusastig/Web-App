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
 *    - attention-grabbing repeating alarm (Web Audio API) while popups exist.
 *
 * The alarm sequence now repeats every 3000 ms while popups exist.
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
    setPopups((p) => [{ id, message, ts }, ...p]); // no slice -> keep all until dismissed
  };
  const dismissPopup = (id) => {
    setPopups((p) => {
      const next = p.filter((x) => x.id !== id);
      return next;
    });
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
  // WebAudio: louder & repeating alarm while popups exist
  // -----------------------
  const audioCtxRef = useRef(null);
  const audioLoopRef = useRef(null);     // holds interval id for repeating sequence
  const playingRef = useRef(false);      // whether sequence currently running

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

  // play a single pulse at given freq & duration with a stronger gain
  const playPulse = (freq = 880, dur = 250, peak = 0.35) => {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      // start with very low gain to avoid clicks, ramp up quickly to peak
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.02), ctx.currentTime + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (dur / 1000));
      o.connect(g);
      g.connect(ctx.destination);
      o.start(ctx.currentTime);
      o.stop(ctx.currentTime + (dur / 1000) + 0.02);
      o.onended = () => {
        try { o.disconnect(); g.disconnect(); } catch (e) {}
      };
    } catch (e) {
      // ignore
    }
  };

  // attention-grabbing sequence: two pulses (high then lower) per cycle
  const playSequenceOnce = async () => {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    // browsers often suspend audio until user interaction — attempt to resume
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (e) { /* ignore */ }
    }
    // Two pulses: 880Hz (short), then 660Hz (short)
    playPulse(880, 240, 0.45); // louder first pulse
    setTimeout(() => playPulse(660, 240, 0.38), 260);
  };

  // start repeating alarm while there are popups (runs until all dismissed or muted)
  const startAlarmLoop = () => {
    if (audioLoopRef.current) return;
    // If muted, do not start.
    if (muted) return;
    // immediate initial burst
    try { playSequenceOnce(); } catch (e) {}
    // repeat every 3000ms (user requested interval)
    audioLoopRef.current = window.setInterval(() => {
      try { playSequenceOnce(); } catch (e) {}
    }, 3000);
  };

  const stopAlarmLoop = () => {
    if (audioLoopRef.current) {
      clearInterval(audioLoopRef.current);
      audioLoopRef.current = null;
    }
  };

  // watch popups and (re)start/stop alarm loop
  useEffect(() => {
    if (muted) {
      stopAlarmLoop();
      return;
    }
    if (popups.length > 0) {
      startAlarmLoop();
    } else {
      stopAlarmLoop();
    }
    // cleanup on unmount
    return () => stopAlarmLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popups.length, muted]);

  // Ensure alarm loop stops on unmount
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

      // ensure audio context exists/resumed if possible — but user gesture may be required.
      const ctx = ensureAudioContext();
      if (ctx && ctx.state === 'suspended') {
        // try to resume on next tick — may still fail without user gesture
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

      {/* floating controls */}
      <div className={css(styles.controls)}>
        <button onClick={() => { try { requestPermission(); } catch (e) {} }} className={css(styles.ctrlBtn)}>Enable Notifications</button>
        <button onClick={() => setMuted((m) => !m)} className={css(styles.ctrlBtn)}>{muted ? 'Unmute' : 'Mute'}</button>
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

  controls: {
    position: 'fixed',
    left: '18px',
    bottom: '18px',
    display: 'flex',
    gap: '8px',
    zIndex: 1200,
  },
  ctrlBtn: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    color: '#E2E8F0',
    padding: '6px 8px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.85rem',
  },
});
