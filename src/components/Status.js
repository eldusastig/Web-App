// src/components/Status.jsx
import React, { useContext, useState, useEffect, useRef } from 'react';
import { MetricsContext } from '../MetricsContext';
import { realtimeDB } from '../firebase2';
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
    if (boolish(d.binFull)) realTimeAlerts.push(`⚠️ Bin Full at Device ${d.id}`);
    if (boolish(d.flooded)) realTimeAlerts.push(`🌊 Flood Risk Detected at Device ${d.id}`);
  });

  // ---------------------------
  // Normalization helpers (NEW/UPDATED)
  // ---------------------------

  // Normalize "classes" field into:
  //  - null => no detections
  //  - string => single class
  //  - array => list of classes
  //  - object => counts or keyed map (only meaningful entries kept)
  function normalizeClasses(raw) {
    if (raw === undefined || raw === null) return null;

    const isNoneToken = (s) => {
      if (s === null || s === undefined) return true;
      const t = String(s).trim();
      return t === '' || /^none$/i.test(t) || /^null$/i.test(t);
    };

    // Strings
    if (typeof raw === 'string') {
      const s = raw.trim();
      if (s === '') return null;
      // If comma-separated list, split
      const parts = s.split(',').map((x) => x.trim()).filter((x) => x.length > 0 && !isNoneToken(x));
      if (parts.length === 0) return null;
      return parts.length === 1 ? parts[0] : parts;
    }

    // Arrays
    if (Array.isArray(raw)) {
      const parts = raw
        .map((x) => (x === undefined || x === null ? '' : String(x).trim()))
        .filter((x) => x.length > 0 && !isNoneToken(x));
      if (parts.length === 0) return null;
      return parts.length === 1 ? parts[0] : parts;
    }

    // Objects - try to keep only keys with meaningful values (e.g. counts > 0)
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
            // non-numeric string (probably label), keep it
            kept[k] = v;
          }
        } else if (v) {
          // truthy non-number => keep
          kept[k] = v;
        }
      }
      if (Object.keys(kept).length === 0) return null;
      return kept;
    }

    // Fallback coerce to string
    const coerced = String(raw).trim();
    return coerced.length === 0 || /^none$/i.test(coerced) || /^null$/i.test(coerced) ? null : coerced;
  }

  // Normalize a full log entry into { ts, classes, arrival, raw }
  const normalizeLog = (entry) => {
    if (!entry) return null;

    // If entry is a JSON string, parse and re-normalize
    if (typeof entry === 'string') {
      try {
        const parsed = JSON.parse(entry);
        if (parsed && typeof parsed === 'object') {
          return normalizeLog(parsed);
        }
      } catch (e) {
        // not JSON -> treat as primitive below
      }
    }

    if (typeof entry === 'object') {
      const ts = entry.ts ?? entry.time ?? entry.timestamp ?? null;
      const rawClasses = entry.classes ?? entry.detected ?? entry.items ?? entry.labels ?? null;
      const classes = normalizeClasses(rawClasses);
      const arrival = entry.arrival ?? null;
      return { ts, classes, arrival, raw: entry };
    }

    // primitives
    return { ts: null, classes: normalizeClasses(String(entry)), arrival: null, raw: entry };
  };

  // returns true if normalized log indicates at least one detection
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
    if (typeof cls === 'object') {
      return Object.keys(cls).length > 0;
    }
    try {
      return String(cls).trim() !== '';
    } catch (e) {
      return false;
    }
  };

  // Format normalized classes into readable string (or null if none)
  const formatClasses = (log) => {
    if (!log) return null;
    const cls = log.classes;
    if (!cls) return null;
    if (Array.isArray(cls)) return cls.join(', ');
    if (typeof cls === 'string') return cls;
    if (typeof cls === 'object') {
      const parts = [];
      for (const [k, v] of Object.entries(cls)) {
        if (typeof v === 'number') parts.push(`${k}(${v})`);
        else parts.push(k);
      }
      return parts.join(', ');
    }
    return String(cls);
  };

  // ---------------------------
  // Logs loading
  // ---------------------------
  const loadLogsForDevice = async (device) => {
    const id = device.id;
    if (logsMap[id] || loadingLogs[id]) return;
    if (Array.isArray(device.logs) && device.logs.length > 0) {
      const normalized = device.logs.map(normalizeLog).filter(Boolean);
      setLogsMap((m) => ({ ...m, [id]: normalized }));
      return;
    }

    setLoadingLogs((m) => ({ ...m, [id]: true }));
    setErrorLogs((m) => ({ ...m, [id]: null }));
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(id)}/logs`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const normalized = Array.isArray(json) ? json.map(normalizeLog).filter(Boolean) : [normalizeLog(json)].filter(Boolean);
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
      try { return info.date.toLocaleString(); } catch (e) { return info.date.toString(); }
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
    const kinds = formatClasses(log);
    const classesLabel = hasDetections(log) ? `Rubbish Detected - ${kinds ?? 'Unknown'}` : 'None';
    return (
      <div key={idx} className={css(styles.logItem)}>
        <div className={css(styles.logTimestamp)}>{tsStr || '—'}</div>
        <div className={css(styles.logClasses)}>{classesLabel}</div>
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
      // UI will refresh from Firebase onValue listener
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
        <Widget icon={<FiTrash2 />} title="Full Bin Alerts" value={`${displayValue(fullBinAlerts)} Alert${fullBinAlerts === 1 ? '' : 's'}`} />
        <Widget icon={<FiPlusCircle />} title="Flood Risk" value={`${displayValue(floodRisks)} Alert${floodRisks === 1 ? '' : 's'}`} />
        <Widget icon={<FiWifi />} title="Active Devices" value={`${displayValue(activeDevices)} Device${activeDevices === 1 ? '' : 's'}`} />
      </div>

      <div className={css(styles.deviceHealth)}>
        <h2>Device Health</h2>
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
            {devices.map((d) => {
              const isDisabled = boolish(d.disabled);
              const isExpanded = expandedDevice === d.id;
              const deviceLogs = Array.isArray(d.logs) && d.logs.length > 0
                ? d.logs.map(normalizeLog).filter(Boolean)
                : (logsMap[d.id] || []);

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
                    <td className={css(boolish(d.binFull) ? styles.alert : styles.ok)}>  {d.fillPct != null ? `${d.fillPct}%` : '-'}</td>
                    <td className={css(boolish(d.active) || boolish(d.online) ? styles.ok : styles.alert)}>{boolish(d.active) || boolish(d.online) ? 'Yes' : 'No'}</td>

                    {/* Actions cell: stop row-level clicks and show inline confirm when needed */}
                    <td onClick={(e) => e.stopPropagation()}>
                      {pendingDelete === d.id ? (
                        <div className={css(styles.inlineConfirm)}>
                          <span>Confirm delete?</span>
                          <button
                            type="button"
                            className={css(styles.confirmBtn)}
                            onClick={(e) => performDelete(e, d.id)}
                            disabled={deleting}
                          >
                            {deleting ? 'Deleting…' : 'Yes'}
                          </button>
                          <button
                            type="button"
                            className={css(styles.cancelBtn)}
                            onClick={(e) => cancelDelete(e)}
                            disabled={deleting}
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={css(styles.deleteBtn)}
                          onClick={(e) => startDelete(e, d.id)}
                          disabled={!authReady || deleting}
                          aria-disabled={!authReady || deleting}
                          title={!authReady ? 'Waiting for auth...' : `Delete device ${d.id}`}
                          data-test-delete={`delete-${d.id}`}
                        >
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
                            <div className={css(styles.noLogs)}>No logs available</div>
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
          </tbody>
        </table>
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

/* Widget + styles kept same as before, plus inline-confirm styles and delete button tweak */
const Widget = ({ icon, title, value }) => (
  <div className={css(styles.widget)}>
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '24px',
    marginBottom: '32px',
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
  deviceHealth: {
    backgroundColor: '#1E293B',
    padding: '24px',
    borderRadius: '12px',
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
    marginBottom: '32px',
  },
  deviceTable: {
    width: '100%',
    borderCollapse: 'collapse',
    marginTop: '12px',
    marginBottom: '12px',
    color: '#F8FAFC',
    fontSize: '0.9rem',
    tableLayout: 'fixed',
  },
  tableHeader: {
    color: '#94A3B8',
    fontWeight: '600',
    fontSize: '1rem',
    textTransform: 'uppercase',
    padding: '12px',
    textAlign: 'left',
  },
  deviceRow: {
    cursor: 'pointer',
    ':hover': {
      backgroundColor: '#111827',
    },
  },
  disabledRow: {
    opacity: 0.5,
  },
  deviceIdCell: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  expandIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: '8px',
    color: '#94A3B8',
  },
  disabledBadge: {
    marginLeft: '8px',
    backgroundColor: '#374151',
    color: '#E5E7EB',
    padding: '2px 6px',
    borderRadius: '6px',
    fontSize: '0.75rem',
  },
  deleteBtn: {
    position: 'relative',
    zIndex: 10,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '6px',
    color: '#F87171',
    ':disabled': {
      opacity: 0.4,
      cursor: 'not-allowed',
    },
  },

  /* inline confirm */
  inlineConfirm: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  confirmBtn: {
    background: '#dc2626',
    color: '#fff',
    border: 'none',
    padding: '6px 8px',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  cancelBtn: {
    background: '#374151',
    color: '#fff',
    border: 'none',
    padding: '6px 8px',
    borderRadius: '6px',
    cursor: 'pointer',
  },

  alert: {
    color: '#EF4444',
    fontWeight: 'bold',
  },
  ok: {
    color: '#10B981',
    fontWeight: 'bold',
  },
  noData: {
    color: '#94A3B8',
    textAlign: 'center',
    padding: '16px',
  },
  realTimeAlerts: {
    backgroundColor: '#1E293B',
    padding: '24px',
    borderRadius: '12px',
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
  },
  alertsList: {
    listStyleType: 'none',
    paddingLeft: '0',
    marginTop: '12px',
    fontSize: '0.95rem',
    lineHeight: '1.6',
    color: '#E2E8F0',
  },

  /* expanded panel */
  expandedRow: {
    backgroundColor: 'transparent',
  },
  expandedPanel: {
    padding: '12px',
    backgroundColor: '#0B1220',
    borderRadius: '8px',
    marginTop: '8px',
  },
  panelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: '8px',
    color: '#E6EEF8',
  },
  panelSub: {
    color: '#94A3B8',
    fontSize: '0.85rem',
    marginLeft: '8px',
  },
  logsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '240px',
    overflowY: 'auto',
    paddingRight: '8px',
  },
  logItem: {
    display: 'grid',
    gridTemplateColumns: '180px 1fr',
    gap: '12px',
    alignItems: 'start',
    padding: '10px',
    borderRadius: '6px',
    backgroundColor: '#0F172A',
    border: '1px solid rgba(255,255,255,0.03)',
  },
  logTimestamp: {
    color: '#94A3B8',
    fontSize: '0.85rem',
  },
  logClasses: {
    color: '#E2E8F0',
    fontSize: '0.95rem',
  },
  loading: {
    color: '#94A3B8',
    padding: '12px',
  },
  error: {
    color: '#F97316',
    padding: '12px',
  },
  noLogs: {
    color: '#94A3B8',
    padding: '12px',
  },
});
