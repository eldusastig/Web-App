// src/components/Status.jsx
import React, { useContext, useState, useEffect, useRef } from 'react';
import { MetricsContext } from '../MetricsContext';
import { realtimeDB } from '../firebase';
import { ref as dbRef, remove, update } from 'firebase/database';
import { FiTrash2, FiPlusCircle, FiWifi, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { StyleSheet, css } from 'aphrodite';

export default function Status() {
  const { devices, activeDevices, floodRisks, fullBinAlerts, logs, authReady } =
    useContext(MetricsContext);

  const [expanded, setExpanded] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState({});
  const deleteTimers = useRef({});

  const toggleExpand = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleDelete = (id) => {
    if (!authReady) {
      console.warn('Delete blocked: auth not ready');
      return;
    }
    if (!deleteConfirm[id]) {
      setDeleteConfirm((prev) => ({ ...prev, [id]: true }));
      if (deleteTimers.current[id]) clearTimeout(deleteTimers.current[id]);
      deleteTimers.current[id] = setTimeout(() => {
        setDeleteConfirm((prev) => ({ ...prev, [id]: false }));
        deleteTimers.current[id] = null;
      }, 5000);
      console.log(`[Status] user asked to delete ${id} (confirming)`);
      return;
    }
    const deviceRef = dbRef(realtimeDB, `devices/${id}`);
    remove(deviceRef)
      .then(() => {
        console.log(`[Status] device ${id} removed`);
      })
      .catch((err) => {
        console.error(`[Status] failed to remove ${id}`, err);
      });
    setDeleteConfirm((prev) => ({ ...prev, [id]: false }));
    if (deleteTimers.current[id]) {
      clearTimeout(deleteTimers.current[id]);
      deleteTimers.current[id] = null;
    }
  };

  useEffect(() => {
    return () => {
      Object.values(deleteTimers.current).forEach((t) => t && clearTimeout(t));
    };
  }, []);

  return (
    <div className={css(styles.statusContainer)}>
      {/* Widgets */}
      <div className={css(styles.widgetGrid)}>
        <Widget icon={<FiWifi />} label="Active Devices" value={activeDevices} />
        <Widget icon={<FiPlusCircle />} label="Flood Risks" value={floodRisks} />
        <Widget icon={<FiTrash2 />} label="Full Bin Alerts" value={fullBinAlerts} />
      </div>

      {/* Device Health */}
      <div className={css(styles.deviceHealth)}>
        <h2>Device Health</h2>
        <table className={css(styles.deviceTable)}>
          <thead>
            <tr className={css(styles.tableHeader)}>
              <th>ID</th>
              <th>Status</th>
              <th>Last Seen</th>
              <th>Battery</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(devices).map(([id, device]) => (
              <React.Fragment key={id}>
                <tr
                  className={css(
                    styles.deviceRow,
                    !device.enabled && styles.disabledRow
                  )}
                  onClick={() => toggleExpand(id)}
                >
                  <td className={css(styles.deviceIdCell)}>
                    <span className={css(styles.expandIcon)}>
                      {expanded[id] ? <FiChevronUp /> : <FiChevronDown />}
                    </span>
                    {id}
                    {!device.enabled && (
                      <span className={css(styles.disabledBadge)}>Disabled</span>
                    )}
                  </td>
                  <td className={device.alert ? css(styles.alert) : css(styles.ok)}>
                    {device.alert ? 'ALERT' : 'OK'}
                  </td>
                  <td>{device.lastSeen || '-'}</td>
                  <td>{device.battery ? `${device.battery}%` : '-'}</td>
                  <td>
                    {deleteConfirm[id] ? (
                      <span className={css(styles.inlineConfirm)}>
                        <button
                          className={css(styles.confirmBtn)}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(id);
                          }}
                        >
                          Confirm
                        </button>
                        <button
                          className={css(styles.cancelBtn)}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirm((prev) => ({ ...prev, [id]: false }));
                          }}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        className={css(styles.deleteBtn)}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(id);
                        }}
                      >
                        <FiTrash2 />
                      </button>
                    )}
                  </td>
                </tr>
                {expanded[id] && (
                  <tr>
                    <td colSpan="5">
                      <div className={css(styles.logItem)}>
                        <div className={css(styles.logTimestamp)}>
                          Logs: {logs[id]?.length || 0} entries
                        </div>
                        <div className={css(styles.logClasses)}>
                          {(logs[id] || []).slice(-5).map((entry, idx) => (
                            <div key={idx}>
                              [{new Date(entry.ts).toLocaleString()}] {entry.msg}
                            </div>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Widget({ icon, label, value }) {
  return (
    <div className={css(styles.widget)}>
      <div className={css(styles.widgetIcon)}>{icon}</div>
      <div className={css(styles.widgetLabel)}>{label}</div>
      <div className={css(styles.widgetValue)}>{value}</div>
    </div>
  );
}

const styles = StyleSheet.create({
  statusContainer: {
    padding: '20px',
    fontFamily: 'Arial, sans-serif',
  },

  widgetGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '12px',
    marginBottom: '20px',
  },

  widget: {
    background: '#fff',
    borderRadius: '8px',
    padding: '16px',
    boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },

  widgetIcon: {
    fontSize: '1.5rem',
    marginBottom: '8px',
  },

  widgetLabel: {
    fontSize: '0.9rem',
    color: '#666',
  },

  widgetValue: {
    fontSize: '1.4rem',
    fontWeight: 'bold',
    marginTop: '4px',
  },

  deviceHealth: {
    marginTop: '20px',
  },

  deviceTable: {
    width: '100%',
    borderCollapse: 'collapse',
    marginTop: '10px',
  },

  tableHeader: {
    backgroundColor: '#f5f5f5',
    textAlign: 'left',
  },

  deviceRow: {
    cursor: 'pointer',
    transition: 'background-color 0.2s ease',
    ':hover': {
      backgroundColor: '#f0f8ff',
    },
  },

  disabledRow: {
    backgroundColor: '#f9f9f9',
    color: '#888',
  },

  deviceIdCell: {
    fontWeight: 'bold',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },

  expandIcon: {
    marginRight: '6px',
  },

  disabledBadge: {
    backgroundColor: '#ccc',
    color: '#fff',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '0.8em',
  },

  alert: {
    color: '#d9534f',
    fontWeight: 'bold',
  },

  ok: {
    color: '#5cb85c',
    fontWeight: 'bold',
  },

  inlineConfirm: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },

  confirmBtn: {
    backgroundColor: '#d9534f',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '4px 8px',
    cursor: 'pointer',
    ':hover': {
      backgroundColor: '#c9302c',
    },
  },

  cancelBtn: {
    backgroundColor: '#6c757d',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '4px 8px',
    cursor: 'pointer',
    ':hover': {
      backgroundColor: '#5a6268',
    },
  },

  deleteBtn: {
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: '1.2rem',
    color: '#d9534f',
    ':hover': {
      color: '#c9302c',
    },
  },

  logItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '4px 0',
    borderBottom: '1px solid #eee',
    fontSize: '0.9rem',
  },

  logTimestamp: {
    flex: '0 0 180px',
    color: '#666',
  },

  logClasses: {
    flex: 1,
    color: '#333',
  },
});
