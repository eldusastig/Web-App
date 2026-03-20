// src/LocationContext.js
// LocationContext with Firebase fallback and cache TTL
import React, { createContext, useState, useEffect, useRef, useCallback } from 'react';
import mqtt from 'mqtt';

// Use the same Realtime DB instance as your other contexts
import { database } from './firebase3';

import { ref as dbRef, get as dbGet } from 'firebase/database';

export const LocationContext = createContext({ locations: [] });

// Toggle verbose logs
const DEBUG = true;

if (DEBUG) console.debug('[Location] module loaded — database present?', !!database, 'database.app?', database && database.app ? database.app.name : 'no-app');

// CACHE TTL for DB fallback (ms)
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Helpers: normalization & parsing ────────────────────────────────────────

function normalizeLatLon(latRaw, lonRaw) {
  const a = Number(latRaw);
  const b = Number(lonRaw);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  const latValid = Math.abs(a) <= 90;
  const lonValid = Math.abs(b) <= 180;
  const swappedLikely = (!latValid && !lonValid && Math.abs(b) <= 90);
  if (swappedLikely) return { lat: b, lon: a };
  return { lat: a, lon: b };
}

function isValidCoord(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  // treat exact (0,0) as invalid placeholder
  if (lat === 0 && lon === 0) return false;
  return true;
}

