// src/alerts/AlertProvider.jsx
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { MetricsContext } from '../MetricsContext';
import { StyleSheet, css } from 'aphrodite';

/**
 * AlertProvider
 * - Keep this mounted at the top of your app (wrap <App /> or inside it).
 * - It watches `devices` from MetricsContext and fires:
 *    - in-app popup (visible anywhere in the SPA),
 *    - system notification (Notification API),
 *    - short beep (Web Audio API) with a persisted mute toggle.
 *
 * Usage: Wrap your Router / app with <AlertProvider><AppRoutes /></AlertProvider>
 */

export const AlertContext = createContext({
  muted: false,
  setMuted: () => {},
  requestPermission: async () => {},
});

export default function AlertProvider({ children }) {
  const { devices } = useContext(MetricsContext);

  // popup queue
  const [popups, setPopups] = useState([]);
  const addPopup = (message) => {
    const id = Math.random().toString(36).slice(2, 9);
    const ts = Date.now();
    setPopups((p) => [{ id, message, ts }, ...p].slice(0, 6));
    setTimeout(() => setPopups((p) => p.filter((x) => x.id !== id)), 8000);
  };
  const dismissPopup = (id) => setPopups((p) => p.filter((x) => x.id !== id));

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

  // WebAudio setup
  const audioCtxRef = useRef(null);
  const ensureAudioContext = () => {
    if (audioCtxRef.current) return audioCtxRef.current;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtxRef.current = new Ctx();
      return audioCtxRef.current;
    } catch (e) { return null; }
  };
  const playBeep = async () => {
    if (muted) return;
    const ctx = ensureAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (e) { /* ignore */ }
    }
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.55);
      o.onended = () => { try { o.disconnect(); g.disconnect(); } catch (e) {} };
    } catch (e) { /* ignore */ }
  };

  // system notification
  const safeShowNotification = (title, body) => {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'granted') {
        const n = new Notification(title, { body, silent: true });
        setTimeout(() => { try { n.close(); } catch (e) {} }, 8000);
      } else if (Notification.permission !== 'denied') {
        // try asking (best after user gesture)
        Notification.requestPermission().then((perm) => {
          if (perm === 'granted') {
            const n = new Notification(title, { body, silent: true });
            setTimeout(() => { try { n.close(); } catch (e) {} }, 8000);
          }
        }).catch(() => {});
      }
    } catch (e) {}
  };

  // exposes a method to request permission proactively
  const requestPermission = async () => {
    if (!('Notification' in window)) return;
    try {
      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    } catch (e) {}
  };

  // build realtime messages from devices (similar to your Status.jsx)
  useEffect(() => {
    if (!devices || devices.length === 0) return;
    const msgs = [];
    devices.forEach((d) => {
      const boolish = (v) => {
        if (v === true) return true;
        if (v === false) return false;
        if (typeof v === 'string') {
          const s = v.trim().toLowerCase();
          if (s === 'true' || s === '1') return true;
          return false;
        }
        return Boolean(v);
      };
      if (boolish(d.binFull)) msgs.push(`⚠️ Bin Full at Device ${d.id}`);
      if (boolish(d.flooded)) msgs.push(`🌊 Flood Alert at Device ${d.id}`);
    });

    if (msgs.length === 0) return;
    const now = Date.now();
    msgs.forEach((m) => {
      const last = alertedRef.current.get(m) || 0;
      if (now - last < ALERT_DEBOUNCE_MS) return;
      alertedRef.current.set(m, now);

      // fire all three (in-app popup, sound, system notification)
      addPopup(m);
      playBeep();
      safeShowNotification('Alert', m);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(devices)]);

  return (
    <AlertContext.Provider value={{ muted, setMuted, requestPermission }}>
      {children}

      {/* popup container (always present anywhere in SPA) */}
      <div className={css(styles.popupContainer)} aria-hidden={popups.length === 0}>
        {popups.map((p) => (
          <div key={p.id} className={css(styles.popup)}>
            <div className={css(styles.popupText)}>{p.message}</div>
            <div className={css(styles.popupActions)}>
              <button onClick={() => dismissPopup(p.id)} className={css(styles.popupDismiss)} aria-label="Dismiss alert">Dismiss</button>
            </div>
          </div>
        ))}
      </div>

      {/* small floating controls for testing / permission */}
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
    maxWidth: '360px',
    pointerEvents: 'none',
  },
  popup: {
    pointerEvents: 'auto',
    backgroundColor: '#111827',
    border: '1px solid rgba(255,255,255,0.06)',
    color: '#E6EEF8',
    padding: '12px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    boxShadow: '0 8px 24px rgba(2,6,23,0.6)',
  },
  popupText: { flex: 1, fontSize: '0.95rem' },
  popupActions: { marginLeft: '8px', display: 'flex', gap: '8px', alignItems: 'center' },
  popupDismiss: { background: 'transparent', border: '1px solid rgba(255,255,255,0.04)', padding: '6px 8px', borderRadius: '6px', color: '#E2E8F0', cursor: 'pointer' },

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
