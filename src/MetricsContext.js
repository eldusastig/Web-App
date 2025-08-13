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

  const activeDeviceIdRef = useRef(null);
  const clientRef         = useRef(null);

  // presence map: { [id]: { online: boolean, lastSeen: number } }
  // kept in a ref to avoid re-creating on every message; we still push updates to React state
  const presenceRef = useRef({});

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

  // --- Firebase devices (historical telemetry) (unchanged) ---
  useEffect(() => {
    if (!authReady) return;

    console.log('🏁 mounting devices listener');
    const devicesRef = ref(realtimeDB, 'devices');
    const unsubDevices = onValue(devicesRef, snap => {
      console.log('🔥 devices snapshot:', snap.val());
      const data = snap.val() || {};
      const arr = Object.entries(data)
        .filter(([id]) => activeDeviceIdRef.current ? id !== activeDeviceIdRef.current : true)
        .map(([id, vals]) => ({ id, ...vals }));

      setDevices(prev => {
        const mqttDev = prev.find(d => d.id === activeDeviceIdRef.current);
        return mqttDev ? [mqttDev, ...arr] : arr;
      });
    });

    return () => unsubDevices();
  }, [authReady]);

  // --- MQTT connection (single connection; subscribes to status + telemetry) ---
  useEffect(() => {
    if (!authReady) return;

    // connect once
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

      // telemetry (unchanged)
      ['gps', 'sensor/flood', 'sensor/bin_full'].forEach(topicSuffix => {
        client.subscribe(`esp32/${topicSuffix}`, { qos: 1 }, err => {
          if (err) console.error('❌ subscribe failed on', topicSuffix, err);
        });
      });

      // presence via LWT (retained messages)
      client.subscribe('esp32/+/status', { qos: 1 }, err => {
        if (err) console.error('❌ subscribe failed on esp32/+/status', err);
      });
    });

    client.on('message', (topic, message) => {
      const txt = (message || '').toString();
      let payload;
      try {
        payload = JSON.parse(txt);
      } catch (e) {
        console.warn('Invalid JSON payload on', topic, txt);
        return;
      }

      const parts = topic.split('/');
      // Handle LWT/status topics: esp32/<id>/status
      if (parts.length >= 3 && parts[0] === 'esp32' && parts[2] === 'status') {
        const idFromTopic = parts[1];
        const id = String(payload.id ?? idFromTopic);

        // payload may be { status: "online"/"offline" } or { online: true/false }
        const onlineFlag = (typeof payload.status === 'string')
          ? payload.status.toLowerCase() === 'online'
          : payload.online === true;

        const now = Date.now();
        // update presence map immediately
        presenceRef.current[id] = { online: onlineFlag, lastSeen: onlineFlag ? now : (presenceRef.current[id]?.lastSeen || null) };

        // Reflect presence in devices array (merge if exists)
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
          return [{ id, online: onlineFlag, lastSeen: onlineFlag ? now : null }, ...prev];
        });

        // Compute activeDevices immediately from presence map
        const activeCount = Object.values(presenceRef.current).filter(p => p.online).length;
        setActiveDevices(activeCount);
        return;
      }

      // Otherwise it's telemetry (gps/flood/bin) — keep original behavior:
      // Note: previous connectMqtt logic only cared about messages for a single active device.
      // We'll accept telemetry for any device id in payload and merge it into devices + write to Firebase.
      const deviceId = payload.id ?? null;
      if (!deviceId) return;

      const now = Date.now();
      // update local devices list with telemetry (merge)
      setDevices(prev => {
        const idx = prev.findIndex(d => String(d.id) === String(deviceId));
        if (idx > -1) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], ...payload, lastSeen: now };
          return updated;
        }
        return [{ id: String(deviceId), ...payload, lastSeen: now }, ...prev];
      });

      // update presence map as telemetry implies online
      presenceRef.current[String(deviceId)] = { online: true, lastSeen: now };
      setActiveDevices(Object.values(presenceRef.current).filter(p => p.online).length);

      // write telemetry to Firebase (unchanged)
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
    };
  }, [authReady]);

  // --- Prune inactive devices every 30s (keeps devices array tidy) ---
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 30000; // 30s
      // prune devices array entries that are stale
      setDevices(prev => prev.filter(d => d.lastSeen && d.lastSeen >= cutoff));
      // also, if presence entries are stale (no LWT updated and lastSeen old) mark offline as fallback
      Object.keys(presenceRef.current).forEach(id => {
        const p = presenceRef.current[id];
        if (p.lastSeen && p.lastSeen < cutoff && p.online) {
          // fallback: mark offline after cutoff
          presenceRef.current[id] = { online: false, lastSeen: p.lastSeen };
        }
      });
      // update activeDevices from presence map after pruning/fallback
      setActiveDevices(Object.values(presenceRef.current).filter(p => p.online).length);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // --- Recompute other metrics from devices (unchanged) ---
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
