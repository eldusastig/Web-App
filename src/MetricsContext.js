// src/MetricsContext.js

import React, { createContext, useState, useEffect } from 'react';
import mqtt from 'mqtt';

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

  // ─── 1) MQTT Setup and Incoming Message Handling ─────────────────────────────────
  useEffect(() => {
    const host = 'a62b022814fc473682be5d58d05e5f97.s1.eu.hivemq.cloud';
    const port = 8884;
    const url  = `wss://${host}:${port}/mqtt`;

    const options = {
      username: 'prototype',
      password: 'Prototype1',
      clean: true,
      keepalive: 60,
      reconnectPeriod: 2000,
      clientId: 'metrics_' + Math.random().toString(16).substr(2, 8),
      // protocolVersion: 4, // uncomment if you need to force MQTT 3.1.1
    };

    const client = mqtt.connect(url, options);

    client.on('connect', () => {
      console.log('✅ MetricsProvider: connected');

      client.subscribe('esp32/gps',             { qos: 1 }, (err, granted) => {
        if (err) console.error('❌ sub esp32/gps failed:', err);
        else    console.log('✅ subscribed to', granted[0].topic);
      });
      client.subscribe('esp32/sensor/flood',    { qos: 1 }, (err, granted) => {
        if (err) console.error('❌ sub esp32/sensor/flood failed:', err);
        else    console.log('✅ subscribed to', granted[0].topic);
      });
      client.subscribe('esp32/sensor/bin_full', { qos: 1 }, (err, granted) => {
        if (err) console.error('❌ sub esp32/sensor/bin_full failed:', err);
        else    console.log('✅ subscribed to', granted[0].topic);
      });
    });

    client.on('error', (err) => {
      console.error('⚠️ MetricsProvider MQTT error:', err);
      // client.end(); // optionally uncomment to stop retrying on fatal error
    });

    client.on('reconnect', () => console.log('🔄 MetricsProvider reconnecting…'));
    client.on('close',     () => console.log('⛔ MetricsProvider disconnected'));

    client.on('message', (topic, message) => {
      let payload;
      try {
        payload = JSON.parse(message.toString());
      } catch {
        console.warn('⚠️ MetricsProvider: invalid JSON on', topic);
        return;
      }

      const now = Date.now();
      const deviceId = payload.id;
      let updatedFields = {};

      if (
        topic === 'esp32/gps' &&
        typeof deviceId === 'string' &&
        typeof payload.lat === 'number' &&
        typeof payload.lon === 'number'
      ) {
        updatedFields = { id: deviceId, lat: payload.lat, lon: payload.lon };
      } else if (
        topic === 'esp32/sensor/flood' &&
        typeof deviceId === 'string' &&
        typeof payload.flooded === 'boolean'
      ) {
        updatedFields = { id: deviceId, flooded: payload.flooded };
      } else if (
        topic === 'esp32/sensor/bin_full' &&
        typeof deviceId === 'string' &&
        typeof payload.binFull === 'boolean'
      ) {
        updatedFields = { id: deviceId, binFull: payload.binFull };
      } else {
        return;
      }

      // Merge/update devices[] with lastSeen timestamp
      setDevices((prev) => {
        const idx = prev.findIndex((d) => d.id === deviceId);
        if (idx > -1) {
          const copy = [...prev];
          copy[idx] = {
            ...copy[idx],
            ...updatedFields,
            lastSeen: now,
          };
          return copy;
        } else {
          return [...prev, { ...updatedFields, lastSeen: now }];
        }
      });
    });

    return () => {
      client.end(true);
    };
  }, []);

  // ─── 2) Periodically Prune Inactive Devices ──────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 3_000; // 30 seconds ago
      setDevices((prev) => prev.filter((d) => d.lastSeen >= cutoff));
    }, 3_000); // every 10 seconds

    return () => clearInterval(interval);
  }, []);

  // ─── 3) Recompute Summary Metrics Whenever devices[] Changes ────────────────────
  useEffect(() => {
    setActiveDevices(devices.length);
    setFullBinAlerts(devices.filter((d) => d.binFull).length);
    setFloodRisks(devices.filter((d) => d.flooded).length);
  }, [devices]);

  return (
    <MetricsContext.Provider
      value={{ fullBinAlerts, floodRisks, activeDevices, devices }}
    >
      {children}
    </MetricsContext.Provider>
  );
};
