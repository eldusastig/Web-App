// src/components/Status.jsx
import React, { useContext, useState, useEffect, useRef, useCallback } from 'react';
import { MetricsContext } from '../MetricsContext';
import { realtimeDB } from '../firebase2';
import { ref as dbRef, remove, set } from 'firebase/database';
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

  // multi-select filters
  const [filters, setFilters] = useState([]); // 'fullBin' | 'flood' | 'active'

  // responsive
  const [isNarrow, setIsNarrow] = useState(false);

  // inline confirm
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

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
      else if (mq.removeListener) mq.removeListener('change', handler);
    };
  }, []);

  useEffect(() => {
    const cleanup = setupMediaListener();
    return cleanup;
  }, [setupMediaListener]);

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
  // Logs loading (FIXED)
  // ---------------------------
  const loadLogsForDevice = async (device) => {
    const id = device.id;
    if (logsMap[id] || loadingLogs[id]) return;

    // If device already has logs embedded, normalize and use them.
    if (Array.isArray(device.logs) && device.logs.length > 0) {
      const normalized = device.logs.map(normalizeLog).filter(Boolean);
      setLogsMap((m) => ({ ...m, [id]: normalized }));
      return;
    }

    setLoadingLogs((m) => ({ ...m, [id]: true }));
    setErrorLogs((m) => ({ ...m, [id]: null }));

    // small helper to truncate long bodies shown in UI
    const truncate = (s, n = 300) => {
      if (!s) return s;
      if (s.length <= n) return s;
      return s.slice(0, n) + '…';
    };

    try {
      const url = `/api/devices/${encodeURIComponent(id)}/logs`;
      console.debug(`[Status] fetching logs for ${id}: ${url}`);
      // Use same-origin credentials so cookies are sent when applicable.
      const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });

      if (!res.ok) {
        // read response text (best-effort) to include in error
        let body = '';
        try {
          body = await res.text();
        } catch (e) {
          body = '<unreadable response body>';
        }
        const msg = `HTTP ${res.status} ${res.statusText}${body ? ` — ${truncate(body)}` : ''}`;
        console.error(`[Status] loadLogsForDevice ${id} failed: ${msg}`);

        // 404 -> treat as no logs rather than an error
        if (res.status === 404) {
          setLogsMap((m) => ({ ...m, [id]: [] }));
          setErrorLogs((m) => ({ ...m, [id]: null }));
          return;
        }

        setErrorLogs((m) => ({ ...m, [id]: `Failed to load logs: ${res.status} ${res.statusText}` }));
        return;
      }

      // Try JSON parse (safe)
      let json;
      try {
        json = await res.json();
      } catch (e) {
        const text = await res.text().catch(() => '<unreadable>');
        console.error(`[Status] loadLogsForDevice ${id} — JSON parse failed, body:`, truncate(text), e);
        setErrorLogs((m) => ({ ...m, [id]: 'Failed to parse logs (invalid JSON)' }));
        return;
      }

      const normalized = Array.isArray(json) ? json.map(normalizeLog).filter(Boolean) : [normalizeLog(json)].filter(Boolean);
      setLogsMap((m) => ({ ...m, [id]: normalized }));
    } catch (err) {
      console.error(`[Status] loadLogsForDevice ${id} exception:`, err);
      setErrorLogs((m) => ({ ...m, [id]: `Failed to load logs: ${err && err.message ? err.message : String(err)}` }));
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
      try { return `${estDate.toLocaleString()} (${uptimeStr})`; } catch (e) { return `${estDate.toString()} (${uptimeStr})`; }
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
    // show only high-level status: "Rubbish Detected" or "None"
    const classesLabel = hasDetections(log) ? 'Rubbish Detected' : 'None';
    return (
      <div key={idx} className={css(styles.logItem)}>
        <div className={css(styles.logTimestamp)}>{tsStr || '—'}</div>
        <div className={css(styles.logClasses)}>{classesLabel}</div>
      </div>
    );
  };

  // delete handlers
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
    if (!authReady) {
      alert('Not authenticated yet. Please wait a moment and try again.');
      setPendingDelete(null);
      return;
    }
    setDeleting(true);
    try {
      await set(dbRef(realtimeDB, `deleted_devices/${deviceId}`), true);
      await remove(dbRef(realtimeDB, `devices/${deviceId}`));
      alert(`Device ${deviceId} permanently removed. It will not be recreated from MQTT messages.`);
    } catch (err) {
      console.error('[Status] Delete operation failed:', err);
      alert(`Failed to delete device: ${err.message}`);
    } finally {
      setDeleting(false);
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
    const isDisabled = boolish(d.disabled);
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
              <button type="button" className={css(styles.deleteBtn)} onClick={(e) => startDelete(e, d.id)} disabled={!authReady || deleting} title={!authReady ? 'Waiting for auth...' : `Delete device ${d.id}`}>
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
              <div className={css(styles.noLogs)}>No logs available</div>
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
                  const isDisabled = boolish(d.disabled);
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
                            <button type="button" className={css(styles.deleteBtn)} onClick={(e) => startDelete(e, d.id)} disabled={!authReady || deleting} aria-disabled={!authReady || deleting} title={!authReady ? 'Waiting for auth...' : `Delete device ${d.id}`} data-test-delete={`delete-${d.id}`}>
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

/* Widget + styles */
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
