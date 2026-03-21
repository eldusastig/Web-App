// src/components/Locations.jsx
import React, {
  useContext,
  useState,
  useRef,
  useEffect,
  useMemo,
} from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import { FiMapPin, FiWifi, FiAlertTriangle, FiDroplet } from 'react-icons/fi';
import { StyleSheet, css } from 'aphrodite';
import { DeviceContext } from '../DeviceContext';
import { LocationContext } from '../LocationContext';

// ─── Inject Leaflet popup styles + font (matches Dashboard/Status) ────────────
const _style = document.createElement('style');
_style.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');

  .leaflet-popup { z-index: 1000 !important; }
  .leaflet-popup-content-wrapper {
    background: #1E293B !important;
    color: #E2E8F0 !important;
    border: 1px solid rgba(255,255,255,0.08) !important;
    border-radius: 10px !important;
    box-shadow: 0 8px 24px rgba(0,0,0,0.6) !important;
    font-family: 'DM Sans', sans-serif !important;
  }
  .leaflet-popup-tip { background: #1E293B !important; }
  .leaflet-popup-content {
    margin: 14px 16px !important;
    font-size: 0.875rem !important;
    line-height: 1.6 !important;
  }
  .leaflet-container a.leaflet-popup-close-button {
    color: #64748B !important;
    font-size: 18px !important;
    top: 8px !important;
    right: 10px !important;
  }
  .leaflet-tile-pane { filter: brightness(0.82) saturate(0.85); }

  /* marker color tints */
  .loc-pin-green  { filter: hue-rotate(100deg) saturate(2); }
  .loc-pin-orange { filter: hue-rotate(20deg) saturate(3) brightness(1.1); }
  .loc-pin-red    { filter: hue-rotate(-30deg) saturate(3) brightness(0.95); }
  .loc-pin-gray   { filter: grayscale(1) brightness(0.6); }

  /* device list hover */
  .loc-row:hover { background: #1a2b3e !important; }
`;
if (!document.getElementById('loc-styles')) { _style.id = 'loc-styles'; document.head.appendChild(_style); }

// ─── Icons ────────────────────────────────────────────────────────────────────
const makeIcon = (cls) => new L.Icon({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  shadowSize: [41, 41], className: cls,
});
const icons = {
  green:  makeIcon('loc-pin-green'),
  orange: makeIcon('loc-pin-orange'),
  red:    makeIcon('loc-pin-red'),
  gray:   makeIcon('loc-pin-gray'),
};

// ─── PanToDevice (inside MapContainer) ───────────────────────────────────────
function PanToDevice({ selectedId, devices, userMoved }) {
  const map = useMapEvents({
    dragstart: () => (userMoved.current = true),
    zoomstart: () => (userMoved.current = true),
  });
  useEffect(() => {
    if (!selectedId || userMoved.current) return;
    const d = devices.find((x) => x.id === selectedId);
    if (d) map.setView([d.lat, d.lon], 15, { animate: true });
  }, [selectedId, devices, map]);
  return null;
}

// ─── Locations ────────────────────────────────────────────────────────────────
export default function Locations() {
  const { devices }   = useContext(DeviceContext);
  const { locations } = useContext(LocationContext);

  const [selectedId,      setSelectedId]      = useState(null);
  const [addresses,       setAddresses]        = useState({});
  const [showFlooded,     setShowFlooded]      = useState(false);
  const [showBinFull,     setShowBinFull]      = useState(false);
  const [showInactive,    setShowInactive]     = useState(false);
  const userMoved   = useRef(false);
  const fetchQueue  = useRef(new Map());

  // ─── merge location coords + device metadata ────────────────────────────
  const metaById = useMemo(() => {
    const m = new Map();
    (devices || []).forEach((d) => { if (d?.id) m.set(String(d.id), d); });
    return m;
  }, [devices]);

  const merged = useMemo(() => (locations || []).map((loc) => {
    const id   = String(loc.id);
    const meta = metaById.get(id) || {};
    return {
      id,
      lat:      Number(loc.lat),
      lon:      Number(loc.lon),
      lastSeen: loc.lastSeen || null,
      flooded:  meta.flooded  ?? meta.flood    ?? false,
      binFull:  meta.binFull  ?? meta.bin_full ?? (meta.fillPct ? Number(meta.fillPct) >= 90 : false),
      active:   meta.active   ?? meta.online   ?? true,
      name:     meta.name     ?? meta.label    ?? id,
    };
  }), [locations, metaById, devices]);

  // ─── filter logic ────────────────────────────────────────────────────────
  const visible = useMemo(() => merged.filter((d) => {
    if (showInactive && !showFlooded && !showBinFull) return !d.active;
    if (!showInactive && !d.active) return false;
    if (!showFlooded && !showBinFull) return true;
    if (showFlooded && d.flooded)  return true;
    if (showBinFull && d.binFull)  return true;
    return false;
  }), [merged, showFlooded, showBinFull, showInactive]);

  // ─── reverse geocode (staggered, cached) ────────────────────────────────
  useEffect(() => {
    visible.forEach((d, idx) => {
      if (!Number.isFinite(d.lat) || !Number.isFinite(d.lon)) return;
      if (addresses[d.id] || fetchQueue.current.get(d.id)) return;
      fetchQueue.current.set(d.id, true);
      setTimeout(async () => {
        try {
          const res  = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${d.lat}&lon=${d.lon}`,
            { headers: { Accept: 'application/json' } }
          );
          const data = res.ok ? await res.json() : null;
          setAddresses(p => ({ ...p, [d.id]: data?.display_name || 'Unknown location' }));
        } catch {
          setAddresses(p => ({ ...p, [d.id]: 'Address unavailable' }));
        } finally {
          fetchQueue.current.delete(d.id);
        }
      }, Math.min(2000, idx * 300));
    });
  }, [visible, addresses]);

  const initialCenter = useMemo(() =>
    visible.length > 0 ? [visible[0].lat, visible[0].lon] : [0, 0],
  [visible]);
  const initialZoom = visible.length > 0 ? 15 : 2;

  // summary counts
  const counts = useMemo(() => ({
    active:   merged.filter(d => d.active).length,
    inactive: merged.filter(d => !d.active).length,
    flooded:  merged.filter(d => d.flooded).length,
    binFull:  merged.filter(d => d.binFull).length,
  }), [merged]);

  const anyFilter = showFlooded || showBinFull || showInactive;

  return (
    <div className={css(s.page)}>

      {/* ─── Header ───────────────────────────────────────────────────────── */}
      <div className={css(s.header)}>
        <div className={css(s.headerLeft)}>
          <FiMapPin className={css(s.headerIcon)} />
          <h2 className={css(s.headerTitle)}>Device Locations</h2>
          <span className={css(s.headerBadge)}>{merged.length} device{merged.length !== 1 ? 's' : ''}</span>
        </div>

        {/* summary pills — same style as Status widgets */}
        <div className={css(s.summaryRow)}>
          <SummaryPill icon={<FiWifi />}          label={`${counts.active} Active`}   color="#10B981" active={counts.active > 0} />
          <SummaryPill icon={<FiWifi />}           label={`${counts.inactive} Offline`} color="#64748B" active={counts.inactive > 0} />
          <SummaryPill icon={<FiDroplet />}        label={`${counts.flooded} Flooded`}  color="#3B82F6" active={counts.flooded > 0} />
          <SummaryPill icon={<FiAlertTriangle />}  label={`${counts.binFull} Bin Full`} color="#F59E0B" active={counts.binFull > 0} />
        </div>
      </div>

      {/* ─── Filter Bar (same style as Status filter chips) ───────────────── */}
      <div className={css(s.filterBar)}>
        <span className={css(s.filterLabel)}>Filter:</span>
        <FilterChip label="Flooded"  icon="🌊" checked={showFlooded}  color="#3B82F6" onChange={setShowFlooded} />
        <FilterChip label="Bin Full" icon="⚠️" checked={showBinFull}  color="#F59E0B" onChange={setShowBinFull} />
        <FilterChip label="Inactive" icon="🔌" checked={showInactive} color="#64748B" onChange={setShowInactive} />
        {anyFilter && (
          <button
            className={css(s.clearBtn)}
            onClick={() => { setShowFlooded(false); setShowBinFull(false); setShowInactive(false); }}
          >
            ✕ Clear
          </button>
        )}
        {anyFilter && (
          <span className={css(s.filterInfo)}>
            Showing {visible.length} of {merged.length} devices
          </span>
        )}
      </div>

      {/* ─── Map Card ─────────────────────────────────────────────────────── */}
      <div className={css(s.card, s.mapCard)}>
        <MapContainer
          center={initialCenter}
          zoom={initialZoom}
          scrollWheelZoom
          style={{ height: '420px', width: '100%' }}
          whenCreated={() => { userMoved.current = false; }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          {visible.map((d) => (
            <Marker
              key={d.id}
              position={[d.lat, d.lon]}
              icon={d.flooded ? icons.red : d.binFull ? icons.orange : d.active ? icons.green : icons.gray}
              eventHandlers={{ click: () => setSelectedId(d.id) }}
            >
              <Popup>
                <div style={{ minWidth: '190px', fontFamily: "'DM Sans', sans-serif" }}>
                  <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '6px', color: '#F1F5F9' }}>
                    {d.name || d.id}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748B', marginBottom: '10px', fontFamily: "'DM Mono', monospace" }}>
                    {addresses[d.id] || `${d.lat.toFixed(6)}, ${d.lon.toFixed(6)}`}
                  </div>
                  <PopupRow label="🌊 Flooded"  value={d.flooded ? 'Yes' : 'No'} alert={d.flooded} />
                  <PopupRow label="⚠️ Bin Full" value={d.binFull ? 'Yes' : 'No'} alert={d.binFull} />
                  <PopupRow label="📶 Active"   value={d.active  ? 'Yes' : 'No'} ok={d.active} />
                  <div style={{ marginTop: '8px', fontSize: '0.72rem', color: '#475569', fontFamily: "'DM Mono', monospace" }}>
                    Last seen: {d.lastSeen ? new Date(d.lastSeen).toLocaleString() : '—'}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}

          <PanToDevice selectedId={selectedId} devices={visible} userMoved={userMoved} />
        </MapContainer>
      </div>

      {/* ─── Device List (styled like Status table) ───────────────────────── */}
      <div className={css(s.card)}>
        <div className={css(s.listHeader)}>
          <strong>Connected Devices</strong>
          <span className={css(s.listCount)}>{visible.length} shown</span>
        </div>

        {visible.length === 0 ? (
          <div className={css(s.noData)}>No devices match the current filters.</div>
        ) : (
          <div className={css(s.listScroll)}>
            <table className={css(s.table)}>
              <thead>
                <tr>
                  <th className={css(s.th)}>Device</th>
                  <th className={css(s.th)}>Address</th>
                  <th className={css(s.th)}>Flooded</th>
                  <th className={css(s.th)}>Bin Full</th>
                  <th className={css(s.th)}>Active</th>
                  <th className={css(s.th)}></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => (
                  <tr
                    key={d.id}
                    className="loc-row"
                    style={{
                      backgroundColor: d.id === selectedId ? '#1a2d4a' : 'transparent',
                      borderLeft: d.id === selectedId ? '3px solid #3B82F6' : '3px solid transparent',
                      cursor: 'pointer',
                    }}
                    onClick={() => setSelectedId(d.id)}
                  >
                    <td className={css(s.td)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                          backgroundColor: d.flooded ? '#3B82F6' : d.binFull ? '#F59E0B' : d.active ? '#10B981' : '#475569',
                          boxShadow: d.active ? `0 0 5px ${d.flooded ? '#3B82F6' : d.binFull ? '#F59E0B' : '#10B981'}` : 'none',
                        }} />
                        <span style={{ fontWeight: 600, color: '#F1F5F9' }}>{d.name || d.id}</span>
                      </div>
                    </td>
                    <td className={css(s.td, s.tdMono)}>
                      {addresses[d.id]
                        ? addresses[d.id].split(',').slice(0, 2).join(',')
                        : `${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}`}
                    </td>
                    <td className={css(s.td, d.flooded  ? s.alert : s.ok)}>{d.flooded  ? 'Yes' : 'No'}</td>
                    <td className={css(s.td, d.binFull  ? s.alert : s.ok)}>{d.binFull  ? 'Yes' : 'No'}</td>
                    <td className={css(s.td, d.active   ? s.ok    : s.alert)}>{d.active ? 'Yes' : 'No'}</td>
                    <td className={css(s.td)}>
                      <button
                        className={css(s.viewBtn)}
                        onClick={(e) => {
                          e.stopPropagation();
                          userMoved.current = false;
                          setSelectedId(d.id);
                        }}
                      >
                        📍 View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}

// ─── Small reusable components ────────────────────────────────────────────────

const SummaryPill = ({ icon, label, color, active }) => (
  <div style={{
    display: 'inline-flex', alignItems: 'center', gap: '5px',
    padding: '4px 10px', borderRadius: '999px', fontSize: '0.78rem', fontWeight: 600,
    backgroundColor: active ? `${color}18` : 'rgba(255,255,255,0.04)',
    color: active ? color : '#475569',
    border: `1px solid ${active ? `${color}44` : 'rgba(255,255,255,0.06)'}`,
    fontFamily: "'DM Sans', sans-serif",
  }}>
    {icon} {label}
  </div>
);

const FilterChip = ({ label, icon, checked, color, onChange }) => (
  <button
    onClick={() => onChange(!checked)}
    style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '6px 14px', borderRadius: '999px',
      fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
      border: `1px solid ${checked ? color : 'rgba(255,255,255,0.1)'}`,
      backgroundColor: checked ? `${color}22` : 'rgba(255,255,255,0.04)',
      color: checked ? color : '#94A3B8',
      transition: 'all 0.15s ease', outline: 'none',
      fontFamily: "'DM Sans', sans-serif",
    }}
  >
    {icon} {label}
  </button>
);

const PopupRow = ({ label, value, alert, ok }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
    <span style={{ color: '#94A3B8' }}>{label}</span>
    <strong style={{ color: alert ? '#EF4444' : ok ? '#10B981' : '#E2E8F0' }}>{value}</strong>
  </div>
);

// ─── Aphrodite styles (same tokens as Dashboard + Status) ─────────────────────
const s = StyleSheet.create({
  page: {
    flex: 1,
    padding: '24px',
    backgroundColor: '#0F172A',   // matches Status.statusContainer
    overflowY: 'auto',
    fontFamily: "'DM Sans', sans-serif",
    color: '#E2E8F0',
    boxSizing: 'border-box',
  },

  // header
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexWrap: 'wrap', gap: '12px', marginBottom: '16px',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '10px' },
  headerIcon: { color: '#3B82F6', fontSize: '1.2rem' },
  headerTitle: { fontSize: '1.25rem', fontWeight: 700, color: '#F8FAFC', margin: 0 },
  headerBadge: {
    fontSize: '0.78rem', color: '#64748B',
    backgroundColor: 'rgba(255,255,255,0.06)',
    padding: '2px 8px', borderRadius: '999px',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  summaryRow: { display: 'flex', gap: '8px', flexWrap: 'wrap' },

  // filter bar — matches Status filterInfo style
  filterBar: {
    display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
    marginBottom: '16px', padding: '12px 16px',
    backgroundColor: '#1E293B',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.06)',
    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
  },
  filterLabel: { fontSize: '0.8rem', color: '#64748B', fontWeight: 600 },
  clearBtn: {
    padding: '6px 12px', borderRadius: '999px',
    fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
    border: '1px solid rgba(255,100,100,0.3)',
    backgroundColor: 'rgba(255,100,100,0.08)',
    color: '#F87171', outline: 'none',
  },
  filterInfo: { fontSize: '0.8rem', color: '#64748B', marginLeft: '4px' },

  // cards — matches Status deviceHealth
  card: {
    backgroundColor: '#1E293B',
    borderRadius: '12px',
    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
    marginBottom: '20px',
    overflow: 'hidden',
  },
  mapCard: { padding: 0 },   // map fills card edge-to-edge

  // device list
  listHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    fontSize: '1rem', fontWeight: 700, color: '#F8FAFC',
  },
  listCount: { fontSize: '0.8rem', color: '#64748B' },
  listScroll: { overflowX: 'auto', maxHeight: '320px', overflowY: 'auto' },
  noData: { color: '#94A3B8', textAlign: 'center', padding: '24px' },

  // table — matches Status deviceTable
  table: {
    width: '100%', borderCollapse: 'collapse',
    fontSize: '0.9rem', color: '#F8FAFC', tableLayout: 'fixed',
  },
  th: {
    padding: '10px 16px', textAlign: 'left',
    fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase',
    color: '#64748B', letterSpacing: '0.05em',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    backgroundColor: '#1E293B',
    position: 'sticky', top: 0, zIndex: 1,
  },
  td: {
    padding: '12px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    verticalAlign: 'middle',
  },
  tdMono: {
    fontFamily: "'DM Mono', monospace",
    fontSize: '0.78rem', color: '#64748B',
  },

  // status colors — identical to Status
  alert: { color: '#EF4444', fontWeight: 'bold' },
  ok:    { color: '#10B981', fontWeight: 'bold' },

  viewBtn: {
    backgroundColor: '#1D4ED8', color: 'white',
    border: 'none', padding: '5px 10px',
    borderRadius: '6px', cursor: 'pointer',
    fontSize: '0.78rem', fontWeight: 600,
    whiteSpace: 'nowrap',
    ':hover': { backgroundColor: '#2563EB' },
  },
});
