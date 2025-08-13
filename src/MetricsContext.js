// src/MetricsContext.js
import React, { createContext, useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import { realtimeDB } from './firebase';
import { ref, onValue, update } from 'firebase/database';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

export const MetricsContext = createContext({
  fullBinAlerts: 0,
  floodRisks: 0,
  activeDevices: 0,
  devices: [],
});

export const MetricsProvider = ({ children }) => {
  const [fullBinAlerts, setFullBinAlerts] = useState(0);
  const [floodRisks, setFloodRisks] = useState(0);
  const [activeDevices, setActiveDevices] = useState(0);
  const [devices, setDevices] = useState([]);
  const [authReady, setAuthReady] = useState(false);

  const clientRef = useRef(null);

  // --- Auth (unchanged) ---
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

  // --- Firebase listener for historical telemetry (unchanged) ---
  useEffect(() => {
    if (!authReady) return;
    console.log('🏁 mounting devices listener (firebase)');
    const devicesRef = ref(realtimeDB, 'devices');
    const unsubDevices = onValue(devicesRef, snap => {
      const data = snap.val() || {};
      const arr = Object.entries(data).map(([id, vals]) => ({ id, ...vals }));
      // Merge with current devices, preferring in-memory (online/lastSeen) fields
      setDevices(prev => {
        const byId = new Map(prev.map(d => [String(d.id), { ...d }]));
        for (const d of arr) {
          const key = String(d.id);
          if (byId.has(key)) {
            byId.set(key, { ...d, ...byId.get(key), id: key }); // preserve online/lastSeen from memory
          } else {
            byId.set(key, { id: key, ...d, online: false });
          }
        }
        return Array.from(byId.values());
      });
    });
    return () => unsubDevices();
  }, [authReady]);

  // --- Single global MQTT connection (presence + telemetry) ---
  useEffect(() => {
    if (!authReady) return;

    // avoid duplicate clients
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
      // subscribe to telemetry: both "short" topics and per-device if used
      client.subscribe('esp32/gps', { qos: 1 });
      client.subscribe('esp32/sensor/flood', { qos: 1 });
      client.subscribe('esp32/sensor/bin_full', { qos: 1 });

      // subscribe to per-device topics and presence LWT
      client.subscribe('esp32/+/gps', { qos: 1 });
      client.subscribe('esp32/+/sensor/flood', { qos: 1 });
      client.subscribe('esp32/+/sensor/bin_full', { qos: 1 });

      // crucial: presence via LWT retained messages
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
      // 1) Handle presence topics (LWT) first: esp32/<id>/status
      if (parts.length >= 3 && parts[0] === 'esp32' && parts[2] === 'status') {
        const id = payload.id ?? parts[1];
        const onlineFlag = (typeof payload.status === 'string')
          ? payload.status.toLowerCase() === 'online'
          : payload.online === true;

        const now = Date.now();
        console.log('Presence:', id, onlineFlag ? 'online' : 'offline');

        setDevices(prev => {
          const idx = prev.findIndex(d => String(d.id) === String(id));
          if (idx > -1) {
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              id: String(id),
              online: onlineFlag,
              lastSeen: onlineFlag ? now : updated[idx].lastSeen,
            };
            return updated;
          }
          // add entry quickly so UI can react
          return [{ id: String(id), online: onlineFlag, lastSeen: onlineFlag ? now : null }, ...prev];
        });

        // activeDevices will be recomputed from devices state via the effect below
        return;
      }

      // 2) Telemetry topics — accept both per-device topics (esp32/<id>/...) and short topics where payload.id exists
      const deviceId = payload.id ?? (parts.length >= 2 ? parts[1] : undefined);
      if (!deviceId) return; // we can't assign telemetry without an ID

      const now = Date.now();

      // Merge telemetry into devices (preserve online flag if present)
      setDevices(prev => {
        const idx = prev.findIndex(d => String(d.id) === String(deviceId));
        if (idx > -1) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], ...payload, id: String(deviceId), lastSeen: now, online: true };
          return updated;
        }
        return [{ id: String(deviceId), ...payload, lastSeen: now, online: true }, ...prev];
      });

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
      clientRef.current = null;
    };
  }, [authReady]);

  // --- Prune stale devices every 10s (keeps array tidy) ---
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 30000;
      setDevices(prev => prev.filter(d => d.lastSeen && d.lastSeen >= cutoff));
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // --- Recompute metrics whenever devices changes (guarantees UI re-render) ---
  useEffect(() => {
    const activeCount = devices.filter(d => d.online).length;
    setActiveDevices(activeCount);
    setFullBinAlerts(devices.filter(d => d.binFull).length);
    setFloodRisks(devices.filter(d => d.flooded).length);

    console.log('Metrics updated:', { activeCount, fullBinAlerts: devices.filter(d => d.binFull).length, floodRisks: devices.filter(d => d.flooded).length, devices });
  }, [devices]);

  return (
    <MetricsContext.Provider value={{ fullBinAlerts, floodRisks, activeDevices, devices }}>
      {children}
    </MetricsContext.Provider>
  );
};
