// src/LocationContext.js (MQTT-based) - improved + debug-friendly
import React, { createContext, useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';

export const LocationContext = createContext({ locations: [] });

const DEBUG = false; // set to true to log incoming MQTT messages and parsing decisions

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

  // string like "12.34,56.78" or "12.34 56.78"
  if (typeof payload === 'string') {
    const s = payload.trim();
    const parts = s.split(/[ ,;|]+/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return normalizeLatLon(parts[0], parts[1]);
    }
    return null;
  }

  // array [lat, lon]
  if (Array.isArray(payload)) {
    if (payload.length >= 2) return normalizeLatLon(payload[0], payload[1]);
    return null;
  }

  if (typeof payload === 'object') {
    // If both top-level lat & lon exist (exact match), accept them immediately
    if ((Object.prototype.hasOwnProperty.call(payload, 'lat') || Object.prototype.hasOwnProperty.call(payload, 'latitude')) &&
        (Object.prototype.hasOwnProperty.call(payload, 'lon') || Object.prototype.hasOwnProperty.call(payload, 'longitude') || Object.prototype.hasOwnProperty.call(payload, 'lng'))) {
      // prefer canonical names if present
      const latKey = Object.prototype.hasOwnProperty.call(payload, 'lat') ? 'lat' : (Object.prototype.hasOwnProperty.call(payload, 'latitude') ? 'latitude' : 'lat');
      const lonKey = Object.prototype.hasOwnProperty.call(payload, 'lon') ? 'lon' : (Object.prototype.hasOwnProperty.call(payload, 'longitude') ? 'longitude' : 'lon');
      // use values only if both are finite when coerced
      const maybeLat = payload[latKey];
      const maybeLon = payload[lonKey];
      const parsed = normalizeLatLon(maybeLat, maybeLon);
      if (parsed) return parsed;
    }

    // common lat/lon candidate pairs (require BOTH keys to be present)
    const gpsCandidates = [
      ['lat','lon'], ['latitude','longitude'], ['lat','lng'], ['latitude','lng'], ['gpsLat','gpsLon'],
      ['Lat','Lon'], ['Latitude','Longitude'], ['LAT','LON']
    ];

    for (const [la, lo] of gpsCandidates) {
      if (Object.prototype.hasOwnProperty.call(payload, la) && Object.prototype.hasOwnProperty.call(payload, lo)) {
        const parsed = normalizeLatLon(payload[la], payload[lo]);
        if (parsed) return parsed;
      }
    }

    // nested gps object patterns
    if (payload.gps && typeof payload.gps === 'object') {
      const g = payload.gps;
      const parsed = parseLocationFromPayload(g);
      if (parsed) return parsed;
    }

    if (payload.position && typeof payload.position === 'string') {
      // sometimes it's "lat,lon" inside `position`
      const parsed = parseLocationFromPayload(payload.position);
      if (parsed) return parsed;
    }

    // location or coords objects
    if (payload.location && typeof payload.location === 'object') {
      const parsed = parseLocationFromPayload(payload.location);
      if (parsed) return parsed;
    }
    if (payload.coords && typeof payload.coords === 'object') {
      const parsed = parseLocationFromPayload(payload.coords);
      if (parsed) return parsed;
    }

    // fallback: find any key that contains 'lat' and pair with a lon-like key (require both)
    const keys = Object.keys(payload);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const lk = k.toLowerCase();
      if (lk.includes('lat')) {
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
  const devicesMapRef = useRef(new Map()); // id -> { id, lat, lon, lastSeen }
  const ACTIVE_CUTOFF_MS = 10000;
  const PRUNE_INTERVAL_MS = 3000;

  // ID validation: allow alnum, -, _, dot; length 1..80 (adjust to your naming)
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
    if (DEBUG) console.debug('[Location] updateDeviceLocation', sid, { lat, lon, lastSeen: now });
  }

  function flushLocations() {
    const arr = Array.from(devicesMapRef.current.values())
      .filter(d => Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lon)))
      .map(d => ({ id: d.id, lat: Number(d.lat), lon: Number(d.lon), lastSeen: d.lastSeen }))
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    setLocations(arr);
  }

  function extractIdFromTopicAndPayload(topic, payload) {
    // normalize split and ignore empty segments
    const parts = topic.split('/').filter(Boolean);
    let candidate = null;

    // If topic looks like esp32/{deviceId}/..., consider parts[1] a candidate
    if (parts.length >= 2 && (parts[0] === 'esp32' || parts[0] === 'device' || parts[0] === 'devices')) {
      candidate = parts[1];
      if (typeof candidate === 'string') {
        const low = candidate.toLowerCase();
        if (RESERVED.has(low) || !ID_REGEX.test(candidate)) candidate = null;
      } else candidate = null;
    }

    // If no candidate from topic, try payload common id fields
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

    // last resort: topic pattern like /{id}/gps (if someone publishes like 'mydevice/gps')
    if (!candidate && parts.length >= 2 && parts[parts.length - 1].toLowerCase().includes('gps')) {
      const cand = parts[parts.length - 2];
      if (cand && typeof cand === 'string' && ID_REGEX.test(cand) && !RESERVED.has(cand.toLowerCase())) {
        candidate = cand;
      }
    }

    if (DEBUG) console.debug('[Location] extractId', { topic, candidate, payloadSample: (payload && typeof payload === 'object') ? Object.keys(payload).slice(0,6) : payload });
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
      // Subscribe broadly to catch GPS even in non-standard paths; we will validate id
      client.subscribe('esp32/#', { qos: 1 }, (err) => {
        if (err) console.error('📍 subscribe esp32/# failed', err);
      });
      // also listen for retained device meta
      client.subscribe('devices/+/meta', { qos: 1 }, (err) => {
        if (err) console.error('📍 subscribe devices/+/meta failed', err);
      });
      // also a fallback for generic device topics
      client.subscribe('device/+/#', { qos: 1 }, (err) => {
        if (err) console.error('📍 subscribe device/+/# failed', err);
      });
    });

    client.on('message', (topic, message) => {
      const txt = (message || '').toString();
      let payload = null;
      try { payload = JSON.parse(txt); } catch (e) { payload = txt; }

      const id = extractIdFromTopicAndPayload(topic, (typeof payload === 'object' ? payload : null));
      if (!id) {
        if (DEBUG) console.debug('[Location] ignored msg (no id)', { topic, payloadSample: String(txt).slice(0,200) });
        return; // ignore messages without a valid id
      }

      // 1) If topic is devices/{id}/meta, prefer meta parsing
      const parts = topic.split('/').filter(Boolean);
      if (parts[0] === 'devices' && parts[2] === 'meta') {
        const loc = parseLocationFromPayload(payload || {});
        if (loc) {
          updateDeviceLocation(id, loc.lat, loc.lon);
          if (DEBUG) console.debug('[Location] parsed devices meta', { id, loc });
        }
        return;
      }

      // 2) If topic mentions gps explicitly (esp32/{id}/gps or similar), try parsing payload or raw text
      if (parts.includes('gps') || parts.includes('GPS') || parts[parts.length-1].toLowerCase().includes('gps')) {
        // prefer structured payload if present, else try raw text
        const loc = parseLocationFromPayload(payload || txt);
        if (loc) {
          updateDeviceLocation(id, loc.lat, loc.lon);
          if (DEBUG) console.debug('[Location] parsed gps topic', { topic, id, loc });
        } else if (DEBUG) {
          console.debug('[Location] gps topic but unable to parse payload', { topic, id, payload: txt });
        }
        return;
      }

      // 3) fallback: try to parse any embedded location in other esp32 messages
      if (parts[0] === 'esp32' || parts[0] === 'device' || parts[0] === 'devices') {
        const loc = parseLocationFromPayload(payload || {});
        if (loc) {
          updateDeviceLocation(id, loc.lat, loc.lon);
          if (DEBUG) console.debug('[Location] parsed fallback payload', { topic, id, loc });
        } else if (DEBUG) {
          console.debug('[Location] payload contained no location', { topic, id, sample: typeof payload === 'string' ? payload.slice(0,200) : payload });
        }
        return;
      }

      // otherwise ignore
      if (DEBUG) console.debug('[Location] ignored other topic', { topic, payload: (typeof payload === 'string' ? payload.slice(0,200) : payload) });
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
