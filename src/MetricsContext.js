// src/MetricsContext.js
import React, { createContext, useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import { realtimeDB } from './firebase2';
import { ref, onValue, update } from 'firebase/database';
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

  // Keep set of device IDs from the authoritative Firebase /devices snapshot.
  // MQTT will check this to avoid re-creating removed DB entries.
  const dbIdsRef = useRef(new Set());

  // Tunables
  const ACTIVE_CUTOFF_MS = 8000;  // device considered offline if not seen in 8s
  const PRUNE_INTERVAL_MS = 2000; // prune every 2s
  const MAX_LOGS_PER_DEVICE = 50; // bounded logs per device

  // Threshold for "full bin" alert (percentage)
  const BIN_FULL_ALERT_PCT = 90;

  // --- Boolean normalization helper ---
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

  // --- parse fill percentage safely ---
  function parseFillPct(payload) {
    if (!payload || typeof payload !== 'object') return null;
    // prefer fillPct key (published by updated ESP32)
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
    // fallback: if payload has a boolean binFull:true => treat as 100 (backwards compat)
    if (Object.prototype.hasOwnProperty.call(payload, 'binFull') || Object.prototype.hasOwnProperty.call(payload, 'bin_full')) {
      const bf = payload.binFull ?? payload.bin_full;
      if (bf === true) return 100;
      if (bf === false) return null;
    }
    return null;
  }

  // --- Firebase auth ---
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

  // --- Firebase devices (authoritative) ---
  useEffect(() => {
    if (!authReady) return;

    console.log('🏁 mounting devices listener (firebase authoritative)');
    const devicesRef = ref(realtimeDB, 'devices');

    const unsubDevices = onValue(devicesRef, (snap) => {
      const data = snap.val() || {};
      // Convert object map -> array of device objects
      const arr = Object.entries(data).map(([id, vals]) => ({ id, ...vals }));

      // update dbIdsRef
      const dbIds = new Set(arr.map(d => String(d.id)));
      dbIdsRef.current = dbIds;

      // Build canonical devices list from DB only; merge presence info for DB-listed devices.
      const merged = arr.map(d => {
        const id = String(d.id);
        const p = presenceRef.current.get(id);

        // --- NORMALIZE logs into an array (handles push-created objects and arrays)
        let logsArr = [];
        if (Array.isArray(d.logs)) {
          logsArr = d.logs.slice(0, MAX_LOGS_PER_DEVICE).filter(Boolean);
        } else if (d.logs && typeof d.logs === 'object') {
          // d.logs is an object keyed by push-id -> entry. Convert to array, attach key, sort by timestamp.
          logsArr = Object.entries(d.logs).map(([pushKey, val]) => {
            if (val && typeof val === 'object') return { _key: pushKey, ...val };
            return { _key: pushKey, raw: val };
          });

          // sort by arrivalServerTs or arrival or ts descending (most recent first)
          logsArr.sort((a, b) => {
            const aTs = Number(a.arrivalServerTs ?? a.arrival ?? a.ts ?? 0);
            const bTs = Number(b.arrivalServerTs ?? b.arrival ?? b.ts ?? 0);
            return bTs - aTs;
          });

          logsArr = logsArr.slice(0, MAX_LOGS_PER_DEVICE);
        } else {
          logsArr = [];
        }

        // compute binFillPct for DB-stored telemetry if any (DB may contain last known fields)
        const dbFillPct = parseFillPct(d);

        return {
          ...d,
          id,
          online: p ? p.online : (d.online || false),
          lastSeen: p ? p.lastSeen : (d.lastSeen || null),
          logs: logsArr,
          binFillPct: dbFillPct ?? (d.binFull === true ? 100 : null),
          binFull: (dbFillPct != null ? dbFillPct >= BIN_FULL_ALERT_PCT : (d.binFull === true)),
        };
      });

      setDevices(merged);
    });

    return () => unsubDevices();
  }, [authReady]);

  // --- helper: push bounded log into device entry (only if device exists in DB) ---
  const pushDeviceLog = (deviceId, logObj) => {
    if (!dbIdsRef.current.has(String(deviceId))) {
      // device was deleted from DB -> do not keep re-adding logs in UI
      return;
    }

    // compute fill pct if present in logObj
    const pct = parseFillPct(logObj);

    if (pct != null) logObj.fillPct = pct; // keep consistent key on logs

    setDevices((prev) => {
      const idx = prev.findIndex((d) => String(d.id) === String(deviceId));
      if (idx > -1) {
        const updated = [...prev];
        const prevLogs = Array.isArray(updated[idx].logs) ? updated[idx].logs : [];
        updated[idx] = {
          ...updated[idx],
          logs: [logObj, ...prevLogs].slice(0, MAX_LOGS_PER_DEVICE),
          lastSeen: Date.now(),
          online: true,
          // update binFillPct if log provided
          binFillPct: (pct != null) ? pct : (updated[idx].binFillPct ?? null),
          binFull: ((pct != null) ? (pct >= BIN_FULL_ALERT_PCT) : (updated[idx].binFull ?? false)),
        };
        return updated;
      }
      // shouldn't happen because we only push logs for DB-known devices,
      // but be defensive: insert at front
      return [{ id: String(deviceId), logs: [logObj], lastSeen: Date.now(), online: true, binFillPct: pct ?? null, binFull: (pct != null) ? (pct >= BIN_FULL_ALERT_PCT) : false }, ...prev];
    });
  };

  // --- MQTT: telemetry, presence, detections ---
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
      // telemetry + per-device topics
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
      try { payload = JSON.parse(txt); } catch (e) { /* not JSON */ }

      if (payload && typeof payload === 'object') {
        payload = normalizePayloadBooleans(payload);
      }

      const parts = topic.split('/');

      // --- Detections: keep logs only for DB-known devices ---
      if (parts.length >= 4 && parts[0] === 'esp32' && parts[2] === 'sensor' && parts[3] === 'detections') {
        const id = (payload && (payload.id ?? parts[1])) || parts[1];
        if (!dbIdsRef.current.has(String(id))) {
          // dropped: device removed from DB, don't re-add logs
          console.warn(`New Device detected: ${id}. Auto-creating in Firebase....`)
          try{
            await update(ref(realtimeDB, `devices/${id}`), {
              createdAt:Date.now(),
              lastSeen:Date.now(),
              online:true,
              autoCreated:true
              
            });
            dbIdsRef.current.add(String(id));
          }catch(e){
            console.error('Failed to auto-create device',e);
          }
        }
          console.debug('Detections for unknown/deleted device ignored:', id);
          presenceRef.current.set(String(id), { online: true, lastSeen: Date.now() });
          setActiveDevices(Array.from(presenceRef.current.values()).filter(p => p.online).length);
          return;
        }

        const logObj = payload ? { ...payload } : { raw: txt, ts: Date.now() };
        if (logObj.ts === undefined || logObj.ts === null) logObj.ts = Date.now();
        logObj.arrival = Date.now();

        // push into in-memory devices array (so UI instantly sees it)
        pushDeviceLog(id, logObj);

        // presence update
        const now = Date.now();
        presenceRef.current.set(String(id), { online: true, lastSeen: now });
        setActiveDevices(Array.from(presenceRef.current.values()).filter(p => p.online).length);

        // optional: write a lastDetection summary to Firebase only if device exists
        try {
          update(ref(realtimeDB, `devices/${id}/lastDetection`), {
            topClass: logObj.topClass ?? null,
            ts: logObj.ts ?? logObj.arrival,
          }).catch((err) => console.warn('Firebase update failed for lastDetection', err));
        } catch (e) {
          console.warn('Firebase update exception', e);
        }
        return;
      }

      // --- Presence LWT: only update devices[] if device is in DB ---
      if (parts.length >= 3 && parts[0] === 'esp32' && parts[2] === 'status') {
        const id = String(payload?.id ?? parts[1]);

        // if device not in DB, update presenceRef only (so activeDevices counts can reflect),
        // but do NOT add it into the devices list (avoids re-creating deleted DB entries).
        let onlineFlag = null;
        if (payload && typeof payload === 'object') {
          if (payload.status && typeof payload.status === 'string') onlineFlag = payload.status.toLowerCase() === 'online';
          else if (Object.prototype.hasOwnProperty.call(payload, 'status') && typeof payload.status === 'boolean') onlineFlag = payload.status;
          else if (Object.prototype.hasOwnProperty.call(payload, 'online')) onlineFlag = !!payload.online;
        }
        if (onlineFlag === null) {
          const lowTxt = (txt || '').toLowerCase();
          if (lowTxt.indexOf('online') !== -1) onlineFlag = true;
          else if (lowTxt.indexOf('offline') !== -1) onlineFlag = false;
          else onlineFlag = false;
        }

        const now = Date.now();
        presenceRef.current.set(id, { online: onlineFlag, lastSeen: onlineFlag ? now : (presenceRef.current.get(id)?.lastSeen || null) });

        // Update devices list only if the id is present in DB snapshot
        if (dbIdsRef.current.has(id)) {
          setDevices((prev) => {
            const idx = prev.findIndex((d) => String(d.id) === id);
            if (idx > -1) {
              const updated = [...prev];
              updated[idx] = {
                ...updated[idx],
                id,
                online: onlineFlag,
                lastSeen: onlineFlag ? now : updated[idx].lastSeen,
              };
              return updated;
            }
            return [{ id, online: onlineFlag, lastSeen: onlineFlag ? now : null }, ...prev];
          });
        }

        const activeNow = Array.from(presenceRef.current.values()).filter((p) => p.online).length;
        setActiveDevices(activeNow);
        return;
      }

      // --- Telemetry (gps / sensor) ---
      const deviceId = payload?.id ?? (parts.length >= 2 ? parts[1] : undefined);
      if (!deviceId) return;

      // update presenceRef always (we want the active count), but only merge telemetry into devices
      // if the device exists in DB. That prevents re-creating deleted DB entries.
      const now = Date.now();
      presenceRef.current.set(String(deviceId), { online: true, lastSeen: now });
      setActiveDevices(Array.from(presenceRef.current.values()).filter((p) => p.online).length);

      if (!dbIdsRef.current.has(String(deviceId))) {
        // Device was deleted in DB -> do NOT re-create it from telemetry.
        // We still keep presenceRef so activeDevices works.
        console.debug('Telemetry for unknown/deleted device ignored:', deviceId);
        return;
      }

      // Merge telemetry into devices state (safe because device exists in DB)
      const payloadToMerge = payload && typeof payload === 'object' ? payload : {};
      const parsedFill = parseFillPct(payloadToMerge);

      setDevices((prev) => {
        const idx = prev.findIndex((d) => String(d.id) === String(deviceId));
        if (idx > -1) {
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            ...payloadToMerge,
            id: String(deviceId),
            lastSeen: now,
            online: true,
            // attach computed binFillPct and binFull boolean (alert if >= BIN_FULL_ALERT_PCT)
            binFillPct: parsedFill != null ? parsedFill : (payloadToMerge.binFillPct ?? updated[idx].binFillPct ?? (payloadToMerge.binFull === true ? 100 : null)),
            binFull: (parsedFill != null ? (parsedFill >= BIN_FULL_ALERT_PCT) : (payloadToMerge.binFull === true ? true : updated[idx].binFull ?? false)),
          };
          return updated;
        }
        // if device somehow missing locally, create one with telemetry merged
        return [{
          id: String(deviceId),
          ...payloadToMerge,
          lastSeen: now,
          online: true,
          binFillPct: parsedFill != null ? parsedFill : (payloadToMerge.binFillPct ?? (payloadToMerge.binFull === true ? 100 : null)),
          binFull: parsedFill != null ? (parsedFill >= BIN_FULL_ALERT_PCT) : (payloadToMerge.binFull === true ? true : false),
        }, ...prev];
      });

      try {
        update(ref(realtimeDB, `devices/${deviceId}`), { ...payloadToMerge, lastSeen: now })
          .catch((err) => console.warn('Firebase update failed', err));
      } catch (e) {
        console.warn('Firebase update exception', e);
      }
    });

    client.on('error', (err) => console.error('MQTT error', err));

    return () => {
      try { client.end(true); } catch (e) { /* ignore */ }
      clientRef.current = null;
    };
  }, [authReady]);

  // --- Fast prune/watchdog: mark offline quickly if silent ---
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
        // Only reflect changes for devices that are present in DB
        setDevices((prev) => {
          const updated = prev.map((d) => {
            const p = presenceRef.current.get(String(d.id));
            if (!p) return d;
            if (d.online !== p.online || d.lastSeen !== p.lastSeen) {
              return { ...d, online: p.online, lastSeen: p.lastSeen };
            }
            return d;
          });
          // Do NOT add presence-only entries here; we rely on DB as the source of truth.
          return updated;
        });

        const activeNow = Array.from(presenceRef.current.values()).filter((p) => p.online).length;
        setActiveDevices(activeNow);
      }
    }, PRUNE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  // --- derived metrics ---
  useEffect(() => {
    // count only devices that are actually >= threshold
    setFullBinAlerts(devices.filter((d) => {
      if (typeof d.binFillPct === 'number') return d.binFillPct >= BIN_FULL_ALERT_PCT;
      return Boolean(d.binFull); // fallback if only boolean present
    }).length);

    setFloodRisks(devices.filter((d) => d.flooded).length);
  }, [devices]);

  return (
    <MetricsContext.Provider value={{ fullBinAlerts, floodRisks, activeDevices, devices, authReady }}>
      {children}
    </MetricsContext.Provider>
  );
};


