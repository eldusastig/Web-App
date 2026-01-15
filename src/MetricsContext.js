// src/MetricsContext.js
import React, { createContext, useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';

// Import your initialized database from your separate file.
// Adjust path/name if your firebase init file is elsewhere.
import { database } from './firebase3.js';

const DEBUG = true; // set false to reduce console noise in production

if (DEBUG) console.debug('[MetricsContext] module loaded — database present?', !!database);

export const MetricsContext = createContext({
  fullBinAlerts: null,
  floodRisks: null,
  activeDevices: null,
  devices: [],
});

export const MetricsProvider = ({ children }) => {
  const [fullBinAlerts, setFullBinAlerts] = useState(0);
  const [floodRisks, setFloodRisks] = useState(0);
  const [activeDevices, setActiveDevices] = useState(0);
  const [devices, setDevices] = useState([]);

  const clientRef = useRef(null);
  const presenceRef = useRef(new Map()); // Map<id, { online: boolean, lastSeen: number }>
  const devicesMapRef = useRef(new Map()); // Map<id, deviceObj>

  // meta fetch cache: Map<id, lastFetchTs>
  const fetchedMetaTsRef = useRef(new Map());
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes - will re-fetch after TTL

  const ACTIVE_CUTOFF_MS = 8000;
  const PRUNE_INTERVAL_MS = 2000;
  const MAX_LOGS_PER_DEVICE = 50;
  const BIN_FULL_ALERT_PCT = 90;

  // NEW: weight threshold (kg) used to determine binFull when weight is available
  const BIN_FULL_WEIGHT_KG = 8.0;

  const KNOWN_BOOL_KEYS = [
    'online',
    'active',
    'flooded',
    'flood',
    'binFull',
    'bin_full',
    'bin_full_flag',
    'collectionError',
    'collection_error',
  ];

  function normalizePayloadBooleans(p) {
    if (!p || typeof p !== 'object') return p;
    const out = { ...p };
    for (const k of KNOWN_BOOL_KEYS) {
      if (Object.prototype.hasOwnProperty.call(out, k)) {
        const v = out[k];
        if (typeof v === 'boolean') continue;
        if (typeof v === 'number') { out[k] = (v !== 0); continue; }
        if (typeof v === 'string') {
          const low = v.trim().toLowerCase();
          if (low === 'true' || low === '"true"' || low === '1') out[k] = true;
          else if (low === 'false' || low === '"false"' || low === '0') out[k] = false;
        }
      }
    }
    return out;
  }

  function parseFillPct(payload) {
    // kept for compatibility but we do NOT use fillPct as the canonical measure anymore.
    if (!payload || typeof payload !== 'object') return null;
    const candidates = ['fillPct', 'fill_pct', 'binFillPct', 'bin_fill_pct', 'fill'];
    for (const k of candidates) {
      if (Object.prototype.hasOwnProperty.call(payload, k)) {
        const v = payload[k];
        if (v === null || v === undefined) continue;
        if (typeof v === 'number' && isFinite(v)) {
          return Math.max(0, Math.min(100, Math.round(v)));
        }
        if (typeof v === 'string') {
          const num = Number(v.trim());
          if (!Number.isNaN(num)) return Math.max(0, Math.min(100, Math.round(num)));
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'binFull') || Object.prototype.hasOwnProperty.call(payload, 'bin_full')) {
      const bf = payload.binFull ?? payload.bin_full;
      if (bf === true) return 100;
      if (bf === false) return null;
    }
    return null;
  }

  function updateDeviceFromLog(id, logObj) {
    const sid = String(id);
    const now = Date.now();
    const map = devicesMapRef.current;
    let dev = map.get(sid);
    const isNew = !dev;

    if (!dev) {
      dev = {
        id: sid,
        createdAt: now,
        lastSeen: now,
        online: true,
        logs: [],
        // binFull remains as boolean flag either from payload or derived from weight
        binFull: false,
        collectionError: false,   
        flooded: false,
        // placeholders used by UI
        lat: null,
        lon: null,
        address: null,
        // canonical weight field (kg)
        weightKg: null,
        // keep fillPct only for backward compatibility / display if available
        fillPct: null,
      };
    }

    // Normalize and enrich
    const payload = (logObj && typeof logObj === 'object') ? normalizePayloadBooleans(logObj) : null;
    const pct = parseFillPct(payload || {});

    // ----- WEIGHT HANDLING: extract weight from payload using common keys and heuristics -----
    let weightKg = null;
    const tryNum = (v) => {
      if (v === undefined || v === null) return null;
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      return n;
    };

    const weightCandidates = ['weight_kg', 'weightKg', 'weight', 'wt_kg', 'weight_g', 'mass_g', 'wtg'];
    for (const k of weightCandidates) {
      if (payload && payload[k] !== undefined && payload[k] !== null) {
        const found = tryNum(payload[k]);
        if (found !== null) {
          const keyStr = String(k);

          // If key explicitly contains 'kg' -> treat value as kilograms (no conversion).
          if (/kg$/i.test(keyStr) || /_kg$/i.test(keyStr) || (/kg/i.test(keyStr) && !/_g$/i.test(keyStr))) {
            weightKg = found;
          } else if (/_g$/.test(keyStr) || /(^|_)g$/i.test(keyStr) || found > 1000) {
            // Keys like weight_g, mass_g, or very large numeric values -> convert grams -> kg
            weightKg = found / 1000.0;
          } else if (found > 100 && !/kg/i.test(keyStr)) {
            // Heuristic: numeric > 100 likely grams unless key contains 'kg'
            weightKg = found / 1000.0;
          } else {
            // Default: assume numeric is already kg
            weightKg = found;
          }

          if (DEBUG) console.debug('[MetricsContext] parsed weight candidate', { key: keyStr, raw: payload[k], weightKg });
          break;
        }
      }
    }

    // also support payload being a plain numeric value (if payload itself is a number)
    if (weightKg === null && payload && typeof payload === 'number') {
      const num = tryNum(payload);
      if (num !== null) {
        // assume it's kg if small, convert if large (heuristic)
        weightKg = num > 100 ? num / 1000.0 : num;
        if (DEBUG) console.debug('[MetricsContext] parsed numeric payload as weight', { raw: payload, weightKg });
      }
    }

    // ----- Build log entry -----
    const entry = { ...(payload || {}), raw: (!payload ? String(logObj) : undefined) };
    if (entry.ts === undefined || entry.ts === null) entry.ts = now;
    entry.arrival = now;

    // Prepend and cap
    const prevLogs = Array.isArray(dev.logs) ? dev.logs : [];
    dev.logs = [entry, ...prevLogs].slice(0, MAX_LOGS_PER_DEVICE);
    dev.lastSeen = now;
    dev.online = true;

    // ----- BIN DETERMINATION PRIORITY -----
    // Priority:
    // 1. If payload explicitly includes binFull (boolean) -> respect it.
    // 2. Else if weight available -> derive binFull from weight >= BIN_FULL_WEIGHT_KG.
    // 3. Else if fillPct present in payload -> derive binFull from fillPct >= BIN_FULL_ALERT_PCT (kept for backward compatibility).
    if (payload && typeof payload.binFull === 'boolean') {
      dev.binFull = payload.binFull;
      // If payload also contains a weight, we still store it below
    } else if (weightKg !== null) {
      dev.weightKg = Number(weightKg.toFixed(3));
      dev.binFull = (dev.weightKg >= BIN_FULL_WEIGHT_KG);
      // Also keep an estimated fillPct from weight if no explicit fill is present (optional)
      if (dev.fillPct == null) {
        // Map 0..BIN_FULL_WEIGHT_KG -> 0..90% so threshold remains meaningful
        const estPct = Math.round(Math.max(0, Math.min(100, (dev.weightKg / BIN_FULL_WEIGHT_KG) * 90)));
        dev.fillPct = estPct;
      }
    } else if (pct != null) {
      // maintain backward compatibility: payload that only provides fill% still sets binFull if >= threshold
      dev.fillPct = pct;
      dev.binFull = pct >= BIN_FULL_ALERT_PCT;
    }

    // Flooded
    if (payload && (payload.flooded === true || payload.flood === true)) {
      dev.flooded = true;
    } else if (payload && (payload.flooded === false || payload.flood === false)) {
      dev.flooded = false;
    }
    // Collection Error
    if (payload && typeof payload.collectionError === 'boolean') {
      dev.collectionError = payload.collectionError;
    }
    if (payload && typeof payload.collection_error === 'boolean') {
      dev.collectionError = payload.collection_error;
    }

    // Merge shallow metadata from payload
    if (payload && payload.name) dev.name = payload.name;
    if (payload && payload.location) dev.location = payload.location;

    // Attach lat/lon if present in payload
    if (payload) {
      if (payload.lat !== undefined && payload.lon !== undefined) {
        const latN = Number(payload.lat);
        const lonN = Number(payload.lon);
        if (Number.isFinite(latN) && Number.isFinite(lonN)) {
          dev.lat = latN;
          dev.lon = lonN;
        }
      }

      if (payload.location && typeof payload.location === 'object') {
        const L = payload.location;
        const latL = (L.lat ?? L.latitude);
        const lonL = (L.lon ?? L.lng ?? L.longitude);
        if (latL !== undefined && lonL !== undefined) {
          const latN = Number(latL);
          const lonN = Number(lonL);
          if (Number.isFinite(latN) && Number.isFinite(lonN)) {
            dev.lat = latN;
            dev.lon = lonN;
          }
        }
      }

      if (payload.gps && typeof payload.gps === 'object') {
        const G = payload.gps;
        const latG = (G.lat ?? G.latitude);
        const lonG = (G.lon ?? G.lng ?? G.longitude);
        if (latG !== undefined && lonG !== undefined) {
          const latN = Number(latG);
          const lonN = Number(lonG);
          if (Number.isFinite(latN) && Number.isFinite(lonN)) {
            dev.lat = latN;
            dev.lon = lonN;
          }
        }
      }

      if (payload.coords && typeof payload.coords === 'object') {
        const C = payload.coords;
        const latC = (C.lat ?? C.latitude ?? (Array.isArray(C) ? C[0] : undefined));
        const lonC = (C.lon ?? C.lng ?? C.longitude ?? (Array.isArray(C) ? C[1] : undefined));
        if (latC !== undefined && lonC !== undefined) {
          const latN = Number(latC);
          const lonN = Number(lonC);
          if (Number.isFinite(latN) && Number.isFinite(lonN)) {
            dev.lat = latN;
            dev.lon = lonN;
          }
        }
      }
    }

    map.set(sid, dev);

    // Update presence
    presenceRef.current.set(sid, { online: true, lastSeen: now });
    setActiveDevices(Array.from(presenceRef.current.values()).filter((p) => p.online).length);

    // Flush to state array (stable ordering: newest first by lastSeen)
    const arr = Array.from(map.values()).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    setDevices(arr);

    if (DEBUG) console.debug('[MetricsContext] updateDeviceFromLog', sid, { lat: dev.lat, lon: dev.lon, binFull: dev.binFull, weightKg: dev.weightKg, fillPct: dev.fillPct });

    return isNew;
  }

  const pushDeviceLog = (deviceId, logObj) => {
    if (!deviceId) return;
    updateDeviceFromLog(deviceId, logObj);
  };

  useEffect(() => {
    // MQTT connect and subscriptions (improved id extraction/validation)
    const url = 'wss://a62b022814fc473682be5d58d05e5f97.s1.eu.hivemq.cloud:8884/mqtt';
    const options = {
      username: 'prototype',
      password: 'Prototype1',
      clean: true,
      keepalive: 60,
      reconnectPeriod: 2000,
      clientId: 'metrics_' + Math.random().toString(16).substr(2, 8),
    };

    const client = mqtt.connect(url, options);
    clientRef.current = client;

    // Accept device IDs that look like identifiers (alphanumeric, - and _), length 2..64
    const ID_REGEX = /^[a-zA-Z0-9_-]{2,64}$/;
    const RESERVED = new Set(['sensor', 'status', 'gps', 'devices', 'meta', 'deleted_devices', 'broadcast', 'mqtt']);

    function extractIdFromTopicAndPayload(topic, payload) {
      const parts = topic.split('/').filter(Boolean);
      let candidate = null;

      // If topic looks like esp32/{deviceId}/..., consider parts[1] a candidate
      if (parts.length >= 2 && parts[0] === 'esp32') {
        candidate = parts[1];
        if (typeof candidate === 'string') {
          const low = candidate.toLowerCase();
          if (RESERVED.has(low)) candidate = null;
          else if (!ID_REGEX.test(candidate)) candidate = null;
        } else candidate = null;
      }

      // If no valid candidate from topic, try payload.id or common id fields
      if (!candidate && payload && typeof payload === 'object') {
        const idFields = ['id', 'deviceId', 'device_id', 'dev_id', 'node_id'];
        for (const f of idFields) {
          if (payload[f]) {
            const v = String(payload[f]).trim();
            if (ID_REGEX.test(v) && !RESERVED.has(v.toLowerCase())) {
              candidate = v;
              break;
            }
          }
        }
      }

      // if still no candidate, return null (we'll ignore message)
      if (DEBUG) console.debug('[MetricsContext] extractIdFromTopicAndPayload', { topic, candidate, payloadSample: payload && typeof payload === 'object' ? Object.keys(payload).slice(0,6) : payload });
      return candidate;
    }

    client.on('connect', () => {
      console.log('✅ MQTT connected (metrics)');
      // Subscribe to esp32 topics — narrow if you can to avoid irrelevant topics
      client.subscribe('esp32/#', { qos: 1 }, (err) => {
        if (err) console.error('Subscribe esp32/# failed', err);
        else if (DEBUG) console.debug('Subscribed to esp32/#');
      });
    });

    client.on('message', (topic, message) => {
      const txt = (message || '').toString();
      let payload = null;
      try { payload = JSON.parse(txt); } catch (e) { /* not JSON */ }

      const id = extractIdFromTopicAndPayload(topic, payload);
      if (!id) {
        // ignored: no valid device id found in topic or payload
        if (DEBUG) console.debug('[MetricsContext] Ignored MQTT message without valid id', { topic, sample: txt });
        return;
      }

      // If it's a detection topic, we still treat it the same way — push a log
      const logObj = payload ? { ...payload } : { raw: txt };
      if (logObj.ts === undefined || logObj.ts === null) logObj.ts = Date.now();

      updateDeviceFromLog(id, logObj);
    });

    client.on('error', (err) => console.error('MQTT error', err));

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
          changed = true;
        }
      });

      if (changed) {
        // update devices map/array
        const map = devicesMapRef.current;
        let updatedAny = false;
        presenceRef.current.forEach((p, id) => {
          const dev = map.get(String(id));
          if (dev && dev.online !== p.online) {
            dev.online = p.online;
            map.set(String(id), dev);
            updatedAny = true;
          }
        });

        if (updatedAny) {
          const arr = Array.from(map.values()).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
          setDevices(arr);
        }

        const activeNow = Array.from(presenceRef.current.values()).filter((p) => p.online).length;
        setActiveDevices(activeNow);
      }
    }, PRUNE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setFullBinAlerts(devices.filter((d) => {
      // count explicit binFull OR weight-based binFull
      if (d && d.binFull === true) return true;
      if (d && typeof d.weightKg === 'number' && d.weightKg >= BIN_FULL_WEIGHT_KG) return true;
      return false;
    }).length);

    setFloodRisks(devices.filter((d) => d.flooded).length);
  }, [devices]);

  // -----------------------------
  // Firebase: fetch metadata for devices that are inactive (with timestamped cache)
  // -----------------------------
  async function fetchDeviceMetaFromFirebase(id) {
    if (!id) return null;

    // check cache TTL
    const lastTs = fetchedMetaTsRef.current.get(id);
    if (lastTs && (Date.now() - lastTs) < CACHE_TTL_MS) {
      if (DEBUG) console.debug('[MetricsContext] fetchDeviceMetaFromFirebase: cache hit, skipping fetch for', id);
      return null;
    }
    // mark attempted fetch time immediately to avoid concurrent repeats
    fetchedMetaTsRef.current.set(id, Date.now());

    if (!database) {
      // Try dynamic import of your firebase init module as a fallback
      if (DEBUG) console.warn('[MetricsContext] no Firebase database instance available — attempting dynamic import of firebase3.js');
      try {
        const mod = await import('./firebase3.js');
        // update local `database` reference if available in module (note: does not rebind the imported name)
        const dynamicDb = mod.database || null;
        if (!dynamicDb) {
          if (DEBUG) console.warn('[MetricsContext] dynamic import returned no database instance');
          return null;
        }
        // Use dynamicDb for this fetch
        return await doDbFetch(dynamicDb, id);
      } catch (err) {
        console.error('[MetricsContext] dynamic import of firebase3.js failed', err);
        return null;
      }
    }

    // use statically imported database
    return await doDbFetch(database, id);
  }

  // helper to perform the DB read
  async function doDbFetch(dbInstance, id) {
    try {
      const { ref: dbRefFunc, get: dbGetFunc } = await import('firebase/database').then(m => ({ ref: m.ref, get: m.get }));
      const path1 = `devices/${id}/meta`;
      const snapshot1 = await dbGetFunc(dbRefFunc(dbInstance, path1));
      if (snapshot1.exists()) {
        if (DEBUG) console.debug('[MetricsContext] fetched meta from', path1, snapshot1.val());
        return snapshot1.val();
      }
      const path2 = `devices/${id}`;
      const snapshot2 = await dbGetFunc(dbRefFunc(dbInstance, path2));
      if (snapshot2.exists()) {
        if (DEBUG) console.debug('[MetricsContext] fetched meta from', path2, snapshot2.val());
        return snapshot2.val();
      }
      if (DEBUG) console.debug('[MetricsContext] no firebase meta for', id);
      return null;
    } catch (err) {
      console.error('[MetricsContext] Firebase fetch error for', id, err);
      return null;
    }
  }

  // When devices list updates, check for offline devices and fetch DB-stored metadata
  useEffect(() => {
    if (!devices || devices.length === 0) return;

    devices.forEach((d) => {
      const id = d.id;
      // consider offline when both online and active flags are false/undefined
      const isOffline = !(d.online === true || d.active === true);
      if (isOffline) {
        // fetch once per TTL & merge
        fetchDeviceMetaFromFirebase(id).then((meta) => {
          if (!meta) return;
          const map = devicesMapRef.current;
          const dev = map.get(String(id));
          if (!dev) return;

          let changed = false;

          // Prefer meta.address OR common alternatives
          const address = meta.address ?? meta.street_address ?? meta.display_name ?? meta.location_name ?? meta.name;
          if (address && !dev.address) {
            dev.address = address;
            changed = true;
          }

          // Prefer meta weight if present
          const metaWeightCandidates = ['weight_kg', 'weightKg', 'weight', 'wt_kg', 'weight_g', 'mass_g', 'wtg'];
          for (const k of metaWeightCandidates) {
            if (meta[k] !== undefined && meta[k] !== null) {
              const n = Number(meta[k]);
              if (Number.isFinite(n)) {
                const keyStr = String(k);
                let wkg = n;

                if (/kg$/i.test(keyStr) || /_kg$/i.test(keyStr) || (/kg/i.test(keyStr) && !/_g$/i.test(keyStr))) {
                  // value is already in kilograms
                  wkg = n;
                } else if (/_g$/.test(keyStr) || /(^|_)g$/i.test(keyStr) || n > 1000) {
                  // grams-like key or very large number -> convert to kg
                  wkg = n / 1000.0;
                } else if (n > 100 && !/kg/i.test(keyStr)) {
                  // heuristic: >100 likely grams
                  wkg = n / 1000.0;
                } else {
                  // otherwise assume already kg
                  wkg = n;
                }

                dev.weightKg = Number(wkg.toFixed(3));
                // update binFull from weight if not already true
                if (!dev.binFull) dev.binFull = dev.weightKg >= BIN_FULL_WEIGHT_KG;
                changed = true;
                if (DEBUG) console.debug('[MetricsContext] merged meta weight', { id, key: keyStr, raw: meta[k], weightKg: dev.weightKg });
                break;
              }
            }
          }

          // Prefer binFull flag in meta
          if ((meta.binFull === true || meta.bin_full === true) && (dev.binFull !== true)) {
            dev.binFull = true;
            changed = true;
          }

          // Merge lat/lon if not present in live object
          const mLat = meta.lat ?? meta.latitude;
          const mLon = meta.lon ?? meta.longitude ?? meta.lng;
          if ((mLat !== undefined && mLon !== undefined) && (!Number.isFinite(dev.lat) || !Number.isFinite(dev.lon))) {
            const latN = Number(mLat);
            const lonN = Number(mLon);
            if (Number.isFinite(latN) && Number.isFinite(lonN)) {
              dev.lat = latN;
              dev.lon = lonN;
              changed = true;
            }
          }

          if (changed) {
            map.set(String(id), dev);
            const arr = Array.from(map.values()).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
            setDevices(arr);
            if (DEBUG) console.debug('[MetricsContext] merged DB metadata for offline device', id, { address: dev.address, weightKg: dev.weightKg, lat: dev.lat, lon: dev.lon });
          }
        }).catch((e) => {
          console.debug('[MetricsContext] fetchDeviceMetaFromFirebase failed for', id, e);
        });
      }
    });
  }, [devices]);

  return (
    <MetricsContext.Provider value={{ fullBinAlerts, floodRisks, activeDevices, devices, pushDeviceLog }}>
      {children}
    </MetricsContext.Provider>
  );
};


