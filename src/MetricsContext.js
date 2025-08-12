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
  const [floodRisks, setFloodRisks]       = useState(0);
  const [activeDevices, setActiveDevices] = useState(0);
  const [devices, setDevices]             = useState([]);
  const [authReady, setAuthReady]         = useState(false);

  const clientRef = useRef(null);

  // Firebase Auth
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

  // Listen to Firebase for historical device data
  useEffect(() => {
    if (!authReady) return;

    console.log('🏁 mounting devices listener (firebase)');
    const devicesRef = ref(realtimeDB, 'devices');
    const unsubDevices = onValue(devicesRef, snap => {
      const data = snap.val() || {};
      setDevices(prev => {
        const merged = [...prev];
        for (const [id, vals] of Object.entries(data)) {
          const idx = merged.findIndex(d => d.id === id);
          if (idx > -1) {
            merged[idx] = { ...merged[idx], ...vals };
          } else {
            merged.push({ id, ...vals });
          }
        }
        return merged;
      });
    });

    return () => unsubDevices();
  }, [authReady]);

  // Connect MQTT immediately (for active devices)
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
      client.subscribe('esp32/+/status', { qos: 1 });
      client.subscribe('esp32/+/gps', { qos: 1 });
      client.subscribe('esp32/+/sensor/flood', { qos: 1 });
      client.subscribe('esp32/+/sensor/bin_full', { qos: 1 });
    });

    client.on('message', (topic, message) => {
      try {
        const payload = JSON.parse(message.toString());
        const [, deviceId, type] = topic.split('/');

        if (type === 'status') {
          setDevices(prev => {
            const idx = prev.findIndex(d => d.id === deviceId);
            const now = Date.now();
            if (idx > -1) {
              const updated = [...prev];
              updated[idx] = { ...updated[idx], online: payload.online, lastSeen: now };
              return updated;
            }
            return [...prev, { id: deviceId, online: payload.online, lastSeen: now }];
          });
        } else {
          // Update Firebase for telemetry
          const now = Date.now();
          update(ref(realtimeDB, `devices/${deviceId}`), { ...payload, lastSeen: now });

          setDevices(prev => {
            const idx = prev.findIndex(d => d.id === deviceId);
            if (idx > -1) {
              const updated = [...prev];
              updated[idx] = { ...updated[idx], ...payload, lastSeen: now };
              return updated;
            }
            return [...prev, { id: deviceId, ...payload, lastSeen: now }];
          });
        }
      } catch (err) {
        console.warn('Invalid MQTT payload on', topic, err);
      }
    });

    client.on('error', err => console.error('MQTT error', err));

    return () => client.end(true);
  }, [authReady]);

  // Recompute metrics
  useEffect(() => {
    setActiveDevices(devices.filter(d => d.online).length);
    setFullBinAlerts(devices.filter(d => d.binFull).length);
    setFloodRisks(devices.filter(d => d.flooded).length);
  }, [devices]);

  return (
    <MetricsContext.Provider value={{ fullBinAlerts, floodRisks, activeDevices, devices }}>
      {children}
    </MetricsContext.Provider>
  );
};
