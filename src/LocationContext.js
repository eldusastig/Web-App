// src/LocationContext.js
// LocationContext with Firebase fallback and cache TTL
import React, { createContext, useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';

// Import the shared firebase database instance (must be exported from src/firebase.js)
import { database } from './firebase';

import { ref as dbRef, get as dbGet } from 'firebase/database';

export const LocationContext = createContext({ locations: [] });

// Toggle verbose logs
const DEBUG = true;

// CACHE TTL for DB fallback (ms)
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Helpers: normalization & parsing
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

  if (typeof payload === 'object' && !Array.isArray(payload)) {
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

  if (typeof payload === 'string') {
    const s = payload.trim();
    const parts = s.split(/[ ,;|]+/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) return normalizeLatLon(parts[0], parts[1]);
    return null;
  }

  if (Array.isArray(payload)) {
    if (payload.length >= 2) return normalizeLatLon(payload[0], payload[1]);
    return null;
  }

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

  // Mirrors the presence / device map pattern from your other contexts
  const devicesMapRef = useRef(new Map()); // id -> device object { id, lat, lon, lastSeen, address, fillPct, online }
  const presenceRef = useRef(new Map()); // id -> { online: boolean, lastSeen: number }

  // map of id->lastFetchedTs to rate-limit DB fallback queries
  const fetchedMetaRef = useRef(new Map()); // id -> timestamp

  const ACTIVE_CUTOFF_MS = 10000;
  const PRUNE_INTERVAL_MS = 3000;

  const ID_REGEX = /^[a-zA-Z0-9_.-]{1,80}$/;
  const RESERVED = new Set(['sensor', 'status', 'gps', 'devices', 'meta', 'deleted_devices', 'broadcast', 'mqtt']);

  function flushLocations() {
    const arr = Array.from(devicesMapRef.current.values())
      .filter(d => Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lon)))
      .map(d => ({
        id: d.id,
        lat: Number(d.lat),
        lon: Number(d.lon),
        lastSeen: d.lastSeen,
        address: d.address ?? null,
        fillPct: d.fillPct ?? null,
        _usingDbFallback: !!d._usingDbFallback,
      }))
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    setLocations(arr);
    if (DEBUG) console.debug('[Location] flushLocations ->', arr);
  }

  function updateDeviceLocation(id, lat, lon) {
    if (!id) return;
    const sid = String(id);
    const now = Date.now();
    const map = devicesMapRef.current;
    const prev = map.get(sid) || { id: sid, lat: null, lon: null, lastSeen: now, address: null, fillPct: null, online: true };
    prev.lat = lat;
    prev.lon = lon;
    prev.lastSeen = now;
    prev.online = true;
    prev._usingDbFallback = false; // real-time message overrides fallback
    map.set(sid, prev);

    presenceRef.current.set(sid, { online: true, lastSeen: now });
    setTimeout(() => { // defer flush to batch multiple incoming updates
      flushLocations();
    }, 0);

    if (DEBUG) console.debug('[Location] updateDeviceLocation ->', sid, { lat, lon, lastSeen: now });
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

  // Fetch metadata from Firebase RTDB for a given device id.
  // Tries /devices/{id}/meta then /devices/{id}. Merges address / lat / lon / fillPct.
  async function fetchDeviceMetaFromFirebase(id) {
    if (!id) return null;
    if (!database) {
      if (DEBUG) console.warn('[Location] Firebase DB not available — cannot fetch meta for', id);
      return null;
    }

    const last = fetchedMetaRef.current.get(id);
    if (last && (Date.now() - last) < CACHE_TTL_MS) {
      if (DEBUG) console.debug('[Location] meta cached recently for', id);
      return null;
    }
    // mark fetch time immediately to avoid duplicate concurrent fetches
    fetchedMetaRef.current.set(id, Date.now());

    try {
      const path1 = `devices/${id}/meta`;
      const snap1 = await dbGet(dbRef(database, path1));
      if (snap1.exists()) {
        if (DEBUG) console.debug('[Location] fetched meta from', path1, snap1.val());
        return snap1.val();
      }
      const path2 = `devices/${id}`;
      const snap2 = await dbGet(dbRef(database, path2));
      if (snap2.exists()) {
        if (DEBUG) console.debug('[Location] fetched meta from', path2, snap2.val());
        return snap2.val();
      }
      if (DEBUG) console.debug('[Location] no firebase meta for', id);
      return null;
    } catch (err) {
      console.error('[Location] Firebase fetch error for', id, err && err.message ? err.message : err);
      return null;
    }
  }

  // MQTT: listen and extract lat/lon messages
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

        const payloadObject = (typeof parsed === 'object' && parsed !== null) ? parsed : null;
        const id = extractIdFromTopicAndPayload(topic, payloadObject);

        // If payload contains lat & lon and id, quick accept
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

        if (!id) {
          if (DEBUG) console.warn('📍 Message ignored: no valid id extracted', { topic, sample: txt });
          return;
        }

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
      try { client.end(true); } catch (e) {}
      clientRef.current = null;
    };
  }, []);

  // Periodic prune: mark offline devices and attempt DB fallback merge for those IDs
  useEffect(() => {
    const interval = setInterval(async () => {
      const now = Date.now();
      const cutoff = now - ACTIVE_CUTOFF_MS;
      const map = devicesMapRef.current;
      let clearedAny = false;

      // mark expired devices: set lat/lon null to indicate live loc gone
      map.forEach((d, id) => {
        if (d.lastSeen && d.lastSeen < cutoff && (d.lat !== null || d.lon !== null)) {
          d.lat = null;
          d.lon = null;
          d._clearedForFallback = true;
          d.online = false;
          map.set(id, d);
          clearedAny = true;
          if (DEBUG) console.debug('[Location] device expired -> cleared live location', id);
        }
      });

      // update presenceRef and devices state if presence changed
      presenceRef.current.forEach((p, id) => {
        if (p.lastSeen && p.lastSeen < cutoff && p.online) {
          presenceRef.current.set(id, { online: false, lastSeen: p.lastSeen });
        }
      });

      // Attempt DB fallback for cleared devices
      if (clearedAny && database) {
        const promises = [];
        map.forEach((d, id) => {
          if (d._clearedForFallback && !d._usingDbFallback) {
            promises.push((async () => {
              const meta = await fetchDeviceMetaFromFirebase(id);
              if (!meta) return null;

              let changed = false;

              // lat/lon from metadata
              const mLat = meta.lat ?? meta.latitude ?? meta.lat_deg ?? null;
              const mLon = meta.lon ?? meta.longitude ?? meta.lng ?? null;
              if ((mLat !== undefined && mLon !== undefined) && (!Number.isFinite(d.lat) || !Number.isFinite(d.lon))) {
                const latN = Number(mLat);
                const lonN = Number(mLon);
                if (Number.isFinite(latN) && Number.isFinite(lonN)) {
                  d.lat = latN;
                  d.lon = lonN;
                  changed = true;
                }
              }

              // address fallback
              const address = meta.address ?? meta.street_address ?? meta.display_name ?? meta.location_name ?? meta.name ?? null;
              if (address && !d.address) {
                d.address = address;
                changed = true;
              }

              // fillPct fallback
              const metaFill = meta.fillPct ?? meta.fill_pct ?? meta.binFillPct ?? meta.bin_fill_pct ?? meta.fill ?? meta.fillPercent ?? meta.fill_percent;
              if (metaFill !== undefined && metaFill !== null && Number.isFinite(Number(metaFill)) && (d.fillPct === null || d.fillPct === undefined)) {
                const pct = Math.max(0, Math.min(100, Math.round(Number(metaFill))));
                d.fillPct = pct;
                d.binFillPct = pct;
                d.binFull = pct >= 90;
                changed = true;
              } else if ((meta.binFull === true || meta.bin_full === true) && (d.binFull !== true)) {
                d.binFull = true;
                d.binFillPct = d.binFillPct ?? 100;
                changed = true;
              }

              if (changed) {
                d._usingDbFallback = true;
                d._clearedForFallback = false;
                map.set(id, d);
                if (DEBUG) console.debug('[Location] merged DB fallback meta into device', id, { lat: d.lat, lon: d.lon, address: d.address, fillPct: d.fillPct });
              }
              return id;
            })());
          }
        });

        try {
          await Promise.all(promises);
        } catch (e) {
          console.warn('[Location] error during DB fallback fetches', e);
        }
      }

      // flush locations (will include DB fallback lat/lon if any merged)
      flushLocations();
    }, PRUNE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  return (
    <LocationContext.Provider value={{ locations }}>
      {children}
    </LocationContext.Provider>
  );
};
