-- Migration 002: Emergency & Ambulance requests + password reset tokens

CREATE TABLE IF NOT EXISTS emergency_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_code TEXT NOT NULL UNIQUE,
  request_type TEXT NOT NULL CHECK (request_type IN ('emergency', 'ambulance')),
  requirement TEXT NOT NULL DEFAULT 'Emergency',
  hospital_id INTEGER REFERENCES hospitals(id) ON DELETE SET NULL,
  requester_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requester_name TEXT NOT NULL DEFAULT 'Emergency Caller',
  requester_phone TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dispatched', 'resolved', 'cancelled')),
  handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_emergency_requests_status ON emergency_requests(status, hospital_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id, used_at);
