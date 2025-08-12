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

  // --- Firebase telemetry listener (no presence logic here) ---
  useEffect(() => {
    if (!authReady) return;

    console.log('🏁 mounting devices listener (firebase)');
    const devicesRef = ref(realtimeDB, 'devices');
    const unsubDevices = onValue(devicesRef, snap => {
      const data = snap.val() || {};

      setDevices(prev => {
        const byId = new Map(prev.map(d => [String(d.id), { ...d }]));

        for (const [id, vals] of Object.entries(data)) {
          const key = String(id);
          if (byId.has(key)) {
            byId.set(key, { ...byId.get(key), ...vals, id: key });
          } else {
            byId.set(key, { id: key, ...vals, online: false });
          }
        }
        return Array.from(byId.values());
      });
    });

    return () => unsubDevices();
  }, [authReady]);

  // --- MQTT connection (presence + telemetry) ---
  useEffect(() => {
    if (!authReady) return;

    const url = `wss://a62b022814fc473682be5d58d05e5f97.s1.eu.hivemq.cloud:8884/mqtt`;
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
      client.subscribe('esp32/gps', { qos: 1 });
      client.subscribe('esp32/sensor/flood', { qos: 1 });
      client.subscribe('esp32/sensor/bin_full', { qos: 1 });

      // status presence messages from all devices
      client.subscribe('esp32/+/status', { qos: 1 });
    });

    client.on('message', (topic, message) => {
      const txt = (message || '').toString();
      let payload;
      try {
        payload = JSON.parse(txt);
      } catch {
        console.warn('Invalid JSON payload on', topic, txt);
        return;
      }

      const parts = topic.split('/');
      const topicId = parts.length >= 3 ? parts[1] : undefined;
      const deviceId = String(payload.id ?? topicId ?? topic);

      const now = Date.now();

      // If it's presence message from LWT
      if (parts[2] === 'status') {
        const onlineFlag =
          payload.status?.toLowerCase() === 'online' ||
          payload.online === true;

        setDevices(prev => {
          const idx = prev.findIndex(d => String(d.id) === deviceId);
          if (idx > -1) {
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              id: deviceId,
              online: onlineFlag,
              lastSeen: onlineFlag ? now : updated[idx].lastSeen,
            };
            return updated;
          }
          return [{ id: deviceId, online: onlineFlag, lastSeen: onlineFlag ? now : null }, ...prev];
        });
        return;
      }

      // Otherwise it's telemetry → still send to Firebase
      update(ref(realtimeDB, `devices/${deviceId}`), { ...payload, lastSeen: now })
        .catch(err => console.warn('Firebase update failed', err));
    });

    client.on('error', err => console.error('MQTT error', err));

    return () => {
      try { client.end(true); } catch {}
    };
  }, [authReady]);

  // --- Recompute metrics ---
  useEffect(() => {
    const activeList = devices.filter(d => d.online);
    setActiveDevices(activeList.length);
    setFullBinAlerts(devices.filter(d => d.binFull).length);
    setFloodRisks(devices.filter(d => d.flooded).length);

    console.log('Metrics updated:', {
      activeDevices: activeList.length,
      fullBinAlerts: devices.filter(d => d.binFull).length,
      floodRisks: devices.filter(d => d.flooded).length,
    });
  }, [devices]);

  return (
    <MetricsContext.Provider value={{ fullBinAlerts, floodRisks, activeDevices, devices }}>
      {children}
    </MetricsContext.Provider>
  );
};
