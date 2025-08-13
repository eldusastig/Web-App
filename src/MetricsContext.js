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

  // Ensure anonymous sign-in to satisfy DB rules
  useEffect(() => {
    const auth = getAuth();
    signInAnonymously(auth)
      .catch(err => console.error('Auth error:', err));

    const unsubscribe = onAuthStateChanged(auth, user => {
      if (user) {
        console.log('✅ Authenticated as', user.uid);
        setAuthReady(true);
      }
    });
    return () => unsubscribe();
  }, []);

  // Watch active device ID in Firebase (after auth)
  useEffect(() => {
    if (!authReady) return;

    console.log('🏁 mounting activeDevice listener');
    const activeRef = ref(realtimeDB, 'activeDevice');
    const unsubActive = onValue(activeRef, snap => {
      console.log('🔥 activeDevice snapshot:', snap.val());
      const id = snap.val();
      if (id && id !== activeDeviceIdRef.current) {
        activeDeviceIdRef.current = id;
        connectMqtt(id);
      }
    });

    return () => unsubActive();
  }, [authReady]);

  // Listen to Firebase for non-active (historical) devices
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
        // preserve possible mqtt-driven online flag and lastSeen if present in prev
        const mqttDev = prev.find(d => d.id === activeDeviceIdRef.current);
        return mqttDev ? [mqttDev, ...arr] : arr;
      });
    });

    return () => unsubDevices();
  }, [authReady]);

  // Connect MQTT for active device
  const connectMqtt = (deviceId) => {
    // close previous client if any
    if (clientRef.current) {
      try { clientRef.current.end(true); } catch (e) { /* ignore */ }
      clientRef.current = null;
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

      // telemetry topics (existing)
      ['gps', 'sensor/flood', 'sensor/bin_full'].forEach(topicSuffix => {
        client.subscribe(`esp32/${topicSuffix}`, { qos: 1 }, err => {
          if (err) console.error('❌ subscribe failed on', topicSuffix, err);
        });
      });

      // critical: subscribe to status topics (LWT) so presence is instant
      client.subscribe('esp32/+/status', { qos: 1 }, err => {
        if (err) console.error('❌ subscribe failed on esp32/+/status', err);
        else console.log('Subscribed to esp32/+/status (LWT presence)');
      });
    });

    client.on('message', (topic, message) => {
      const txt = (message || '').toString();
      // defensive parse
      let payload;
      try {
        payload = JSON.parse(txt);
      } catch (e) {
        console.warn('Invalid JSON on topic', topic, txt);
        return;
      }

      const parts = topic.split('/');
      // HANDLE STATUS (LWT) TOPICS FIRST: esp32/<id>/status
      if (parts.length >= 3 && parts[0] === 'esp32' && parts[2] === 'status') {
        const idFromTopic = parts[1];
        const id = String(payload.id ?? idFromTopic);

        // status payloads could be { status: "online"/"offline" } or { online: true/false }
        const onlineFlag = (typeof payload.status === 'string')
          ? payload.status.toLowerCase() === 'online'
          : payload.online === true;

        const now = Date.now();
        console.log('LWT status for', id, '=>', onlineFlag ? 'online' : 'offline');

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
          // not found -> add it so UI sees the status quickly
          return [{ id, online: onlineFlag, lastSeen: onlineFlag ? now : null }, ...prev];
        });

        // recompute activeDevices right away
        setTimeout(() => {
          setActiveDevices(prevDevices => {
            // use the latest devices state (read via function to reduce race)
            // but we also compute from the current 'devices' state variable
            // safer: compute from devices via setDevices callback above; we'll just compute from latest devices variable
            // immediate compute:
            const active = (Array.isArray(devices) ? devices : []).filter(d => d.online).length;
            // If device was just added above, the devices state may not include it yet — compute conservatively:
            // count in-memory: traverse state + this id
            const hasThis = (devices || []).some(d => String(d.id) === id && d.online);
            const activeCount = hasThis ? active : (onlineFlag ? active + 1 : active - 0);
            // set accurate value using actual devices state in next effect; this gives immediate feedback
            return Math.max(0, activeCount);
          });
        }, 0);

        return; // handled LWT; skip telemetry handling
      }

      // OTHERWISE: telemetry messages (gps/flood/bin) — original behavior:
      // only accept telemetry for the currently active device (same as your original code)
      if (payload.id !== deviceId) return;

      const now = Date.now();
      setDevices(prev => {
        const idx = prev.findIndex(d => d.id === deviceId);
        if (idx > -1) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], ...payload, lastSeen: now, id: deviceId };
          return updated;
        }
        return [...prev, { ...payload, lastSeen: now, id: deviceId }];
      });

      // write telemetry to Firebase
      try {
        update(ref(realtimeDB, `devices/${deviceId}`), { ...payload, lastSeen: now });
      } catch (e) {
        console.warn('Firebase update error', e);
      }
    });

    client.on('error', err => console.error('MQTT error', err));
  };

  // Prune inactive devices every 30s (keep the behavior you had)
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 30000; // 30s
      setDevices(prev => prev.filter(d => d.lastSeen >= cutoff));
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // Cleanup MQTT on unmount — no optional chaining for compatibility
  useEffect(() => {
    return () => {
      if (clientRef.current) {
        try { clientRef.current.end(true); } catch (e) { /* ignore */ }
        clientRef.current = null;
      }
    };
  }, []);

  // Recompute metrics — compute activeDevices from online flag
  useEffect(() => {
    const activeCount = devices.filter(d => d.online).length;
    setActiveDevices(activeCount);
    setFullBinAlerts(devices.filter(d => d.binFull).length);
    setFloodRisks(devices.filter(d => d.flooded).length);

    console.log('Metrics updated:', {
      activeDevices: activeCount,
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
