// src/LocationContext.js — verbose debug edition
import React, { createContext, useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';

export const LocationContext = createContext({ locations: [] });

// Turn on while debugging — set to false once working
const DEBUG = true;

function normalizeLatLon(latRaw, lonRaw) {
  const a = Number(latRaw);
  const b = Number(lonRaw);
  if (!isFinite(a) || !isFinite(b)) return null;

  const latValid = Math.abs(a) <= 90;
  const lonValid = Math.abs(b) <= 180;
  const swappedLikely = (!latValid && Math.abs(b) <= 90);
  if (swappedLikely) return { lat: b, lon: a };
  return { lat: a, lon: b };
}

function parseLocationFromPayload(payload) {
  if (!payload) return null;

  // If payload is already an object with numeric lat/lon fields, accept
  if (typeof payload === 'object' && !Array.isArray(payload)) {
    // direct canonical fields check (both required)
    const possibleLatKeys = ['lat','latitude','Lat','Latitude','LAT'];
    const possibleLonKeys = ['lon','lng','longitude','Lon','Longitude','LON','Lng'];

    let latVal = undefined, lonVal = undefined;
    for (const k of possibleLatKeys) if (Object.prototype.hasOwnProperty.call(payload, k)) { latVal = payload[k]; break; }
    for (const k of possibleLonKeys) if (Object.prototype.hasOwnProperty.call(payload, k)) { lonVal = payload[k]; break; }

    if (latVal !== undefined && lonVal !== undefined) {
      const parsed = normalizeLatLon(latVal, lonVal);
      if (parsed) return parsed;
    }
  }

  // string like "12.34,56.78" or "12.34 56.78"
  if (typeof payload === 'string') {
    const s = payload.trim();
    const parts = s.split(/[ ,;|]+/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) return normalizeLatLon(parts[0], parts[1]);
    return null;
  }

  // array [lat, lon]
  if (Array.isArray(payload)) {
    if (payload.length >= 2) return normalizeLatLon(payload[0], payload[1]);
    return null;
  }

  // nested patterns
  if (typeof payload === 'object') {
    if (payload.gps && typeof payload.gps === 'object') {
      const r = parseLocationFromPayload(payload.gps);
      if (r) return r;
    }
    if (payload.location && typeof payload.location === 'object') {
      const r = parseLocationFromPayload(payload.location);
      if (r) return r;
    }
    if (payload.coords && typeof payload.coords === 'object') {
      const r = parseLocationFromPayload(payload.coords);
      if (r) return r;
    }

    // fallback: search keys that include 'lat' and 'lon'-like
    const keys = Object.keys(payload);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k.toLowerCase().includes('lat')) {
        const lonKey = keys.find(kk => {
          const s = kk.toLowerCase();
          return s.includes('lon') || s.includes('lng') || s.includes('long');
        });
        if (lonKey && Object.prototype.hasOwnProperty.call(payload, lonKey)) {
          const parsed = normalizeLatLon(payload[k], payload[lonKey]);
          if (parsed) return parsed;
        }
      }
    }
  }

  return null;
}

