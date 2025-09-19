// src/LocationContext.js (MQTT-based)
import React, { createContext, useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';

export const LocationContext = createContext({ locations: [] });

function normalizeLatLon(latRaw, lonRaw) {
  const a = Number(latRaw);
  const b = Number(lonRaw);
  if (!isFinite(a) || !isFinite(b)) return null;

  const latValid = Math.abs(a) <= 90;
  const lonValid = Math.abs(b) <= 180;

  const swappedLikely = (!latValid && Math.abs(b) <= 90);

  if (swappedLikely) {
    return { lat: b, lon: a };
  }

  return { lat: a, lon: b };
}

function parseLocationFromPayload(payload) {
  if (!payload) return null;

  // string like "12.34,56.78"
  if (typeof payload === 'string') {
    const s = payload.trim();
    const parts = s.split(/[ ,;|]+/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return normalizeLatLon(parts[0], parts[1]);
    }
    return null;
  }

  // array [lat, lon] or [{lat, lon}]
  if (Array.isArray(payload)) {
    if (payload.length >= 2) return normalizeLatLon(payload[0], payload[1]);
    return null;
  }

  if (typeof payload === 'object') {
    // nested gps object patterns
    const gpsCandidates = [
      ['lat','lon'], ['latitude','longitude'], ['lat','lng'], ['latitude','lng'], ['gpsLat','gpsLon']
    ];

    for (const [la, lo] of gpsCandidates) {
      if (payload[la] !== undefined || payload[lo] !== undefined) {
        return normalizeLatLon(payload[la], payload[lo]);
      }
    }

    // sometimes devices send { gps: { lat, lon } }
    if (payload.gps && typeof payload.gps === 'object') {
      const g = payload.gps;
      return parseLocationFromPayload(g);
    }

    // sometimes location is { lat: "..", lon: ".." } inside a `location` or `coords` field
    if (payload.location && typeof payload.location === 'object') {
      return parseLocationFromPayload(payload.location);
    }
    if (payload.coords && typeof payload.coords === 'object') {
      return parseLocationFromPayload(payload.coords);
    }

    // fallback: maybe lat/lon exist as strings under different keys
    const keys = Object.keys(payload);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i].toLowerCase();
      if (k.includes('lat')) {
        // attempt to find a lon-like key
        const lonKey = keys.find(kk => kk.toLowerCase().includes('lon') || kk.toLowerCase().includes('lng') || kk.toLowerCase().includes('long'));
        if (lonKey) return normalizeLatLon(payload[keys[i]], payload[lonKey]);
      }
    }
  }

  return null;
}

export const LocationProvider = ({ children }) => {
  const [locations, setLocations] = useState([]);

  const clientRef = useRef(null);
  const devicesMapRef = useRef(new Map()); // id -> { id, lat, lon, lastSeen }
  const ACTIVE_CUTOFF_MS = 10000;
  const PRUNE_INTERVAL_MS = 3000;

  function updateDeviceLocation(id, lat, lon) {
    if (!id) return;
    const sid = String(id);
    const now = Date.now();
    const map = devicesMapRef.current;
    const prev = map.get(sid) || { id: sid, lat: null, lon: null, lastSeen: now };
    prev.lat = lat;
    prev.lon = lon;
    prev.lastSeen = now;
    map.set(sid, prev);
    flushLocations();
  }

  function flushLocations() {
    const arr = Array.from(devicesMapRef.current.values())
      .filter(d => Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lon)))
      .map(d => ({ id: d.id, lat: Number(d.lat), lon: Number(d.lon) }))
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    setLocations(arr);
  }

  useEffect(() => {
    const url = 'wss://a62b022814fc473682be5d58d05e5f97.s1.eu.hivemq.cloud:8884/mqtt';
    const options = {
      username: 'prototype',
      password: 'Prototype1',
      clean: true,
      keepalive: 60,
      reconnectPeriod: 2000,
      clientId: 'locationctx_' + Math.random().toString(16).substr(2, 8),
    };

    const client = mqtt.connect(url, options);
    clientRef.current = client;

    client.on('connect', () => {
      console.log('📍 LocationContext: MQTT connected');
      // retained device meta (optional)
      client.subscribe('devices/+/meta', { qos: 1 }, (err) => {
        if (err) console.error('📍 subscribe devices/+/meta failed', err);
      });
      // device GPS topics
      client.subscribe('esp32/+/gps', { qos: 1 }, (err) => {
        if (err) console.error('📍 subscribe esp32/+/gps failed', err);
      });
      // also subscribe to general esp32 topics in case GPS is embedded elsewhere
      client.subscribe('esp32/+/status', { qos: 1 });
      client.subscribe('esp32/+/sensor/#', { qos: 1 });
    });

    client.on('message', (topic, message) => {
      const txt = (message || '').toString();
      let payload = null;
      try { payload = JSON.parse(txt); } catch (e) { /* not JSON - keep txt */ }

      const parts = topic.split('/');

      // devices/{id}/meta
      if (parts[0] === 'devices' && parts[2] === 'meta') {
        const id = parts[1];
        if (!id) return;
        const loc = parseLocationFromPayload(payload || {});
        if (loc) updateDeviceLocation(id, loc.lat, loc.lon);
        return;
      }

      // esp32/{id}/gps
      if (parts[0] === 'esp32' && parts[2] === 'gps') {
        const id = parts[1] || (payload && payload.id);
        if (!id) return;
        const loc = parseLocationFromPayload(payload || txt);
        if (loc) updateDeviceLocation(id, loc.lat, loc.lon);
        return;
      }

      // other esp32 topics that might embed gps info
      if (parts[0] === 'esp32') {
        const id = parts[1] || (payload && payload.id);
        if (!id) return;
        const loc = parseLocationFromPayload(payload || {});
        if (loc) updateDeviceLocation(id, loc.lat, loc.lon);
        return;
      }

      // ignore other topics
    });

    client.on('error', (err) => console.error('📍 LocationContext MQTT error', err));

    return () => {
      try { client.end(true); } catch (e) { /* ignore */ }
      clientRef.current = null;
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - ACTIVE_CUTOFF_MS;
      let changed = false;
      devicesMapRef.current.forEach((d, id) => {
        if (d.lastSeen && d.lastSeen < cutoff && (d.lat !== null || d.lon !== null)) {
          // clear stale coords
          d.lat = null;
          d.lon = null;
          devicesMapRef.current.set(id, d);
          changed = true;
        }
      });
      if (changed) flushLocations();
    }, PRUNE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  return (
    <LocationContext.Provider value={{ locations }}>
      {children}
    </LocationContext.Provider>
  );
};