function parseLocationFromPayload(payload) {
  if (!payload) return null;

  if (typeof payload === 'object' && !Array.isArray(payload)) {
    const possibleLatKeys = ['lat', 'latitude', 'Lat', 'Latitude', 'LAT', 'lat_deg'];
    const possibleLonKeys = ['lon', 'lng', 'longitude', 'Lon', 'Longitude', 'LON', 'Lng', 'lon_deg'];

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

function normalizeLatLonPayload(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };

  const latCandidates = ['lat', 'latitude', 'lat_deg'];
  const lonCandidates = ['lon', 'lng', 'longitude', 'lon_deg'];

  let foundLat = null;
  let foundLon = null;

  for (const k of latCandidates) {
    if (Object.prototype.hasOwnProperty.call(out, k)) { foundLat = out[k]; break; }
  }
  for (const k of lonCandidates) {
    if (Object.prototype.hasOwnProperty.call(out, k)) { foundLon = out[k]; break; }
  }

  if ((foundLat === null || foundLat === undefined) && out.gps && typeof out.gps === 'object') {
    for (const k of latCandidates) {
      if (Object.prototype.hasOwnProperty.call(out.gps, k)) { foundLat = out.gps[k]; break; }
    }
  }
  if ((foundLon === null || foundLon === undefined) && out.gps && typeof out.gps === 'object') {
    for (const k of lonCandidates) {
      if (Object.prototype.hasOwnProperty.call(out.gps, k)) { foundLon = out.gps[k]; break; }
    }
  }

  if (foundLat !== null && foundLat !== undefined && foundLon !== null && foundLon !== undefined) {
    const parsed = normalizeLatLon(foundLat, foundLon);
    if (parsed) {
      out.lat = parsed.lat;
      out.lon = parsed.lon;
    }
  }

  return out;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export const LocationProvider = ({ children }) => {
  const [locations, setLocations] = useState([]);
  const clientRef = useRef(null);

  const devicesMapRef = useRef(new Map());
  const presenceRef  = useRef(new Map());
  const fetchedMetaRef = useRef(new Map());

  const ACTIVE_CUTOFF_MS = 10000;
  const PRUNE_INTERVAL_MS = 3000;

  const ID_REGEX = /^[a-zA-Z0-9_.-]{1,80}$/;
  const RESERVED = new Set(['sensor', 'status', 'gps', 'devices', 'meta', 'deleted_devices', 'broadcast', 'mqtt']);

  // ─── flushLocations: stable via useCallback (reads ref only, never stale) ──
  const flushLocations = useCallback(() => {
    const arr = Array.from(devicesMapRef.current.values())
      .filter(d => {
        const latN = Number(d.lat);
        const lonN = Number(d.lon);
        return isValidCoord(latN, lonN);
      })
      .map(d => ({
        id: d.id,
        lat: Number(d.lat),
        lon: Number(d.lon),
        lastSeen: d.lastSeen,
        address: d.address ?? null,
        fillPct: d.fillPct ?? null,
        binFull: d.binFull ?? false,
        flooded: d.flooded ?? false,
        _usingDbFallback: !!d._usingDbFallback,
      }))
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));

    setLocations(arr);
    if (DEBUG) console.debug('[Location] flushLocations ->', arr);
  }, []); // stable — only reads from ref

  // ─── updateDeviceLocation: stable via useCallback ─────────────────────────
  const updateDeviceLocation = useCallback((id, lat, lon) => {
    if (!id) return;
    const sid = String(id);
    const now = Date.now();
    const map = devicesMapRef.current;
    const prev = map.get(sid) || {
      id: sid,
      lat: null,
      lon: null,
      lastSeen: now,
      address: null,
      fillPct: null,
      binFull: false,
      flooded: false,
      online: true,
    };

    const parsed = normalizeLatLon(lat, lon);
    if (!parsed || !isValidCoord(parsed.lat, parsed.lon)) {
      if (DEBUG) console.debug('[Location] updateDeviceLocation — invalid coords, ignoring', { id: sid, lat, lon });
      prev.lastSeen = now;
      prev.online = true;
      map.set(sid, prev);
      presenceRef.current.set(sid, { online: true, lastSeen: now });
      flushLocations();
      return;
    }

    prev.lat = parsed.lat;
    prev.lon = parsed.lon;
    prev.lastSeen = now;
    prev.online = true;
    prev._usingDbFallback = false;
    map.set(sid, prev);

    presenceRef.current.set(sid, { online: true, lastSeen: now });
    flushLocations();

    if (DEBUG) console.debug('[Location] updateDeviceLocation ->', sid, { lat: parsed.lat, lon: parsed.lon });
  }, [flushLocations]);

  // ─── extractIdFromTopicAndPayload: stable via useCallback ─────────────────
  const extractIdFromTopicAndPayload = useCallback((topic, payload) => {
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

    if (DEBUG) console.debug('[Location] extractId', { topic, candidate });
    return candidate;
  }, []); // no external deps — only uses module-level constants

  // ─── fetchDeviceMetaFromFirebase ──────────────────────────────────────────
  const fetchDeviceMetaFromFirebase = useCallback(async (id) => {
    if (!id) return null;
    if (!database) {
      if (DEBUG) console.warn('[Location] Firebase DB not available for', id);
      return null;
    }

    const last = fetchedMetaRef.current.get(id);
    if (last && (Date.now() - last) < CACHE_TTL_MS) {
      if (DEBUG) console.debug('[Location] meta cached for', id);
      return null;
    }
    fetchedMetaRef.current.set(id, Date.now());

    try {
      const snap1 = await dbGet(dbRef(database, `devices/${id}/meta`));
      if (snap1.exists()) {
        if (DEBUG) console.debug('[Location] fetched meta from devices/' + id + '/meta', snap1.val());
        return snap1.val();
      }
      const snap2 = await dbGet(dbRef(database, `devices/${id}`));
      if (snap2.exists()) {
        if (DEBUG) console.debug('[Location] fetched meta from devices/' + id, snap2.val());
        return snap2.val();
      }
      if (DEBUG) console.debug('[Location] no firebase meta for', id);
      return null;
    } catch (err) {
      console.error('[Location] Firebase fetch error for', id, err && err.message ? err.message : err);
      return null;
    }
  }, []);

  // ─── Initial seed from Firebase ───────────────────────────────────────────
  useEffect(() => {
    if (!database) {
      if (DEBUG) console.debug('[Location] database not available for initial seed');
      return;
    }

    let aborted = false;
    (async () => {
      try {
        const snap = await dbGet(dbRef(database, 'devices'));
        if (!snap.exists()) return;

        const obj = snap.val();
        const now = Date.now();
        let seeded = 0;

        Object.keys(obj || {}).forEach(id => {
          if (aborted) return;
          const meta = obj[id];
          const mLatRaw = meta?.lat ?? meta?.latitude ?? meta?.lat_deg ?? null;
          const mLonRaw = meta?.lon ?? meta?.longitude ?? meta?.lng ?? null;
          const latN = Number(mLatRaw);
          const lonN = Number(mLonRaw);

          if (isValidCoord(latN, lonN)) {
            const sid = String(id);
            const existing = devicesMapRef.current.get(sid);
            if (!existing || existing._usingDbFallback) {
              devicesMapRef.current.set(sid, {
                id: sid,
                lat: latN,
                lon: lonN,
                lastSeen: meta?.lastSeen ?? now,
                address: meta?.address ?? null,
                fillPct: meta?.fillPct ?? meta?.fill_percent ?? null,
                binFull: meta?.binFull ?? meta?.bin_full ?? false,
                flooded: meta?.flooded ?? meta?.flood ?? false,
                online: !!meta?.online,
                _usingDbFallback: true,
              });
              seeded++;
            }
          }
        });

        if (seeded > 0) {
          flushLocations();
          if (DEBUG) console.debug('[Location] seeded', seeded, 'devices from Firebase');
        }
      } catch (e) {
        console.warn('[Location] initial DB seed failed', e);
      }
    })();

    return () => { aborted = true; };
  }, [flushLocations]);

  // ─── MQTT: connect once on mount, stable deps via useCallback ─────────────
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
      client.subscribe('esp32/#',        { qos: 1 }, (err) => { if (err) console.error('subscribe esp32/# failed', err); });
      client.subscribe('esp32/+/gps',    { qos: 1 }, (err) => { if (err) console.error('subscribe esp32/+/gps failed', err); });
      client.subscribe('esp32/gps',      { qos: 1 }, (err) => { if (err) console.error('subscribe esp32/gps failed', err); });
      client.subscribe('devices/+/meta', { qos: 1 }, (err) => { if (err) console.error('subscribe devices/+/meta failed', err); });
      client.subscribe('device/+/#',     { qos: 1 }, (err) => { if (err) console.error('subscribe device/+/# failed', err); });
    });

    client.on('reconnect', () => { if (DEBUG) console.debug('📍 LocationContext: reconnecting...'); });
    client.on('offline',   () => { if (DEBUG) console.debug('📍 LocationContext: offline'); });

    client.on('message', (topic, message) => {
      try {
        const txt = (message || '').toString();
        if (DEBUG) console.debug('📍 MQTT message', { topic, txt });

        let parsed = null;
        try { parsed = JSON.parse(txt); }
        catch (e) { parsed = txt; }

        const payloadObject = (typeof parsed === 'object' && parsed !== null) ? parsed : null;
        const id = extractIdFromTopicAndPayload(topic, payloadObject);

        // Quick path: payload contains lat & lon directly
        if (payloadObject &&
            Object.prototype.hasOwnProperty.call(payloadObject, 'lat') &&
            Object.prototype.hasOwnProperty.call(payloadObject, 'lon')) {
          const quickId = payloadObject.id ? String(payloadObject.id) : id;
          if (quickId) {
            const loc = parseLocationFromPayload(payloadObject);
            if (loc) {
              if (DEBUG) console.debug('📍 Quick accept', { topic, id: quickId, loc });
              updateDeviceLocation(quickId, loc.lat, loc.lon);
              return;
            }
          }
        }

        if (!id) {
          if (DEBUG) console.warn('📍 Message ignored: no valid id', { topic, sample: txt });
          return;
        }

        const loc = parseLocationFromPayload(payloadObject || txt);
        if (loc) {
          if (DEBUG) console.debug('📍 Parsed location', { topic, id, loc });
          updateDeviceLocation(id, loc.lat, loc.lon);
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
  }, []); // ← empty: runs once on mount. Functions are stable via useCallback above.

  // ─── Periodic prune + DB fallback ─────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(async () => {
      const now = Date.now();
      const cutoff = now - ACTIVE_CUTOFF_MS;
      const map = devicesMapRef.current;
      let clearedAny = false;

      map.forEach((d, id) => {
        if (d.lastSeen && d.lastSeen < cutoff && (d.lat !== null || d.lon !== null)) {
          if (d._usingDbFallback) {
            if (DEBUG) console.debug('[Location] skipping clear for DB-fallback device', id);
            return;
          }
          d.lat = null;
          d.lon = null;
          d._clearedForFallback = true;
          d._usingDbFallback = false;
          d.online = false;
          map.set(id, d);
          clearedAny = true;
          if (DEBUG) console.debug('[Location] device expired -> cleared live location', id);
        }
      });

      presenceRef.current.forEach((p, id) => {
        if (p.lastSeen && p.lastSeen < cutoff && p.online) {
          presenceRef.current.set(id, { online: false, lastSeen: p.lastSeen });
        }
      });

      if (clearedAny && database) {
        const promises = [];
        map.forEach((d, id) => {
          if (d._clearedForFallback && !d._usingDbFallback) {
            promises.push((async () => {
              if (DEBUG) console.debug('[Location] attempting DB fallback for', id);
              const meta = await fetchDeviceMetaFromFirebase(id);
              if (!meta) return;

              let changed = false;
              const metaNorm = normalizeLatLonPayload(meta);
              const mLatRaw = metaNorm.lat ?? metaNorm.latitude ?? metaNorm.lat_deg ?? null;
              const mLonRaw = metaNorm.lon ?? metaNorm.longitude ?? metaNorm.lng ?? null;
              const latN = Number(mLatRaw);
              const lonN = Number(mLonRaw);

              if (mLatRaw != null && mLonRaw != null && Number.isFinite(latN) && Number.isFinite(lonN) && isValidCoord(latN, lonN)) {
                d.lat = latN;
                d.lon = lonN;
                changed = true;
              }

              const address = meta.address ?? meta.street_address ?? meta.display_name ?? meta.location_name ?? meta.name ?? null;
              if (address && !d.address) { d.address = address; changed = true; }

              const metaFill = meta.fillPct ?? meta.fill_pct ?? meta.binFillPct ?? meta.fill ?? meta.fill_percent;
              if (metaFill != null && Number.isFinite(Number(metaFill)) && d.fillPct == null) {
                d.fillPct = Math.max(0, Math.min(100, Math.round(Number(metaFill))));
                d.binFull = d.fillPct >= 90;
                changed = true;
              } else if ((meta.binFull === true || meta.bin_full === true) && !d.binFull) {
                d.binFull = true;
                changed = true;
              }

              d._usingDbFallback = true;
              d._clearedForFallback = false;
              map.set(id, d);

              if (DEBUG) console.debug('[Location] DB fallback merged for', id, { lat: d.lat, lon: d.lon, address: d.address, changed });
            })());
          }
        });

        try { await Promise.all(promises); }
        catch (e) { console.warn('[Location] DB fallback error', e); }
      }

      flushLocations();
    }, PRUNE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [fetchDeviceMetaFromFirebase, flushLocations]);

  return (
    <LocationContext.Provider value={{ locations }}>
      {children}
    </LocationContext.Provider>
  );
};
