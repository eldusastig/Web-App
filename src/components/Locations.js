// src/components/Locations.jsx
import React, {
  useContext, useState, useRef, useEffect, useMemo,
} from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { StyleSheet, css } from 'aphrodite';
import { DeviceContext } from '../DeviceContext';
import { LocationContext } from '../LocationContext';

// ─── Leaflet popup dark theme ─────────────────────────────────────────────────
const _style = document.createElement('style');
_style.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
  .leaflet-popup-content-wrapper {
    background: #1E293B !important;
    color: #E2E8F0 !important;
    border: 1px solid rgba(255,255,255,0.08) !important;
    border-radius: 10px !important;
    box-shadow: 0 8px 24px rgba(0,0,0,0.6) !important;
    font-family: 'DM Sans', sans-serif !important;
  }
  .leaflet-popup-tip { background: #1E293B !important; }
  .leaflet-popup-content { margin: 14px 16px !important; font-size: 0.875rem !important; line-height: 1.6 !important; }
  .leaflet-container a.leaflet-popup-close-button { color: #64748B !important; }
  .leaflet-tile-pane { filter: brightness(0.82) saturate(0.85); }
  .loc-pin-green  { filter: hue-rotate(100deg) saturate(2); }
  .loc-pin-orange { filter: hue-rotate(20deg) saturate(3) brightness(1.1); }
  .loc-pin-red    { filter: hue-rotate(-30deg) saturate(3); }
  .loc-pin-gray   { filter: grayscale(1) brightness(0.6); }
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

// ─── PanToDevice ──────────────────────────────────────────────────────────────
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

  const [selectedId,   setSelectedId]   = useState(null);
  const [addresses,    setAddresses]     = useState({});
  const [showFlooded,  setShowFlooded]   = useState(false);
  const [showBinFull,  setShowBinFull]   = useState(false);
  const [showInactive, setShowInactive]  = useState(false);
  const userMoved  = useRef(false);
  const fetchQueue = useRef(new Map());

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
      flooded:  meta.flooded ?? meta.flood    ?? false,
      binFull:  meta.binFull ?? meta.bin_full ?? (meta.fillPct ? Number(meta.fillPct) >= 90 : false),
      active:   meta.active  ?? meta.online   ?? true,
      name:     meta.name    ?? meta.label    ?? id,
    };
  }), [locations, metaById, devices]);

  const visible = useMemo(() => merged.filter((d) => {
    if (showInactive && !showFlooded && !showBinFull) return !d.active;
    if (!showInactive && !d.active) return false;
    if (!showFlooded && !showBinFull) return true;
    if (showFlooded && d.flooded) return true;
    if (showBinFull && d.binFull) return true;
    return false;
  }), [merged, showFlooded, showBinFull, showInactive]);

  // reverse geocode
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
    visible.length > 0 ? [visible[0].lat, visible[0].lon] : [0, 0]
  , [visible]);

  return (
    <div className={css(s.page)}>

      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <h2 className={css(s.title)}>Device Locations</h2>

      {/* ─── Filters ────────────────────────────────────────────────────── */}
      <div className={css(s.filterRow)}>
        <Chip label="Flooded"  checked={showFlooded}  color="#3B82F6" onChange={setShowFlooded} />
        <Chip label="Bin Full" checked={showBinFull}  color="#F59E0B" onChange={setShowBinFull} />
        <Chip label="Inactive" checked={showInactive} color="#64748B" onChange={setShowInactive} />
      </div>

      {/* ─── Map ────────────────────────────────────────────────────────── */}
      <div className={css(s.mapWrap)}>
        <MapContainer
          center={initialCenter}
          zoom={visible.length > 0 ? 15 : 2}
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
                <div style={{ minWidth: '180px' }}>
                  <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '6px', color: '#F1F5F9' }}>
                    {d.name || d.id}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748B', marginBottom: '10px', fontFamily: "'DM Mono', monospace" }}>
                    {addresses[d.id] || `${d.lat.toFixed(6)}, ${d.lon.toFixed(6)}`}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <PopupRow label="🌊 Flooded"  value={d.flooded ? 'Yes' : 'No'} bad={d.flooded} />
                    <PopupRow label="⚠️ Bin Full" value={d.binFull ? 'Yes' : 'No'} bad={d.binFull} />
                    <PopupRow label="📶 Active"   value={d.active  ? 'Yes' : 'No'} good={d.active} />
                  </div>
                  <div style={{ marginTop: '8px', fontSize: '0.72rem', color: '#475569', fontFamily: "'DM Mono', monospace" }}>
                    {d.lastSeen ? new Date(d.lastSeen).toLocaleString() : '—'}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
          <PanToDevice selectedId={selectedId} devices={visible} userMoved={userMoved} />
        </MapContainer>
      </div>

      {/* ─── Device List ────────────────────────────────────────────────── */}
      <div className={css(s.listCard)}>
        <div className={css(s.listHead)}>Connected Devices</div>
        {visible.length === 0 ? (
          <p className={css(s.empty)}>No devices to show.</p>
        ) : (
          <ul className={css(s.list)}>
            {visible.map((d) => (
              <li
                key={d.id}
                className={css(s.listItem, d.id === selectedId && s.listItemSelected)}
                onClick={() => { userMoved.current = false; setSelectedId(d.id); }}
              >
                <span style={{
                  width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, marginTop: '2px',
                  backgroundColor: d.flooded ? '#3B82F6' : d.binFull ? '#F59E0B' : d.active ? '#10B981' : '#475569',
                }} />
                <div className={css(s.listItemInfo)}>
                  <span className={css(s.listItemName)}>{d.name || d.id}</span>
                  {d.flooded  && <Tag label="Flooded"  color="#3B82F6" />}
                  {d.binFull  && <Tag label="Bin Full" color="#F59E0B" />}
                  {!d.active  && <Tag label="Offline"  color="#64748B" />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

    </div>
  );
}

// ─── Tiny components ──────────────────────────────────────────────────────────
const Chip = ({ label, checked, color, onChange }) => (
  <button
    onClick={() => onChange(!checked)}
    style={{
      padding: '5px 14px', borderRadius: '999px', fontSize: '0.8rem',
      fontWeight: 600, cursor: 'pointer', outline: 'none',
      border: `1px solid ${checked ? color : 'rgba(255,255,255,0.1)'}`,
      backgroundColor: checked ? `${color}22` : 'transparent',
      color: checked ? color : '#64748B',
      fontFamily: "'DM Sans', sans-serif",
    }}
  >
    {label}
  </button>
);

const Tag = ({ label, color }) => (
  <span style={{
    fontSize: '0.7rem', fontWeight: 600, padding: '1px 7px',
    borderRadius: '999px', backgroundColor: `${color}22`,
    color, border: `1px solid ${color}44`,
    fontFamily: "'DM Sans', sans-serif",
  }}>
    {label}
  </span>
);

const PopupRow = ({ label, value, bad, good }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
    <span style={{ color: '#94A3B8' }}>{label}</span>
    <strong style={{ color: bad ? '#EF4444' : good ? '#10B981' : '#E2E8F0' }}>{value}</strong>
  </div>
);

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  page: {
    flex: 1,
    padding: '24px',
    backgroundColor: '#0F172A',
    overflowY: 'auto',
    fontFamily: "'DM Sans', sans-serif",
    color: '#E2E8F0',
    boxSizing: 'border-box',
  },
  title: {
    fontSize: '1.25rem',
    fontWeight: 700,
    color: '#F8FAFC',
    margin: '0 0 16px 0',
  },
  filterRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '16px',
  },
  mapWrap: {
    borderRadius: '12px',
    overflow: 'hidden',
    marginBottom: '20px',
    border: '1px solid rgba(255,255,255,0.06)',
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
  },
  listCard: {
    backgroundColor: '#1E293B',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.06)',
    overflow: 'hidden',
    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
  },
  listHead: {
    padding: '14px 18px',
    fontWeight: 700,
    fontSize: '0.95rem',
    color: '#F8FAFC',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    maxHeight: '260px',
    overflowY: 'auto',
  },
  listItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '11px 18px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    cursor: 'pointer',
    transition: 'background 0.12s ease',
    ':hover': { backgroundColor: '#1a2b3e' },
  },
  listItemSelected: {
    backgroundColor: '#1a2d4a',
    borderLeft: '3px solid #3B82F6',
  },
  listItemInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  listItemName: {
    fontWeight: 600,
    fontSize: '0.875rem',
    color: '#E2E8F0',
  },
  empty: {
    color: '#475569',
    padding: '20px 18px',
    margin: 0,
    fontStyle: 'italic',
  },
});
