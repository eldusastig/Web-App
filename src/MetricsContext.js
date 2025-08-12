// src/MetricsContext.js
import React, { createContext, useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import { realtimeDB } from './firebase'; // ✅ shared DB instance
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

  const activeDeviceIdRef = useRef(null);
  const clientRef = useRef(null);

  // Ensure anonymous sign-in
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

  // Watch active device ID in Firebase
  useEffect(() => {
    if (!authReady) return;
    const activeRef = ref(realtimeDB, 'activeDevice');
    const unsubActive = onValue(activeRef, snap => {
      const id = snap.val();
      if (id && id !== activeDeviceIdRef.current) {
        activeDeviceIdRef.current = id;
        connectMqtt(id);
      }
    });
    return () => unsubActive();
  }, [authReady]);

  // Listen to Firebase for other devices
  useEffect(() => {
    if (!authReady) return;
    const devicesRef = ref(realtimeDB, 'devices');
    const unsubDevices = onValue(devicesRef, snap => {
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

  const connectMqtt = (deviceId) => {
    if (clientRef.current) {
      clientRef.current.end(true);
    }

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
      console.log('✅ MQTT connected for active device', deviceId);
      ['gps', 'sensor/flood', 'sensor/bin_full', 'status'].forEach(topicSuffix => {
        client.subscribe(`esp32/${deviceId}/${topicSuffix}`, { qos: 1 }, err => {
          if (err) console.error('❌ subscribe failed on', topicSuffix, err);
        });
      });
    });

    client.on('message', (topic, message) => {
      try {
        const payload = JSON.parse(message.toString());

        if (topic.endsWith('/status')) {
          if (payload.status === 'offline') {
            console.log(`⚠️ Device ${deviceId} went offline`);
            update(ref(realtimeDB, `devices/${deviceId}`), {
              connected: false,
              lastSeen: Date.now(),
            });
            setDevices(prev =>
              prev.map(d => d.id === deviceId ? { ...d, connected: false } : d)
            );
          }
          return;
        }

        if (payload.id !== deviceId) return;

        const now = Date.now();
        setDevices(prev => {
          const idx = prev.findIndex(d => d.id === deviceId);
          if (idx > -1) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], ...payload, lastSeen: now, connected: true };
            return updated;
          }
          return [...prev, { ...payload, lastSeen: now, connected: true }];
        });

        update(ref(realtimeDB, `devices/${deviceId}`), { ...payload, lastSeen: now, connected: true });
      } catch {
        console.warn('Invalid JSON on', topic);
      }
    });

    client.on('close', () => {
      console.log(`❌ MQTT disconnected for device ${deviceId}`);
      update(ref(realtimeDB, `devices/${deviceId}`), { connected: false });
      setDevices(prev =>
        prev.map(d => d.id === deviceId ? { ...d, connected: false } : d)
      );
    });

    client.on('error', err => console.error('MQTT error', err));
  };

  // Prune inactive devices
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 30_000;
      setDevices(prev =>
        prev.map(d =>
          d.lastSeen < cutoff ? { ...d, connected: false } : d
        )
      );
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => () => clientRef.current?.end(true), []);

  useEffect(() => {
    setActiveDevices(devices.filter(d => d.connected).length);
    setFullBinAlerts(devices.filter(d => d.binFull && d.connected).length);
    setFloodRisks(devices.filter(d => d.flooded && d.connected).length);
  }, [devices]);

  return (
    <MetricsContext.Provider value={{ fullBinAlerts, floodRisks, activeDevices, devices }}>
      {children}
    </MetricsContext.Provider>
  );
};
