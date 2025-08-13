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
        const mqttDev = prev.find(d => d.id === activeDeviceIdRef.current);
        return mqttDev ? [mqttDev, ...arr] : arr;
      });
    });

    return () => unsubDevices();
  }, [authReady]);

  // Connect MQTT for active device
  const connectMqtt = (deviceId) => {
    if (clientRef.current) {
      try {
        clientRef.current.end(true);
      } catch (e) {
        console.warn('Error ending previous MQTT client', e);
      }
      clientRef.current = null;
    }

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
      console.log('✅ MQTT connected for active device', deviceId);
      ['gps', 'sensor/flood', 'sensor/bin_full'].forEach(topicSuffix => {
        client.subscribe(`esp32/${topicSuffix}`, { qos: 1 }, err => {
          if (err) console.error('❌ subscribe failed on', topicSuffix, err);
        });
      });

      // Also subscribe to LWT/status topics so presence is instant
      client.subscribe('esp32/+/status', { qos: 1 }, err => {
        if (err) console.error('❌ subscribe failed on esp32/+/status', err);
      });
    });

    client.on('message', (topic, message) => {
      try {
        const payload = JSON.parse(message.toString());
        const parts = topic.split('/');

        // If this is a per-device status (LWT) topic: esp32/<id>/status
        if (parts.length >= 3 && parts[2] === 'status') {
          const idFromTopic = parts[1];
          const id = String(payload.id ?? idFromTopic ?? idFromTopic);
          // status may be { status: "online"/"offline" } or { online: true/false }
          const onlineFlag = (typeof payload.status === 'string')
            ? payload.status.toLowerCase() === 'online'
            : payload.online === true;

          const now = Date.now();
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

          return;
        }

        // Otherwise it's telemetry (your previous behaviour):
        // payload.id must match the active deviceId (we only subscribe to short topics)
        if (payload.id !== deviceId) return;

        const now = Date.now();
        setDevices(prev => {
          const idx = prev.findIndex(d => d.id === deviceId);
          if (idx > -1) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], ...payload, lastSeen: now };
            return updated;
          }
          return [...prev, { ...payload, lastSeen: now }];
        });

        update(ref(realtimeDB, `devices/${deviceId}`), { ...payload, lastSeen: now });
      } catch (e) {
        console.warn('Invalid JSON on', topic, e);
      }
    });

    client.on('error', err => console.error('MQTT error', err));
  };

  // Prune inactive devices every 30s (keep the behavior you had)
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 30000;
      setDevices(prev => prev.filter(d => d.lastSeen >= cutoff));
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // Cleanup MQTT on unmount
  useEffect(() => {
    return () => {
      if (clientRef.current) {
        try {
          clientRef.current.end(true);
        } catch (e) {
          /* ignore */
        }
      }
    };
  }, []);

  // Recompute metrics
  useEffect(() => {
    // activeDevices now derived from explicit 'online' flag (LWT presence)
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
