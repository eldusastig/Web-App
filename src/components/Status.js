// src/components/Status.jsx (MQTT-enabled)
import React, { useContext, useState, useEffect, useRef, useCallback } from 'react';
import mqtt from 'mqtt';
import { MetricsContext } from '../MetricsContext';
import { FiTrash2, FiPlusCircle, FiWifi } from 'react-icons/fi';
import { StyleSheet, css } from 'aphrodite';

export default function Status() {
  const { fullBinAlerts, floodRisks, activeDevices, devices } = useContext(MetricsContext);
  const [deviceAddresses, setDeviceAddresses] = useState({});
  const fetchedAddrs = useRef(new Set());
  const [expandedDevice, setExpandedDevice] = useState(null);
  const [loadingLogs, setLoadingLogs] = useState({});
  const [errorLogs, setErrorLogs] = useState({});
  const [logsMap, setLogsMap] = useState({});
  const [filters, setFilters] = useState([]);
  const [isNarrow, setIsNarrow] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const clientRef = useRef(null);
  const subListenersRef = useRef(new Map());
  const pendingPublishesRef = useRef([]);
  const [mqttConnected, setMqttConnected] = useState(false);

  const BIN_FULL_WEIGHT_KG = 8.0;
  const CLEAR_TOPIC_TEMPLATES = [
    'esp32/{id}/status',
    'esp32/{id}/sensor/detections',
  ];

  const displayValue = (val) => (val == null ? 'Loading…' : val);
  const boolish = (v) => {
    if (v === true || v === 'true' || v === '1') return true;
    if (v === false || v === 'false' || v === '0') return false;
    return Boolean(v);
  };

  const setupMediaListener = useCallback(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 720px)');
    const handler = (e) => setIsNarrow(Boolean(e.matches));
    setIsNarrow(Boolean(mq.matches));
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
      else mq.removeListener(handler);
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
        if (err) console.warn('Failed to subscribe devices/+/meta', err);
      });
      pendingPublishesRef.current.forEach(({ topic, payload, opts }) => {
        client.publish(topic, payload, opts);
      });
      pendingPublishesRef.current = [];
    });
    client.on('reconnect', () => setMqttConnected(false));
    client.on('close', () => setMqttConnected(false));
    client.on('offline', () => setMqttConnected(false));
    client.on('error', (err) => console.error('MQTT error', err));

    return () => { try { client.end(true); } catch (e) {} clientRef.current = null; setMqttConnected(false); };
  }, []);

  // Reverse geocode
  useEffect(() => {
    devices.forEach((d) => {
      if (d.lat != null && d.lon != null && !fetchedAddrs.current.has(d.id)) {
        fetchedAddrs.current.add(d.id);
        fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${d.lat}&lon=${d.lon}`)
          .then((res) => res.json())
          .then((data) => {
            const street = data.address?.road || data.display_name || 'Unknown address';
            setDeviceAddresses((prev) => ({ ...prev, [d.id]: street }));
          })
          .catch(() => setDeviceAddresses((prev) => ({ ...prev, [d.id]: 'Address unavailable' })));
      }
    });
  }, [devices]);

  const realTimeAlerts = [];
  devices.forEach((d) => {
    const isWeightFull = (typeof d.weightKg === 'number' && d.weightKg >= BIN_FULL_WEIGHT_KG);
    if (boolish(d.binFull) || isWeightFull) realTimeAlerts.push(`⚠️ Bin Full at Device ${d.id}`);
    if (boolish(d.flooded)) realTimeAlerts.push(`🌊 Flood Alert Detected at Device ${d.id}`);
  });

  const normalizeClasses = (raw) => {
    if (!raw) return null;
    if (typeof raw === 'string') return raw.trim() || null;
    if (Array.isArray(raw)) return raw.length === 1 ? raw[0] : raw;
    if (typeof raw === 'object') return raw;
    return String(raw).trim() || null;
  };

  const isDetectionPayload = (payload) => {
    if (!payload) return false;
    if (typeof payload === 'string') return payload.trim().startsWith('{') || payload.trim().startsWith('[');
    if (typeof payload === 'object') return true;
    return false;
  };

  const normalizeLog = (entry) => {
    if (!entry) return null;
    if (typeof entry === 'string') {
      try { return normalizeLog(JSON.parse(entry)); } catch (e) {}
    }
    if (typeof entry === 'object') {
      const raw = { ...entry };
      const ts = raw.ts ?? raw.time ?? raw.timestamp ?? null;
      const classes = normalizeClasses(raw.classes ?? raw.detected ?? raw.items ?? raw.labels ?? null);
      return { ts, classes, raw, arrival: raw.arrival ?? Date.now() };
    }
    return { ts: null, classes: normalizeClasses(String(entry)), raw: entry, arrival: Date.now() };
  };

  const filterAndNormalizeDeviceLogs = (logs) => {
    if (!Array.isArray(logs) || logs.length === 0) return [];
    const candidates = logs.filter((entry) => isDetectionPayload(entry) || entry._detectionTopic);
    const normalized = candidates.map(normalizeLog).filter(Boolean);
    const seen = new Set();
    return normalized.filter((n) => {
      const key = JSON.stringify(n.raw ?? n.classes ?? n);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const hasDetections = (log) => {
    if (!log) return false;
    const cls = log.classes;
    if (!cls) return false;
    if (Array.isArray(cls)) return cls.length > 0;
    if (typeof cls === 'object') return Object.keys(cls).length > 0;
    if (typeof cls === 'string') return cls.trim() !== '';
    return false;
  };

  const ANIMAL_KEYWORDS = new Set(['animal','animals']);
  const isAnimalClass = (cls) => {
    if (!cls) return false;
    if (typeof cls === 'string') return ANIMAL_KEYWORDS.has(cls.toLowerCase().trim());
    if (Array.isArray(cls)) return cls.some(isAnimalClass);
    if (typeof cls === 'object') return Object.keys(cls).some(isAnimalClass);
    return false;
  };

  const getClassLabel = (log) => {
    if (!log) return 'None';
    if (log.raw?._explicitEmptyClasses) return 'None';
    if (isAnimalClass(log.classes)) return 'Animal Detected';
    if (hasDetections(log)) return 'Rubbish Detected';
    return 'None';
  };

  const onToggleDevice = (d) => {
    if (expandedDevice === d.id) { setExpandedDevice(null); return; }
    setExpandedDevice(d.id);
  };

  const renderLogItem = (log, idx, device) => {
    const tsStr = log.ts ?? new Date(log.arrival).toLocaleString();
    const classesLabel = getClassLabel(log);
    return (
      <div key={idx} className={css(styles.logItem)}>
        <div className={css(styles.logTimestamp)}>{tsStr}</div>
        <div className={css(styles.logClasses)}>{classesLabel}</div>
      </div>
    );
  };

  const toggleFilter = (type) => {
    setFilters((prev) => prev.includes(type) ? prev.filter(f => f !== type) : [...prev, type]);
    setExpandedDevice(null);
  };
  const clearFilters = () => setFilters([]);

  const matchesFilter = (d) => {
    if (!filters || filters.length === 0) return true;
    return filters.some((f) => {
      if (f === 'fullBin') return boolish(d.binFull) || (d.weightKg >= BIN_FULL_WEIGHT_KG);
      if (f === 'flood') return boolish(d.flooded);
      if (f === 'active') return boolish(d.active) || boolish(d.online);
      return false;
    });
  };

  const filteredDevices = devices.filter(matchesFilter);
  const filterLabel = (f) => f === 'fullBin' ? 'Full Bin' : f === 'flood' ? 'Flood Alerts' : f === 'active' ? 'Active' : f;

  const DeviceCard = ({ d }) => {
    const addr = d.lat != null && d.lon != null ? deviceAddresses[d.id] || 'Loading…' : '—';
    const deviceLogs = logsMap[d.id] || [];
    return (
      <div className={css(styles.deviceCard)}>
        <div className={css(styles.cardHeader)}>
          <strong>{d.id}</strong>
        </div>
        <div className={css(styles.cardBody)}>
          <div><strong>Address:</strong> {addr}</div>
          <div><strong>Flooded:</strong> {boolish(d.flooded) ? 'Yes' : 'No'}</div>
          <div><strong>Weight (kg):</strong> {d.weightKg?.toFixed(3) ?? '-'}</div>
          <div><strong>Active:</strong> {boolish(d.active) || boolish(d.online) ? 'Yes' : 'No'}</div>
        </div>
        <div className={css(styles.cardFooter)}>
          <button type="button" onClick={() => onToggleDevice(d)}>
            {expandedDevice === d.id ? 'Hide Logs' : 'Show Logs'}
          </button>
        </div>
        {expandedDevice === d.id && (
          <div className={css(styles.logsListMobile)}>
            {deviceLogs.map((l, i) => renderLogItem(l, i, d))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={css(styles.statusContainer)}>
      <div className={css(styles.widgetGrid)}>
        <Widget icon={<FiTrash2 />} title="Full Bin Alerts" value={`${displayValue(fullBinAlerts)} Alert${fullBinAlerts === 1 ? '' : 's'}`} onClick={() => toggleFilter('fullBin')} isActive={filters.includes('fullBin')} />
        <Widget icon={<FiPlusCircle />} title="Flood Alerts" value={`${displayValue(floodRisks)} Alert${floodRisks === 1 ? '' : 's'}`} onClick={() => toggleFilter('flood')} isActive={filters.includes('flood')} />
        <Widget icon={<FiWifi />} title="Active Devices" value={`${displayValue(activeDevices)} Device${activeDevices === 1 ? '' : 's'}`} onClick={() => toggleFilter('active')} isActive={filters.includes('active')} />
      </div>

      {filters.length > 0 && (
        <div className={css(styles.filterInfo)}>
          Showing {filteredDevices.length} of {devices.length} devices — Filters:
          {filters.map((f) => <span key={f}>{filterLabel(f)}</span>)}
          <button type="button" onClick={clearFilters}>Clear filters</button>
        </div>
      )}

      <div className={css(styles.deviceHealth)}>
        <h2>Device Status</h2>
        {isNarrow
          ? filteredDevices.map((d) => <DeviceCard key={d.id} d={d} />)
          : (
            <table className={css(styles.deviceTable)}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Address</th>
                  <th>Flooded</th>
                  <th>Weight (kg)</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {filteredDevices.map((d) => (
                  <tr key={d.id}>
                    <td>{d.id}</td>
                    <td>{deviceAddresses[d.id] || 'Loading…'}</td>
                    <td>{boolish(d.flooded) ? 'Yes' : 'No'}</td>
                    <td>{d.weightKg?.toFixed(3) ?? '-'}</td>
                    <td>{boolish(d.active) || boolish(d.online) ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}

/* Widget + styles (fixed alignment) */
const Widget = ({ icon, title, value, onClick, isActive }) => (
  <div
    className={css(styles.widget, isActive ? styles.widgetActive : null)}
    onClick={onClick}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') onClick && onClick();
    }}
  >
    <div className={css(styles.widgetIcon)}>{icon}</div>
    <div className={css(styles.widgetText)}>
      <p className={css(styles.widgetTitle)}>{title}</p>
      <p className={css(styles.widgetValue)}>{value}</p>
    </div>
  </div>
);

const styles = StyleSheet.create({
  /* --- MAIN CONTAINER FIXED --- */
  statusContainer: {
    flex: 1,
    marginLeft: '25px',
    padding: '24px',
    boxSizing: 'border-box',
    overflowX: 'hidden',
    overflowY: 'auto',
    backgroundColor: '#0F172A', // dark blue background
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
    transition:
      'transform 0.12s ease, box-shadow 0.12s ease, border 0.12s ease',
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
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  cardTitle: {
    fontSize: '1rem',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  cardActions: { display: 'flex', gap: '8px', alignItems: 'center' },
  cardBody: { display: 'grid', gap: '6px', fontSize: '0.95rem' },
  cardFooter: {
    marginTop: '8px',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  expandSmallBtn: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.06)',
    padding: '6px 10px',
    borderRadius: '8px',
    color: '#E2E8F0',
    cursor: 'pointer',
  },
  logsListMobile: {
    marginTop: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    maxHeight: '200px',
    overflowY: 'auto',
    paddingRight: '6px',
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
    ':hover': { backgroundColor: '#111827' },
  },
  disabledRow: { opacity: 0.5 },
  deviceIdCell: { display: 'flex', alignItems: 'center', gap: '8px' },
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
    ':disabled': { opacity: 0.4, cursor: 'not-allowed' },
  },
  inlineConfirm: { display: 'flex', gap: '8px', alignItems: 'center' },
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

  alert: { color: '#EF4444', fontWeight: 'bold' },
  ok: { color: '#10B981', fontWeight: 'bold' },
  noData: { color: '#94A3B8', textAlign: 'center', padding: '16px' },

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

  expandedRow: { backgroundColor: 'transparent' },
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
  logTimestamp: { color: '#94A3B8', fontSize: '0.85rem' },
  logClasses: { color: '#E2E8F0', fontSize: '0.95rem' },
  loading: { color: '#94A3B8', padding: '12px' },
  error: { color: '#F97316', padding: '12px' },
  noLogs: { color: '#94A3B8', padding: '12px' },
});
