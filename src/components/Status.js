// src/components/Status.jsx (MQTT-enabled) — fixed delete flow (waits for publishes, clears retained topics, HTTP delete fire-and-forget)
import React, { useContext, useState, useEffect, useRef, useCallback } from 'react';
import mqtt from 'mqtt';
import { MetricsContext } from '../MetricsContext';
import { FiTrash2, FiPlusCircle, FiWifi, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { StyleSheet, css } from 'aphrodite';

export default function Status() {
  const { fullBinAlerts, floodRisks, activeDevices, devices } = useContext(MetricsContext);
  const [deviceAddresses, setDeviceAddresses] = useState({});

  const fetchedAddrs = useRef(new Set());
  const [expandedDevice, setExpandedDevice] = useState(null);
  const [loadingLogs, setLoadingLogs] = useState({});
  const [errorLogs, setErrorLogs] = useState({});
  const [logsMap, setLogsMap] = useState({});

  // multi-select filters
  const [filters, setFilters] = useState([]); // 'fullBin' | 'flood' | 'active'

  // responsive
  const [isNarrow, setIsNarrow] = useState(false);

  // inline confirm & deleting state
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // MQTT client state
  const clientRef = useRef(null);
  const subListenersRef = useRef(new Map()); // map deviceId->handler for temporary log subscriptions
  const pendingPublishesRef = useRef([]);    // queue publishes while disconnected
  const [mqttConnected, setMqttConnected] = useState(false);

  // topics to clear after deleting a device — templates with `{id}` placeholder
  const CLEAR_TOPIC_TEMPLATES = [
    'esp32/{id}/status',
    'esp32/{id}/sensor/detections',
    // add other topics your devices publish retained on as needed
  ];

  const displayValue = (val) => (val === null || val === undefined ? 'Loading…' : val);

  const boolish = (v) => {
    if (v === true) return true;
    if (v === false) return false;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (s === 'true' || s === '1' || s === '"true"') return true;
      if (s === 'false' || s === '0' || s === '"false"') return false;
      return false;
    }
    return Boolean(v);
  };

  // media listener setup
  const setupMediaListener = useCallback(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(max-width: 720px)');
    const handler = (e) => setIsNarrow(Boolean(e.matches));
    setIsNarrow(Boolean(mq.matches));
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
      else if (mq.removeListener) mq.removeListener(handler);
    };
  }, []);

  useEffect(() => {
    const cleanup = setupMediaListener();
    return cleanup;
  }, [setupMediaListener]);

  // MQTT connection
  useEffect(() => {
    const url = 'wss://a62b022814fc473682be5d58d05e5f97.s1.eu.hivemq.cloud:8884/mqtt';
    const options = {
      username: 'prototype',
      password: 'Prototype1',
      clean: true,
      keepalive: 60,
      reconnectPeriod: 2000,
      clientId: 'status_' + Math.random().toString(16).substr(2, 8),
    };

    const client = mqtt.connect(url, options);
    clientRef.current = client;

    client.on('connect', () => {
      console.log('Status: MQTT connected');
      setMqttConnected(true);
      // subscribe to retained meta
      client.subscribe('devices/+/meta', { qos: 1 }, (err) => {
        if (err) console.warn('Status: failed to subscribe devices/+/meta', err);
      });

      // flush queued publishes
      if (pendingPublishesRef.current.length > 0) {
        console.debug('[Status] flushing', pendingPublishesRef.current.length, 'queued publishes');
        pendingPublishesRef.current.forEach(({ topic, payload, opts }) => {
          client.publish(topic, payload, opts, (err) => {
            if (err) console.error('[Status] queued publish error', topic, err);
            else console.debug('[Status] queued publish sent', topic);
          });
        });
        pendingPublishesRef.current = [];
      }
    });

    client.on('reconnect', () => setMqttConnected(false));
    client.on('close', () => setMqttConnected(false));
    client.on('offline', () => setMqttConnected(false));

    client.on('error', (err) => console.error('Status MQTT error', err));

    return () => {
      try { client.end(true); } catch (e) {}
      clientRef.current = null;
      setMqttConnected(false);
    };
  }, []);

  // reverse geocode addresses (simple caching)
  useEffect(() => {
    devices.forEach((d) => {
      if (d.lat != null && d.lon != null && !fetchedAddrs.current.has(d.id)) {
        fetchedAddrs.current.add(d.id);
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${d.lat}&lon=${d.lon}`;
        fetch(url)
          .then((res) => res.json())
          .then((data) => {
            const street = data.address?.road || data.display_name || 'Unknown address';
            setDeviceAddresses((prev) => ({ ...prev, [d.id]: street }));
          })
          .catch(() => {
            setDeviceAddresses((prev) => ({ ...prev, [d.id]: 'Address unavailable' }));
          });
      }
    });
  }, [devices]);

  const realTimeAlerts = [];
  devices.forEach((d) => {
    if (boolish(d.binFull)) realTimeAlerts.push(`⚠️ Bin Full at Device ${d.id}`);
    if (boolish(d.flooded)) realTimeAlerts.push(`🌊 Flood Alert Detected at Device ${d.id}`);
  });

  // ---------------------------
  // Normalization helpers (unchanged)
  // ---------------------------
  function normalizeClasses(raw) {
    if (raw === undefined || raw === null) return null;
     

    const isNoneToken = (s) => {
      if (s === null || s === undefined) return true;
      const t = String(s).trim();
      return t === '' || /^none$/i.test(t) || /^null$/i.test(t);
    };

    if (typeof raw === 'string') {
      const s = raw.trim();
      if (s === '') return null;
      const parts = s.split(',').map((x) => x.trim()).filter((x) => x.length > 0 && !isNoneToken(x));
      if (parts.length === 0) return null;
      return parts.length === 1 ? parts[0] : parts;
    }

    if (Array.isArray(raw)) {
      const parts = raw
        .map((x) => (x === undefined || x === null ? '' : String(x).trim()))
        .filter((x) => x.length > 0 && !isNoneToken(x));
      if (parts.length === 0) return null;
      return parts.length === 1 ? parts[0] : parts;
    }

    if (typeof raw === 'object') {
      const entries = Object.entries(raw).map(([k, v]) => [String(k).trim(), v]);
      const kept = {};
      for (const [k, v] of entries) {
        if (isNoneToken(k)) continue;
        if (typeof v === 'number') {
          if (v > 0) kept[k] = v;
        } else if (typeof v === 'string') {
          const n = Number(v);
          if (!Number.isNaN(n) && n > 0) kept[k] = n;
          else if (!/^\d+$/.test(v) && !isNoneToken(v)) {
            kept[k] = v;
          }
        } else if (v) {
          kept[k] = v;
        }
      }
      if (Object.keys(kept).length === 0) return null;
      return kept;
    }

    const coerced = String(raw).trim();
    return coerced.length === 0 || /^none$/i.test(coerced) || /^null$/i.test(coerced) ? null : coerced;
  }
  const isDetectionPayload = (payload) => {
  if (!payload) return false;

  // If payload is a primitive (string/number) — treat as detection if it's "[]", "none", etc.
  if (typeof payload === 'string') {
    const s = payload.trim().toLowerCase();
    return s === '[]' || s === 'null' || s === 'none' || s.startsWith('{') || s.startsWith('[');
  }

  if (typeof payload === 'object') {
    // Detection outputs normally include one of these keys
    const detectionKeys = ['classes', 'detected', 'items', 'labels'];
    for (const k of detectionKeys) if (Object.prototype.hasOwnProperty.call(payload, k)) return true;

    // Some detection formats embed labels as top-level array or object with counts / names
    // Treat as detection if it has 'confidence' or 'label' keys
    if (Object.prototype.hasOwnProperty.call(payload, 'confidence') || Object.prototype.hasOwnProperty.call(payload, 'label')) return true;

    // Telemetry sensor keys commonly present in your logs — treat these as telemetry (not detection)
    const telemetryKeys = new Set(['weight_g', 'd1', 'd2', 'flooded', 'binFull', 'adc', 'avg', 'id']);
    // if object has at least one telemetry-only key and no detection keys -> telemetry
    let hasTelemetry = false;
    for (const k of Object.keys(payload)) {
      if (telemetryKeys.has(k)) { hasTelemetry = true; break; }
    }
    if (hasTelemetry) return false;

    // otherwise be permissive: if it has any string/array structure but not telemetry, assume detection
    return true;
  }

  // fall back to false
  return false;
};.
  
  const normalizeLog = (entry) => {
    if (!entry) return null;
    if (typeof entry === 'string') {
      try {
        const parsed = JSON.parse(entry);
        if (parsed && typeof parsed === 'object') return normalizeLog(parsed);
      } catch (e) {
        // not JSON
      }
    }
    if (typeof entry === 'object') {
      const ts = entry.ts ?? entry.time ?? entry.timestamp ?? null;
      const rawClasses = entry.classes ?? entry.detected ?? entry.items ?? entry.labels ?? null;
      const classes = normalizeClasses(rawClasses);
      // arrival may be set by MQTT collector or server; preserve if present
      const arrival = entry.arrival ?? null;
      return { ts, classes, arrival, raw: entry };
    }
    return { ts: null, classes: normalizeClasses(String(entry)), arrival: null, raw: entry };
  };

  const hasDetections = (log) => {
    if (!log) return false;
    const cls = log.classes;
    if (!cls) return false;
    if (Array.isArray(cls)) return cls.length > 0;
    if (typeof cls === 'string') {
      const s = cls.trim().toLowerCase();
      if (s === '' || s === 'none' || s === 'null') return false;
      return true;
    }
    if (typeof cls === 'object') return Object.keys(cls).length > 0;
    try { return String(cls).trim() !== ''; } catch (e) { return false; }
  };

  // ---------------------------
  // Animal detection helpers (NEW)
  // ---------------------------
  // conservative list of animal keywords (lowercase). Extend as needed.
  const ANIMAL_KEYWORDS = new Set([
    // explicit generic tokens so a class named "Animals" or "Animal" matches
    'animal','animals'
  ]);

  const cleanToken = (s) => {
    if (!s && s !== 0) return '';
    try {
      return String(s).toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
    } catch (e) {
      return '';
    }
  };

  const isAnimalClass = (cls) => {
    if (!cls) return false;
    // string
    if (typeof cls === 'string') {
      const tok = cleanToken(cls);
      if (!tok) return false;
      if (ANIMAL_KEYWORDS.has(tok)) return true;
      // check words inside string
      for (const w of tok.split(/\s+/)) if (ANIMAL_KEYWORDS.has(w)) return true;
      return false;
    }
    // array
    if (Array.isArray(cls)) {
      return cls.some((c) => isAnimalClass(c));
    }
    // object: check keys (class names) and string values
    if (typeof cls === 'object') {
      for (const [k, v] of Object.entries(cls)) {
        if (isAnimalClass(k)) return true;
        if (typeof v === 'string' && isAnimalClass(v)) return true;
      }
      return false;
    }
    // fallback
    return false;
  };

  // New helper: detect if this log is a retained/placeholder message where the model hasn't produced real detections yet
  const isPendingModel = (log) => {
  if (!log || !log.raw) return false;

  if (log.raw._retained === true) return true;

  // handle wrapped { raw: ... } collector style
  const nested = (typeof log.raw === 'object' && log.raw.raw !== undefined) ? log.raw.raw : log.raw;

  if (typeof nested === 'string') {
    const s = nested.trim().toLowerCase();
    if (s === '' || s === '[]' || s === 'null' || s === 'none') return true;
  }

  // If classes exist but are explicitly empty => pending
  if (Array.isArray(log.classes) && log.classes.length === 0) return true;
  if (typeof log.classes === 'object' && log.classes !== null && Object.keys(log.classes).length === 0) return true;

  return false;
};

  const getClassLabel = (log) => {
    if (!log) return 'None';
    const cls = log.classes;

    // PRIORITY: animals always win even if other waste classes are present
    if (isAnimalClass(cls)) return 'Animal Detected';

    // If there are non-animal detections, show 'Rubbish Detected'
    if (hasDetections(log)) return 'Rubbish Detected';

    // If this looks like a retained/placeholder message (model hasn't produced real labels yet)
    // show an explicit 'Awaiting detections' label instead of defaulting to 'None'.
    if (isPendingModel(log)) return 'Awaiting detections';

    // otherwise fallback to 'None'
    return 'None';
  };

  const getClassLabelShort = (log) => getClassLabel(log);

  const formatClasses = (log) => {
    if (!log) return null;
    return getClassLabel(log);
  };

  const formatLogTimestamp = (log, device) => {
    const info = parseTsInfo(log?.ts);
    // mark retained if present so user can tell these were broker-retained messages
    const retainedNote = log && log.raw && (log.raw._retained === true) ? ' (retained)' : '';

    if (info.kind === 'epoch-ms' || info.kind === 'epoch-s' || info.kind === 'iso') {
      try { return info.date.toLocaleString() + retainedNote; } catch (e) { return info.date.toString() + retainedNote; }
    }
    if (info.kind === 'uptime') {
      // uptime-style timestamps are relative; to show a wall-clock we combine with arrival (when the dashboard received the message)
      // arrival may be set per-log (recommended). If missing we fall back to device.lastSeen, which makes multiple logs appear with the same timestamp.
      const arrivalMs = (log && log.arrival) || (device && device.lastSeen) || Date.now();
      const estDate = new Date(arrivalMs);
      const uptimeStr = formatUptime(info.uptimeMs);
      try { return `${estDate.toLocaleString()} (${uptimeStr})${retainedNote}`; } catch (e) { return `${estDate.toString()} (${uptimeStr})${retainedNote}`; }
    }
    return '—';
  };

  const parseTsInfo = (rawTs) => {
    if (rawTs == null) return { kind: 'unknown' };
    if (rawTs instanceof Date && !isNaN(rawTs)) return { kind: 'epoch-ms', date: rawTs };
    if (typeof rawTs === 'number' || (typeof rawTs === 'string' && /^\d+$/.test(rawTs.trim()))) {
      const n = Number(rawTs);
      // heuristics:
      // - epoch ms are >= 1e12 (roughly year 2001+ in ms)
      // - epoch seconds are >= 1e9 and < 1e12 (year 2001+ in s)
      // - smaller numbers are likely uptime counters (ms or s depending on device)
      if (n >= 1e12) return { kind: 'epoch-ms', date: new Date(n) };
      if (n >= 1e9 && n < 1e12) return { kind: 'epoch-s', date: new Date(n * 1000) };
      if (n >= 0 && n < 1e9) return { kind: 'uptime', uptimeMs: n };
      return { kind: 'unknown' };
    }
    if (typeof rawTs === 'string') {
      const trimmed = rawTs.trim();
      const parsed = Date.parse(trimmed);
      if (!isNaN(parsed)) return { kind: 'iso', date: new Date(parsed) };
    }
    return { kind: 'unknown' };
  };

  const formatUptime = (ms) => {
    if (!isFinite(ms) || ms < 0) return 'uptime: —';
    const s = Math.floor(ms / 1000);
    const hours = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hours > 0) return `uptime: ${hours}h ${mins}m ${secs}s`;
    if (mins > 0) return `uptime: ${mins}m ${secs}s`;
    return `uptime: ${secs}s`;
  };

  const onToggleDevice = (d) => {
    if (expandedDevice === d.id) {
      setExpandedDevice(null);
      return;
    }
    setExpandedDevice(d.id);
    loadLogsForDevice(d);
  };

  const renderLogItem = (log, idx, device) => {
    if (!log) return null;
    const tsStr = log.ts ? formatLogTimestamp(log, device) : (formatLogTimestamp(log, device) || '—');
    // use the new classification-aware label (Animal Detected if any animal class is present)
    const classesLabel = getClassLabel(log);
    return (
      <div key={idx} className={css(styles.logItem)}>
        <div className={css(styles.logTimestamp)}>{tsStr || '—'}</div>
        <div className={css(styles.logClasses)}>{classesLabel}</div>
      </div>
    );
  };

  // ---------------------------
  // Logs loading (MQTT-backed)
  // ---------------------------
  const loadLogsForDevice = async (device) => {
    const id = device.id;
    if (!id) return;

    // avoid duplicate fetches
    if (logsMap[id] || loadingLogs[id]) return;

    // if logs are already embedded on the device object, use them
    if (Array.isArray(device.logs) && device.logs.length > 0) {
      const normalized = device.logs.map(normalizeLog).filter(Boolean);
      setLogsMap((m) => ({ ...m, [id]: normalized }));
      return;
    }

    // HTTP first, then MQTT fallback (unchanged)
    const tryHttpFetch = async () => {
      try {
        setLoadingLogs((m) => ({ ...m, [id]: true }));
        setErrorLogs((m) => ({ ...m, [id]: null }));

        const url = `/api/devices/${encodeURIComponent(id)}/logs`;
        const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (res.status === 404) {
          setLogsMap((m) => ({ ...m, [id]: [] }));
          return true;
        }
        if (!res.ok) {
          let body = '';
          try { body = await res.text(); } catch (e) { body = '<unreadable>'; }
          setErrorLogs((m) => ({ ...m, [id]: `Failed to load logs: ${res.status} ${res.statusText}` }));
          console.error('[Status] HTTP logs fetch failed', res.status, body);
          return false;
        }
        const json = await res.json();
        const normalized = Array.isArray(json) ? json.map(normalizeLog).filter(Boolean) : [normalizeLog(json)].filter(Boolean);
        setLogsMap((m) => ({ ...m, [id]: normalized }));
        return true;
      } catch (err) {
        console.debug('[Status] HTTP logs fetch error, falling back to MQTT', err);
        return false;
      } finally {
        setLoadingLogs((m) => ({ ...m, [id]: false }));
      }
    };

    const httpSucceeded = await tryHttpFetch();
    if (httpSucceeded) return;

    // MQTT fallback (improved)
    const client = clientRef.current;
    if (!client || !client.connected) {
      setErrorLogs((m) => ({ ...m, [id]: 'MQTT not connected' }));
      return;
    }

    setLoadingLogs((m) => ({ ...m, [id]: true }));
    setErrorLogs((m) => ({ ...m, [id]: null }));

    const collected = [];
    const topic = `esp32/${id}/sensor/detections`;

    const handler = (t, message, packet) => {
      if (t !== topic) return;
      const txt = (message || '').toString();
      try {
        console.debug('[Status MQTT] recv', t, 'retain=', !!(packet && packet.retain), 'qos=', packet ? packet.qos : '-', 'payload=', txt);
      } catch (e) {}

      let parsed = null;
      try { parsed = JSON.parse(txt); } catch (e) { parsed = txt; }

      // Always attach an arrival timestamp so each log can be shown with a distinct wall-clock when available.
      const now = Date.now();
      let payload;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // preserve any existing arrival from device if present, otherwise set arrival to now
        payload = { ...parsed, arrival: parsed.arrival ?? now };
        if (packet && packet.retain) payload._retained = true;
      } else {
        // any non-object payloads become objects with raw + arrival so we can track when we received them
        payload = { raw: parsed, arrival: now };
        if (packet && packet.retain) payload._retained = true;
      }

      collected.unshift(payload);
      if (collected.length >= 50) {
        client.removeListener('message', handler);
        client.unsubscribe(topic);
        const normalized = collected.map(normalizeLog).filter(Boolean);
        setLogsMap((m) => ({ ...m, [id]: normalized }));
        setLoadingLogs((m) => ({ ...m, [id]: false }));
      }
    };

    subListenersRef.current.set(id, handler);
    client.on('message', handler);
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) {
        console.error('[Status] subscribe failed for', topic, err);
        client.removeListener('message', handler);
        setErrorLogs((m) => ({ ...m, [id]: 'Failed to subscribe for logs' }));
        setLoadingLogs((m) => ({ ...m, [id]: false }));
      }
    });

    // allow a little more time to collect messages from broker; retained messages will all have the same original publish time
    setTimeout(() => {
      try {
        client.removeListener('message', handler);
        client.unsubscribe(topic);
      } catch (e) {}
      const normalized = collected.map(normalizeLog).filter(Boolean);
      setLogsMap((m) => ({ ...m, [id]: normalized }));
      setLoadingLogs((m) => ({ ...m, [id]: false }));
      subListenersRef.current.delete(id);
    }, 1500);
  };

  // Helper: wrap client.publish in a Promise (resolves on callback)
  const publishPromise = (topic, payload, opts = {}) => {
    const client = clientRef.current;
    if (!client) {
      // queue for later
      pendingPublishesRef.current.push({ topic, payload, opts });
      console.debug('[Status] queued publish (no client)', topic);
      return Promise.resolve({ queued: true });
    }
    return new Promise((resolve, reject) => {
      try {
        client.publish(topic, payload, opts, (err) => {
          if (err) {
            console.error('[Status] publish error for', topic, err);
            return reject(err);
          }
          console.debug('[Status] publish ok', topic);
          return resolve({ queued: false });
        });
      } catch (e) {
        console.error('[Status] publish exception for', topic, e);
        // fallback -> queue
        pendingPublishesRef.current.push({ topic, payload, opts });
        return resolve({ queued: true });
      }
    });
  };

  // delete handlers (MQTT-backed) — improved: await publishes, clear retained topics, don't block UI on HTTP
  const startDelete = (e, deviceId) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    setPendingDelete(deviceId);
  };

  const cancelDelete = (e) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    setPendingDelete(null);
  };

  const performDelete = async (e, deviceId) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    if (!deviceId) return;

    setDeleting(true);
    // keep pendingDelete visible until operation finishes so user sees it's in progress

    try {
      const delTopic = `deleted_devices/${deviceId}`;
      const metaTopic = `devices/${deviceId}/meta`;
      const metaPayload = JSON.stringify({ deleted: true, deletedAt: Date.now() });
      const opts = { qos: 1, retain: true };

      const client = clientRef.current;

      // If client is missing or disconnected, queue the publishes and inform the user.
      if (!client || !client.connected) {
        pendingPublishesRef.current.push({ topic: delTopic, payload: 'true', opts });
        pendingPublishesRef.current.push({ topic: metaTopic, payload: metaPayload, opts });
        console.debug('[Status] MQTT offline — queued delete for', deviceId);
        alert(`MQTT offline — delete queued for device ${deviceId}. It will be sent when the dashboard reconnects.`);
      } else {
        // publish delete marker + meta and wait for each to finish
        await publishPromise(delTopic, 'true', opts);
        await publishPromise(metaTopic, metaPayload, opts);

        // clear retained topics (empty payload with retain:true)
        const clearTopics = CLEAR_TOPIC_TEMPLATES.map(t => t.replace(/\{id\}/g, deviceId));
        // perform in parallel but wait for completion to give clearer log/diagnostics
        await Promise.allSettled(
          clearTopics.map(t => publishPromise(t, '', { qos: 1, retain: true }))
        );

        // attempt HTTP delete asynchronously (do not block UI). This is fire-and-forget.
        (async () => {
          try {
            const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}`, {
              method: 'DELETE',
              credentials: 'same-origin',
              headers: { Accept: 'application/json' },
            });
            if (!res.ok) {
              console.warn('[Status] HTTP delete returned', res.status);
            } else {
              console.debug('[Status] HTTP delete OK for', deviceId);
            }
          } catch (err) {
            console.warn('[Status] HTTP delete error (ignored)', err);
          }
        })();

        alert(`Device ${deviceId} marked deleted (MQTT publish confirmed).`);
      }
    } catch (err) {
      console.error('[Status] performDelete failed', err);
      alert(`Failed to delete device ${deviceId}: ${err && err.message ? err.message : String(err)}`);
      // keep pendingDelete so user can retry
      return;
    } finally {
      setDeleting(false);
      // Clear pendingDelete so the inline confirm no longer shows after success/failure handling
      setPendingDelete(null);
    }
  };

  // multi-select filters
  const toggleFilter = (type) => {
    setFilters((prev) => {
      if (prev.includes(type)) return prev.filter((p) => p !== type);
      return [...prev, type];
    });
    setExpandedDevice(null);
  };

  const clearFilters = () => setFilters([]);

  const matchesFilter = (d) => {
    if (!filters || filters.length === 0) return true;
    return filters.some((f) => {
      if (f === 'fullBin') return boolish(d.binFull) || (d.fillPct != null && Number(d.fillPct) >= 90);
      if (f === 'flood') return boolish(d.flooded);
      if (f === 'active') return boolish(d.active) || boolish(d.online);
      return false;
    });
  };

  const filteredDevices = devices.filter(matchesFilter);
  const filterLabel = (f) => (f === 'fullBin' ? 'Full Bin' : f === 'flood' ? 'Flood Alerts' : f === 'active' ? 'Active' : f);

  // Device card for mobile/narrow screens
  const DeviceCard = ({ d }) => {
    const isDisabled = boolish(d.disabled) || boolish(d.meta?.deleted) || boolish(d.deleted);
    const addr = d.lat != null && d.lon != null ? deviceAddresses[d.id] || 'Loading address…' : '—';
    const deviceLogs = Array.isArray(d.logs) && d.logs.length > 0 ? d.logs.map(normalizeLog).filter(Boolean) : (logsMap[d.id] || []);

    return (
      <div className={css(styles.deviceCard)}>
        <div className={css(styles.cardHeader)}>
          <div className={css(styles.cardTitle)}>
            <strong>{d.id}</strong>
            {isDisabled && <span className={css(styles.disabledBadge)}>Disabled</span>}
          </div>
          <div className={css(styles.cardActions)}>
            {pendingDelete === d.id ? (
              <div className={css(styles.inlineConfirm)}>
                <span>Confirm?</span>
                <button type="button" className={css(styles.confirmBtn)} onClick={(e) => performDelete(e, d.id)} disabled={deleting}>{deleting ? 'Deleting…' : 'Yes'}</button>
                <button type="button" className={css(styles.cancelBtn)} onClick={(e) => cancelDelete(e)} disabled={deleting}>No</button>
              </div>
            ) : (
              <button type="button" className={css(styles.deleteBtn)} onClick={(e) => startDelete(e, d.id)} disabled={deleting} title={deleting ? 'Deleting…' : `Delete device ${d.id}`}>
                <FiTrash2 />
              </button>
            )}
          </div>
        </div>

        <div className={css(styles.cardBody)}>
          <div><strong>Address:</strong> {addr}</div>
          <div><strong>Flooded:</strong> <span className={css(boolish(d.flooded) ? styles.alert : styles.ok)}>{boolish(d.flooded) ? 'Yes' : 'No'}</span></div>
          <div><strong>Bin Fill:</strong> {d.fillPct != null ? `${d.fillPct}%` : '-'}</div>
          <div><strong>Active:</strong> <span className={css(boolish(d.active) || boolish(d.online) ? styles.ok : styles.alert)}>{boolish(d.active) || boolish(d.online) ? 'Yes' : 'No'}</span></div>
        </div>

        <div className={css(styles.cardFooter)}>
          <button type="button" className={css(styles.expandSmallBtn)} onClick={() => onToggleDevice(d)} aria-expanded={expandedDevice === d.id}>
            {expandedDevice === d.id ? 'Hide Logs' : 'Show Logs'}
          </button>
        </div>

        {expandedDevice === d.id && (
          <div className={css(styles.logsListMobile)}>
            {loadingLogs[d.id] ? (
              <div className={css(styles.loading)}>Loading logs…</div>
            ) : errorLogs[d.id] ? (
              <div className={css(styles.error)}>Error: {errorLogs[d.id]}</div>
            ) : deviceLogs.length > 0 ? (
              deviceLogs.map((l, i) => renderLogItem(l, i, d))
            ) : (
              <div className={css(styles.noLogs)}>{mqttConnected ? 'Waiting for detection topic…' : 'No logs available'}</div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ---------------------------
  // Render
  // ---------------------------
  return (
    <div className={css(styles.statusContainer)}>
      <div className={css(styles.widgetGrid)}>
        <Widget
          icon={<FiTrash2 />}
          title="Full Bin Alerts"
          value={`${displayValue(fullBinAlerts)} Alert${fullBinAlerts === 1 ? '' : 's'}`}
          onClick={() => toggleFilter('fullBin')}
          isActive={filters.includes('fullBin')}
        />
        <Widget
          icon={<FiPlusCircle />}
          title="Flood Alerts"
          value={`${displayValue(floodRisks)} Alert${floodRisks === 1 ? '' : 's'}`}
          onClick={() => toggleFilter('flood')}
          isActive={filters.includes('flood')}
        />
        <Widget
          icon={<FiWifi />}
          title="Active Devices"
          value={`${displayValue(activeDevices)} Device${activeDevices === 1 ? '' : 's'}`}
          onClick={() => toggleFilter('active')}
          isActive={filters.includes('active')}
        />
      </div>

      {filters && filters.length > 0 && (
        <div className={css(styles.filterInfo)}>
          Showing {filteredDevices.length} of {devices.length} devices — Filters:
          <span className={css(styles.filterChips)}>
            {filters.map((f) => <span key={f} className={css(styles.filterChip)}>{filterLabel(f)}</span>)}
          </span>
          <button type="button" className={css(styles.clearBtn)} onClick={clearFilters}>Clear filters</button>
        </div>
      )}

      <div className={css(styles.deviceHealth)}>
        <h2>Device Status</h2>

        {isNarrow ? (
          <div className={css(styles.deviceCardList)}>
            {filteredDevices.length === 0 ? (
              <div className={css(styles.noData)}>No devices match the selected filter</div>
            ) : (
              filteredDevices.map((d) => <DeviceCard key={d.id} d={d} />)
            )}
          </div>
        ) : (
          <div className={css(styles.responsiveTableWrapper)}>
            <table className={css(styles.deviceTable)}>
              <thead>
                <tr className={css(styles.tableHeader)}>
                  <th>Device ID</th>
                  <th>Street Address</th>
                  <th>Flooded</th>
                  <th>Bin Full</th>
                  <th>Active</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDevices.map((d) => {
                  const isDisabled = boolish(d.disabled) || boolish(d.meta?.deleted) || boolish(d.deleted);
                  const isExpanded = expandedDevice === d.id;
                  const deviceLogs = Array.isArray(d.logs) && d.logs.length > 0 ? d.logs.map(normalizeLog).filter(Boolean) : (logsMap[d.id] || []);

                  return (
                    <React.Fragment key={d.id}>
                      <tr
                        className={css(styles.deviceRow, isDisabled ? styles.disabledRow : null)}
                        onClick={() => onToggleDevice(d)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggleDevice(d); }}
                      >
                        <td className={css(styles.deviceIdCell)}>
                          <span className={css(styles.expandIcon)}>{isExpanded ? <FiChevronUp /> : <FiChevronDown />}</span>
                          {d.id} {isDisabled && <span className={css(styles.disabledBadge)}>Disabled</span>}
                        </td>
                        <td>{d.lat != null && d.lon != null ? deviceAddresses[d.id] || 'Loading address…' : '—'}</td>
                        <td className={css(boolish(d.flooded) ? styles.alert : styles.ok)}>{boolish(d.flooded) ? 'Yes' : 'No'}</td>
                        <td className={css(boolish(d.binFull) ? styles.alert : styles.ok)}>{d.fillPct != null ? `${d.fillPct}%` : '-'}</td>
                        <td className={css(boolish(d.active) || boolish(d.online) ? styles.ok : styles.alert)}>{boolish(d.active) || boolish(d.online) ? 'Yes' : 'No'}</td>

                        <td onClick={(e) => e.stopPropagation()}>
                          {pendingDelete === d.id ? (
                            <div className={css(styles.inlineConfirm)}>
                              <span>Confirm delete?</span>
                              <button type="button" className={css(styles.confirmBtn)} onClick={(e) => performDelete(e, d.id)} disabled={deleting}>{deleting ? 'Deleting…' : 'Yes'}</button>
                              <button type="button" className={css(styles.cancelBtn)} onClick={(e) => cancelDelete(e)} disabled={deleting}>No</button>
                            </div>
                          ) : (
                            <button type="button" className={css(styles.deleteBtn)} onClick={(e) => startDelete(e, d.id)} disabled={deleting} aria-disabled={deleting} title={deleting ? 'Deleting…' : `Delete device ${d.id}`} data-test-delete={`delete-${d.id}`}>
                              <FiTrash2 />
                            </button>
                          )}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className={css(styles.expandedRow)}>
                          <td colSpan="6">
                            <div className={css(styles.expandedPanel)}>
                              <div className={css(styles.panelHeader)}>
                                <strong>Detection Logs</strong>
                                <span className={css(styles.panelSub)}>Device {d.id}</span>
                              </div>

                              {loadingLogs[d.id] ? (
                                <div className={css(styles.loading)}>Loading logs…</div>
                              ) : errorLogs[d.id] ? (
                                <div className={css(styles.error)}>Error: {errorLogs[d.id]}</div>
                              ) : deviceLogs.length > 0 ? (
                                <div className={css(styles.logsList)}>
                                  {deviceLogs.map((l, i) => renderLogItem(l, i, d))}
                                </div>
                              ) : (
                                <div className={css(styles.noLogs)}>{mqttConnected ? 'Waiting for detection topic…' : 'No logs available'}</div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {devices.length === 0 && (
                  <tr>
                    <td colSpan="6" className={css(styles.noData)}>No devices connected yet</td>
                  </tr>
                )}

                {devices.length > 0 && filteredDevices.length === 0 && (
                  <tr>
                    <td colSpan="6" className={css(styles.noData)}>No devices match the selected filter</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={css(styles.realTimeAlerts)}>
        <h2>Real-Time Alerts</h2>
        {realTimeAlerts.length > 0 ? (
          <ul className={css(styles.alertsList)}>
            {realTimeAlerts.map((msg, idx) => <li key={idx}>{msg}</li>)}
          </ul>
        ) : (
          <p>No current alerts</p>
        )}
      </div>
    </div>
  );
}

/* Widget + styles (unchanged) */
const Widget = ({ icon, title, value, onClick, isActive }) => (
  <div
    className={css(styles.widget, isActive ? styles.widgetActive : null)}
    onClick={onClick}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick && onClick(); }}
  >
    <div className={css(styles.widgetIcon)}>{icon}</div>
    <div className={css(styles.widgetText)}>
      <p className={css(styles.widgetTitle)}>{title}</p>
      <p className={css(styles.widgetValue)}>{value}</p>
    </div>
  </div>
);

const styles = StyleSheet.create({
  statusContainer: {
    flex: 1,
    padding: '24px',
    overflow: 'auto',
    backgroundColor: '#0F172A',
  },
  widgetGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '16px',
    marginBottom: '12px',
    '@media (max-width: 420px)': {
      gridTemplateColumns: '1fr',
    },
  },
  widget: {
    backgroundColor: '#1E293B',
    padding: '20px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    boxShadow: '0 4px 10px rgba(0, 0, 0, 0.2)',
    cursor: 'pointer',
    transition: 'transform 0.12s ease, box-shadow 0.12s ease, border 0.12s ease',
    outline: 'none',
    ':focus': {
      boxShadow: '0 6px 14px rgba(0,0,0,0.25)',
    },
  },
  widgetActive: {
    border: '2px solid rgba(59,130,246,0.9)',
    transform: 'translateY(-2px)',
  },
  widgetIcon: {
    fontSize: '36px',
    color: '#3B82F6',
  },
  widgetText: { color: '#F8FAFC' },
  widgetTitle: {
    fontSize: '1rem',
    fontWeight: '600',
    marginBottom: '4px',
  },
  widgetValue: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
  },

  filterInfo: {
    color: '#94A3B8',
    marginBottom: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  filterChips: { display: 'inline-flex', gap: '8px', marginLeft: '8px' },
  filterChip: {
    backgroundColor: '#0B1220',
    color: '#E2E8F0',
    padding: '6px 8px',
    borderRadius: '999px',
    fontSize: '0.85rem',
    border: '1px solid rgba(255,255,255,0.04)',
  },
  clearBtn: {
    marginLeft: '8px',
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.06)',
    color: '#94A3B8',
    padding: '6px 10px',
    borderRadius: '8px',
    cursor: 'pointer',
  },

  deviceHealth: {
    backgroundColor: '#1E293B',
    padding: '24px',
    borderRadius: '12px',
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
    marginBottom: '32px',
  },
  responsiveTableWrapper: { overflowX: 'auto', paddingBottom: '8px' },
  deviceCardList: { display: 'flex', flexDirection: 'column', gap: '12px' },
  deviceCard: {
    backgroundColor: '#0B1220',
    borderRadius: '10px',
    padding: '12px',
    border: '1px solid rgba(255,255,255,0.03)',
  },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
  cardTitle: { fontSize: '1rem', display: 'flex', gap: '8px', alignItems: 'center' },
  cardActions: { display: 'flex', gap: '8px', alignItems: 'center' },
  cardBody: { display: 'grid', gap: '6px', fontSize: '0.95rem' },
  cardFooter: { marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center' },
  expandSmallBtn: { background: 'transparent', border: '1px solid rgba(255,255,255,0.06)', padding: '6px 10px', borderRadius: '8px', color: '#E2E8F0', cursor: 'pointer' },
  logsListMobile: { marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto', paddingRight: '6px' },

  deviceTable: { width: '100%', borderCollapse: 'collapse', marginTop: '12px', marginBottom: '12px', color: '#F8FAFC', fontSize: '0.9rem', tableLayout: 'fixed' },
  tableHeader: { color: '#94A3B8', fontWeight: '600', fontSize: '1rem', textTransform: 'uppercase', padding: '12px', textAlign: 'left' },
  deviceRow: { cursor: 'pointer', ':hover': { backgroundColor: '#111827' } },
  disabledRow: { opacity: 0.5 },
  deviceIdCell: { display: 'flex', alignItems: 'center', gap: '8px' },
  expandIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginRight: '8px', color: '#94A3B8' },
  disabledBadge: { marginLeft: '8px', backgroundColor: '#374151', color: '#E5E7EB', padding: '2px 6px', borderRadius: '6px', fontSize: '0.75rem' },

  deleteBtn: { position: 'relative', zIndex: 10, background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px', color: '#F87171', ':disabled': { opacity: 0.4, cursor: 'not-allowed' } },
  inlineConfirm: { display: 'flex', gap: '8px', alignItems: 'center' },
  confirmBtn: { background: '#dc2626', color: '#fff', border: 'none', padding: '6px 8px', borderRadius: '6px', cursor: 'pointer' },
  cancelBtn: { background: '#374151', color: '#fff', border: 'none', padding: '6px 8px', borderRadius: '6px', cursor: 'pointer' },

  alert: { color: '#EF4444', fontWeight: 'bold' },
  ok: { color: '#10B981', fontWeight: 'bold' },
  noData: { color: '#94A3B8', textAlign: 'center', padding: '16px' },

  realTimeAlerts: { backgroundColor: '#1E293B', padding: '24px', borderRadius: '12px', boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)' },
  alertsList: { listStyleType: 'none', paddingLeft: '0', marginTop: '12px', fontSize: '0.95rem', lineHeight: '1.6', color: '#E2E8F0' },

  expandedRow: { backgroundColor: 'transparent' },
  expandedPanel: { padding: '12px', backgroundColor: '#0B1220', borderRadius: '8px', marginTop: '8px' },
  panelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px', color: '#E6EEF8' },
  panelSub: { color: '#94A3B8', fontSize: '0.85rem', marginLeft: '8px' },
  logsList: { display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px', overflowY: 'auto', paddingRight: '8px' },
  logItem: { display: 'grid', gridTemplateColumns: '180px 1fr', gap: '12px', alignItems: 'start', padding: '10px', borderRadius: '6px', backgroundColor: '#0F172A', border: '1px solid rgba(255,255,255,0.03)' },
  logTimestamp: { color: '#94A3B8', fontSize: '0.85rem' },
  logClasses: { color: '#E2E8F0', fontSize: '0.95rem' },
  loading: { color: '#94A3B8', padding: '12px' },
  error: { color: '#F97316', padding: '12px' },
  noLogs: { color: '#94A3B8', padding: '12px' },
});
