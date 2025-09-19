// src/DeviceContext.js
import React, { createContext, useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';

export const DeviceContext = createContext({ devices: [] });

export const DeviceProvider = ({ children }) => {
  const [devices, setDevices] = useState([]);

  const clientRef = useRef(null);
  const devicesMapRef = useRef(new Map()); // Map<id, deviceObj>
  const presenceRef = useRef(new Map()); // Map<id, { online, lastSeen }>

  const ACTIVE_CUTOFF_MS = 8000;
  const PRUNE_INTERVAL_MS = 2000;
  const MAX_LOGS_PER_DEVICE = 20;

  function ensureDevice(id) {
    const sid = String(id);
    const map = devicesMapRef.current;
    let dev = map.get(sid);
    if (!dev) {
      dev = {
        id: sid,
        name: sid,
        createdAt: Date.now(),
        lastSeen: Date.now(),
        online: true,
        meta: {},
        logs: [],
      };
      map.set(sid, dev);
    }
    return dev;
  }

  function mergeMeta(id, meta) {
    const dev = ensureDevice(id);
    dev.meta = { ...dev.meta, ...(meta || {}) };
    if (meta && meta.name) dev.name = meta.name;
    dev.lastSeen = Date.now();
    dev.online = true;
    devicesMapRef.current.set(String(id), dev);
    presenceRef.current.set(String(id), { online: true, lastSeen: dev.lastSeen });
    flushDevices();
  }

  function pushLog(id, log) {
    const dev = ensureDevice(id);
    const entry = { ...(typeof log === 'object' ? log : { raw: String(log) }) };
    if (entry.ts === undefined || entry.ts === null) entry.ts = Date.now();
    entry.arrival = Date.now();

    dev.logs = [entry, ...dev.logs].slice(0, MAX_LOGS_PER_DEVICE);
    // lightweight helpers that DeviceContext used to have from Firebase
    if (typeof entry.fillPct === 'number') dev.meta.fillPct = entry.fillPct;
    if (entry.binFull !== undefined) dev.meta.binFull = entry.binFull;
    if (entry.flooded !== undefined) dev.meta.flooded = entry.flooded;

    dev.lastSeen = Date.now();
    dev.online = true;

    devicesMapRef.current.set(String(id), dev);
    presenceRef.current.set(String(id), { online: true, lastSeen: dev.lastSeen });
    flushDevices();
  }

  function flushDevices() {
    const arr = Array.from(devicesMapRef.current.values())
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    setDevices(arr);
  }

  useEffect(() => {
    // connect to MQTT broker
    const url = 'wss://a62b022814fc473682be5d58d05e5f97.s1.eu.hivemq.cloud:8884/mqtt';
    const options = {
      username: 'prototype',
      password: 'Prototype1',
      clean: true,
      keepalive: 60,
      reconnectPeriod: 2000,
      clientId: 'devicectx_' + Math.random().toString(16).substr(2, 8),
    };

    const client = mqtt.connect(url, options);
    clientRef.current = client;

    client.on('connect', () => {
      console.log('🔌 DeviceContext: MQTT connected');
      // Subscribe to retained device meta (if you publish retained meta to devices/{id}/meta)
      client.subscribe('devices/+/meta', { qos: 1 }, (err) => {
        if (err) console.error('🔌 subscribe devices/+/meta failed', err);
      });
      // Subscribe to device topics (detections/status/presence)
      client.subscribe('esp32/#', { qos: 1 }, (err) => {
        if (err) console.error('🔌 subscribe esp32/# failed', err);
      });
    });

    client.on('message', (topic, message) => {
      const txt = (message || '').toString();
      let payload = null;
      try { payload = JSON.parse(txt); } catch (e) { /* ignore - non-json payload */ }

      const parts = topic.split('/');

      // devices/{id}/meta -> treat as retained metadata
      if (parts[0] === 'devices' && parts[2] === 'meta') {
        const id = parts[1];
        if (!id) return;
        if (payload && typeof payload === 'object') mergeMeta(id, payload);
        else mergeMeta(id, { rawMeta: txt });
        return;
      }

      // esp32/{id}/... topics
      if (parts[0] === 'esp32') {
        const id = parts[1] || (payload && payload.id);
        if (!id) return;

        // if it's a status topic, we may set presence
        if (parts[2] === 'status') {
          pushLog(id, payload || { raw: txt });
          return;
        }

        // sensor topics or detections: push as log and update lastSeen
        if (parts[2] === 'sensor' || parts[2] === 'gps' || parts[2] === 'sensor' || parts[2] === 'sensor') {
          pushLog(id, payload || { raw: txt });
          return;
        }

        // fallback: push whatever we received
        pushLog(id, payload || { raw: txt });
        return;
      }

      // fallback: ignore unrelated topics
    });

    client.on('error', (err) => console.error('🔌 DeviceContext MQTT error', err));

    return () => {
      try { client.end(true); } catch (e) { /* ignore */ }
      clientRef.current = null;
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - ACTIVE_CUTOFF_MS;
      let changed = false;

      presenceRef.current.forEach((val, id) => {
        if (val.lastSeen && val.lastSeen < cutoff && val.online) {
          presenceRef.current.set(id, { online: false, lastSeen: val.lastSeen });
          const dev = devicesMapRef.current.get(String(id));
          if (dev) {
            dev.online = false;
            devicesMapRef.current.set(String(id), dev);
            changed = true;
          }
        }
      });

      if (changed) flushDevices();
    }, PRUNE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  return (
    <DeviceContext.Provider value={{ devices }}>
      {children}
    </DeviceContext.Provider>
  );
};
