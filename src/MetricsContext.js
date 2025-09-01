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

  useEffect(() => {
    if (!authReady) return;

    console.log('🏁 mounting devices listener (firebase authoritative)');
    const devicesRef = ref(realtimeDB, 'devices');

    const unsubDevices = onValue(devicesRef, (snap) => {
      const data = snap.val() || {};
      const arr = Object.entries(data).map(([id, vals]) => ({ id, ...vals }));

      const dbIds = new Set(arr.map(d => String(d.id)));
      dbIdsRef.current = dbIds;

      const merged = arr.map(d => {
        const id = String(d.id);
        const p = presenceRef.current.get(id);

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
          binFillPct: dbFillPct ?? (d.binFull === true ? 100 : null),
          binFull: (dbFillPct != null ? dbFillPct >= BIN_FULL_ALERT_PCT : (d.binFull === true)),
        };
      });

      setDevices(merged);
    });

    return () => unsubDevices();
  }, [authReady]);

  const pushDeviceLog = (deviceId, logObj) => {
    if (!dbIdsRef.current.has(String(deviceId))) {
      return;
    }

    const pct = parseFillPct(logObj);

    if (pct != null) logObj.fillPct = pct;

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
          binFillPct: (pct != null) ? pct : (updated[idx].binFillPct ?? null),
          binFull: ((pct != null) ? (pct >= BIN_FULL_ALERT_PCT) : (updated[idx].binFull ?? false)),
        };
        return updated;
      }
      return [{ id: String(deviceId), logs: [logObj], lastSeen: Date.now(), online: true, binFillPct: pct ?? null, binFull: (pct != null) ? (pct >= BIN_FULL_ALERT_PCT) : false }, ...prev];
    });
  };

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

      if (parts.length >= 4 && parts[0] === 'esp32' && parts[2] === 'sensor' && parts[3] === 'detections') {
        const id = (payload && (payload.id ?? parts[1])) || parts[1];
        if (!dbIdsRef.current.has(String(id))) {
          console.warn(`New device detected: ${id}. Auto-creating in Firebase...`);
          update(ref(realtimeDB, `devices/${id}`), {
            createdAt: Date.now(),
            lastSeen: Date.now(),
            online: true,
            autoCreated: true
          })
          .then(() => {
            dbIdsRef.current.add(String(id));
          })
          .catch((e) => {
            console.error('Failed to auto-create device', e);
          });
        }
        console.debug('Detections for unknown/deleted device ignored:', id);
        presenceRef.current.set(String(id), { online: true, lastSeen: Date.now() });
        setActiveDevices(Array.from(presenceRef.current.values()).filter(p => p.online).length);
        return;
      }

      const logObj = payload ? { ...payload } : { raw: txt, ts: Date.now() };
      if (logObj.ts === undefined || logObj.ts === null) logObj.ts = Date.now();
      logObj.arrival = Date.now();

      pushDeviceLog(id, logObj);

      const now = Date.now();
      presenceRef.current.set(String(id), { online: true, lastSeen: now });
      setActiveDevices(Array.from(presenceRef.current.values()).filter(p => p.online).length);

      try {
        update(ref(realtimeDB, `devices/${id}/lastDetection`), {
          topClass: logObj.topClass ?? null,
          ts: logObj.ts ?? logObj.arrival,
        }).catch((err) => console.warn('Firebase update failed for lastDetection', err));
      } catch (e) {
        console.warn('Firebase update exception', e);
      }
      return;
    });

    client.on('error', (err) => console.error('MQTT error', err));

    return () => {
      try { client.end(true); } catch (e) {}
      clientRef.current = null;
    };
  }, [authReady]);

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
