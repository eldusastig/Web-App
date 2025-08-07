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
  historicalDevices: [],
  liveDevices: [],
});

export const MetricsProvider = ({ children }) => {
  const [fullBinAlerts, setFullBinAlerts] = useState(0);
  const [floodRisks, setFloodRisks] = useState(0);
  const [activeDevices, setActiveDevices] = useState(0);
  const [historicalDevices, setHistoricalDevices] = useState([]);
  const [liveDevices, setLiveDevices] = useState([]);
  const [authReady, setAuthReady] = useState(false);

  const activeDeviceIdRef = useRef(null);
  const clientRef = useRef(null);

  // Anonymous auth for Firebase access
  useEffect(() => {
    const auth = getAuth();
    signInAnonymously(auth).catch(err => console.error('Auth error:', err));
    const unsubscribe = onAuthStateChanged(auth, user => {
      if (user) setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Historical devices from Firebase (never pruned)
  useEffect(() => {
    if (!authReady) return;
    const devicesRef = ref(realtimeDB, 'devices');
    const unsub = onValue(devicesRef, snap => {
      const data = snap.val() || {};
      const list = Object.entries(data).map(([id, vals]) => ({ id, ...vals }));
      setHistoricalDevices(list);
    }, console.error);
    return () => unsub();
  }, [authReady]);

  // Watch activeDevice ID and connect MQTT
  useEffect(() => {
    if (!authReady) return;
    const activeRef = ref(realtimeDB, 'activeDevice');
    const unsub = onValue(activeRef, snap => {
      const id = snap.val();
      if (id && id !== activeDeviceIdRef.current) {
        activeDeviceIdRef.current = id;
        setLiveDevices([]); // reset live devices on new active
        connectMqtt(id);
      }
    }, console.error);
    return () => unsub();
  }, [authReady]);

  // MQTT real-time updates for the active device (liveDevices)
  const connectMqtt = (deviceId) => {
    clientRef.current?.end(true);
    const client = mqtt.connect(
      'wss://a62b022814fc473682be5d58d05e5f97.s1.eu.hivemq.cloud:8884/mqtt',
      {
        username: 'prototype', password: 'Prototype1', clean: true,
        keepalive: 60, reconnectPeriod: 2000,
        clientId: 'metrics_' + Math.random().toString(16).substr(2, 8)
      }
    );
    clientRef.current = client;

    client.on('connect', () => {
      ['gps', 'sensor/flood', 'sensor/bin_full'].forEach(topic =>
        client.subscribe(`esp32/${topic}`, { qos: 1 })
      );
    });

    client.on('message', (topic, msg) => {
      try {
        const payload = JSON.parse(msg.toString());
        if (payload.id !== deviceId) return;
        const now = Date.now();
        setLiveDevices(prev => {
          const idx = prev.findIndex(d => d.id === deviceId);
          const updated = { id: deviceId, ...payload, lastSeen: now };
          if (idx > -1) {
            const copy = [...prev]; copy[idx] = updated; return copy;
          }
          return [updated];
        });
        update(ref(realtimeDB, `devices/${deviceId}`), { ...payload, lastSeen: now });
      } catch { console.warn('Invalid JSON on', topic); }
    });

    client.on('error', console.error);

    // Prune live device after 30s inactivity
    const interval = setInterval(() => {
      setLiveDevices(prev => prev.filter(d => d.lastSeen >= Date.now() - 30000));
    }, 10000);
    client.on('close', () => clearInterval(interval));
  };

  // Recompute combined metrics
  useEffect(() => {
    const combined = [...historicalDevices, ...liveDevices];
    setActiveDevices(liveDevices.length);
    setFullBinAlerts(combined.filter(d => d.binFull).length);
    setFloodRisks(combined.filter(d => d.flooded).length);
  }, [historicalDevices, liveDevices]);

  return (
    <MetricsContext.Provider value={{
      fullBinAlerts, floodRisks, activeDevices,
      historicalDevices, liveDevices
    }}>
      {children}
    </MetricsContext.Provider>
  );
};
