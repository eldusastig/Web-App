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
  activeDeviceId: null,
});

export const MetricsProvider = ({ children }) => {
  const [fullBinAlerts, setFullBinAlerts] = useState(0);
  const [floodRisks, setFloodRisks] = useState(0);
  const [activeDevices, setActiveDevices] = useState(0);
  const [devices, setDevices] = useState([]);
  const [authReady, setAuthReady] = useState(false);
  const [activeDeviceId, setActiveDeviceId] = useState(null); // exposed in context for UI/debugging

  const activeDeviceIdRef = useRef(null);
  const clientRef = useRef(null);

  // Holds the latest MQTT-updated data for the active device so we can merge it with DB snapshots
  const activeDeviceDataRef = useRef(null);

  // Ensure anonymous sign-in to satisfy DB rules
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

  // Watch active device ID in Firebase (after auth)
  useEffect(() => {
    if (!authReady) return;

    console.log('🏁 mounting activeDevice listener');
    const activeRef = ref(realtimeDB, 'activeDevice');
    const unsubActive = onValue(activeRef, snap => {
      const id = snap.val();
      console.log('🔥 activeDevice snapshot:', id);

      // keep both ref and state in sync
      activeDeviceIdRef.current = id ?? null;
      setActiveDeviceId(id ?? null);

      if (!id) {
        // if cleared, disconnect MQTT if present and clear active data
        console.log('No active device. Disconnecting MQTT if present.');
        if (clientRef.current) {
          try { clientRef.current.end(true); } catch (e) { console.warn('Error ending MQTT client', e); }
          clientRef.current = null;
        }
        activeDeviceDataRef.current = null;
        setDevices(prev => prev.filter(d => d.id !== null)); // keep other historical devices
        return;
      }

      if (id && id !== clientRef.current?.__deviceId) {
        // store the deviceId on client for easy comparison
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
      // build array of devices from DB, excluding the active device (we'll merge active mqtt data on top)
      const arr = Object.entries(data)
        .filter(([id]) => (activeDeviceIdRef.current ? String(id) !== String(activeDeviceIdRef.current) : true))
        .map(([id, vals]) => ({ id, ...vals }));

      // merge the latest mqtt-updated active device data (if present) on top of arr
      const activeData = activeDeviceDataRef.current;
      setDevices(() => (activeData ? [activeData, ...arr] : arr));
    });

    return () => unsubDevices();
  }, [authReady]);

  // Connect MQTT for active device (subscribe and robust message handling)
  const connectMqtt = (deviceId) => {
    // close previous
    if (clientRef.current) {
      try {
        clientRef.current.end(true);
      } catch (e) {
        console.warn('Error ending previous MQTT client', e);
      }
      clientRef.current = null;
    }

    if (!deviceId) {
      console.warn('connectMqtt called with falsy deviceId');
      return;
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
    // annotate client with its target device id to help later checks
    client.__deviceId = deviceId;
    clientRef.current = client;

    client.on('connect', () => {
      console.log('✅ MQTT connected for active device', deviceId);

      // Preferred: device-specific topics
      const topicSuffixes = ['gps', 'sensor/flood', 'sensor/bin_full'];
      topicSuffixes.forEach(suffix => {
        const topicWithId = `esp32/${deviceId}/${suffix}`;
        client.subscribe(topicWithId, { qos: 1 }, err => {
          if (err) console.error('❌ subscribe failed on', topicWithId, err);
          else console.log('Subscribed to', topicWithId);
        });
      });

      // ALSO subscribe to short topics (original format)
      const shortTopics = ['esp32/gps', 'esp32/sensor/flood', 'esp32/sensor/bin_full'];
      shortTopics.forEach(topic => {
        client.subscribe(topic, { qos: 1 }, err => {
          if (err) console.error('❌ subscribe failed on', topic, err);
          else console.log('Subscribed to', topic);
        });
      });

      // TEMP DEBUG: you can enable a catch-all to see everything during debugging
      // client.subscribe('esp32/#', { qos: 1 }, err => { if (!err) console.log('Subscribed to esp32/# (debug)'); });
    });

    client.on('message', (topic, message) => {
      const txt = (message || '').toString();
      console.log('MQTT msg', topic, txt);

      let payload;
      try {
        payload = JSON.parse(txt);
      } catch (e) {
        console.warn('Non-JSON payload received on', topic, txt);
        return;
      }

      // Determine message device id:
      const parts = topic.split('/');
      const topicId = parts.length >= 2 ? parts[1] : undefined;
      const msgId = payload.id ?? topicId;

      // If message id not present or doesn't match the active device, ignore
      if (String(msgId) !== String(deviceId)) {
        console.log('Message for different device', msgId, 'expected', deviceId);
        return;
      }

      const now = Date.now();
      const merged = { id: deviceId, ...payload, lastSeen: now };

      // store latest active device data in ref for merges with DB snapshots
      activeDeviceDataRef.current = merged;

      // update local devices state so metrics update immediately
      setDevices(prev => {
        // keep other devices but put/replace active device at front
        const others = prev.filter(d => String(d.id) !== String(deviceId));
        return [merged, ...others];
      });

      // push into realtime DB (optional)
      try {
        update(ref(realtimeDB, `devices/${deviceId}`), { ...payload, lastSeen: now })
          .catch(err => console.warn('Firebase update failed', err));
      } catch (e) {
        console.warn('Firebase update exception', e);
      }
    });

    client.on('error', err => console.error('MQTT error', err));
    client.on('close', () => console.log('MQTT connection closed for', deviceId));
    client.on('reconnect', () => console.log('MQTT reconnecting...'));
  };

  // Prune inactive devices every 10s (keep devices seen within last 30s)
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 30_000;
      setDevices(prev => prev.filter(d => d.lastSeen >= cutoff));
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  // Cleanup MQTT on unmount
  useEffect(() => {
    return () => {
      try {
        clientRef.current?.end(true);
      } catch (e) {
        console.warn('Error closing MQTT client on unmount', e);
      }
    };
  }, []);

  // Recompute metrics when devices list changes
  useEffect(() => {
    setActiveDevices(devices.length);
    setFullBinAlerts(devices.filter(d => d.binFull).length);
    setFloodRisks(devices.filter(d => d.flooded).length);
    console.log('Metrics updated:', {
      activeDeviceId: activeDeviceIdRef.current,
      activeDevices: devices.length,
      fullBinAlerts: devices.filter(d => d.binFull).length,
      floodRisks: devices.filter(d => d.flooded).length,
      devices,
    });
  }, [devices]);

  return (
    <MetricsContext.Provider value={{
      fullBinAlerts,
      floodRisks,
      activeDevices,
      devices,
      activeDeviceId,
    }}>
      {children}
    </MetricsContext.Provider>
  );
};
