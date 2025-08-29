// src/components/Status.jsx
import React, { useContext, useState, useEffect } from "react";
import { MetricsContext } from "../MetricsContext";
import { realtimeDB } from "../firebase";
import { ref as dbRef, onValue, remove } from "firebase/database";
import {
  FiTrash2,
  FiPlusCircle,
  FiWifi,
  FiChevronDown,
  FiChevronUp,
} from "react-icons/fi";
import { StyleSheet, css } from "aphrodite";

// ✅ Widget component
const Widget = ({ icon, title, value }) => (
  <div className={css(styles.widget)}>
    <div className={css(styles.widgetIcon)}>{icon}</div>
    <div className={css(styles.widgetBody)}>
      <div className={css(styles.widgetTitle)}>{title}</div>
      <div className={css(styles.widgetValue)}>{value}</div>
    </div>
  </div>
);

export default function Status() {
  const { activeDevices, floodRisks, fullBinAlerts } =
    useContext(MetricsContext);
  const [devices, setDevices] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [realTimeAlerts, setRealTimeAlerts] = useState([]);
  const [logs, setLogs] = useState([]); // ✅ Global logs

  // ✅ Load devices from Firebase
  useEffect(() => {
    const devicesRef = dbRef(realtimeDB, "devices");
    const unsub = onValue(devicesRef, (snapshot) => {
      const data = snapshot.val() || {};
      const arr = Object.entries(data).map(([id, d]) => ({
        id,
        ...d,
      }));
      setDevices(arr);
    });
    return () => unsub();
  }, []);

  // ✅ Delete device
  const deleteDevice = (deviceId) => {
    console.log("[Status] deleteDevice called for", deviceId);
    const confirmDelete = window.confirm(
      `Are you sure you want to delete device ${deviceId}?`
    );
    if (!confirmDelete) {
      console.log(`[Status] user cancelled delete for ${deviceId}`);
      return;
    }
    setDevices((prev) => prev.filter((d) => d.id !== deviceId));
    remove(dbRef(realtimeDB, `devices/${deviceId}`));
    setLogs((prev) => [
      ...prev,
      `${new Date().toLocaleString()}: Deleted device ${deviceId}`,
    ]);
  };

  // ✅ Toggle expand/collapse
  const toggleExpand = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // ✅ Append real-time alerts from devices
  useEffect(() => {
    if (!devices.length) return;
    const latest = devices
      .map((d) => d.logs?.slice(-1)[0])
      .filter(Boolean)
      .map((msg, idx) => `Device ${devices[idx].id}: ${msg}`);
    setRealTimeAlerts(latest);

    // Add to global logs
    if (latest.length > 0) {
      setLogs((prev) => [
        ...prev,
        `${new Date().toLocaleString()}: ${latest.join(" | ")}`,
      ]);
    }
  }, [devices]);

  return (
    <div className={css(styles.container)}>
      {/* Top row widgets */}
      <div className={css(styles.widgetRow)}>
        <Widget icon={<FiWifi />} title="Active Devices" value={activeDevices} />
        <Widget
          icon={<FiPlusCircle />}
          title="Flood Risks"
          value={floodRisks}
        />
        <Widget
          icon={<FiTrash2 />}
          title="Full Bin Alerts"
          value={fullBinAlerts}
        />
      </div>

      {/* Devices list */}
      <div className={css(styles.deviceList)}>
        {devices.map((device) => (
          <div key={device.id} className={css(styles.deviceCard)}>
            <div
              className={css(styles.deviceHeader)}
              onClick={() => toggleExpand(device.id)}
            >
              <span>{device.name || device.id}</span>
              {expanded[device.id] ? <FiChevronUp /> : <FiChevronDown />}
            </div>
            {expanded[device.id] && (
              <div className={css(styles.deviceDetails)}>
                {/* Logs */}
                <div className={css(styles.logs)}>
                  <h4>Detection Logs</h4>
                  {device.logs && device.logs.length > 0 ? (
                    <ul>
                      {device.logs.map((log, idx) => (
                        <li key={idx}>{log}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>No logs available.</p>
                  )}
                </div>

                {/* Delete button */}
                <button
                  className={css(styles.deleteButton)}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteDevice(device.id);
                  }}
                >
                  <FiTrash2 /> Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Real-time Alerts */}
      <div className={css(styles.alerts)}>
        <h3>Real-Time Alerts</h3>
        {realTimeAlerts.length > 0 ? (
          <ul>
            {realTimeAlerts.map((alert, idx) => (
              <li key={idx}>{alert}</li>
            ))}
          </ul>
        ) : (
          <p>No active alerts.</p>
        )}
      </div>

      {/* ✅ Global Activity Logs */}
      <div className={css(styles.activityLogs)}>
        <h3>Activity Logs</h3>
        {logs.length > 0 ? (
          <ul>
            {logs.map((log, idx) => (
              <li key={idx}>{log}</li>
            ))}
          </ul>
        ) : (
          <p>No activity yet.</p>
        )}
      </div>
    </div>
  );
}

const styles = StyleSheet.create({
  container: {
    background: "#1a1a1a",
    color: "#fff",
    padding: "20px",
    minHeight: "100vh",
    fontFamily: "Arial, sans-serif",
  },
  widgetRow: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "15px",
    marginBottom: "20px",
  },
  widget: {
    background: "#2a2a2a",
    borderRadius: "12px",
    padding: "15px",
    display: "flex",
    alignItems: "center",
    boxShadow: "0 2px 5px rgba(0,0,0,0.3)",
  },
  widgetIcon: {
    fontSize: "24px",
    marginRight: "12px",
  },
  widgetBody: {
    display: "flex",
    flexDirection: "column",
  },
  widgetTitle: {
    fontSize: "14px",
    color: "#aaa",
  },
  widgetValue: {
    fontSize: "20px",
    fontWeight: "bold",
  },
  deviceList: {
    marginTop: "20px",
  },
  deviceCard: {
    background: "#2a2a2a",
    borderRadius: "12px",
    marginBottom: "10px",
    overflow: "hidden",
  },
  deviceHeader: {
    padding: "12px",
    display: "flex",
    justifyContent: "space-between",
    cursor: "pointer",
    background: "#333",
  },
  deviceDetails: {
    padding: "12px",
  },
  logs: {
    marginBottom: "10px",
  },
  deleteButton: {
    background: "#d9534f",
    border: "none",
    color: "#fff",
    padding: "8px 12px",
    borderRadius: "6px",
    cursor: "pointer",
  },
  alerts: {
    marginTop: "20px",
    background: "#2a2a2a",
    borderRadius: "12px",
    padding: "15px",
  },
  activityLogs: {
    marginTop: "20px",
    background: "#2a2a2a",
    borderRadius: "12px",
    padding: "15px",
  },
});
