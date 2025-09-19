import React, { createContext, useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';

export const MetricsContext = createContext({
  fullBinAlerts: null,
  floodRisks: null,
  activeDevices: null,
  devices: [],
});

export const MetricsProvider = ({ children }) => {
  const [fullBinAlerts, setFullBinAlerts] = useState(0);
  const [floodRisks, setFloodRisks] = useState(0);
  const [activeDevices, setActiveDevices] = useState(0);
  const [devices, setDevices] = useState([]);

  const clientRef = useRef(null);
  const presenceRef = useRef(new Map()); // Map<id, { online: boolean, lastSeen: number }>
  const devicesMapRef = useRef(new Map()); // Map<id, deviceObj>

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

  function updateDeviceFromLog(id, logObj) {
    const sid = String(id);
    const now = Date.now();
    const map = devicesMapRef.current;
    let dev = map.get(sid);
    const isNew = !dev;

    if (!dev) {
      dev = {
        id: sid,
        createdAt: now,
        lastSeen: now,
        online: true,
        logs: [],
        binFillPct: null,
        binFull: false,
        flooded: false,
      };
    }

    // Normalize and enrich
    const payload = (logObj && typeof logObj === 'object') ? normalizePayloadBooleans(logObj) : null;
    const pct = parseFillPct(payload || {});

    const entry = { ...(payload || {}), raw: (!payload ? String(logObj) : undefined) };
    if (entry.ts === undefined || entry.ts === null) entry.ts = now;
    entry.arrival = now;

    // Prepend and cap
    const prevLogs = Array.isArray(dev.logs) ? dev.logs : [];
    dev.logs = [entry, ...prevLogs].slice(0, MAX_LOGS_PER_DEVICE);
    dev.lastSeen = now;
    dev.online = true;

    if (pct != null) {
      dev.binFillPct = pct;
      dev.binFull = pct >= BIN_FULL_ALERT_PCT;
    } else if (typeof payload?.binFull === 'boolean') {
      dev.binFull = payload.binFull;
      dev.binFillPct = payload.binFull ? 100 : dev.binFillPct;
    }

    if (payload && (payload.flooded === true || payload.flood === true)) {
      dev.flooded = true;
    } else if (payload && (payload.flooded === false || payload.flood === false)) {
      dev.flooded = false;
    }

    // Merge shallow metadata from payload
    if (payload && payload.name) dev.name = payload.name;
    if (payload && payload.location) dev.location = payload.location;

    map.set(sid, dev);

    // Update presence
    presenceRef.current.set(sid, { online: true, lastSeen: now });
    setActiveDevices(Array.from(presenceRef.current.values()).filter((p) => p.online).length);

    // Flush to state array (stable ordering: newest first by lastSeen)
    const arr = Array.from(map.values()).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    setDevices(arr);

    return isNew;
  }

  const pushDeviceLog = (deviceId, logObj) => {
    if (!deviceId) return;
    updateDeviceFromLog(deviceId, logObj);
  };

  useEffect(() => {
    // MQTT connect and subscriptions
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
      console.log('✅ MQTT connected (mqtt-only metrics)');
      // Subscribe to all esp32 topics — adjust if you want narrower scope
      client.subscribe('esp32/#', { qos: 1 }, (err) => {
        if (err) console.error('Subscribe esp32/# failed', err);
        else console.log('Subscribed to esp32/#');
      });
    });

    client.on('message', (topic, message) => {
      const txt = (message || '').toString();
      let payload = null;
      try { payload = JSON.parse(txt); } catch (e) { /* not JSON */ }

      const parts = topic.split('/');
      let id = null;
      if (parts[0] === 'esp32') id = parts[1] || (payload && payload.id);
      if (!id && payload && payload.id) id = payload.id;
      if (!id) {
        // Unknown topic structure — ignore
        return;
      }

      // If it's a detection topic, we still treat it the same way — push a log
      const logObj = payload ? { ...payload } : { raw: txt };
      if (logObj.ts === undefined || logObj.ts === null) logObj.ts = Date.now();

      const wasNew = updateDeviceFromLog(id, logObj);

      // Optionally: publish a "device/created" retained message so other services know about this device
      // if (wasNew && client && client.connected) {
      //   const metaTopic = `devices/${id}/created`;
      //   client.publish(metaTopic, JSON.stringify({ id, createdAt: Date.now() }), { qos: 1, retain: true });
      // }
    });

    client.on('error', (err) => console.error('MQTT error', err));

    return () => {
      try { client.end(true); } catch (e) { /* ignore */ }
      clientRef.current = null;
    };
  }, []);

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
        // update devices map/array
        const map = devicesMapRef.current;
        let updatedAny = false;
        presenceRef.current.forEach((p, id) => {
          const dev = map.get(String(id));
          if (dev && dev.online !== p.online) {
            dev.online = p.online;
            map.set(String(id), dev);
            updatedAny = true;
          }
        });

        if (updatedAny) {
          const arr = Array.from(map.values()).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
          setDevices(arr);
        }

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
    <MetricsContext.Provider value={{ fullBinAlerts, floodRisks, activeDevices, devices }}>
      {children}
    </MetricsContext.Provider>
  );
};
