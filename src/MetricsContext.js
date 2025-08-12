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
  const [activeDeviceId, setActiveDeviceId] = useState(null);

  const activeDeviceIdRef = useRef(null);
  const clientRef = useRef(null);
  const activeDeviceDataRef = useRef(null); // latest MQTT-updated active device

  const ACTIVE_CUTOFF_MS = 30_000; // consider device active if lastSeen within this window

  // --- Auth ---
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

  // --- activeDevice listener ---
  useEffect(() => {
    if (!authReady) return;

    console.log('🏁 mounting activeDevice listener');
    const activeRef = ref(realtimeDB, 'activeDevice');
    const unsubActive = onValue(activeRef, snap => {
      const id = snap.val();
      console.log('🔥 activeDevice snapshot:', id);

      // keep ref + state in sync
      activeDeviceIdRef.current = id ?? null;
      setActiveDeviceId(id ?? null);

      if (!id) {
        // cleared: disconnect MQTT and clear active data
        console.log('No active device. Disconnecting MQTT if present.');
        if (clientRef.current) {
          try { clientRef.current.end(true); } catch (e) { console.warn(e); }
          clientRef.current = null;
        }
        activeDeviceDataRef.current = null;
        // keep historical devices only
        setDevices(prev => prev.filter(d => String(d.id) !== String(id)));
        return;
      }

      // if device changed, (re)connect
      if (id && id !== clientRef.current?.__deviceId) {
        connectMqtt(id);
      }
    });

    return () => unsubActive();
  }, [authReady]);

  // --- devices snapshot (immediate pruning) ---
  useEffect(() => {
    if (!authReady) return;

    console.log('🏁 mounting devices listener');
    const devicesRef = ref(realtimeDB, 'devices');
    const unsubDevices = onValue(devicesRef, snap => {
      console.log('🔥 devices snapshot raw:', snap.val());
      const data = snap.val() || {};

      const cutoff = Date.now() - ACTIVE_CUTOFF_MS;

      // Build array and immediately prune stale entries
      const arr = Object.entries(data)
        .filter(([id]) => (activeDeviceIdRef.current ? String(id) !== String(activeDeviceIdRef.current) : true))
        .map(([id, vals]) => ({ id, ...vals }))
        .filter(d => d.lastSeen && d.lastSeen >= cutoff);

      // Merge active MQTT-updated data (if present)
      const activeData = activeDeviceDataRef.current;
      setDevices(() => (activeData ? [activeData, ...arr] : arr));
    });

    return () => unsubDevices();
  }, [authReady]);

  // --- MQTT connect & message handling ---
  const connectMqtt = (deviceId) => {
    // close previous
    if (clientRef.current) {
      try { clientRef.current.end(true); } catch (e) { console.warn('Error ending previous MQTT client', e); }
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
    client.__deviceId = deviceId; // annotate client for checks
    clientRef.current = client;

    client.on('connect', () => {
      console.log('✅ MQTT connected for active device', deviceId);

      // device-specific topics (preferred)
      const topicSuffixes = ['gps', 'sensor/flood', 'sensor/bin_full'];
      topicSuffixes.forEach(suffix => {
        const topicWithId = `esp32/${deviceId}/${suffix}`;
        client.subscribe(topicWithId, { qos: 1 }, err => {
          if (err) console.error('❌ subscribe failed on', topicWithId, err);
          else console.log('Subscribed to', topicWithId);
        });
      });

      // also subscribe to short topics (original format)
      const shortTopics = ['esp32/gps', 'esp32/sensor/flood', 'esp32/sensor/bin_full'];
      shortTopics.forEach(topic => {
        client.subscribe(topic, { qos: 1 }, err => {
          if (err) console.error('❌ subscribe failed on', topic, err);
          else console.log('Subscribed to', topic);
        });
      });

      // debug-only (uncomment while troubleshooting):
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

      // determine msg id: prefer payload.id else topic path esp32/<id>/...
      const parts = topic.split('/');
      const topicId = parts.length >= 2 ? parts[1] : undefined;
      const msgId = payload.id ?? topicId;

      if (String(msgId) !== String(deviceId)) {
        console.log('Message for different device', msgId, 'expected', deviceId);
        return;
      }

      const now = Date.now();
      const merged = { id: deviceId, ...payload, lastSeen: now };

      // store latest active device data to merge with DB snapshots
      activeDeviceDataRef.current = merged;

      // update devices immediately (active front)
      setDevices(prev => {
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

  // --- prune interval (keeps UI in sync) ---
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - ACTIVE_CUTOFF_MS;
      setDevices(prev => prev.filter(d => d.lastSeen && d.lastSeen >= cutoff));
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  // --- cleanup on unmount ---
  useEffect(() => {
    return () => {
      try { clientRef.current?.end(true); } catch (e) { console.warn('Error closing MQTT client on unmount', e); }
    };
  }, []);

  // --- time-aware metrics computation ---
  useEffect(() => {
    const cutoff = Date.now() - ACTIVE_CUTOFF_MS;
    const activeList = devices.filter(d => d.lastSeen && d.lastSeen >= cutoff);

    setActiveDevices(activeList.length);
    setFullBinAlerts(activeList.filter(d => d.binFull).length);
    setFloodRisks(activeList.filter(d => d.flooded).length);

    console.log('Metrics updated:', {
      activeDeviceId: activeDeviceIdRef.current,
      activeDevices: activeList.length,
      fullBinAlerts: activeList.filter(d => d.binFull).length,
      floodRisks: activeList.filter(d => d.flooded).length,
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
