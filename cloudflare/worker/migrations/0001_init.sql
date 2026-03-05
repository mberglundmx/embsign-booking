PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  admin_apartment_id TEXT NOT NULL DEFAULT 'admin',
  admin_password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_configs (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS apartments (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  house TEXT,
  lgh_internal TEXT,
  skv_lgh TEXT,
  access_groups TEXT,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  booking_type TEXT NOT NULL DEFAULT 'time-slot',
  category TEXT NOT NULL DEFAULT '',
  slot_duration_minutes INTEGER NOT NULL DEFAULT 60,
  slot_start_hour INTEGER NOT NULL DEFAULT 6,
  slot_end_hour INTEGER NOT NULL DEFAULT 22,
  max_future_days INTEGER NOT NULL DEFAULT 30,
  min_future_days INTEGER NOT NULL DEFAULT 0,
  max_bookings INTEGER NOT NULL DEFAULT 2,
  allow_houses TEXT NOT NULL DEFAULT '',
  deny_apartment_ids TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  price_weekday_cents INTEGER NOT NULL DEFAULT 0,
  price_weekend_cents INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL DEFAULT 0,
  is_billable INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_resources_tenant_active ON resources(tenant_id, is_active, id);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  apartment_id TEXT NOT NULL,
  resource_id INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_billable INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bookings_resource_time
  ON bookings(tenant_id, resource_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_bookings_apartment_time
  ON bookings(tenant_id, apartment_id, start_time, end_time);

CREATE TABLE IF NOT EXISTS booking_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  resource_id INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_booking_blocks_resource_time
  ON booking_blocks(tenant_id, resource_id, start_time, end_time);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  apartment_id TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_tenant_token ON sessions(tenant_id, token);

CREATE TABLE IF NOT EXISTS rfid_tags (
  tenant_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  apartment_id TEXT NOT NULL,
  house TEXT NOT NULL DEFAULT '',
  lgh_internal TEXT NOT NULL DEFAULT '',
  skv_lgh TEXT NOT NULL DEFAULT '',
  access_groups TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, uid),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rfid_tags_tenant_apartment ON rfid_tags(tenant_id, apartment_id);
