import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import { MetricsContext } from '../MetricsContext';
import { StyleSheet, css } from 'aphrodite';

export const AlertContext = createContext({
  muted: false,
  setMuted: () => {},
  requestPermission: async () => {},
});

export default function AlertProvider({ children }) {
  const { devices } = useContext(MetricsContext);

  // -----------------------
  // Popup queue (persistent until dismissed)
  // -----------------------
  const [popups, setPopups] = useState([]);

  const addPopup = (popup) => {
    const id = Math.random().toString(36).slice(2, 9);
    const ts = Date.now();
    setPopups((p) => [{ id, ts, ...popup }, ...p]);
  };

  const dismissPopup = (id) => {
    setPopups((p) => p.filter((x) => x.id !== id));
  };

  // -----------------------
  // Mute persistence
  // -----------------------
  const LS_MUTE_KEY = 'alerts_muted_v1';
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem(LS_MUTE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(LS_MUTE_KEY, muted ? '1' : '0');
    } catch {}
  }, [muted]);

  // -----------------------
  // Dedup map
  // -----------------------
  const alertedRef = useRef(new Map());
  const ALERT_DEBOUNCE_MS = 20_000;

  // -----------------------
  // WebAudio siren
  // -----------------------
  const audioCtxRef = useRef(null);
  const audioLoopRef = useRef(null);

  const ensureAudioContext = () => {
    if (audioCtxRef.current) return audioCtxRef.current;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtxRef.current = new Ctx();
      return audioCtxRef.current;
    } catch {
      return null;
    }
  };

  const playSirenOnce = async () => {
    if (muted) return;
    const ctx = ensureAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {}
    }

    try {
      const now = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();

      o.type = 'sine';
      o.connect(g);
      g.connect(ctx.destination);

      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.4, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

      o.frequency.setValueAtTime(600, now);
      o.frequency.linearRampToValueAtTime(1400, now + 0.6);
      o.frequency.linearRampToValueAtTime(600, now + 1.2);

      o.start(now);
      o.stop(now + 1.25);

      o.onended = () => {
        try {
          o.disconnect();
        } catch {}
        try {
          g.disconnect();
        } catch {}
      };
    } catch (e) {
      console.warn('siren failed', e);
    }
  };

  const startAlarmLoop = useCallback(() => {
    if (audioLoopRef.current || muted) return;
    playSirenOnce();
    audioLoopRef.current = window.setInterval(playSirenOnce, 3000);
  }, [muted]);

  const stopAlarmLoop = useCallback(() => {
    if (audioLoopRef.current) {
      clearInterval(audioLoopRef.current);
      audioLoopRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (muted) {
      stopAlarmLoop();
      return;
    }

    if (popups.length > 0) startAlarmLoop();
    else stopAlarmLoop();

    return () => stopAlarmLoop();
  }, [popups.length, muted, startAlarmLoop, stopAlarmLoop]);

  // -----------------------
  // Notifications
  // -----------------------
  const safeShowNotification = (title, body) => {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'granted') {
        const n = new Notification(title, { body, silent: true });
        setTimeout(() => n.close(), 10_000);
      }
    } catch {}
  };

  const requestPermission = async () => {
    if (!('Notification' in window)) return;
    try {
      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    } catch {}
  };

  // -----------------------
  // Utils
  // -----------------------
  const boolish = (v) => {
    if (v === true) return true;
    if (v === false) return false;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (s === 'true' || s === '1') return true;
      if (s === 'false' || s === '0') return false;
    }
    return Boolean(v);
  };

  // -----------------------
  // Alert detection
  // -----------------------
  useEffect(() => {
    if (!devices || devices.length === 0) return;

    const now = Date.now();
    const normalMsgs = [];
    const errorPopups = [];

    devices.forEach((d) => {
      if (boolish(d.binFull)) {
        normalMsgs.push(`⚠️ Bin Full at Device ${d.id}`);
      }

      if (boolish(d.flooded)) {
        normalMsgs.push(`🌊 Flood Alert at Device ${d.id}`);
      }

      if (boolish(d.collectionError)) {
        errorPopups.push(d);
      }
    });

    normalMsgs.forEach((msg) => {
      const last = alertedRef.current.get(msg) || 0;
      if (now - last < ALERT_DEBOUNCE_MS) return;
      alertedRef.current.set(msg, now);

      addPopup({
        type: 'normal',
        message: msg,
      });

      safeShowNotification('Alert', msg);
    });

    errorPopups.forEach((device) => {
      const key = `collectionError:${device.id}`;
      const last = alertedRef.current.get(key) || 0;
      if (now - last < ALERT_DEBOUNCE_MS) return;
      alertedRef.current.set(key, now);

      addPopup({
        type: 'collectionError',
        device,
      });

      safeShowNotification(
        '🚨 Collection Error',
        `${device.name || device.id} requires attention`
      );
    });
  }, [devices]);

  // -----------------------
  // Render
  // -----------------------
  return (
    <AlertContext.Provider value={{ muted, setMuted, requestPermission }}>
      {children}

      <div className={css(styles.popupContainer)}>
        {popups.map((p) => (
          <div key={p.id} className={css(styles.popup)}>
            {p.type === 'collectionError' ? (
              <div className={css(styles.popupText)}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  🚨 Collection Error
                </div>

                <div>
                  <strong>Device:</strong> {p.device.name || p.device.id}
                </div>
                <div style={{ marginTop: 8 }}>
                  <strong>Troubleshooting:</strong>
                  <ul style={{ margin: '6px 0 0 16px' }}>
                    <li>Turn the switch off</li>
                    <li>Check if the chain is properly aligned</li>
                    <li>Check if the weight of the object exceeded</li>
                    <li>Check for physical blockage</li>
                    <li>Check if the motor is working properly</li>
                    <li>Check if there is something stuck</li>
                  </ul>
                </div>
              </div>
            ) : (
              <div className={css(styles.popupText)}>{p.message}</div>
            )}

            <div className={css(styles.popupActions)}>
              <button
                onClick={() => dismissPopup(p.id)}
                className={css(styles.popupDismiss)}
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

// -----------------------
// Styles
// -----------------------
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
  },
  popup: {
    backgroundColor: '#111827',
    border: '1px solid rgba(255,255,255,0.06)',
    color: '#E6EEF8',
    padding: '14px',
    borderRadius: '8px',
    display: 'flex',
    gap: '12px',
    boxShadow: '0 10px 30px rgba(2,6,23,0.6)',
  },
  popupText: { flex: 1, fontSize: '0.95rem', lineHeight: 1.25 },
  popupActions: { display: 'flex', alignItems: 'flex-start' },
  popupDismiss: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.06)',
    padding: '6px 8px',
    borderRadius: '6px',
    color: '#F87171',
    cursor: 'pointer',
  },
});
