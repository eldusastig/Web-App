// src/components/Status.jsx
import React, { useContext, useState, useEffect, useRef } from 'react';
import { MetricsContext } from '../MetricsContext';
import { realtimeDB } from '../firebase';
import { ref as dbRef, remove, update } from 'firebase/database';
import { FiTrash2, FiPlusCircle, FiWifi, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { StyleSheet, css } from 'aphrodite';

export default function Status() {
  const { fullBinAlerts, floodRisks, activeDevices, devices, authReady } = useContext(MetricsContext);
  const [deviceAddresses, setDeviceAddresses] = useState({});
  const fetchedAddrs = useRef(new Set());
  const [expandedDevice, setExpandedDevice] = useState(null);
  const [loadingLogs, setLoadingLogs] = useState({});
  const [errorLogs, setErrorLogs] = useState({});
  const [logsMap, setLogsMap] = useState({});

  // Inline-confirm state
  const [pendingDelete, setPendingDelete] = useState(null); // device id awaiting confirmation
  const [deleting, setDeleting] = useState(false); // deletion in progress

  const displayValue = (val) => (val === null || val === undefined ? 'Loading…' : val);

  // defensive boolean helper: treat 'true'/'false' strings as booleans
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
    // ✅ Modified part: handle bin fullness as percentage instead of yes/no
    if (d.binLevel != null && !isNaN(d.binLevel)) {
      const binPercent = Number(d.binLevel);
      if (binPercent >= 90) {
        realTimeAlerts.push(`⚠️ Bin ${binPercent}% Full at Device ${d.id}`);
      }
    } else if (boolish(d.binFull)) {
      // fallback if only old boolean field exists
      realTimeAlerts.push(`⚠️ Bin Full at Device ${d.id}`);
    }

    if (boolish(d.flooded)) realTimeAlerts.push(`🌊 Flood Risk Detected at Device ${d.id}`);
  });

  const normalizeLog = (entry) => {
    if (!entry) return null;
    if (typeof entry === 'string') {
      try {
        const parsed = JSON.parse(entry);
        if (parsed) {
          return {
            ts: parsed.ts ?? parsed.time ?? parsed.timestamp ?? null,
            classes: parsed.classes ?? parsed.detected ?? parsed.items ?? null,
            arrival: parsed.arrival ?? null,
            raw: parsed,
          };
        }
      } catch (e) {
        return { ts: null, classes: null, arrival: null, raw: entry };
      }
    }
    if (typeof entry === 'object') {
      const ts = entry.ts ?? entry.time ?? entry.timestamp ?? null;
      const classes = entry.classes ?? entry.detected ?? entry.items ?? null;
      const arrival = entry.arrival ?? null;
      return { ts, classes, arrival, raw: entry };
    }
    return { ts: null, classes: null, arrival: null, raw: String(entry) };
  };

  const loadLogsForDevice = async (device) => {
    const id = device.id;
    if (logsMap[id] || loadingLogs[id]) return;

    if (Array.isArray(device.logs) && device.logs.length > 0) {
      const normalized = device.logs.map(normalizeLog);
      setLogsMap((m) => ({ ...m, [id]: normalized }));
      return;
    }

    setLoadingLogs((m) => ({ ...m, [id]: true }));
    setErrorLogs((m) => ({ ...m, [id]: null }));
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(id)}/logs`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const normalized = Array.isArray(json) ? json.map(normalizeLog) : [normalizeLog(json)];
      setLogsMap((m) => ({ ...m, [id]: normalized }));
    } catch (err) {
      console.error('Failed to load logs for', id, err);
      setErrorLogs((m) => ({ ...m, [id]: 'Failed to load logs' }));
    } finally {
      setLoadingLogs((m) => ({ ...m, [id]: false }));
    }
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

  const formatLogTimestamp = (log, device) => {
    const info = parseTsInfo(log?.ts);
    if (info.kind === 'epoch-ms' || info.kind === 'epoch-s' || info.kind === 'iso') {
      try {
        return info.date.toLocaleString();
      } catch (e) {
        return info.date.toString();
      }
    }
    if (info.kind === 'uptime') {
      const arrivalMs = (log && log.arrival) || (device && device.lastSeen) || Date.now();
      const estDate = new Date(arrivalMs);
      const uptimeStr = formatUptime(info.uptimeMs);
      try {
        return `${estDate.toLocaleString()} (${uptimeStr})`;
      } catch (e) {
        return `${estDate.toString()} (${uptimeStr})`;
      }
    }
    return '—';
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
    const tsStr = log.ts ? formatLogTimestamp(log, device) : '—';
    const classes =
      log.classes &&
      (Array.isArray(log.classes && log.classes.length > 0) ||
        (typeof log.classes == 'string' && log.classes.trim() !== ''))
        ? 'Rubbish Detected'
        : 'None';
    return (
      <div key={idx} className={css(styles.logItem)}>
        <div className={css(styles.logTimestamp)}>{tsStr || '—'}</div>
        <div className={css(styles.logClasses)}>{classes}</div>
      </div>
    );
  };

  // ---------- Inline confirm + delete handlers ----------
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
    console.log('[Status] performDelete called for', deviceId, { authReady });
    if (!authReady) {
      console.warn('[Status] performDelete: auth not ready');
      alert('Not authenticated yet. Please wait a moment and try again.');
      setPendingDelete(null);
      return;
    }
    setDeleting(true);
    try {
      await remove(dbRef(realtimeDB, `devices/${deviceId}`));
      console.log('[Status] hard remove success for', deviceId);
      alert(`Device ${deviceId} removed.`);
    } catch (err) {
      console.warn('[Status] hard remove failed, falling back to soft-disable:', err);
      try {
        await update(dbRef(realtimeDB, `devices/${deviceId}`), { disabled: true });
        console.log('[Status] soft-disable success for', deviceId);
        alert(`Device ${deviceId} marked disabled.`);
      } catch (err2) {
        console.error('[Status] soft-disable also failed:', err2);
        alert('Failed to delete device. Check console for errors (Firebase rules/auth).');
      }
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  return (
    <div className={css(styles.statusContainer)}>
      <div className={css(styles.widgetGrid)}>
        <Widget
          icon={<FiTrash2 />}
          title="Full Bin Alerts"
          value={`${displayValue(fullBinAlerts)} Alert${fullBinAlerts === 1 ? '' : 's'}`}
        />
        <Widget
          icon={<FiPlusCircle />}
          title="Flood Risk"
          value={`${displayValue(floodRisks)} Alert${floodRisks === 1 ? '' : 's'}`}
        />
        <Widget
          icon={<FiWifi />}
          title="Active Devices"
          value={`${displayValue(activeDevices)} Device${activeDevices === 1 ? '' : 's'}`}
        />
      </div>

      <div className={css(styles.deviceHealth)}>
        <h2>Device Health</h2>
        <table className={css(styles.deviceTable)}>
          <thead>
            <tr className={css(styles.tableHeader)}>
              {/* Rest of table headers */}
            </tr>
          </thead>
          {/* Rest of table rendering */}
        </table>
      </div>
    </div>
  );
}

// Assuming Widget and styles are defined elsewhere in the file
