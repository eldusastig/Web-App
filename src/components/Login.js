import React, { useState } from 'react';
import { StyleSheet, css } from 'aphrodite';

const Login = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (username === 'admin' && password === 'admin123') {
      onLogin();
    } else {
      setError('Invalid credentials');
    }
  };

  return (
    <div className={css(styles.loginContainer)}>
      <form onSubmit={handleSubmit} className={css(styles.loginForm)}>
        <h2 className={css(styles.title)}>Login</h2>

        <input
          className={css(styles.input)}
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className={css(styles.input)}
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className={css(styles.error)}>{error}</p>}
        <button className={css(styles.button)} type="submit">Login</button>
      </form>
    </div>
  );
};

const styles = StyleSheet.create({
  loginContainer: {
    height: '100vh',
    width: '100vw',
    backgroundColor: '#0F1B34',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '0 10px',
    boxSizing: 'border-box',
  },
  loginForm: {
    backgroundColor: '#1E293B',
    padding: '50px',
    borderRadius: '12px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '100%',
    maxWidth: '400px',
    boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
  },
  title: {
    color: 'white',
    marginBottom: '20px',
    textAlign: 'center',
    fontSize: '2rem',
  },
  input: {
    marginBottom: '16px',
    padding: '10px',
    borderRadius: '6px',
    border: 'none',
    fontSize: '1rem',
    width: '100%',
  },
  button: {
    padding: '10px',
    marginTop: '5px',
    backgroundColor: '#3B82F6',
    color: 'white',
    fontWeight: 'bold',
    fontSize: '1rem',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background-color 0.2s ease',
    ':hover': {
      backgroundColor: '#2563EB',
    },
  },
  error: {
    color: '#EF4444',
    marginBottom: '16px',
    fontSize: '0.875rem',
    textAlign: 'center',
  },
});

export default Login;
