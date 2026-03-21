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
import { FiMapPin } from 'react-icons/fi';
import { DeviceContext } from '../DeviceContext';
import { LocationContext } from '../LocationContext';

// ─── Inject dark popup + map styles to match Dashboard ───────────────────────
const locationPopupFix = document.createElement('style');
locationPopupFix.textContent = `
  .leaflet-popup { z-index: 1000 !important; }
  .leaflet-popup-content-wrapper {
    background: #1E293B !important;
    color: #E2E8F0 !important;
    border: 1px solid rgba(255,255,255,0.1) !important;
    border-radius: 8px !important;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
  }
  .leaflet-popup-tip { background: #1E293B !important; }
  .leaflet-popup-content {
    margin: 12px 16px !important;
    font-size: 0.875rem !important;
    line-height: 1.6 !important;
  }
  .leaflet-container a.leaflet-popup-close-button { color: #94A3B8 !important; }
  .leaflet-tile-pane { filter: brightness(0.85) saturate(0.9); }
  .leaflet-marker-green  { filter: hue-rotate(100deg) saturate(2); }
  .leaflet-marker-orange { filter: hue-rotate(20deg) saturate(3) brightness(1.1); }
  .leaflet-marker-red    { filter: hue-rotate(-30deg) saturate(3) brightness(0.95); }
  .leaflet-marker-gray   { filter: grayscale(1) brightness(0.7); }
  .loc-device-item:hover { background: #273549 !important; }
`;
if (!document.getElementById('location-popup-fix')) {
  locationPopupFix.id = 'location-popup-fix';
  document.head.appendChild(locationPopupFix);
}

// ─── Icons ────────────────────────────────────────────────────────────────────
const makeIcon = (className) => new L.Icon({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  shadowSize: [41, 41], className,
});
const greenIcon  = makeIcon('leaflet-marker-green');
const orangeIcon = makeIcon('leaflet-marker-orange');
const redIcon    = makeIcon('leaflet-marker-red');
const grayIcon   = makeIcon('leaflet-marker-gray');

// ─── PanToDevice ──────────────────────────────────────────────────────────────
function PanToDevice({ selectedDeviceId, devicesToShow, userMovedMap }) {
  const map = useMapEvents({
    dragstart: () => (userMovedMap.current = true),
    zoomstart: () => (userMovedMap.current = true),
  });
  useEffect(() => {
    if (!selectedDeviceId || userMovedMap.current || !map) return;
    const device = devicesToShow.find((d) => d.id === selectedDeviceId);
    if (device && typeof device.lat === 'number' && typeof device.lon === 'number') {
      map.setView([device.lat, device.lon], 15, { animate: true });
    }
  }, [selectedDeviceId, devicesToShow, map]);
  return null;
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────
const StatusBadge = ({ label, active, activeColor = '#22C55E' }) => (
  <span style={{
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    borderRadius: '999px',
    fontSize: '0.72rem',
    fontWeight: 600,
    letterSpacing: '0.03em',
    backgroundColor: active ? `${activeColor}22` : 'rgba(255,255,255,0.05)',
    color: active ? activeColor : '#64748B',
    border: `1px solid ${active ? `${activeColor}55` : 'rgba(255,255,255,0.08)'}`,
  }}>
    {label}
  </span>
);

// ─── FilterChip ──────────────────────────────────────────────────────────────
const FilterChip = ({ label, checked, onChange, color, icon }) => (
  <button
    onClick={() => onChange(!checked)}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 14px',
      borderRadius: '999px',
      fontSize: '0.8rem',
      fontWeight: 600,
      cursor: 'pointer',
      border: `1px solid ${checked ? color : 'rgba(255,255,255,0.1)'}`,
      backgroundColor: checked ? `${color}22` : 'rgba(255,255,255,0.04)',
      color: checked ? color : '#94A3B8',
      transition: 'all 0.15s ease',
      outline: 'none',
    }}
  >
    {icon} {label}
  </button>
);

