// src/MetricsContext.js
import React, { createContext, useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import { realtimeDB } from './firebase';
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
  const [floodRisks, setFloodRisks] = useState(0);
  const [activeDevices, setActiveDevices] = useState(0);
  const [devices, setDevices] = useState([]);
  const [authReady, setAuthReady] = useState(false);

  const clientRef = useRef(null);

  // how long before a device is considered offline
  const ACTIVE_CUTOFF_MS = 8_000;
  const PRUNE_INTERVAL_MS = 5_000;

  // --- Firebase auth (still used for telemetry storage) ---
  useEffect(() => {
    const auth = getAuth();
    signInAnonymously(auth).catch(err => console.error('Auth error:', err));

    const unsubscribe = onAuthStateChanged(auth, user => {
      if (user) {
        console.log('✅ Authenticated as', user.uid);
        setAuthReady(true);
      } else {
        setAuthReady(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // --- Listen to Firebase devices (historical telemetry) and merge with local devices ---
  useEffect(() => {
    if (!authReady) return;

    console.log('🏁 mounting devices listener (firebase)');
    const devicesRef = ref(realtimeDB, 'devices');
    const unsubDevices = onValue(devicesRef, snap => {
      const data = snap.val() || {};

      setDevices(prev => {
        // Build a map from prev for quick lookup (preserve online/lastSeen if present)
        const byId = new Map(prev.map(d => [String(d.id), { ...d }]));

        for (const [id, vals] of Object.entries(data)) {
          const key = String(id);
          if (byId.has(key)) {
            // merge telemetry from Firebase into existing (preserve online/lastSeen)
            byId.set(key, { ...byId.get(key), ...vals, id: key });
          } else {
            byId.set(key, { id: key, ...vals, online: false });
          }
        }

        // return array preserving recently-updated online items near front
        return Array.from(byId.values());
      });
    });

    return () => unsubDevices();
  }, [authReady]);

  // --- MQTT: connect and handle messages (presence + telemetry) ---
  useEffect(() => {
    if (!authReady) return;

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
      console.log('✅ MQTT connected');
      // subscribe to your existing topics (no deviceId in topic)
      client.subscribe('esp32/gps', { qos: 1 });
      client.subscribe('esp32/sensor/flood', { qos: 1 });
      client.subscribe('esp32/sensor/bin_full', { qos: 1 });

      // Also subscribe to per-device status if any device later uses that pattern
      client.subscribe('esp32/+/status', { qos: 1 });
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

      // Determine device id:
      // prefer payload.id (your ESP32 sends "id":"DVC001"), else try topic-based id (esp32/<id>/...)
      const parts = topic.split('/');
      const topicId = parts.length >= 3 ? parts[1] : undefined; // handles esp32/<id>/...
      const inferredId = payload.id ?? topicId ?? topic; // fallback to topic string if nothing else

      const deviceId = String(inferredId);
      const now = Date.now();

      // If it's a status message (esp32/<id>/status) follow online flag; else treat any telemetry message as "online"
      const isStatusTopic = parts.length >= 3 && parts[2] === 'status';
      const onlineFlag = isStatusTopic ? Boolean(payload.online) : true;

      // Update Firebase for telemetry messages (keep using DB for flood/location/bin)
      if (!isStatusTopic) {
        try {
          update(ref(realtimeDB, `devices/${deviceId}`), { ...payload, lastSeen: now })
            .catch(err => console.warn('Firebase update failed', err));
        } catch (e) {
          console.warn('Firebase update exception', e);
        }
      }

      // Update local devices array (preserve other fields)
      setDevices(prev => {
        const idx = prev.findIndex(d => String(d.id) === deviceId);
        if (idx > -1) {
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            ...payload,
            id: deviceId,
            lastSeen: now,
            online: onlineFlag,
          };
          return updated;
        }
        // not found — push front so active ones are visible
        return [{ id: deviceId, ...payload, lastSeen: now, online: onlineFlag }, ...prev];
      });
    });

    client.on('error', err => console.error('MQTT error', err));

    // clean up on unmount
    return () => {
      try { client.end(true); } catch (e) { /* ignore */ }
    };
  }, [authReady]);

  // --- prune/watchdog: mark offline if silent longer than cutoff ---
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - ACTIVE_CUTOFF_MS;
      setDevices(prev => prev.map(d => {
        const stillOnline = d.lastSeen && d.lastSeen >= cutoff;
        if (d.online !== stillOnline) {
          return { ...d, online: stillOnline };
        }
        return d;
      }));
    }, PRUNE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // --- recompute metrics (time-aware) ---
  useEffect(() => {
    const cutoff = Date.now() - ACTIVE_CUTOFF_MS;
    const activeList = devices.filter(d => d.lastSeen && d.lastSeen >= cutoff && d.online);

    setActiveDevices(activeList.length);
    setFullBinAlerts(devices.filter(d => d.binFull).length);
    setFloodRisks(devices.filter(d => d.flooded).length);

    // debug log
    console.log('Metrics updated:', {
      activeDevices: activeList.length,
      fullBinAlerts: devices.filter(d => d.binFull).length,
      floodRisks: devices.filter(d => d.flooded).length,
      devices,
    });
  }, [devices]);

  return (
    <MetricsContext.Provider value={{ fullBinAlerts, floodRisks, activeDevices, devices }}>
      {children}
    </MetricsContext.Provider>
  );
};
