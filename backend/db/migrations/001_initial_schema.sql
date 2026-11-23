-- MedTrack Smart Blood Availability & IoT Blood Transport Schema (v1)

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('patient', 'hospital', 'blood_bank', 'admin')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  phone_verified INTEGER NOT NULL DEFAULT 0,
  verification_code_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hospitals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  registration_number TEXT NOT NULL UNIQUE,
  hospital_type TEXT NOT NULL DEFAULT 'Multi-Specialty',
  contact_person TEXT NOT NULL,
  official_email TEXT NOT NULL,
  mobile TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  pin_code TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'approved', 'rejected')),
  verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verified_at TEXT,
  general_beds INTEGER NOT NULL DEFAULT 0,
  icu_beds INTEGER NOT NULL DEFAULT 0,
  emergency_beds INTEGER NOT NULL DEFAULT 0,
  ambulances INTEGER NOT NULL DEFAULT 0,
  rating REAL NOT NULL DEFAULT 4.5,
  travel_time_min INTEGER NOT NULL DEFAULT 15,
  emergency_capable INTEGER NOT NULL DEFAULT 1,
  specialists_json TEXT NOT NULL DEFAULT '[]',
  facilities_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'limited', 'full')),
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blood_banks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  license_number TEXT NOT NULL UNIQUE,
  contact_person TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  pin_code TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'approved', 'rejected')),
  verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blood_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blood_bank_id INTEGER NOT NULL REFERENCES blood_banks(id) ON DELETE CASCADE,
  blood_group TEXT NOT NULL CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-')),
  units_available INTEGER NOT NULL DEFAULT 0 CHECK (units_available >= 0),
  low_threshold INTEGER NOT NULL DEFAULT 8,
  critical_threshold INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'Unavailable' CHECK (status IN ('Sufficient', 'Low', 'Critical', 'Unavailable')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (blood_bank_id, blood_group)
);

CREATE TABLE IF NOT EXISTS inventory_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blood_bank_id INTEGER NOT NULL REFERENCES blood_banks(id) ON DELETE CASCADE,
  blood_group TEXT NOT NULL CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-')),
  previous_units INTEGER NOT NULL,
  delta_units INTEGER NOT NULL,
  new_units INTEGER NOT NULL,
  reason TEXT NOT NULL,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blood_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_code TEXT NOT NULL UNIQUE,
  requester_hospital_id INTEGER REFERENCES hospitals(id) ON DELETE SET NULL,
  requester_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  blood_bank_id INTEGER NOT NULL REFERENCES blood_banks(id) ON DELETE CASCADE,
  blood_group TEXT NOT NULL CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-')),
  units_requested INTEGER NOT NULL CHECK (units_requested > 0),
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal', 'urgent', 'critical')),
  patient_reference TEXT,
  recipient_contact TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'dispatched', 'delivered', 'cancelled')),
  rejection_reason TEXT,
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_uid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  hardware_model TEXT NOT NULL DEFAULT 'ESP32-WROOM-32',
  api_key_hash TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  cooling_policy_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'maintenance')),
  firmware_version TEXT NOT NULL DEFAULT '1.0.0',
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS device_sensors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  sensor_type TEXT NOT NULL,
  label TEXT NOT NULL,
  unit TEXT NOT NULL,
  min_threshold REAL,
  max_threshold REAL,
  config_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fault', 'disabled')),
  UNIQUE (device_id, sensor_type)
);

CREATE TABLE IF NOT EXISTS transports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transport_code TEXT NOT NULL UNIQUE,
  blood_request_id INTEGER NOT NULL REFERENCES blood_requests(id) ON DELETE CASCADE,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
  origin_blood_bank_id INTEGER NOT NULL REFERENCES blood_banks(id) ON DELETE RESTRICT,
  destination_hospital_id INTEGER REFERENCES hospitals(id) ON DELETE SET NULL,
  recipient_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recipient_contact TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'in_transit', 'arrived', 'delivered', 'cancelled')),
  dispatched_at TEXT NOT NULL DEFAULT (datetime('now')),
  arrived_at TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sensor_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  transport_id INTEGER REFERENCES transports(id) ON DELETE SET NULL,
  sensor_type TEXT NOT NULL,
  value_numeric REAL,
  value_json TEXT,
  unit TEXT NOT NULL,
  quality_status TEXT NOT NULL DEFAULT 'ok' CHECK (quality_status IN ('ok', 'warning', 'critical', 'sensor_error')),
  cooling_active INTEGER NOT NULL DEFAULT 0,
  is_simulated INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS temperature_excursions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  transport_id INTEGER REFERENCES transports(id) ON DELETE SET NULL,
  excursion_type TEXT NOT NULL CHECK (excursion_type IN ('high', 'low', 'sensor_failure')),
  threshold_c REAL,
  observed_value_c REAL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS gps_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  transport_id INTEGER REFERENCES transports(id) ON DELETE SET NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  speed_kmh REAL DEFAULT 0,
  satellites INTEGER DEFAULT 0,
  hdop REAL DEFAULT 1.0,
  fix_valid INTEGER NOT NULL DEFAULT 1,
  is_simulated INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS otp_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transport_id INTEGER NOT NULL REFERENCES transports(id) ON DELETE CASCADE,
  recipient_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  otp_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  unlock_token_hash TEXT,
  unlock_expires_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS access_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transport_id INTEGER REFERENCES transports(id) ON DELETE SET NULL,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'otp_issued', 'otp_valid', 'otp_invalid', 'lockout',
    'unlock_authorized', 'door_opened', 'door_closed', 'unauthorized_door_open'
  )),
  success INTEGER NOT NULL DEFAULT 1,
  details TEXT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source_ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_role TEXT,
  target_hospital_id INTEGER REFERENCES hospitals(id) ON DELETE CASCADE,
  target_blood_bank_id INTEGER REFERENCES blood_banks(id) ON DELETE CASCADE,
  device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
  transport_id INTEGER REFERENCES transports(id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  acknowledged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata_json TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hospitals_city_status ON hospitals(city, verification_status);
CREATE INDEX IF NOT EXISTS idx_blood_inventory_group ON blood_inventory(blood_group, status);
CREATE INDEX IF NOT EXISTS idx_blood_requests_status ON blood_requests(status, blood_bank_id);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_device_time ON sensor_readings(device_id, sensor_type, recorded_at);
CREATE INDEX IF NOT EXISTS idx_gps_locations_transport_time ON gps_locations(transport_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_otp_tokens_transport ON otp_tokens(transport_id, used_at);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);