// ─── Locations ────────────────────────────────────────────────────────────────
export default function Locations() {
  const { devices } = useContext(DeviceContext);
  const { locations } = useContext(LocationContext);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [deviceAddresses, setDeviceAddresses] = useState({});
  const [showFlooded, setShowFlooded] = useState(false);
  const [showBinFull, setShowBinFull] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const userMovedMap = useRef(false);
  const fetchQueueRef = useRef(new Map());

  const metaById = useMemo(() => {
    const m = new Map();
    (devices || []).forEach((d) => { if (d && d.id) m.set(String(d.id), d); });
    return m;
  }, [devices]);

  const mergedDevices = useMemo(() => {
    return (locations || []).map((loc) => {
      const id = String(loc.id);
      const meta = metaById.get(id) || {};
      return {
        id,
        lat: Number(loc.lat),
        lon: Number(loc.lon),
        lastSeen: loc.lastSeen || null,
        flooded: meta.flooded ?? meta.flood ?? false,
        binFull: meta.binFull ?? meta.bin_full ?? (meta.fillPct ? (Number(meta.fillPct) >= 90) : false),
        active: meta.active ?? meta.online ?? true,
        name: meta.name ?? meta.label ?? id,
        rawMeta: meta,
      };
    });
  }, [locations, metaById, devices]);

  const devicesToShow = useMemo(() => {
    return mergedDevices.filter((d) => {
      if (showInactive && !showFlooded && !showBinFull) return !d.active;
      if (!showInactive && !d.active) return false;
      if (!showFlooded && !showBinFull) return true;
      if (showFlooded && d.flooded) return true;
      if (showBinFull && d.binFull) return true;
      return false;
    });
  }, [mergedDevices, showFlooded, showBinFull, showInactive]);

  // Reverse geocode
  useEffect(() => {
    devicesToShow.forEach((device, idx) => {
      const { id, lat, lon } = device;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      if (deviceAddresses[id]) return;
      if (fetchQueueRef.current.get(id)) return;
      fetchQueueRef.current.set(id, true);
      setTimeout(async () => {
        try {
          const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
          const res = await fetch(url, { headers: { Accept: 'application/json' } });
          const data = res.ok ? await res.json() : null;
          setDeviceAddresses(prev => ({ ...prev, [id]: data?.display_name || 'Unknown location' }));
        } catch {
          setDeviceAddresses(prev => ({ ...prev, [id]: 'No address found' }));
        } finally {
          fetchQueueRef.current.delete(id);
        }
      }, Math.min(2000, idx * 300));
    });
  }, [devicesToShow, deviceAddresses]);

  const initialCenter = useMemo(() => (
    devicesToShow.length > 0 ? [devicesToShow[0].lat, devicesToShow[0].lon] : [0, 0]
  ), [devicesToShow]);
  const initialZoom = useMemo(() => (devicesToShow.length > 0 ? 15 : 2), [devicesToShow]);

  // summary counts
  const floodCount    = mergedDevices.filter(d => d.flooded).length;
  const binFullCount  = mergedDevices.filter(d => d.binFull).length;
  const activeCount   = mergedDevices.filter(d => d.active).length;
  const inactiveCount = mergedDevices.filter(d => !d.active).length;

  return (
    <div style={s.page}>

      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <FiMapPin style={{ color: '#3B82F6', fontSize: '1.2rem' }} />
          <span style={s.headerTitle}>Device Locations</span>
          <span style={s.headerCount}>
            {mergedDevices.length} device{mergedDevices.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div style={s.summaryPills}>
          <StatusBadge label={`${activeCount} Active`}    active={activeCount > 0}    activeColor="#22C55E" />
          <StatusBadge label={`${inactiveCount} Offline`} active={inactiveCount > 0}  activeColor="#94A3B8" />
          <StatusBadge label={`${floodCount} Flooded`}    active={floodCount > 0}     activeColor="#3B82F6" />
          <StatusBadge label={`${binFullCount} Bin Full`} active={binFullCount > 0}   activeColor="#F59E0B" />
        </div>
      </div>

      {/* ─── Filter Row ─────────────────────────────────────────────────────── */}
      <div style={s.filterRow}>
        <span style={s.filterLabel}>Filter:</span>
        <FilterChip label="Flooded"  checked={showFlooded}  onChange={setShowFlooded}  color="#3B82F6" icon="🌊" />
        <FilterChip label="Bin Full" checked={showBinFull}  onChange={setShowBinFull}  color="#F59E0B" icon="⚠️" />
        <FilterChip label="Inactive" checked={showInactive} onChange={setShowInactive} color="#94A3B8" icon="🔌" />
        {(showFlooded || showBinFull || showInactive) && (
          <button
            onClick={() => { setShowFlooded(false); setShowBinFull(false); setShowInactive(false); }}
            style={s.clearBtn}
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* ─── Map ────────────────────────────────────────────────────────────── */}
      <div style={s.mapCard}>
        <MapContainer
          center={initialCenter}
          zoom={initialZoom}
          scrollWheelZoom={true}
          style={{ height: '420px', width: '100%', borderRadius: '10px' }}
          whenCreated={() => { userMovedMap.current = false; }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          {devicesToShow.map((device) => {
            let iconToUse = greenIcon;
            if (device.flooded)      iconToUse = redIcon;
            else if (device.binFull) iconToUse = orangeIcon;
            else if (!device.active) iconToUse = grayIcon;

            return (
              <Marker
                key={device.id}
                position={[device.lat, device.lon]}
                icon={iconToUse}
                eventHandlers={{ click: () => setSelectedDeviceId(device.id) }}
              >
                <Popup>
                  <div style={{ minWidth: '190px', fontSize: '0.875rem', lineHeight: '1.7' }}>
                    <div style={{ fontWeight: 700, marginBottom: '6px', fontSize: '1rem' }}>
                      {device.name || device.id}
                    </div>
                    <div style={{ marginBottom: '8px', color: '#94A3B8', fontSize: '0.78rem' }}>
                      {deviceAddresses[device.id] || `${device.lat.toFixed(6)}, ${device.lon.toFixed(6)}`}
                    </div>
                    <div>🌊 Flooded: <strong>{device.flooded ? 'Yes' : 'No'}</strong></div>
                    <div>⚠️ Bin Full: <strong>{device.binFull ? 'Yes' : 'No'}</strong></div>
                    <div>📶 Active: <strong>{device.active ? 'Yes' : 'No'}</strong></div>
                    <div style={{ marginTop: '6px', color: '#64748B', fontSize: '0.75rem' }}>
                      Last seen: {device.lastSeen ? new Date(device.lastSeen).toLocaleString() : '—'}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}

          <PanToDevice
            selectedDeviceId={selectedDeviceId}
            devicesToShow={devicesToShow}
            userMovedMap={userMovedMap}
          />
        </MapContainer>
      </div>

      {/* ─── Device List ────────────────────────────────────────────────────── */}
      <div style={s.listCard}>
        <div style={s.listHeader}>
          <span style={s.listTitle}>Connected Devices</span>
          <span style={s.listSubtitle}>{devicesToShow.length} shown</span>
        </div>

        {devicesToShow.length === 0 ? (
          <div style={s.emptyState}>
            <FiMapPin style={{ fontSize: '2rem', color: '#334155', marginBottom: '8px' }} />
            <p style={{ color: '#475569', margin: 0 }}>No devices match the current filters.</p>
          </div>
        ) : (
          <div style={s.deviceGrid}>
            {devicesToShow.map((device) => {
              const isSelected = device.id === selectedDeviceId;
              const dotColor = device.flooded ? '#3B82F6'
                : device.binFull ? '#F59E0B'
                : device.active  ? '#22C55E'
                : '#475569';

              return (
                <div
                  key={device.id}
                  className="loc-device-item"
                  style={{
                    ...s.deviceCard,
                    borderLeftColor: isSelected ? '#3B82F6' : 'transparent',
                    backgroundColor: isSelected ? '#1a2d4a' : '#1E293B',
                  }}
                >
                  {/* left: dot + name + address */}
                  <div style={s.deviceCardLeft}>
                    <span style={{
                      width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                      backgroundColor: dotColor,
                      boxShadow: device.active ? `0 0 6px ${dotColor}` : 'none',
                    }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={s.deviceName}>{device.name || device.id}</div>
                      <div style={s.deviceAddress}>
                        {deviceAddresses[device.id]
                          ? deviceAddresses[device.id].split(',').slice(0, 2).join(',')
                          : `${device.lat.toFixed(4)}, ${device.lon.toFixed(4)}`}
                      </div>
                    </div>
                  </div>

                  {/* right: status badges + view button */}
                  <div style={s.deviceCardRight}>
                    <div style={s.badgeRow}>
                      {device.flooded  && <StatusBadge label="Flooded"  active activeColor="#3B82F6" />}
                      {device.binFull  && <StatusBadge label="Bin Full" active activeColor="#F59E0B" />}
                      {!device.active  && <StatusBadge label="Offline"  active activeColor="#94A3B8" />}
                    </div>
                    <button
                      style={s.viewBtn}
                      onClick={() => { userMovedMap.current = false; setSelectedDeviceId(device.id); }}
                    >
                      📍 View
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = {
  page: {
    padding: '24px',
    backgroundColor: '#0F1B34',
    minHeight: '100%',
    color: '#E2E8F0',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '12px',
    marginBottom: '16px',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  headerTitle: {
    fontSize: '1.25rem',
    fontWeight: 700,
    color: '#F1F5F9',
  },
  headerCount: {
    fontSize: '0.8rem',
    color: '#64748B',
    backgroundColor: 'rgba(255,255,255,0.06)',
    padding: '2px 8px',
    borderRadius: '999px',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  summaryPills: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  filterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    marginBottom: '16px',
    padding: '12px 16px',
    backgroundColor: '#1E293B',
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.06)',
  },
  filterLabel: {
    fontSize: '0.8rem',
    color: '#64748B',
    fontWeight: 600,
    marginRight: '4px',
  },
  clearBtn: {
    marginLeft: '4px',
    padding: '6px 12px',
    borderRadius: '999px',
    fontSize: '0.78rem',
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid rgba(255,100,100,0.3)',
    backgroundColor: 'rgba(255,100,100,0.08)',
    color: '#F87171',
    transition: 'all 0.15s ease',
    outline: 'none',
  },
  mapCard: {
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
  },
  listHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  listTitle: {
    fontSize: '0.95rem',
    fontWeight: 700,
    color: '#F1F5F9',
  },
  listSubtitle: {
    fontSize: '0.78rem',
    color: '#64748B',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '40px 20px',
  },
  deviceGrid: {
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '280px',
    overflowY: 'auto',
  },
  deviceCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    borderLeft: '3px solid transparent',
    cursor: 'pointer',
    transition: 'background 0.15s ease',
    gap: '12px',
  },
  deviceCardLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flex: 1,
    minWidth: 0,
  },
  deviceCardRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: 0,
  },
  badgeRow: {
    display: 'flex',
    gap: '4px',
  },
  deviceName: {
    fontSize: '0.875rem',
    fontWeight: 600,
    color: '#E2E8F0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '160px',
  },
  deviceAddress: {
    fontSize: '0.72rem',
    color: '#64748B',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '220px',
    marginTop: '1px',
  },
  viewBtn: {
    backgroundColor: '#1D4ED8',
    color: 'white',
    border: 'none',
    padding: '5px 10px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.78rem',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
};
