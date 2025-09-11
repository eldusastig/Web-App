// File: src/MetricsContext.js
import React, { createContext, useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import { realtimeDB } from './firebase2';
import { ref as dbRef, get, update, onValue } from 'firebase/database';
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
  const dbIdsRef = useRef(new Set()); // locally-known device ids (firebase-driven when available, mqtt-driven otherwise)

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
  // Helper: add a new local device (MQTT-created or fallback)
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
      fillPct: (typeof initial.binFillPct === 'number') ? initial.binFillPct : (initial.fillPct ?? null),
      binFull: (typeof initial.binFillPct === 'number') ? (initial.binFillPct >= BIN_FULL_ALERT_PCT) : (initial.binFull === true ?? false),
      lat: initial.lat ?? null,
      lon: initial.lon ?? null,
      flooded: typeof initial.flooded === 'boolean' ? initial.flooded : undefined,
      ...initial,
    };

    setDevices((prev) => [newDev, ...prev]);
  };

  // ---------------------------
  // Firebase devices listener (keeps firebase as authoritative device list when present)
  // ---------------------------
  useEffect(() => {
    if (!authReady) return;

    console.log('🏁 mounting devices listener (firebase authoritative)');
    const devicesRef = dbRef(realtimeDB, 'devices');

    const unsubDevices = onValue(devicesRef, (snap) => {
      const data = snap.val() || {};
      const arr = Object.entries(data).map(([id, vals]) => ({ id, ...vals }));

      const dbIds = new Set(arr.map(d => String(d.id)));
      dbIdsRef.current = dbIds;

      const merged = arr.map(d => {
        const id = String(d.id);
        const p = presenceRef.current.get(id);

        // prepare logs as array
        let logsArr = [];
        if (Array.isArray(d.logs)) {
          logsArr = d.logs.slice(0, MAX_LOGS_PER_DEVICE).filter(Boolean);
        } else if (d.logs && typeof d.logs === 'object') {
          logsArr = Object.entries(d.logs).map(([pushKey, val]) => {
            if (val && typeof val === 'object') return { _key: pushKey, ...val };
            return { _key: pushKey, raw: val };
          });
          logsArr.sort((a, b) => {
            const aTs = Number(a.arrivalServerTs ?? a.arrival ?? a.ts ?? 0);
            const bTs = Number(b.arrivalServerTs ?? b.arrival ?? b.ts ?? 0);
            return bTs - aTs;
          });
          logsArr = logsArr.slice(0, MAX_LOGS_PER_DEVICE);
        } else {
          logsArr = [];
        }

        const dbFillPct = parseFillPct(d);

        return {
          ...d,
          id,
          online: p ? p.online : (d.online || false),
          lastSeen: p ? p.lastSeen : (d.lastSeen || null),
          logs: logsArr,
          // canonical fill fields for Status.jsx compatibility
          binFillPct: dbFillPct ?? (d.binFull === true ? 100 : (d.binFillPct ?? null)),
          fillPct: (dbFillPct != null ? dbFillPct : (d.fillPct ?? d.binFillPct ?? null)),
          binFull: (dbFillPct != null ? dbFillPct >= BIN_FULL_ALERT_PCT : (d.binFull === true)),
        };
      });

      setDevices(merged);
    });

    return () => unsubDevices();
  }, [authReady]);

  // ---------------------------
  // pushDeviceLog: MQTT-authoritative log handling + local device merge
  // ---------------------------
  const pushDeviceLog = (deviceId, logObj) => {
    const idStr = String(deviceId);
    const pct = parseFillPct(logObj);
    if (pct != null) logObj.fillPct = pct;

    // Ensure arrival timestamp
    if (logObj.arrival === undefined || logObj.arrival === null) logObj.arrival = Date.now();

    // 1) update deviceLogs map (MQTT authoritative)
    setDeviceLogs((prev) => {
      const cur = Array.isArray(prev[idStr]) ? prev[idStr].slice() : [];
      cur.unshift(logObj);
      if (cur.length > MAX_LOGS_PERSIST) cur.length = MAX_LOGS_PERSIST;
      return { ...prev, [idStr]: cur };
    });

    // Convenience local values from log (if present)
    const latFromLog = (logObj.lat != null) ? logObj.lat : null;
    const lonFromLog = (logObj.lon != null) ? logObj.lon : null;
    const floodedFromLog = (typeof logObj.flooded === 'boolean') ? logObj.flooded : undefined;

    // 2) If device unknown locally, create it (MQTT-driven, no firebase write)
    if (!dbIdsRef.current.has(idStr)) {
      addLocalDevice(idStr, {
        logs: [logObj],
        lastSeen: Date.now(),
        online: true,
        binFillPct: pct ?? null,
        fillPct: pct ?? null,
        binFull: (pct != null) ? (pct >= BIN_FULL_ALERT_PCT) : false,
        lat: latFromLog,
        lon: lonFromLog,
        flooded: floodedFromLog,
      });

      // mark presence and active devices
      presenceRef.current.set(idStr, { online: true, lastSeen: Date.now() });
      setActiveDevices(Array.from(presenceRef.current.values()).filter(p => p.online).length);
      return;
    }

    // 3) existing device: update devices[] state (merge useful sensor fields)
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
          // update fill values consistently
          binFillPct: (pct != null) ? pct : (updated[idx].binFillPct ?? null),
          fillPct: (pct != null) ? pct : (updated[idx].fillPct ?? updated[idx].binFillPct ?? null),
          binFull: (pct != null) ? (pct >= BIN_FULL_ALERT_PCT) : (updated[idx].binFull ?? false),
          // merge lat/lon/flooded if present in the incoming log
          lat: (latFromLog != null ? latFromLog : updated[idx].lat),
          lon: (lonFromLog != null ? lonFromLog : updated[idx].lon),
          flooded: (floodedFromLog !== undefined ? floodedFromLog : updated[idx].flooded),
        };
        return updated;
      }
      // fallback (shouldn't usually happen)
      return [{
        id: idStr,
        logs: [logObj],
        lastSeen: Date.now(),
        online: true,
        binFillPct: pct ?? null,
        fillPct: pct ?? null,
        binFull: (pct != null) ? (pct >= BIN_FULL_ALERT_PCT) : false,
        lat: latFromLog,
        lon: lonFromLog,
        flooded: floodedFromLog,
      }, ...prev];
    });
  };

  // ---------------------------
  // MQTT connection (MQTT is now the single source for real-time logs/presence)
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
      console.debug('[MQTT RX]', topic, txt);
      let payload = null;
      try { payload = JSON.parse(txt); } catch (e) { /* non-JSON payloads fall back to raw */ }

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

      // Handle detection topic specially (auto-create in Firebase if not present)
      if (parts.length >= 4 && parts[0] === 'esp32' && parts[2] === 'sensor' && parts[3] === 'detections') {
        if (!dbIdsRef.current.has(idStr)) {
          // Check if device is deleted before auto-creating
          const deletedRef = dbRef(realtimeDB, `deleted_devices/${idStr}`);
          get(deletedRef).then((snap) => {
            if (snap.exists() && snap.val()) {
              console.log(`Device ${idStr} is marked deleted — ignoring MQTT message`);
              return;
            }

            console.warn(`New device detected via MQTT: ${idStr}. Auto-creating in Firebase...`);
            update(dbRef(realtimeDB, `devices/${idStr}`), {
              createdAt: Date.now(),
              lastSeen: Date.now(),
              online: true,
              autoCreated: true
            })
            .then(() => {
              dbIdsRef.current.add(String(idStr));
              // Process the message after device creation
              const logObj = payload ? { ...payload } : { raw: txt, ts: Date.now() };
              if (logObj.ts === undefined || logObj.ts === null) logObj.ts = Date.now();
              logObj.arrival = Date.now();

              pushDeviceLog(idStr, logObj);

              const now = Date.now();
              presenceRef.current.set(String(idStr), { online: true, lastSeen: now });
              setActiveDevices(Array.from(presenceRef.current.values()).filter(p => p.online).length);
            })
            .catch((e) => {
              console.error('Failed to auto-create device in Firebase', e);
              // fallback: create local-only device so UI still shows it
              addLocalDevice(idStr, { online: true, lastSeen: Date.now() });
              const logObj = payload ? { ...payload } : { raw: txt, ts: Date.now() };
              if (logObj.ts === undefined || logObj.ts === null) logObj.ts = Date.now();
              logObj.arrival = Date.now();
              pushDeviceLog(idStr, logObj);
              markPresence(idStr);
            });
          }).catch((e) => {
            console.error('Failed to check deleted_devices', e);
            // fallback: create local-only device
            addLocalDevice(idStr, { online: true, lastSeen: Date.now() });
            const logObj = payload ? { ...payload } : { raw: txt, ts: Date.now() };
            if (logObj.ts === undefined || logObj.ts === null) logObj.ts = Date.now();
            logObj.arrival = Date.now();
            pushDeviceLog(idStr, logObj);
            markPresence(idStr);
          });
        } else {
          // Device exists in DB, process normally
          const logObj = payload ? { ...payload } : { raw: txt, ts: Date.now() };
          if (logObj.ts === undefined || logObj.ts === null) logObj.ts = Date.now();
          logObj.arrival = Date.now();

          pushDeviceLog(idStr, logObj);
          markPresence(idStr);
        }

        // Update lastDetection in Firebase for existing devices
        if (dbIdsRef.current.has(idStr)) {
          const logObj = payload ? { ...payload } : { raw: txt, ts: Date.now() };
          if (logObj.ts === undefined || logObj.ts === null) logObj.ts = Date.now();

          try {
            update(dbRef(realtimeDB, `devices/${idStr}/lastDetection`), {
              topClass: logObj.topClass ?? null,
              ts: logObj.ts ?? logObj.arrival,
            }).catch((err) => console.warn('Firebase update failed for lastDetection', err));
          } catch (e) {
            console.warn('Firebase update exception', e);
          }
        }

        return;
      }

      // Non-detection messages (status, sensors, gps, etc.)
      const logObj = payload ? { ...payload } : { raw: txt, ts: Date.now() };
      if (logObj.ts === undefined || logObj.ts === null) logObj.ts = Date.now();
      logObj.arrival = Date.now();

      if (!dbIdsRef.current.has(idStr)) {
        // If device not in firebase, check deleted first then create local device (MQTT authoritative)
        const deletedRef = dbRef(realtimeDB, `deleted_devices/${idStr}`);
        get(deletedRef).then((snap) => {
          if (snap.exists() && snap.val()) {
            console.log(`Device ${idStr} is marked deleted — ignoring MQTT message`);
            return;
          }

          // Create a local-only device (so UI sees it immediately). Firebase may later add it.
          addLocalDevice(idStr, { online: true, lastSeen: Date.now() });
          pushDeviceLog(idStr, logObj);
          markPresence(idStr);
        }).catch((e) => {
          console.error('Failed to check deleted_devices', e);
          // fallback: create local device
          addLocalDevice(idStr, { online: true, lastSeen: Date.now() });
          pushDeviceLog(idStr, logObj);
          markPresence(idStr);
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
  // ---------------------------
  useEffect(() => {
    setFullBinAlerts(devices.filter((d) => {
      if (typeof d.fillPct === 'number') return d.fillPct >= BIN_FULL_ALERT_PCT;
      if (typeof d.binFillPct === 'number') return d.binFillPct >= BIN_FULL_ALERT_PCT;
      return Boolean(d.binFull);
    }).length);

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
