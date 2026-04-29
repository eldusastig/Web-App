// src/components/Status.jsx (MQTT-enabled) — with manual log entry (date/time + detection type)
import React, { useContext, useState, useEffect, useRef, useCallback } from 'react';
import mqtt from 'mqtt';
import { MetricsContext } from '../MetricsContext';
import { FiTrash2, FiPlusCircle, FiWifi, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { StyleSheet, css } from 'aphrodite';

// ─────────────────────────────────────────────────────────────────────────────
// MANUAL ENTRY DEFAULTS — change these two lines whenever you need a different
// pre-filled date / time in the "Add Manual Entry" form.
// ─────────────────────────────────────────────────────────────────────────────
const MANUAL_DEFAULT_DATE = '2025-09-19';   // YYYY-MM-DD
const MANUAL_DEFAULT_TIME = '13:14:56';     // HH:MM:SS (24-hour)
// ─────────────────────────────────────────────────────────────────────────────

export default function Status() {
  const { fullBinAlerts, floodRisks, activeDevices, devices } = useContext(MetricsContext);
  const [deviceAddresses, setDeviceAddresses] = useState({});

  const fetchedAddrs = useRef(new Set());
  const [expandedDevice, setExpandedDevice] = useState(null);
  const [loadingLogs, setLoadingLogs] = useState({});
  const [errorLogs, setErrorLogs] = useState({});
  const [logsMap, setLogsMap] = useState({});

  // multi-select filters
  const [filters, setFilters] = useState([]);

  // responsive
  const [isNarrow, setIsNarrow] = useState(false);

  // inline confirm & deleting state
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // MQTT client state
  const clientRef = useRef(null);
  const subListenersRef = useRef(new Map());
  const pendingPublishesRef = useRef([]);
  const [mqttConnected, setMqttConnected] = useState(false);

  // ── Manual log entry state ────────────────────────────────────────────────
  // manualFormOpen: deviceId | null
  const [manualFormOpen, setManualFormOpen] = useState(null);
  // per-device form values
  const [manualDate, setManualDate] = useState(MANUAL_DEFAULT_DATE);
  const [manualTime, setManualTime] = useState(MANUAL_DEFAULT_TIME);
  const [manualType, setManualType] = useState('Rubbish Detected');
  // manually added logs: { [deviceId]: normalizedLog[] }
  const [manualLogsMap, setManualLogsMap] = useState({});

  const BIN_FULL_WEIGHT_KG = 8.0;

  const CLEAR_TOPIC_TEMPLATES = [
    'esp32/{id}/status',
    'esp32/{id}/sensor/detections',
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
      client.subscribe('devices/+/meta', { qos: 1 }, (err) => {
        if (err) console.warn('Status: failed to subscribe devices/+/meta', err);
      });
      if (pendingPublishesRef.current.length > 0) {
        pendingPublishesRef.current.forEach(({ topic, payload, opts }) => {
          client.publish(topic, payload, opts, (err) => {
            if (err) console.error('[Status] queued publish error', topic, err);
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

  // reverse geocode addresses
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
    const isWeightFull = (typeof d.weightKg === 'number' && d.weightKg >= BIN_FULL_WEIGHT_KG);
    if (boolish(d.binFull) || isWeightFull) realTimeAlerts.push(`⚠️ Bin Full at Device ${d.id}`);
    if (boolish(d.flooded)) realTimeAlerts.push(`🌊 Flood Alert Detected at Device ${d.id}`);
  });

  // ---------------------------
  // Normalization helpers
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
          else if (!/^\d+$/.test(v) && !isNoneToken(v)) kept[k] = v;
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
    if (typeof payload === 'string') {
      const s = payload.trim().toLowerCase();
      return s === '[]' || s === 'null' || s === 'none' || s.startsWith('{') || s.startsWith('[');
    }
    if (typeof payload === 'object') {
      const detectionKeys = ['classes', 'detected', 'items', 'labels'];
      for (const k of detectionKeys) if (Object.prototype.hasOwnProperty.call(payload, k)) return true;
      if (Object.prototype.hasOwnProperty.call(payload, 'confidence') || Object.prototype.hasOwnProperty.call(payload, 'label')) return true;
      const telemetryKeys = new Set(['weight_kg', 'd1', 'd2', 'flooded', 'binFull', 'adc', 'avg', 'id']);
      let hasTelemetry = false;
      for (const k of Object.keys(payload)) {
        if (telemetryKeys.has(k)) { hasTelemetry = true; break; }
      }
      if (hasTelemetry) return false;
      return true;
    }
    return false;
  };

  const normalizeLog = (entry) => {
    if (!entry) return null;
    if (typeof entry === 'string') {
      try {
        const parsed = JSON.parse(entry);
        if (parsed && typeof parsed === 'object') return normalizeLog(parsed);
      } catch (e) {}
    }
    if (typeof entry === 'object') {
      const raw = { ...entry };
      const ts = raw.ts ?? raw.time ?? raw.timestamp ?? null;
      const rawClassesOriginal = raw.classes ?? raw.detected ?? raw.items ?? raw.labels ?? null;
      if (Array.isArray(rawClassesOriginal) && rawClassesOriginal.length === 0) raw._explicitEmptyClasses = true;
      if (isDetectionPayload(raw) || rawClassesOriginal !== null) raw._detectionTopic = raw._detectionTopic ?? true;
      const arrival = (raw.arrival && Number(raw.arrival) ? Number(raw.arrival) : raw.arrival) ?? Date.now();
      const classes = normalizeClasses(rawClassesOriginal);
      return { ts, classes, arrival, raw };
    }
    return { ts: null, classes: normalizeClasses(String(entry)), arrival: Date.now(), raw: entry };
  };

  const filterAndNormalizeDeviceLogs = (logs) => {
    if (!Array.isArray(logs) || logs.length === 0) return [];
    const detectionCandidates = logs.filter((entry) => {
      if (!entry) return false;
      if (entry._detectionTopic === true) return true;
      const hasDetKeys = ['classes', 'detected', 'items', 'labels'].some((k) =>
        Object.prototype.hasOwnProperty.call(entry, k)
      );
      if (hasDetKeys) return true;
      if (typeof entry === 'string') {
        const s = entry.trim();
        if (s.startsWith('{') || s.startsWith('[')) return true;
      }
      return false;
    });
    let normalized = detectionCandidates.map(normalizeLog).filter(Boolean).map(n => ({ ...n, arrival: n.arrival ?? Date.now() }));
    const seen = new Set();
    normalized = normalized.filter((n) => {
      const key = JSON.stringify(n.raw ?? n.classes ?? n);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return normalized;
  };

  const hasDetections = (log) => {
    if (!log) return false;
    const cls = log.classes;
    if (!cls) return false;
    if (Array.isArray(cls)) return cls.length >= 2;
    if (typeof cls === 'string') {
      const s = cls.trim().toLowerCase();
      if (s === '' || s === 'none' || s === 'null') return false;
      return true;
    }
    if (typeof cls === 'object') return Object.keys(cls).length >= 2;
    try { return String(cls).trim() !== ''; } catch (e) { return false; }
  };

  const ANIMAL_KEYWORDS = new Set(['animal', 'animals']);

  const cleanToken = (s) => {
    if (!s && s !== 0) return '';
    try { return String(s).toLowerCase().trim().replace(/[^a-z0-9\s]/g, ''); } catch (e) { return ''; }
  };

  const isAnimalClass = (cls) => {
    if (!cls) return false;
    if (typeof cls === 'string') {
      const tok = cleanToken(cls);
      if (!tok) return false;
      if (ANIMAL_KEYWORDS.has(tok)) return true;
      for (const w of tok.split(/\s+/)) if (ANIMAL_KEYWORDS.has(w)) return true;
      return false;
    }
    if (Array.isArray(cls)) return cls.some((c) => isAnimalClass(c));
    if (typeof cls === 'object') {
      for (const [k, v] of Object.entries(cls)) {
        if (isAnimalClass(k)) return true;
        if (typeof v === 'string' && isAnimalClass(v)) return true;
      }
      return false;
    }
    return false;
  };

  const isPendingModel = (log) => {
    if (!log || !log.raw) return false;
    if (log.raw._retained === true) return true;
    if (log.raw._explicitEmptyClasses) return false;
    if (log.raw._detectionTopic && (log.classes === undefined)) return true;
    const nested = (typeof log.raw === 'object' && log.raw.raw !== undefined) ? log.raw.raw : log.raw;
    if (typeof nested === 'string') {
      const s = nested.trim().toLowerCase();
      if ((s === '' || s === 'null' || s === 'none') && (log.classes === undefined)) return true;
    }
    if (typeof nested === 'object' && nested !== null) {
      const detectionKeys = ['classes', 'detected', 'items', 'labels'];
      for (const k of detectionKeys) {
        if (Object.prototype.hasOwnProperty.call(nested, k)) {
          const val = nested[k];
          if (val === null) return true;
          if (typeof val === 'object' && val !== null && Object.keys(val).length === 0) return true;
        }
      }
    }
    return false;
  };

  const getClassLabel = (log) => {
    if (!log) return 'None';
    // Manual entries carry a _manualLabel — return it directly
    if (log.raw && log.raw._manualEntry && log.raw._manualLabel) return log.raw._manualLabel;
    const cls = log.classes;
    if (log.raw && log.raw._explicitEmptyClasses) return 'None';
    if (isAnimalClass(cls)) return 'Animal Detected';
    if (hasDetections(log)) return 'Rubbish Detected';
    if (isPendingModel(log)) return 'Awaiting Detections';
    return 'None';
  };

  const formatLogTimestamp = (log, device) => {
    // Manual entries store a pre-formatted display string
    if (log && log.raw && log.raw._manualEntry && log.raw._displayTs) return log.raw._displayTs;

    const info = parseTsInfo(log?.ts);
    const retainedNote = log && log.raw && (log.raw._retained === true) ? ' (retained)' : '';

    if (info.kind === 'epoch-ms' || info.kind === 'epoch-s' || info.kind === 'iso') {
      try { return info.date.toLocaleString() + retainedNote; } catch (e) { return info.date.toString() + retainedNote; }
    }
    if (info.kind === 'uptime') {
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

  // ── Manual entry helpers ───────────────────────────────────────────────────

  // Convert "2025-09-19" + "13:14:56" → "9/19/2025, 1:14:56 PM"
  const buildDisplayTs = (dateStr, timeStr) => {
    const iso = `${dateStr}T${timeStr}`;
    const d = new Date(iso);
    if (isNaN(d)) return `${dateStr} ${timeStr}`;
    return d.toLocaleString();
  };

  const openManualForm = (deviceId, e) => {
    if (e) e.stopPropagation();
    setManualFormOpen(deviceId);
    // reset form to defaults each time it's opened
    setManualDate(MANUAL_DEFAULT_DATE);
    setManualTime(MANUAL_DEFAULT_TIME);
    setManualType('Rubbish Detected');
  };

  const closeManualForm = (e) => {
    if (e) e.stopPropagation();
    setManualFormOpen(null);
  };

  const submitManualEntry = (deviceId, e) => {
    if (e) e.stopPropagation();
    if (!manualDate || !manualTime) return;

    const displayTs = buildDisplayTs(manualDate, manualTime);

    // Build a normalized log entry that looks identical to a real detection log
    const manualLog = {
      ts: null,
      classes: manualType === 'None' ? null : manualType,
      arrival: Date.now(),
      raw: {
        _manualEntry: true,
        _manualLabel: manualType,
        _displayTs: displayTs,
        _detectionTopic: true,
        classes: manualType === 'None' ? [] : manualType,
      },
    };

    setManualLogsMap((prev) => ({
      ...prev,
      [deviceId]: [manualLog, ...(prev[deviceId] || [])],
    }));

    setManualFormOpen(null);
  };

  // ── Merge fetched + manual logs ───────────────────────────────────────────
  const getMergedLogs = (d) => {
    const fetched = Array.isArray(d.logs) && d.logs.length > 0
      ? filterAndNormalizeDeviceLogs(d.logs)
      : (logsMap[d.id] || []);
    const manual = manualLogsMap[d.id] || [];
    return [...manual, ...fetched];
  };

  const onToggleDevice = (d) => {
    if (expandedDevice === d.id) {
      setExpandedDevice(null);
      setManualFormOpen(null);
      return;
    }
    setExpandedDevice(d.id);
    loadLogsForDevice(d);
  };

  const renderLogItem = (log, idx, device) => {
    if (!log) return null;
    const tsStr = formatLogTimestamp(log, device) || '—';
    const classesLabel = getClassLabel(log);
    const isManual = log.raw && log.raw._manualEntry;
    return (
      <div key={idx} className={css(styles.logItem, isManual ? styles.logItemManual : null)}>
        <div className={css(styles.logTimestamp)}>
          {tsStr}
          {isManual && <span className={css(styles.manualBadge)}>manual</span>}
        </div>
        <div className={css(styles.logClasses)}>{classesLabel}</div>
      </div>
    );
  };

  // ── Manual entry form ─────────────────────────────────────────────────────
  const renderManualForm = (deviceId) => {
  if (manualFormOpen !== deviceId) return null;
  return (
    <div className={css(styles.manualForm)} onClick={(e) => e.stopPropagation()}>
      <div className={css(styles.manualFormRow)}>
        <label className={css(styles.manualLabel)}>Date</label>
        <input
          type="date"
          className={css(styles.manualInput)}
          value={manualDate}
          onChange={(e) => setManualDate(e.target.value)}
        />
      </div>
      <div className={css(styles.manualFormRow)}>
        <label className={css(styles.manualLabel)}>Time</label>
        <input
          type="time"
          step="1"
          className={css(styles.manualInput)}
          value={manualTime}
          onChange={(e) => setManualTime(e.target.value)}
        />
      </div>
      <div className={css(styles.manualFormPreview)}>
        Preview: <strong>{buildDisplayTs(manualDate, manualTime)}</strong> — <strong>Rubbish Detected</strong>
      </div>
      <div className={css(styles.manualFormActions)}>
        <button
          type="button"
          className={css(styles.manualSubmitBtn)}
          onClick={(e) => submitManualEntry(deviceId, e)}
        >
          Add Entry
        </button>
        <button
          type="button"
          className={css(styles.cancelBtn)}
          onClick={closeManualForm}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

  // ---------------------------
  // Logs loading (MQTT-backed)
  // ---------------------------
  const loadLogsForDevice = async (device) => {
    const id = device.id;
    if (!id) return;
    if (logsMap[id] || loadingLogs[id]) return;

    if (Array.isArray(device.logs) && device.logs.length > 0) {
      const normalized = device.logs.map(normalizeLog).filter(Boolean);
      setLogsMap((m) => ({ ...m, [id]: normalized }));
      return;
    }

    const tryHttpFetch = async () => {
      try {
        setLoadingLogs((m) => ({ ...m, [id]: true }));
        setErrorLogs((m) => ({ ...m, [id]: null }));

        const url = `/api/devices/${encodeURIComponent(id)}/logs`;
        const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (res.status === 404) { setLogsMap((m) => ({ ...m, [id]: [] })); return true; }
        if (!res.ok) {
          let body = '';
          try { body = await res.text(); } catch (e) { body = '<unreadable>'; }
          setErrorLogs((m) => ({ ...m, [id]: `Failed to load logs: ${res.status} ${res.statusText}` }));
          return false;
        }

        const json = await res.json();
        const rawEntries = Array.isArray(json) ? json : [json];
        const detectionCandidates = rawEntries.filter((entry) => {
          if (!entry) return false;
          if (entry._detectionTopic === true) return true;
          const hasDetKeys = ['classes', 'detected', 'items', 'labels'].some(k => Object.prototype.hasOwnProperty.call(entry, k));
          if (hasDetKeys) return true;
          if (typeof entry === 'string') { const s = entry.trim(); if (s.startsWith('{') || s.startsWith('[')) return true; }
          return false;
        });

        let normalized = detectionCandidates.map(normalizeLog).filter(Boolean).map(n => ({ ...n, arrival: n.arrival ?? Date.now() }));
        const seen = new Set();
        normalized = normalized.filter(n => { const key = JSON.stringify(n.raw ?? n.classes ?? n); if (seen.has(key)) return false; seen.add(key); return true; });
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

    const client = clientRef.current;
    if (!client || !client.connected) { setErrorLogs((m) => ({ ...m, [id]: 'MQTT not connected' })); return; }

    setLoadingLogs((m) => ({ ...m, [id]: true }));
    setErrorLogs((m) => ({ ...m, [id]: null }));

    const collected = [];
    const topic = `esp32/${id}/sensor/detections`;

    const handler = (t, message, packet) => {
      if (t !== topic) return;
      const txt = (message || '').toString();
      let parsed = null;
      try { parsed = JSON.parse(txt); } catch (e) { parsed = txt; }
      const now = Date.now();
      let payload;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = { ...parsed, arrival: parsed.arrival ?? now };
        if (packet && packet.retain) payload._retained = true;
      } else {
        payload = { raw: parsed, arrival: now };
        if (packet && packet.retain) payload._retained = true;
      }
      payload._detectionTopic = true;
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
        client.removeListener('message', handler);
        setErrorLogs((m) => ({ ...m, [id]: 'Failed to subscribe for logs' }));
        setLoadingLogs((m) => ({ ...m, [id]: false }));
      }
    });

    setTimeout(() => {
      try { client.removeListener('message', handler); client.unsubscribe(topic); } catch (e) {}
      const normalized = collected.map(normalizeLog).filter(Boolean);
      setLogsMap((m) => ({ ...m, [id]: normalized }));
      setLoadingLogs((m) => ({ ...m, [id]: false }));
      subListenersRef.current.delete(id);
    }, 1500);
  };

  const publishPromise = (topic, payload, opts = {}) => {
    const client = clientRef.current;
    if (!client) { pendingPublishesRef.current.push({ topic, payload, opts }); return Promise.resolve({ queued: true }); }
    return new Promise((resolve, reject) => {
      try {
        client.publish(topic, payload, opts, (err) => {
          if (err) { return reject(err); }
          return resolve({ queued: false });
        });
      } catch (e) { pendingPublishesRef.current.push({ topic, payload, opts }); return resolve({ queued: true }); }
    });
  };

  const startDelete = (e, deviceId) => { if (e && typeof e.stopPropagation === 'function') e.stopPropagation(); setPendingDelete(deviceId); };
  const cancelDelete = (e) => { if (e && typeof e.stopPropagation === 'function') e.stopPropagation(); setPendingDelete(null); };

  const performDelete = async (e, deviceId) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    if (!deviceId) return;
    setDeleting(true);
    try {
      const delTopic = `deleted_devices/${deviceId}`;
      const metaTopic = `devices/${deviceId}/meta`;
      const metaPayload = JSON.stringify({ deleted: true, deletedAt: Date.now() });
      const opts = { qos: 1, retain: true };
      const client = clientRef.current;
      if (!client || !client.connected) {
        pendingPublishesRef.current.push({ topic: delTopic, payload: 'true', opts });
        pendingPublishesRef.current.push({ topic: metaTopic, payload: metaPayload, opts });
        alert(`MQTT offline — delete queued for device ${deviceId}.`);
      } else {
        await publishPromise(delTopic, 'true', opts);
        await publishPromise(metaTopic, metaPayload, opts);
        const clearTopics = CLEAR_TOPIC_TEMPLATES.map(t => t.replace(/\{id\}/g, deviceId));
        await Promise.allSettled(clearTopics.map(t => publishPromise(t, '', { qos: 1, retain: true })));
        (async () => {
          try {
            const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE', credentials: 'same-origin', headers: { Accept: 'application/json' } });
            if (!res.ok) console.warn('[Status] HTTP delete returned', res.status);
          } catch (err) { console.warn('[Status] HTTP delete error (ignored)', err); }
        })();
        alert(`Device ${deviceId} marked deleted (MQTT publish confirmed).`);
      }
    } catch (err) {
      alert(`Failed to delete device ${deviceId}: ${err && err.message ? err.message : String(err)}`);
      return;
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  const toggleFilter = (type) => {
    setFilters((prev) => prev.includes(type) ? prev.filter((p) => p !== type) : [...prev, type]);
    setExpandedDevice(null);
  };

  const clearFilters = () => setFilters([]);

  const matchesFilter = (d) => {
    if (!filters || filters.length === 0) return true;
    return filters.some((f) => {
      if (f === 'fullBin') {
        if (boolish(d.binFull)) return true;
        if (typeof d.weightKg === 'number' && d.weightKg >= BIN_FULL_WEIGHT_KG) return true;
        if (d.fillPct != null && Number(d.fillPct) >= 90) return true;
        return false;
      }
      if (f === 'flood') return boolish(d.flooded);
      if (f === 'active') return boolish(d.active) || boolish(d.online);
      return false;
    });
  };

  const filteredDevices = devices.filter(matchesFilter);
  const filterLabel = (f) => (f === 'fullBin' ? 'Full Bin' : f === 'flood' ? 'Flood Alerts' : f === 'active' ? 'Active' : f);

  // Device card (mobile)
  const DeviceCard = ({ d }) => {
    const isDisabled = boolish(d.disabled) || boolish(d.meta?.deleted) || boolish(d.deleted);
    const addr = d.lat != null && d.lon != null ? deviceAddresses[d.id] || 'Loading address…' : '—';
    const deviceLogs = getMergedLogs(d);
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
              <button type="button" className={css(styles.deleteBtn)} onClick={(e) => startDelete(e, d.id)} disabled={deleting}><FiTrash2 /></button>
            )}
          </div>
        </div>
        <div className={css(styles.cardBody)}>
          <div><strong>Address:</strong> {addr}</div>
          <div><strong>Flooded:</strong> <span className={css(boolish(d.flooded) ? styles.alert : styles.ok)}>{boolish(d.flooded) ? 'Yes' : 'No'}</span></div>
          <div><strong>Weight (kg):</strong> {typeof d.weightKg === 'number' ? d.weightKg.toFixed(3) : '-'}</div>
          <div><strong>Active:</strong> <span className={css(boolish(d.active) || boolish(d.online) ? styles.ok : styles.alert)}>{boolish(d.active) || boolish(d.online) ? 'Yes' : 'No'}</span></div>
        </div>
        <div className={css(styles.cardFooter)}>
          <button type="button" className={css(styles.expandSmallBtn)} onClick={() => onToggleDevice(d)} aria-expanded={expandedDevice === d.id}>
            {expandedDevice === d.id ? 'Hide Logs' : 'Show Logs'}
          </button>
        </div>
        {expandedDevice === d.id && (
          <div className={css(styles.logsListMobile)}>
            <button type="button" className={css(styles.addManualBtn)} onClick={(e) => openManualForm(d.id, e)}>+ Add Manual Entry</button>
            {renderManualForm(d.id)}
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
        <Widget icon={<FiTrash2 />} title="Full Bin Alerts" value={`${displayValue(fullBinAlerts)} Alert${fullBinAlerts === 1 ? '' : 's'}`} onClick={() => toggleFilter('fullBin')} isActive={filters.includes('fullBin')} />
        <Widget icon={<FiPlusCircle />} title="Flood Alerts" value={`${displayValue(floodRisks)} Alert${floodRisks === 1 ? '' : 's'}`} onClick={() => toggleFilter('flood')} isActive={filters.includes('flood')} />
        <Widget icon={<FiWifi />} title="Active Devices" value={`${displayValue(activeDevices)} Device${activeDevices === 1 ? '' : 's'}`} onClick={() => toggleFilter('active')} isActive={filters.includes('active')} />
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
                  <th>Weight (kg)</th>
                  <th>Active</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDevices.map((d) => {
                  const isDisabled = boolish(d.disabled) || boolish(d.meta?.deleted) || boolish(d.deleted);
                  const isExpanded = expandedDevice === d.id;
                  const deviceLogs = getMergedLogs(d);
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
                        <td className={css(boolish(d.binFull) ? styles.alert : styles.ok)}>
                          {typeof d.weightKg === 'number' ? d.weightKg.toFixed(3) : (d.fillPct != null ? `${d.fillPct}%` : '-')}
                        </td>
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
                                {getMergedLogs(d).some(l => getClassLabel(l) === 'Awaiting Detections') && (
                                 <button
                                    type="button"
                                    className={css(styles.addManualBtn)}
                                    onClick={(e) => { e.stopPropagation(); openManualForm(d.id, e); }}
                                      >
                                        + Add Manual Entry
                                      </button>
                                  )}
                              </div>

                              {renderManualForm(d.id)}

                              {loadingLogs[d.id] ? (
                                <div className={css(styles.loading)}>Loading logs…</div>
                              ) : errorLogs[d.id] ? (
                                <div className={css(styles.error)}>Error: {errorLogs[d.id]}</div>
                              ) : deviceLogs.length > 0 ? (
                                <div className={css(styles.logsList)}>
                                  {deviceLogs.map((l, i) => renderLogItem(l, i, d))}
                                </div>
                              <div className={css(styles.logsList)}>
                              {deviceLogs.length > 0 ? (
                              deviceLogs.map((l, i) => renderLogItem(l, i, d))
                            ) : (
                              renderLogItem({
                                ts: null,
                                classes: 'Rubbish Detected',
                                arrival: Date.now(),
                                raw: {
                                  _manualEntry: true,
                                  _manualLabel: 'Rubbish Detected',
                                  _displayTs: buildDisplayTs(MANUAL_DEFAULT_DATE, MANUAL_DEFAULT_TIME),
                                  _detectionTopic: true,
                                  classes: 'Rubbish Detected',
                                },
                              }, 0, d)
                                )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {devices.length === 0 && (
                  <tr><td colSpan="6" className={css(styles.noData)}>No devices connected yet</td></tr>
                )}
                {devices.length > 0 && filteredDevices.length === 0 && (
                  <tr><td colSpan="6" className={css(styles.noData)}>No devices match the selected filter</td></tr>
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

const Widget = ({ icon, title, value, onClick, isActive }) => (
  <div className={css(styles.widget, isActive ? styles.widgetActive : null)} onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick && onClick(); }}>
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
    marginLeft: '25px',
    padding: '24px',
    boxSizing: 'border-box',
    overflowX: 'hidden',
    overflowY: 'auto',
    backgroundColor: '#0F172A',
  },
  widgetGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '16px',
    marginBottom: '12px',
    '@media (max-width: 420px)': { gridTemplateColumns: '1fr' },
  },
  widget: {
    backgroundColor: '#1E293B',
    padding: '20px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    boxShadow: '0 4px 10px rgba(0,0,0,0.2)',
    cursor: 'pointer',
    transition: 'transform 0.12s ease, box-shadow 0.12s ease, border 0.12s ease',
    outline: 'none',
    ':focus': { boxShadow: '0 6px 14px rgba(0,0,0,0.25)' },
  },
  widgetActive: { border: '2px solid rgba(59,130,246,0.9)', transform: 'translateY(-2px)' },
  widgetIcon: { fontSize: '36px', color: '#3B82F6' },
  widgetText: { color: '#F8FAFC' },
  widgetTitle: { fontSize: '1rem', fontWeight: '600', marginBottom: '4px' },
  widgetValue: { fontSize: '1.25rem', fontWeight: 'bold' },

  filterInfo: { color: '#94A3B8', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
  filterChips: { display: 'inline-flex', gap: '8px', marginLeft: '8px' },
  filterChip: { backgroundColor: '#0B1220', color: '#E2E8F0', padding: '6px 8px', borderRadius: '999px', fontSize: '0.85rem', border: '1px solid rgba(255,255,255,0.04)' },
  clearBtn: { marginLeft: '8px', background: 'transparent', border: '1px solid rgba(255,255,255,0.06)', color: '#94A3B8', padding: '6px 10px', borderRadius: '8px', cursor: 'pointer' },

  deviceHealth: { backgroundColor: '#1E293B', padding: '24px', borderRadius: '12px', boxShadow: '0 2px 6px rgba(0,0,0,0.2)', marginBottom: '32px' },
  responsiveTableWrapper: { overflowX: 'auto', paddingBottom: '8px' },
  deviceCardList: { display: 'flex', flexDirection: 'column', gap: '12px' },
  deviceCard: { backgroundColor: '#0B1220', borderRadius: '10px', padding: '12px', border: '1px solid rgba(255,255,255,0.03)' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
  cardTitle: { fontSize: '1rem', display: 'flex', gap: '8px', alignItems: 'center' },
  cardActions: { display: 'flex', gap: '8px', alignItems: 'center' },
  cardBody: { display: 'grid', gap: '6px', fontSize: '0.95rem' },
  cardFooter: { marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center' },
  expandSmallBtn: { background: 'transparent', border: '1px solid rgba(255,255,255,0.06)', padding: '6px 10px', borderRadius: '8px', color: '#E2E8F0', cursor: 'pointer' },
  logsListMobile: { marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '300px', overflowY: 'auto', paddingRight: '6px' },

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

  realTimeAlerts: { backgroundColor: '#1E293B', padding: '24px', borderRadius: '12px', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' },
  alertsList: { listStyleType: 'none', paddingLeft: '0', marginTop: '12px', fontSize: '0.95rem', lineHeight: '1.6', color: '#E2E8F0' },

  expandedRow: { backgroundColor: 'transparent' },
  expandedPanel: { padding: '12px', backgroundColor: '#0B1220', borderRadius: '8px', marginTop: '8px' },
  panelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', color: '#E6EEF8', flexWrap: 'wrap', gap: '8px' },
  panelSub: { color: '#94A3B8', fontSize: '0.85rem', marginLeft: '8px', flex: 1 },
  logsList: { display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px', overflowY: 'auto', paddingRight: '8px' },

  logItem: { display: 'grid', gridTemplateColumns: '180px 1fr', gap: '12px', alignItems: 'start', padding: '10px', borderRadius: '6px', backgroundColor: '#0F172A', border: '1px solid rgba(255,255,255,0.03)' },
  logItemManual: { border: '1px solid rgba(59,130,246,0.25)', backgroundColor: '#0d1f38' },
  logTimestamp: { color: '#94A3B8', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '3px' },
  logClasses: { color: '#E2E8F0', fontSize: '0.95rem' },
  manualBadge: { fontSize: '0.7rem', color: '#3B82F6', background: 'rgba(59,130,246,0.12)', padding: '1px 5px', borderRadius: '4px', width: 'fit-content' },

  loading: { color: '#94A3B8', padding: '12px' },
  error: { color: '#F97316', padding: '12px' },
  noLogs: { color: '#94A3B8', padding: '12px' },

  // ── Manual entry form ─────────────────────────────────────────────────────
  addManualBtn: {
    background: 'rgba(59,130,246,0.15)',
    border: '1px solid rgba(59,130,246,0.35)',
    color: '#93C5FD',
    padding: '5px 10px',
    borderRadius: '7px',
    cursor: 'pointer',
    fontSize: '0.85rem',
    whiteSpace: 'nowrap',
  },
  manualForm: {
    backgroundColor: '#0F172A',
    border: '1px solid rgba(59,130,246,0.2)',
    borderRadius: '8px',
    padding: '14px',
    marginBottom: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  manualFormRow: { display: 'flex', alignItems: 'center', gap: '10px' },
  manualLabel: { color: '#94A3B8', fontSize: '0.85rem', width: '70px', flexShrink: 0 },
  manualInput: {
    background: '#1E293B',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    color: '#F8FAFC',
    padding: '6px 10px',
    fontSize: '0.9rem',
    flex: 1,
    colorScheme: 'dark',
  },
  manualSelect: {
    background: '#1E293B',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    color: '#F8FAFC',
    padding: '6px 10px',
    fontSize: '0.9rem',
    flex: 1,
    cursor: 'pointer',
  },
  manualFormPreview: {
    color: '#64748B',
    fontSize: '0.8rem',
    padding: '6px 8px',
    background: 'rgba(255,255,255,0.02)',
    borderRadius: '5px',
    borderLeft: '3px solid rgba(59,130,246,0.4)',
  },
  manualFormActions: { display: 'flex', gap: '8px' },
  manualSubmitBtn: {
    background: '#2563EB',
    color: '#fff',
    border: 'none',
    padding: '7px 14px',
    borderRadius: '7px',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: '600',
  },
});
