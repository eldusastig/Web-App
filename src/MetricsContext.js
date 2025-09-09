// src/MetricsContext.js
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

  const clientRef = useRef(null);
  const presenceRef = useRef(new Map()); // Map<id, { online: boolean, lastSeen: number }>
  // dbIdsRef now represents locally-known device IDs (sourced from MQTT)
  const dbIdsRef = useRef(new Set());

  const ACTIVE_CUTOFF_MS = 8000;
  const PRUNE_INTERVAL_MS = 2000;
  const MAX_LOGS_PER_DEVICE = 50;
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

  function normalizePayloadBooleans(p) {
    if (!p || typeof p !== 'object') return p;
    const out = { ...p };
    for (const k of KNOWN_BOOL_KEYS) {
      if (Object.prototype.hasOwnProperty.call(out, k)) {
        const v = out[k];
        if (typeof v === 'boolean') continue;
        if (typeof v === 'number') { out[k] = (v !== 0); continue; }
        if (typeof v === 'string') {
          const low = v.trim().toLowerCase();
          if (low === 'true' || low === '"true"' || low === '1') out[k] = true;
          else if (low === 'false' || low === '"false"' || low === '0') out[k] = false;
        }
      }
    }
    return out;
  }

  function parseFillPct(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const candidates = ['fillPct', 'fill_pct', 'binFillPct', 'bin_fill_pct', 'fill'];
    for (const k of candidates) {
      if (Object.prototype.hasOwnProperty.call(payload, k)) {
        const v = payload[k];
        if (v === null || v === undefined) continue;
        if (typeof v === 'number' && isFinite(v)) {
          return Math.max(0, Math.min(100, Math.round(v)));
        }
        if (typeof v === 'string') {
          const num = Number(v.trim());
          if (!Number.isNaN(num)) return Math.max(0, Math.min(100, Math.round(num)));
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'binFull') || Object.prototype.hasOwnProperty.call(payload, 'bin_full')) {
      const bf = payload.binFull ?? payload.bin_full;
      if (bf === true) return 100;
      if (bf === false) return null;
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

    const newDev = {
      id: sid,
      createdAt: Date.now(),
      lastSeen: initial.lastSeen ?? Date.now(),
      online: initial.online ?? true,
      logs: Array.isArray(initial.logs) ? initial.logs.slice(0, MAX_LOGS_PER_DEVICE) : [],
      binFillPct: initial.binFillPct ?? (initial.binFull === true ? 100 : null),
      binFull: (typeof initial.binFillPct === 'number') ? (initial.binFillPct >= BIN_FULL_ALERT_PCT) : (initial.binFull === true ?? false),
      ...initial,
    };

    setDevices((prev) => [newDev, ...prev]);
  };

  // ---------------------------
  // pushDeviceLog: now works fully locally (creates device if not present)
  // ---------------------------
  const pushDeviceLog = (deviceId, logObj) => {
    const idStr = String(deviceId);
    const pct = parseFillPct(logObj);
    if (pct != null) logObj.fillPct = pct;

    // If device unknown locally, create it (MQTT-driven, no firebase write)
    if (!dbIdsRef.current.has(idStr)) {
      addLocalDevice(idStr, {
        logs: [logObj],
        lastSeen: Date.now(),
        online: true,
        binFillPct: pct ?? null,
        binFull: (pct != null) ? (pct >= BIN_FULL_ALERT_PCT) : false,
      });
      // Also update presence map and activeDevices
      presenceRef.current.set(idStr, { online: true, lastSeen: Date.now() });
      setActiveDevices(Array.from(presenceRef.current.values()).filter(p => p.online).length);
      return;
    }

    setDevices((prev) => {
      const idx = prev.findIndex((d) => String(d.id) === idStr);
      if (idx > -1) {
        const updated = [...prev];
        const prevLogs = Array.isArray(updated[idx].logs) ? updated[idx].logs : [];
        updated[idx] = {
          ...updated[idx],
          logs: [logObj, ...prevLogs].slice(0, MAX_LOGS_PER_DEVICE),
          lastSeen: Date.now(),
          online: true,
          binFillPct: (pct != null) ? pct : (updated[idx].binFillPct ?? null),
          binFull: ((pct != null) ? (pct >= BIN_FULL_ALERT_PCT) : (updated[idx].binFull ?? false)),
        };
        return updated;
      }
      // Fallback: if somehow not found, prepend as new device
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

      // Helper to mark presence and activeDevices
      const markPresence = (deviceId) => {
        const now = Date.now();
        presenceRef.current.set(String(deviceId), { online: true, lastSeen: now });
        setActiveDevices(Array.from(presenceRef.current.values()).filter(p => p.online).length);
      };

      // Handle detection messages (and other sensor messages)
      if (parts.length >= 4 && parts[0] === 'esp32' && parts[2] === 'sensor' && parts[3] === 'detections') {
        // If device unknown locally, check deleted_devices flag before creating
        if (!dbIdsRef.current.has(idStr)) {
          const deletedRef = dbRef(realtimeDB, `deleted_devices/${idStr}`);
          get(deletedRef).then((snap) => {
            if (snap.exists() && snap.val()) {
              console.log(`Device ${idStr} is marked deleted — ignoring MQTT message`);
              return;
            }

            console.warn(`New device detected via MQTT: ${idStr}. Creating locally (MQTT authoritative).`);
            // Create locally (no firebase create)
            addLocalDevice(idStr, { online: true, lastSeen: Date.now() });

            // Build log and push
            const logObj = payload ? { ...payload } : { raw: txt, ts: Date.now() };
            if (logObj.ts === undefined || logObj.ts === null) logObj.ts = Date.now();
            logObj.arrival = Date.now();

            pushDeviceLog(idStr, logObj);
            markPresence(idStr);
          }).catch((e) => {
            console.error('Failed to check deleted_devices', e);
          });
        } else {
          // Known device: process normally
          const logObj = payload ? { ...payload } : { raw: txt, ts: Date.now() };
          if (logObj.ts === undefined || logObj.ts === null) logObj.ts = Date.now();
          logObj.arrival = Date.now();

          pushDeviceLog(idStr, logObj);
          markPresence(idStr);
        }

        // NOTE: no firebase write for lastDetection anymore (MQTT authoritative)
        return;
      }

      // Non-detection messages (status, sensors, etc.)
      const logObj = payload ? { ...payload } : { raw: txt, ts: Date.now() };
      if (logObj.ts === undefined || logObj.ts === null) logObj.ts = Date.now();
      logObj.arrival = Date.now();

      // If device unknown, add locally (but still respect deleted_devices)
      if (!dbIdsRef.current.has(idStr)) {
        const deletedRef = dbRef(realtimeDB, `deleted_devices/${idStr}`);
        get(deletedRef).then((snap) => {
          if (snap.exists() && snap.val()) {
            console.log(`Device ${idStr} is marked deleted — ignoring MQTT message`);
            return;
          }

          addLocalDevice(idStr, { online: true, lastSeen: Date.now() });
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
  // Prune presence periodically (same as before)
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
  // Compute fullBinAlerts / floodRisks (same logic)
  // ---------------------------
  useEffect(() => {
    setFullBinAlerts(devices.filter((d) => {
      if (typeof d.binFillPct === 'number') return d.binFillPct >= BIN_FULL_ALERT_PCT;
      return Boolean(d.binFull);
    }).length);

    setFloodRisks(devices.filter((d) => d.flooded).length);
  }, [devices]);

  return (
    <MetricsContext.Provider value={{ fullBinAlerts, floodRisks, activeDevices, devices, authReady }}>
      {children}
    </MetricsContext.Provider>
  );
};
