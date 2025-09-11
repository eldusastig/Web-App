// File: src/MetricsContext.js
import React, { createContext, useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import { realtimeDB } from './firebase2';
import { ref as dbRef, get } from 'firebase/database';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

export const MetricsContext = createContext({
  fullBinAlerts: null,
  floodRisks: null,
  activeDevices: null,
  devices: [],
  authReady: false,
});

export const MetricsProvider = ({ children }) => {
  const [fullBinAlerts, setFullBinAlerts] = useState(0);
  const [floodRisks, setFloodRisks]       = useState(0);
  const [activeDevices, setActiveDevices] = useState(0);
  const [devices, setDevices]             = useState([]);
  const [authReady, setAuthReady]         = useState(false);

  // deviceLogs holds normalized raw log objects (MQTT authoritative)
  const [deviceLogs, setDeviceLogs] = useState({}); // { [id]: [ logObj, ... ] }

  const clientRef = useRef(null);
  const presenceRef = useRef(new Map()); // Map<id, { online: boolean, lastSeen: number }>
  const dbIdsRef = useRef(new Set()); // locally-known device ids (MQTT-driven)

  const ACTIVE_CUTOFF_MS = 8000;
  const PRUNE_INTERVAL_MS = 2000;
  const MAX_LOGS_PER_DEVICE = 50; // used when building devices[].logs
  const MAX_LOGS_PERSIST = 200;   // how many logs to keep in deviceLogs map
  const BIN_FULL_ALERT_PCT = 90;

  const KNOWN_BOOL_KEYS = [
    'online',
    'active',
    'flooded',
    'flood',
    'binFull',
    'bin_full',
    'bin_full_flag',
  ];

  // helper: clamp to 0..100 and keep one decimal precision
  function clampPct(n) {
    if (typeof n !== 'number' || !isFinite(n)) return null;
    const clamped = Math.max(0, Math.min(100, n));
    return Math.round(clamped * 10) / 10; // one decimal place
  }

  // parseFillPct: robust extractor that prefers an explicit numeric percentage
  // - accepts number (int/float), string with optional % or quotes, and checks nested payload.data
  // - DOES NOT infer false->0, but will return 100 if binFull boolean is true (useful fallback)
  function parseFillPct(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const candidates = ['fillPct', 'fill_pct', 'binFillPct', 'bin_fill_pct', 'fill', 'level', 'fillPercentage', 'fill_percentage'];

    const findIn = (obj) => {
      for (const k of candidates) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
      }
      return undefined;
    };

    // 1) direct keys
    let raw = findIn(payload);
    // 2) nested .data object (common device pattern)
    if (raw === undefined && payload.data && typeof payload.data === 'object') raw = findIn(payload.data);

    if (raw === undefined || raw === null) {
      // Fallback: if device explicitly reports binFull:true but no numeric, treat it as 100%
      if (Object.prototype.hasOwnProperty.call(payload, 'binFull') || Object.prototype.hasOwnProperty.call(payload, 'bin_full')) {
        const bf = payload.binFull ?? payload.bin_full;
        if (bf === true) return 100.0; // explicit full
        return null; // don't infer false->0 (avoid false positives)
      }
      return null;
    }

    // If it's already numeric
    if (typeof raw === 'number' && isFinite(raw)) return clampPct(raw);

    // If it's a boolean (should be rare here), treat true -> 100, false -> null
    if (typeof raw === 'boolean') return raw ? 100.0 : null;

    // If it's a string, strip quotes and percentage signs, then parse
    if (typeof raw === 'string') {
      const cleaned = raw.trim().replace(/^["']+|["']+$|%/g, '').trim();
      if (cleaned.length === 0) return null;
      const num = Number(cleaned);
      if (!Number.isNaN(num) && isFinite(num)) return clampPct(num);
      return null;
    }

    return null;
  }

  // ---------------------------
  // Auth (kept - used for Status delete flow)
  // ---------------------------
  useEffect(() => {
    const auth = getAuth();
    signInAnonymously(auth).catch((err) => console.error('Auth error:', err));

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        console.log('✅ Authenticated as', user.uid);
        setAuthReady(true);
      }
    });
    return () => unsubscribe();
  }, []);

  // ---------------------------
  // Helper: add a new local device (MQTT-created)
  // ---------------------------
  const addLocalDevice = (id, initial = {}) => {
    const sid = String(id);
    if (dbIdsRef.current.has(sid)) return;
    dbIdsRef.current.add(sid);

    const computedBinFill = (typeof initial.binFillPct === 'number') ? initial.binFillPct : null;

    const newDev = {
      id: sid,
      createdAt: Date.now(),
      lastSeen: initial.lastSeen ?? Date.now(),
      online: initial.online ?? true,
      logs: Array.isArray(initial.logs) ? initial.logs.slice(0, MAX_LOGS_PER_DEVICE) : [],
      binFillPct: computedBinFill,
      // compute binFull strictly from numeric binFillPct (MQTT authoritative)
      binFull: (typeof computedBinFill === 'number') ? (computedBinFill >= BIN_FULL_ALERT_PCT) : false,
      ...initial,
    };

    setDevices((prev) => [newDev, ...prev]);
  };

  // ---------------------------
  // pushDeviceLog: now works fully locally (creates device if not present)
  // Uses the MQTT-provided fillPct when available and treats it as authoritative.
  // ---------------------------
  const pushDeviceLog = (deviceId, logObj) => {
    const idStr = String(deviceId);
    const pct = parseFillPct(logObj);
    if (pct != null) {
      // store as a numeric (one decimal) under both fillPct and fill_pct for compatibility
      logObj.fillPct = pct;
      logObj.fill_pct = pct;
    }

    // Ensure arrival timestamp
    if (logObj.arrival === undefined || logObj.arrival === null) logObj.arrival = Date.now();

    // 1) update deviceLogs map (MQTT authoritative)
    setDeviceLogs((prev) => {
      const cur = Array.isArray(prev[idStr]) ? prev[idStr].slice() : [];
      cur.unshift(logObj);
      if (cur.length > MAX_LOGS_PERSIST) cur.length = MAX_LOGS_PERSIST;
      return { ...prev, [idStr]: cur };
    });

    // 2) If device unknown locally, create it (MQTT-driven, no firebase write)
    if (!dbIdsRef.current.has(idStr)) {
      addLocalDevice(idStr, {
        logs: [logObj],
        lastSeen: Date.now(),
        online: true,
        binFillPct: pct ?? null,
      });

      // mark presence and active devices
      presenceRef.current.set(idStr, { online: true, lastSeen: Date.now() });
      setActiveDevices(Array.from(presenceRef.current.values()).filter(p => p.online).length);
      return;
    }

    // 3) existing device: update devices[] state (shallow merge)
    setDevices((prev) => {
      const idx = prev.findIndex((d) => String(d.id) === idStr);
      if (idx > -1) {
        const updated = [...prev];
        const prevLogs = Array.isArray(updated[idx].logs) ? updated[idx].logs : [];
        const newBinFill = (pct != null) ? pct : (updated[idx].binFillPct ?? null);
        updated[idx] = {
          ...updated[idx],
          logs: [logObj, ...prevLogs].slice(0, MAX_LOGS_PER_DEVICE),
          lastSeen: Date.now(),
          online: true,
          binFillPct: newBinFill,
          // compute binFull ONLY from numeric binFillPct
          binFull: (typeof newBinFill === 'number') ? (newBinFill >= BIN_FULL_ALERT_PCT) : (updated[idx].binFull ?? false),
        };
        return updated;
      }
      // fallback: unknown in array even though dbIdsRef says known
      return [{ id: idStr, logs: [logObj], lastSeen: Date.now(), online: true, binFillPct: pct ?? null, binFull: (pct != null) ? (pct >= BIN_FULL_ALERT_PCT) : false }, ...prev];
    });
  };

  // ---------------------------
  // MQTT connection (MQTT is now the single source for devices/presence)
  // ---------------------------
  useEffect(() => {
    if (!authReady) return;
    if (clientRef.current) return;

    const url = 'wss://a62b022814fc473682be5d58d05e5f97.s1.eu.hivemq.cloud:8884/mqtt';
    const options = {
      username: 'prototype',
      password: 'Prototype1',
      clean: true,
      keepalive: 60,
      reconnectPeriod: 2000,
      clientId: 'metrics_' + Math.random().toString(16).substr(2, 8),
    };

    const client = mqtt.connect(url, options);
    clientRef.current = client;

    client.on('connect', () => {
      console.log('✅ MQTT connected (global)');
      client.subscribe('esp32/gps', { qos: 1 });
      client.subscribe('esp32/sensor/flood', { qos: 1 });
      client.subscribe('esp32/sensor/bin_full', { qos: 1 });
      client.subscribe('esp32/+/gps', { qos: 1 });
      client.subscribe('esp32/+/sensor/flood', { qos: 1 });
      client.subscribe('esp32/+/sensor/bin_full', { qos: 1 });
      client.subscribe('esp32/+/sensor/detections', { qos: 1 }, (err) => {
        if (err) console.error('❌ subscribe failed on esp32/+/sensor/detections', err);
        else console.log('Subscribed to esp32/+/sensor/detections (detections)');
      });
      client.subscribe('esp32/+/status', { qos: 1 }, (err) => {
        if (err) console.error('❌ subscribe failed on esp32/+/status', err);
        else console.log('Subscribed to esp32/+/status (presence)');
      });
    });

    client.on('message', (topic, message) => {
      const txt = (message || '').toString();
      let payload = null;
      try { payload = JSON.parse(txt); } catch (e) {}

      if (payload && typeof payload === 'object') {
        payload = normalizePayloadBooleans(payload);
      }

      const parts = topic.split('/');
      const id = (payload && (payload.id ?? parts[1])) || parts[1]; // Device ID extraction
      const idStr = String(id);

      // compute pct early from MQTT payload so we ALWAYS prefer it
      const pct = parseFillPct(payload);

      // Helper to mark presence and activeDevices
      const markPresence = (deviceId) => {
        const now = Date.now();
        presenceRef.current.set(String(deviceId), { online: true, lastSeen: now });
        setActiveDevices(Array.from(presenceRef.current.values()).filter(p => p.online).length);
      };

      // Handle detection topic specially
      if (parts.length >= 4 && parts[0] === 'esp32' && parts[2] === 'sensor' && parts[3] === 'detections') {
        if (!dbIdsRef.current.has(idStr)) {
          const deletedRef = dbRef(realtimeDB, `deleted_devices/${idStr}`);
          get(deletedRef).then((snap) => {
            if (snap.exists() && snap.val()) {
              console.log(`Device ${idStr} is marked deleted — ignoring MQTT message`);
              return;
            }

            console.warn(`New device detected via MQTT: ${idStr}. Creating locally (MQTT authoritative).`);
            addLocalDevice(idStr, { online: true, lastSeen: Date.now(), binFillPct: pct ?? null, logs: [] });

            const logObj = payload ? { ...payload } : { raw: txt, ts: Date.now() };
            if (logObj.ts === undefined || logObj.ts === null) logObj.ts = Date.now();
            logObj.arrival = Date.now();

            pushDeviceLog(idStr, logObj);
            markPresence(idStr);
          }).catch((e) => {
            console.error('Failed to check deleted_devices', e);
          });
        } else {
          const logObj = payload ? { ...payload } : { raw: txt, ts: Date.now() };
          if (logObj.ts === undefined || logObj.ts === null) logObj.ts = Date.now();
          logObj.arrival = Date.now();

          pushDeviceLog(idStr, logObj);
          markPresence(idStr);
        }

        return;
      }

      // Non-detection messages (status, sensors, etc.)
      const logObj = payload ? { ...payload } : { raw: txt, ts: Date.now() };
      if (logObj.ts === undefined || logObj.ts === null) logObj.ts = Date.now();
      logObj.arrival = Date.now();

      if (!dbIdsRef.current.has(idStr)) {
        const deletedRef = dbRef(realtimeDB, `deleted_devices/${idStr}`);
        get(deletedRef).then((snap) => {
          if (snap.exists() && snap.val()) {
            console.log(`Device ${idStr} is marked deleted — ignoring MQTT message`);
            return;
          }

          addLocalDevice(idStr, { online: true, lastSeen: Date.now(), binFillPct: pct ?? null, logs: [] });
          pushDeviceLog(idStr, logObj);
          markPresence(idStr);
        }).catch((e) => {
          console.error('Failed to check deleted_devices', e);
        });
      } else {
        pushDeviceLog(idStr, logObj);
        markPresence(idStr);
      }
    });

    client.on('error', (err) => console.error('MQTT error', err));

    return () => {
      try { client.end(true); } catch (e) {}
      clientRef.current = null;
    };
  }, [authReady]);

  // ---------------------------
  // Prune presence periodically
  // ---------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - ACTIVE_CUTOFF_MS;
      let changed = false;

      presenceRef.current.forEach((val, id) => {
        if (val.lastSeen && val.lastSeen < cutoff && val.online) {
          presenceRef.current.set(id, { online: false, lastSeen: val.lastSeen });
          changed = true;
        }
      });

      if (changed) {
        setDevices((prev) => {
          const updated = prev.map((d) => {
            const p = presenceRef.current.get(String(d.id));
            if (!p) return d;
            if (d.online !== p.online || d.lastSeen !== p.lastSeen) {
              return { ...d, online: p.online, lastSeen: p.lastSeen };
            }
            return d;
          });
          return updated;
        });

        const activeNow = Array.from(presenceRef.current.values()).filter((p) => p.online).length;
        setActiveDevices(activeNow);
      }
    }, PRUNE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  // ---------------------------
  // Compute fullBinAlerts / floodRisks
  // Now counts full bins only when an explicit numeric binFillPct is present
  // and meets the threshold. This avoids inferring fullness from boolean flags
  // and ensures MQTT-provided percentage is authoritative.
  // ---------------------------
  useEffect(() => {
    setFullBinAlerts(devices.filter((d) => (typeof d.binFillPct === 'number') && (d.binFillPct >= BIN_FULL_ALERT_PCT)).length);

    setFloodRisks(devices.filter((d) => d.flooded).length);
  }, [devices]);

  // Helper to expose logs to consumers
  const getLogsForDevice = (id) => {
    const sid = String(id);
    if (Array.isArray(deviceLogs[sid])) return deviceLogs[sid];
    const dev = devices.find((d) => String(d.id) === sid);
    if (dev && Array.isArray(dev.logs)) return dev.logs;
    return [];
  };

  return (
    <MetricsContext.Provider value={{
      fullBinAlerts,
      floodRisks,
      activeDevices,
      devices,
      authReady,
      deviceLogs,      // optional raw map (useful for reactive UI)
      getLogsForDevice, // accessor
    }}>
      {children}
    </MetricsContext.Provider>
  );
};
