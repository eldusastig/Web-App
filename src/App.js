// src/App.js

import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { StyleSheet, css } from 'aphrodite';

import Sidebar   from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Locations from './components/Locations';
import Status    from './components/Status';
import About     from './components/About';
import Login     from './components/Login';

import { DeviceProvider } from './DeviceContext';
import { MetricsProvider } from './MetricsContext';

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const handleLogin  = () => setIsLoggedIn(true);
  const handleLogout = () => setIsLoggedIn(false);

  return (
    // 1) Wrap everything in DeviceProvider so all MQTT logic lives there
    <DeviceProvider>
      {/* 2) Wrap in MetricProvider so Dashboard/Status can read summary counts */}
      <MetricsProvider>
        <div className={css(styles.appContainer)}>
          <Router>
            {!isLoggedIn ? (
              <Login onLogin={handleLogin} />
            ) : (
              <>
                <Sidebar onLogout={handleLogout} />
                <div className={css(styles.contentContainer)}>
                  <Routes>
                    <Route path="/"         element={<Dashboard />} />
                    <Route path="/locations" element={<Locations />} />
                    <Route path="/status"    element={<Status />} />
                    <Route path="/about"     element={<About />} />
                  </Routes>
                </div>
              </>
            )}
          </Router>
        </div>
      </MetricsProvider>
    </DeviceProvider>
  );
}

const styles = StyleSheet.create({
  appContainer: {
    display: 'flex',
    height: '100vh',
  },
  contentContainer: {
    flex: 1,
    backgroundColor: '#0F1B34',
    color: 'white',
    padding: '24px',
    overflow: 'auto',
  },
});
