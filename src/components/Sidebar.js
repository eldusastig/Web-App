import React from 'react';
import { NavLink } from 'react-router-dom';
import { FiHome, FiMapPin, FiActivity, FiInfo, FiLogOut } from 'react-icons/fi';

const Sidebar = ({ onLogout }) => {
  return (
    <div style={styles.sidebar}>
      <div style={styles.header}>EcoTrack Dashboard</div>
      <nav>
        <MenuItem icon={<FiHome />} label="Home" to="/" />
        <MenuItem icon={<FiMapPin />} label="Locations" to="/locations" />
        <MenuItem icon={<FiActivity />} label="Status" to="/status" />
        <MenuItem icon={<FiInfo />} label="About" to="/about" />
        <MenuItem icon={<FiLogOut />} label="Logout" onClick={onLogout} /> {/* Logout button */}
      </nav>
    </div>
  );
};

const MenuItem = ({ icon, label, to, onClick }) => {
  return (
    <div style={styles.menuItem} onClick={onClick}>
      <NavLink
        to={to}
        style={({ isActive }) => ({
          ...styles.navLink,
          color: isActive ? '#61dafb' : 'white',
        })}
      >
        <span style={styles.icon}>{icon}</span>
        <span>{label}</span>
      </NavLink>
    </div>
  );
};

const styles = {
  sidebar: {
    width: '250px',
    height: '100vh',
    backgroundColor: '#1F2937',
    color: 'white',
    padding: '20px',
  },
  header: {
    fontSize: '24px',
    fontWeight: 'bold',
    marginTop: '20px',
    marginBottom: '20px',
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px',
    cursor: 'pointer',
    borderRadius: '6px',
    marginBottom: '10px',
    transition: 'background-color 0.2s ease',
  },
  navLink: {
    textDecoration: 'none',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
  },
  icon: {
    marginRight: '10px',
    fontSize: '1.2rem',
  },
};

export default Sidebar;