export const LocationProvider = ({ children }) => {
  const [locations, setLocations] = useState([]);
  const clientRef = useRef(null);
  const devicesMapRef = useRef(new Map());
  const ACTIVE_CUTOFF_MS = 10000;
  const PRUNE_INTERVAL_MS = 3000;

  const ID_REGEX = /^[a-zA-Z0-9_.-]{1,80}$/;
  const RESERVED = new Set(['sensor', 'status', 'gps', 'devices', 'meta', 'deleted_devices', 'broadcast', 'mqtt']);

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
    if (DEBUG) console.debug('[Location] updateDeviceLocation ->', sid, { lat, lon, lastSeen: now });
  }

  function flushLocations() {
    const arr = Array.from(devicesMapRef.current.values())
      .filter(d => Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lon)))
      .map(d => ({ id: d.id, lat: Number(d.lat), lon: Number(d.lon), lastSeen: d.lastSeen }))
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    setLocations(arr);
    if (DEBUG) console.debug('[Location] flushLocations ->', arr);
  }

  function extractIdFromTopicAndPayload(topic, payload) {
    const parts = topic.split('/').filter(Boolean);
    let candidate = null;

    if (parts.length >= 2 && (parts[0] === 'esp32' || parts[0] === 'device' || parts[0] === 'devices')) {
      candidate = parts[1];
      if (typeof candidate === 'string') {
        const low = candidate.toLowerCase();
        if (RESERVED.has(low) || !ID_REGEX.test(candidate)) candidate = null;
      } else candidate = null;
    }

    if (!candidate && payload && typeof payload === 'object') {
      const idFields = ['id', 'deviceId', 'device_id', 'dev_id', 'node_id', 'name'];
      for (const f of idFields) {
        if (Object.prototype.hasOwnProperty.call(payload, f) && payload[f]) {
          const v = String(payload[f]).trim();
          if (ID_REGEX.test(v) && !RESERVED.has(v.toLowerCase())) {
            candidate = v;
            break;
          }
        }
      }
    }

    if (!candidate && parts.length >= 2 && parts[parts.length - 1].toLowerCase().includes('gps')) {
      const cand = parts[parts.length - 2];
      if (cand && typeof cand === 'string' && ID_REGEX.test(cand) && !RESERVED.has(cand.toLowerCase())) {
        candidate = cand;
      }
    }

    if (DEBUG) console.debug('[Location] extractIdFromTopicAndPayload', { topic, candidate, payloadSample: (payload && typeof payload === 'object') ? Object.keys(payload).slice(0,6) : payload });
    return candidate;
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
      // subscribe broadly plus explicit gps topics
      client.subscribe('esp32/#', { qos: 1 }, (err) => { if (err) console.error('subscribe esp32/# failed', err); });
      client.subscribe('esp32/+/gps', { qos: 1 }, (err) => { if (err) console.error('subscribe esp32/+/gps failed', err); });
      client.subscribe('esp32/gps', { qos: 1 }, (err) => { if (err) console.error('subscribe esp32/gps failed', err); });
      client.subscribe('devices/+/meta', { qos: 1 }, (err) => { if (err) console.error('subscribe devices/+/meta failed', err); });
      client.subscribe('device/+/#', { qos: 1 }, (err) => { if (err) console.error('subscribe device/+/# failed', err); });
    });

    client.on('reconnect', () => { if (DEBUG) console.debug('📍 LocationContext: reconnecting...'); });
    client.on('offline', () => { if (DEBUG) console.debug('📍 LocationContext: offline'); });

    client.on('message', (topic, message) => {
      try {
        const txt = (message || '').toString();
        if (DEBUG) console.debug('📍 MQTT message arrived', { topic, txt });

        let parsed = null;
        try { parsed = JSON.parse(txt); if (DEBUG) console.debug('📍 JSON parsed', parsed); }
        catch (e) { if (DEBUG) console.debug('📍 JSON parse failed, keeping raw text'); parsed = txt; }

        // If parsed is object, try to extract id & location directly
        const payloadObject = (typeof parsed === 'object' && parsed !== null) ? parsed : null;
        const id = extractIdFromTopicAndPayload(topic, payloadObject);

        // Quick heuristic: if payload object has lat & lon AND id field, accept immediately
        if (payloadObject && Object.prototype.hasOwnProperty.call(payloadObject, 'lat') && Object.prototype.hasOwnProperty.call(payloadObject, 'lon')) {
          const quickId = payloadObject.id ? String(payloadObject.id) : id;
          if (quickId) {
            const loc = parseLocationFromPayload(payloadObject);
            if (loc) {
              if (DEBUG) console.debug('📍 Quick accept (payload lat/lon present)', { topic, id: quickId, loc });
              updateDeviceLocation(quickId, loc.lat, loc.lon);
              return;
            }
          }
        }

        // Normal flow: need a valid id and parseable location
        if (!id) {
          if (DEBUG) console.warn('📍 Message ignored: no valid id extracted', { topic, sample: txt });
          return;
        }

        // parse location either from object or raw text
        const loc = parseLocationFromPayload(payloadObject || txt);
        if (loc) {
          if (DEBUG) console.debug('📍 Parsed location', { topic, id, loc });
          updateDeviceLocation(id, loc.lat, loc.lon);
          return;
        } else {
          if (DEBUG) console.warn('📍 Message had id but no parsable location', { topic, id, sample: txt });
        }
      } catch (err) {
        console.error('📍 LocationContext onmessage error', err);
      }
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
          d.lat = null; d.lon = null;
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
