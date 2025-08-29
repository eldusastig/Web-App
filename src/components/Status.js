// src/components/Status.jsx
import React, { useContext, useState } from "react";
import { FiTrash2, FiPlusCircle, FiWifi } from "react-icons/fi";
import { StyleSheet, css } from "aphrodite";
import { MetricsContext } from "../MetricsContext";

// ✅ Inline Widget component
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
  const { activeDevices, floodRisks, fullBinAlerts } = useContext(MetricsContext);
  const [devices, setDevices] = useState([]);

  const deleteDevice = (deviceId) => {
    console.log("[Status] deleteDevice called for", deviceId);
    const confirmDelete = window.confirm(`Are you sure you want to delete device ${deviceId}?`);
    if (!confirmDelete) {
      console.log(`[Status] user cancelled delete for ${deviceId}`);
      return;
    }
    setDevices((prev) => prev.filter((d) => d.id !== deviceId));
  };

  return (
    <div className={css(styles.container)}>
      {/* Top row widgets */}
      <div className={css(styles.widgetRow)}>
        <Widget icon={<FiWifi />} title="Active Devices" value={activeDevices} />
        <Widget icon={<FiPlusCircle />} title="Flood Risks" value={floodRisks} />
        <Widget icon={<FiTrash2 />} title="Full Bin Alerts" value={fullBinAlerts} />
      </div>

      {/* Device list */}
      <div className={css(styles.deviceList)}>
        {devices.map((device) => (
          <div key={device.id} className={css(styles.deviceCard)}>
            <span>{device.name}</span>
            <button
              className={css(styles.deleteBtn)}
              onClick={() => deleteDevice(device.id)}
            >
              <FiTrash2 />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
  },
  widgetRow: {
    display: "flex",
    gap: 16,
    marginBottom: 20,
  },
  deviceList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  deviceCard: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#f9f9f9",
    padding: 12,
    borderRadius: 8,
  },
  deleteBtn: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: 18,
    color: "#d33",
  },

  // ✅ Widget styles
  widget: {
    display: "flex",
    alignItems: "center",
    padding: 12,
    borderRadius: 8,
    background: "#fff",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    minWidth: 180,
  },
  widgetIcon: {
    marginRight: 10,
    fontSize: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  widgetBody: {
    display: "flex",
    flexDirection: "column",
  },
  widgetTitle: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  widgetValue: {
    fontSize: 18,
    fontWeight: 700,
    color: "#111",
  },
});
