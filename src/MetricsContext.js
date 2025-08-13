// src/MetricsContext.js
import React, { createContext, useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import { realtimeDB } from './firebase';  // ✅ import shared DB instance
import { ref, onValue, update } from 'firebase/database';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

export const MetricsContext = createContext({
  fullBinAlerts: null,
  floodRisks: null,
  activeDevices: null,
  devices: [],
});

export const MetricsProvider = ({ children }) => {
  const [fullBinAlerts, setFullBinAlerts] = useState(0);
  const [floodRisks, setFloodRisks]       = useState(0);
  const [activeDevices, setActiveDevices] = useState(0);
  const [devices, setDevices]             = useState([]);
  const [authReady, setAuthReady]         = useState(false);

  const clientRef = useRef(null);

  // Presence tracking (fast, in-memory). Map<id, { online: boolean, lastSeen: number }>
  const presenceRef = useRef(new Map());

  // Tunables: shorter cutoff & faster prune for near-realtime
  const ACTIVE_CUTOFF_MS = 8000;  // device considered offline if no seen in 8s
  const PRUNE_INTERVAL_MS = 2000; // check every 2s

  // --- Firebase auth (unchanged) ---
  useEffect(() => {
    const auth = getAuth();
    signInAnonymously(auth).catch(err => console.error('Auth error:', err));

    const unsubscribe = onAuthStateChanged(auth, user => {
      if (user) {
        console.log('✅ Authenticated as', user.uid);
        setAuthReady(true);
      }
    });
    return () => unsubscribe();
  }, []);

  // --- Firebase devices (historical telemetry) ---
  useEffect(() => {
    if (!authReady) return;

    console.log('🏁 mounting devices listener (firebase)');
    const devicesRef = ref(realtimeDB, 'devices');
    const unsubDevices = onValue(devicesRef, snap => {
      const data = snap.val() || {};
      const arr = Object.entries(data).map(([id, vals]) => ({ id, ...vals }));
      // Merge with current devices, prefer in-memory online/lastSeen
      setDevices(prev => {
        const byId = new Map(prev.map(d => [String(d.id), { ...d }]));
        for (const d of arr) {
          const key = String(d.id);
          if (byId.has(key)) {
            // preserve in-memory fields (online/lastSeen) if present
            byId.set(key, { ...d, ...byId.get(key), id: key });
          } else {
            byId.set(key, { id: key, ...d, online: false });
          }
        }
        return Array.from(byId.values());
      });
    });
    return () => unsubDevices();
  }, [authReady]);

  // --- Global MQTT connection: subscribe to telemetry + LWT presence ---
  useEffect(() => {
    if (!authReady) return;
    if (clientRef.current) return; // already connected

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

      // Telemetry topics (both short and per-device patterns)
      client.subscribe('esp32/gps', { qos: 1 });
      client.subscribe('esp32/sensor/flood', { qos: 1 });
      client.subscribe('esp32/sensor/bin_full', { qos: 1 });

      client.subscribe('esp32/+/gps', { qos: 1 });
      client.subscribe('esp32/+/sensor/flood', { qos: 1 });
      client.subscribe('esp32/+/sensor/bin_full', { qos: 1 });

      // Presence LWT topics (retained)
      client.subscribe('esp32/+/status', { qos: 1 }, err => {
        if (err) console.error('❌ subscribe failed on esp32/+/status', err);
        else console.log('Subscribed to esp32/+/status (presence)');
      });
    });

    client.on('message', (topic, message) => {
      const txt = (message || '').toString();
      let payload;
      try {
        payload = JSON.parse(txt);
      } catch (e) {
        console.warn('Invalid JSON on', topic, txt);
        return;
      }

      const parts = topic.split('/');

      // --- 1) Presence topics first: esp32/<id>/status ---
      if (parts.length >= 3 && parts[0] === 'esp32' && parts[2] === 'status') {
        const id = String(payload.id ?? parts[1]);
        const onlineFlag = (typeof payload.status === 'string')
          ? payload.status.toLowerCase() === 'online'
          : payload.online === true;

        const now = Date.now();
        // update presence map immediately (fast, synchronous)
        presenceRef.current.set(id, { online: onlineFlag, lastSeen: onlineFlag ? now : (presenceRef.current.get(id)?.lastSeen || null) });

        // update devices array quickly (so UI has device object to show)
        setDevices(prev => {
          const idx = prev.findIndex(d => String(d.id) === id);
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
          // insert at front for immediate UI feedback
          return [{ id, online: onlineFlag, lastSeen: onlineFlag ? now : null }, ...prev];
        });

        // Immediately compute and set activeDevices from presenceRef (no wait)
        const activeNow = Array.from(presenceRef.current.values()).filter(p => p.online).length;
        setActiveDevices(activeNow);
        // done handling presence
        return;
      }

      // --- 2) Telemetry topics: update telemetry + treat as presence (online) ---
      // Determine device id: prefer payload.id, otherwise topic like esp32/<id>/...
      const deviceId = payload.id ?? (parts.length >= 2 ? parts[1] : undefined);
      if (!deviceId) return;

      const now = Date.now();

      // immediate presence update (telemetry implies device is online)
      presenceRef.current.set(String(deviceId), { online: true, lastSeen: now });
      // update activeDevices right now
      setActiveDevices(Array.from(presenceRef.current.values()).filter(p => p.online).length);

      // merge telemetry into devices state (preserve online flag if present)
      setDevices(prev => {
        const idx = prev.findIndex(d => String(d.id) === String(deviceId));
        if (idx > -1) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], ...payload, id: String(deviceId), lastSeen: now, online: true };
          return updated;
        }
        return [{ id: String(deviceId), ...payload, lastSeen: now, online: true }, ...prev];
      });

      // write telemetry into Firebase (unchanged)
      try {
        update(ref(realtimeDB, `devices/${deviceId}`), { ...payload, lastSeen: now })
          .catch(err => console.warn('Firebase update failed', err));
      } catch (e) {
        console.warn('Firebase update exception', e);
      }
    });

    client.on('error', err => console.error('MQTT error', err));

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

      // mark presenceRef entries offline if stale
      presenceRef.current.forEach((val, id) => {
        if (val.lastSeen && val.lastSeen < cutoff && val.online) {
          presenceRef.current.set(id, { online: false, lastSeen: val.lastSeen });
          changed = true;
        }
      });

      // if presence map changed, reflect in devices state and active count immediately
      if (changed) {
        setDevices(prev => {
          const updated = prev.map(d => {
            const p = presenceRef.current.get(String(d.id));
            if (!p) return d;
            if (d.online !== p.online || d.lastSeen !== p.lastSeen) {
              return { ...d, online: p.online, lastSeen: p.lastSeen };
            }
            return d;
          });
          // also ensure any presence-only entries (present in presenceRef but not in devices) get added
          presenceRef.current.forEach((p, id) => {
            if (!updated.some(x => String(x.id) === String(id))) {
              updated.unshift({ id, online: p.online, lastSeen: p.lastSeen || null });
            }
          });
          return updated;
        });

        // update activeDevices from presenceRef immediately
        const activeNow = Array.from(presenceRef.current.values()).filter(p => p.online).length;
        setActiveDevices(activeNow);
      }
    }, PRUNE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // --- Recompute other metrics from devices (bin/flood) (unchanged) ---
  useEffect(() => {
    setFullBinAlerts(devices.filter(d => d.binFull).length);
    setFloodRisks(devices.filter(d => d.flooded).length);
  }, [devices]);

  return (
    <MetricsContext.Provider value={{ fullBinAlerts, floodRisks, activeDevices, devices }}>
      {children}
    </MetricsContext.Provider>
  );
};
