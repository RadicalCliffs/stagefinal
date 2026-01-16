/**
 * Admin Password Gate
 *
 * A minimal password entry page that grants admin access to the visual editor.
 * No identifying text or visual elements - just a blank input and submit button.
 */

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

// The admin access key stored in localStorage after successful authentication
const ADMIN_ACCESS_KEY = 'prz_admin_access';
const ADMIN_ACCESS_VALUE = 'granted';

// Password hash comparison (simple obfuscation - not meant to be cryptographically secure)
// The actual password check happens client-side
const checkPassword = (input: string): boolean => {
  return input === 'aintn0body';
};

export function isAdminAccessGranted(): boolean {
  return localStorage.getItem(ADMIN_ACCESS_KEY) === ADMIN_ACCESS_VALUE;
}

export function grantAdminAccess(): void {
  localStorage.setItem(ADMIN_ACCESS_KEY, ADMIN_ACCESS_VALUE);
}

export function revokeAdminAccess(): void {
  localStorage.removeItem(ADMIN_ACCESS_KEY);
}

export default function AdminPasswordGate() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    if (checkPassword(password)) {
      grantAdminAccess();
      // Navigate to the actual editor
      navigate('/a/e/o/x/u/editor', { replace: true });
    } else {
      setError(true);
      setPassword('');
      // Clear error after a moment
      setTimeout(() => setError(false), 1500);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0a0b0d',
      }}
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '8px' }}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          style={{
            padding: '8px 12px',
            backgroundColor: error ? '#1a0a0a' : '#1a1a1a',
            border: error ? '1px solid #3a0a0a' : '1px solid #333',
            borderRadius: '4px',
            color: '#fff',
            outline: 'none',
            width: '200px',
            transition: 'background-color 0.3s, border-color 0.3s',
          }}
        />
        <button
          type="submit"
          style={{
            padding: '8px 16px',
            backgroundColor: '#222',
            border: '1px solid #333',
            borderRadius: '4px',
            color: '#666',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          &rarr;
        </button>
      </form>
    </div>
  );
}
