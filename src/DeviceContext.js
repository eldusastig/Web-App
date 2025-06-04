// src/DeviceContext.js

import React, { createContext, useState, useEffect, useMemo } from 'react';
import mqtt from 'mqtt';

export const DeviceContext = createContext({
  devices: [], // Array of device objects (with added “active” flag)
});

export const DeviceProvider = ({ children }) => {
  // 1) On first render, try to load saved devices from localStorage:
  const [devices, setDevices] = useState(() => {
    try {
      const saved = localStorage.getItem('ecotrack_devices');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // 2) Whenever devices array changes, persist it to localStorage:
  useEffect(() => {
    try {
      localStorage.setItem('ecotrack_devices', JSON.stringify(devices));
    } catch {
      // ignore write errors
    }
  }, [devices]);

  // 3) Helper: merge‐update a single device by id, stamping lastSeen
  const mergeDevice = (partial) => {
    setDevices((prev) => {
      const idx = prev.findIndex((d) => d.id === partial.id);
      const now = Date.now();

      if (idx >= 0) {
        // Update existing device, preserving other fields
        const copy = [...prev];
        copy[idx] = {
          ...copy[idx],
          ...partial,
          lastSeen: now, // update lastSeen whenever any partial arrives
        };
        return copy;
      } else {
        // New device entry
        return [
          ...prev,
          {
            ...partial,
            lastSeen: now,
          },
        ];
      }
    });
  };

  // 4) Set up MQTT subscription once on mount:
  useEffect(() => {
    const host = 'a62b022814fc473682be5d58d05e5f97.s1.eu.hivemq.cloud';
    const port = 8884; // secure WebSocket port
    const url = `wss://${host}:${port}/mqtt`;

    const options = {
      username: 'prototype',
      password: 'Prototype1',
      clean: true,
      keepalive: 60,
      reconnectPeriod: 2000,
    };

    const client = mqtt.connect(url, options);

    client.on('connect', () => {
      console.log('🌐 DeviceProvider: MQTT connected');
      client.subscribe('esp32/gps',           { qos: 1 });
      client.subscribe('esp32/sensor/flood',    { qos: 1 });
      client.subscribe('esp32/sensor/bin_full', { qos: 1 });
    });

    client.on('message', (topic, message) => {
      let payload;
      try {
        payload = JSON.parse(message.toString());
      } catch {
        return; // ignore invalid JSON
      }

      if (
        topic === 'esp32/gps' &&
        typeof payload.id === 'string' &&
        typeof payload.lat === 'number' &&
        typeof payload.lon === 'number'
      ) {
        mergeDevice({ id: payload.id, lat: payload.lat, lon: payload.lon });
      }

      if (
        topic === 'esp32/sensor/flood' &&
        typeof payload.id === 'string' &&
        typeof payload.flooded === 'boolean'
      ) {
        mergeDevice({ id: payload.id, flooded: payload.flooded });
      }

      if (
        topic === 'esp32/sensor/bin_full' &&
        typeof payload.id === 'string' &&
        typeof payload.binFull === 'boolean'
      ) {
        mergeDevice({ id: payload.id, binFull: payload.binFull });
      }
    });

    client.on('error',    (err) => { console.error('⚠️ DeviceProvider MQTT error:', err); client.end(); });
    client.on('reconnect',() => console.log('🔄 DeviceProvider MQTT reconnecting…'));
    client.on('close',    () => console.log('⛔ DeviceProvider MQTT disconnected'));

    return () => {
      client.end(true);
    };
  }, []);

  // 5) "Tick" state to force recalculation of active flags every second:
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // 6) Compute devicesWithActive: each device has active = (Date.now() - lastSeen < 5000)
  const devicesWithActive = useMemo(() => {
    const now = Date.now();
    const THRESHOLD_MS = 5000; // 5 seconds
    return devices.map((d) => ({
      ...d,
      active: now - (d.lastSeen || 0) < THRESHOLD_MS,
    }));
  }, [devices, tick]);

  return (
    <DeviceContext.Provider value={{ devices: devicesWithActive }}>
      {children}
    </DeviceContext.Provider>
  );
};
