import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { config } from "../config/env.js";

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];

export function computeStockStatus(units, lowThreshold = 8, criticalThreshold = 3) {
  if (units <= 0) return "Unavailable";
  if (units <= criticalThreshold) return "Critical";
  if (units <= lowThreshold) return "Low";
  return "Sufficient";
}

export function hashApiKey(rawKey) {
  return crypto.createHash("sha256").update(String(rawKey)).digest("hex");
}

/**
 * Seeds baseline realistic data only when the database is empty.
 * Preserves the original 8 Indian hospitals from hospitals.js so all existing frontend
 * discovery and emergency flows keep working seamlessly via the live backend API.
 */
export function seedDatabase(db) {
  const existingUsers = db.queryOne("SELECT COUNT(*) AS count FROM users");
  if (existingUsers && Number(existingUsers.count) > 0) {
    return { seeded: false };
  }

  const demoPasswordHash = bcrypt.hashSync("MedTrack@2026", 10);

  return db.transaction(() => {
    // 1. Seed Users (Admin, Hospital Staff, Blood Bank Staff, Patient)
    const adminId = db.execute(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, email_verified, phone_verified)
       VALUES (?, ?, ?, ?, ?, 'admin', 1, 1)`,
      ["System", "Administrator", "admin@medtrack.in", "9800000001", demoPasswordHash]
    ).lastInsertRowid;

    const rubyUserId = db.execute(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, email_verified, phone_verified)
       VALUES (?, ?, ?, ?, ?, 'hospital', 1, 1)`,
      ["Dr. Ananya", "Deshmukh", "ruby@medtrack.in", "9822011101", demoPasswordHash]
    ).lastInsertRowid;

    const kemUserId = db.execute(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, email_verified, phone_verified)
       VALUES (?, ?, ?, ?, ?, 'hospital', 1, 1)`,
      ["Dr. Vikram", "Kulkarni", "kem@medtrack.in", "9822011102", demoPasswordHash]
    ).lastInsertRowid;

    const manipalUserId = db.execute(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, email_verified, phone_verified)
       VALUES (?, ?, ?, ?, ?, 'hospital', 1, 1)`,
      ["Dr. Meera", "Nair", "manipal@medtrack.in", "9845011103", demoPasswordHash]
    ).lastInsertRowid;

    const cityBankUserId = db.execute(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, email_verified, phone_verified)
       VALUES (?, ?, ?, ?, ?, 'blood_bank', 1, 1)`,
      ["Rohan", "Joshi", "cityblood@medtrack.in", "9822022201", demoPasswordHash]
    ).lastInsertRowid;

    const lifeBankUserId = db.execute(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, email_verified, phone_verified)
       VALUES (?, ?, ?, ?, ?, 'blood_bank', 1, 1)`,
      ["Priya", "Patil", "lifeblood@medtrack.in", "9822022202", demoPasswordHash]
    ).lastInsertRowid;

    const patientUserId = db.execute(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, email_verified, phone_verified)
       VALUES (?, ?, ?, ?, ?, 'patient', 1, 1)`,
      ["Aarav", "Sharma", "patient@medtrack.in", "9890011223", demoPasswordHash]
    ).lastInsertRowid;

    // 2. Seed the 8 Indian Hospitals from original hospitals.js
    const originalHospitals = [
      {
        userId: rubyUserId,
        name: "Ruby Hall Clinic",
        regNo: "MH-PUNE-HOSP-1001",
        type: "Multi-Specialty Tertiary",
        contact: "Dr. Ananya Deshmukh",
        email: "ruby@medtrack.in",
        mobile: "02026163391",
        address: "40 Sassoon Road, Sangamwadi, Pune",
        city: "Pune",
        state: "Maharashtra",
        pin: "411001",
        lat: 18.5204,
        lng: 73.8567,
        general: 32,
        icu: 5,
        emergency: 8,
        ambulances: 2,
        rating: 4.5,
        travel: 12,
        specialists: ["Cardiology", "Neurology", "Emergency Medicine"],
        facilities: ["ICU", "Emergency", "Cardiology", "CT Scan", "MRI", "Ambulance", "Ventilator", "Oxygen", "Blood Bank"]
      },
      {
        userId: kemUserId,
        name: "KEM Hospital Pune",
        regNo: "MH-PUNE-HOSP-1002",
        type: "Charitable Multi-Specialty",
        contact: "Dr. Vikram Kulkarni",
        email: "kem@medtrack.in",
        mobile: "02026125600",
        address: "489 Sardar Moodliar Road, Rasta Peth, Pune",
        city: "Pune",
        state: "Maharashtra",
        pin: "411011",
        lat: 18.5200,
        lng: 73.8620,
        general: 45,
        icu: 8,
        emergency: 12,
        ambulances: 3,
        rating: 4.4,
        travel: 15,
        specialists: ["Cardiology", "Orthopedics", "Emergency Medicine"],
        facilities: ["ICU", "Emergency", "Cardiology", "Orthopedics", "CT Scan", "Ambulance", "Ventilator", "Oxygen", "Blood Bank"]
      },
      {
        userId: manipalUserId,
        name: "Manipal Hospital",
        regNo: "KA-BLR-HOSP-1003",
        type: "Quaternary Care",
        contact: "Dr. Meera Nair",
        email: "manipal@medtrack.in",
        mobile: "08025024444",
        address: "98 HAL Old Airport Road, Bengaluru",
        city: "Bengaluru",
        state: "Karnataka",
        pin: "560017",
        lat: 12.9592,
        lng: 77.6470,
        general: 60,
        icu: 10,
        emergency: 15,
        ambulances: 4,
        rating: 4.6,
        travel: 10,
        specialists: ["Cardiology", "Neurology", "Emergency Medicine"],
        facilities: ["ICU", "Emergency", "Cardiology", "Neurology", "MRI", "CT Scan", "Ambulance", "Ventilator", "Oxygen", "Blood Bank"]
      },
      {
        userId: null,
        name: "KLE Hospital",
        regNo: "KA-BGM-HOSP-1004",
        type: "Teaching & Research",
        contact: "Dr. Suresh Angadi",
        email: "kle@medtrack.in",
        mobile: "08312473777",
        address: "Nehru Nagar, Belgaum",
        city: "Belgaum",
        state: "Karnataka",
        pin: "590010",
        lat: 15.8497,
        lng: 74.4977,
        general: 40,
        icu: 6,
        emergency: 10,
        ambulances: 2,
        rating: 4.5,
        travel: 8,
        specialists: ["Cardiology", "Orthopedics", "Emergency Medicine"],
        facilities: ["ICU", "Emergency", "Cardiology", "Orthopedics", "CT Scan", "Ambulance", "Ventilator", "Oxygen", "Blood Bank"]
      },
      {
        userId: null,
        name: "Apollo Hospital",
        regNo: "TS-HYD-HOSP-1005",
        type: "Multi-Specialty",
        contact: "Dr. Kavita Rao",
        email: "apollo.hyd@medtrack.in",
        mobile: "04023607777",
        address: "Road No 72, Film Nagar, Jubilee Hills, Hyderabad",
        city: "Hyderabad",
        state: "Telangana",
        pin: "500033",
        lat: 17.4239,
        lng: 78.4738,
        general: 70,
        icu: 12,
        emergency: 18,
        ambulances: 5,
        rating: 4.7,
        travel: 14,
        specialists: ["Cardiology", "Oncology", "Emergency Medicine"],
        facilities: ["ICU", "Emergency", "Cardiology", "Oncology", "MRI", "CT Scan", "Ambulance", "Ventilator", "Oxygen", "Blood Bank"]
      },
      {
        userId: null,
        name: "AIIMS Delhi",
        regNo: "DL-ND-HOSP-1006",
        type: "Government Apex Institute",
        contact: "Dr. Rajesh Malhotra",
        email: "aiims@medtrack.in",
        mobile: "01126588500",
        address: "Sri Aurobindo Marg, Ansari Nagar, New Delhi",
        city: "New Delhi",
        state: "Delhi",
        pin: "110029",
        lat: 28.5672,
        lng: 77.2100,
        general: 90,
        icu: 15,
        emergency: 20,
        ambulances: 6,
        rating: 4.8,
        travel: 18,
        specialists: ["Cardiology", "Neurology", "Oncology", "Emergency Medicine", "Trauma"],
        facilities: ["ICU", "Emergency", "Cardiology", "Neurology", "Oncology", "MRI", "CT Scan", "Ambulance", "Ventilator", "Oxygen", "Blood Bank"]
      },
      {
        userId: null,
        name: "CMC Hospital",
        regNo: "TN-VLR-HOSP-1007",
        type: "Medical College Hospital",
        contact: "Dr. Grace Thomas",
        email: "cmc@medtrack.in",
        mobile: "04162281000",
        address: "Ida Scudder Road, Vellore",
        city: "Vellore",
        state: "Tamil Nadu",
        pin: "632004",
        lat: 12.9249,
        lng: 79.1350,
        general: 55,
        icu: 9,
        emergency: 14,
        ambulances: 3,
        rating: 4.7,
        travel: 11,
        specialists: ["Cardiology", "Neurology", "Emergency Medicine"],
        facilities: ["ICU", "Emergency", "Cardiology", "Neurology", "MRI", "CT Scan", "Ambulance", "Ventilator", "Oxygen", "Blood Bank"]
      },
      {
        userId: null,
        name: "Fortis Hospital",
        regNo: "MH-MUM-HOSP-1008",
        type: "Multi-Specialty",
        contact: "Dr. Sanjay Mehta",
        email: "fortis.mulund@medtrack.in",
        mobile: "02267994444",
        address: "Mulund Goregaon Link Road, Mulund West, Mumbai",
        city: "Mumbai",
        state: "Maharashtra",
        pin: "400078",
        lat: 19.1726,
        lng: 72.9567,
        general: 48,
        icu: 7,
        emergency: 11,
        ambulances: 3,
        rating: 4.6,
        travel: 13,
        specialists: ["Cardiology", "Orthopedics", "Emergency Medicine"],
        facilities: ["ICU", "Emergency", "Cardiology", "Orthopedics", "CT Scan", "MRI", "Ambulance", "Ventilator", "Oxygen", "Blood Bank"]
      }
    ];

    const hospitalIds = [];
    for (const h of originalHospitals) {
      const res = db.execute(
        `INSERT INTO hospitals (
          user_id, name, registration_number, hospital_type, contact_person, official_email,
          mobile, address, city, state, pin_code, latitude, longitude, verification_status,
          verified_by, verified_at, general_beds, icu_beds, emergency_beds, ambulances,
          rating, travel_time_min, emergency_capable, specialists_json, facilities_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, datetime('now'), ?, ?, ?, ?, ?, ?, 1, ?, ?, 'active')`,
        [
          h.userId, h.name, h.regNo, h.type, h.contact, h.email,
          h.mobile, h.address, h.city, h.state, h.pin, h.lat, h.lng,
          adminId, h.general, h.icu, h.emergency, h.ambulances,
          h.rating, h.travel, JSON.stringify(h.specialists), JSON.stringify(h.facilities)
        ]
      );
      hospitalIds.push(res.lastInsertRowid);
    }

    // 3. Seed Blood Banks + 8-Group Inventory
    const cityBankId = db.execute(
      `INSERT INTO blood_banks (
        user_id, name, license_number, contact_person, email, phone,
        address, city, state, pin_code, latitude, longitude, verification_status, verified_by, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, datetime('now'))`,
      [
        cityBankUserId, "City Blood Bank", "MH-BB-2024-001", "Rohan Joshi",
        "cityblood@medtrack.in", "02024471234", "Shivajinagar, JM Road, Pune",
        "Pune", "Maharashtra", "411005", 18.5308, 73.8475, adminId
      ]
    ).lastInsertRowid;

    const lifeBankId = db.execute(
      `INSERT INTO blood_banks (
        user_id, name, license_number, contact_person, email, phone,
        address, city, state, pin_code, latitude, longitude, verification_status, verified_by, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, datetime('now'))`,
      [
        lifeBankUserId, "Life Blood Centre", "MH-BB-2024-002", "Priya Patil",
        "lifeblood@medtrack.in", "02025537890", "Deccan Gymkhana, Pune",
        "Pune", "Maharashtra", "411004", 18.5165, 73.8412, adminId
      ]
    ).lastInsertRowid;

    const blrBankId = db.execute(
      `INSERT INTO blood_banks (
        user_id, name, license_number, contact_person, email, phone,
        address, city, state, pin_code, latitude, longitude, verification_status, verified_by, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, datetime('now'))`,
      [
        null, "Bengaluru Lions Blood Bank", "KA-BB-2024-011", "Suresh Shetty",
        "lionsblood@medtrack.in", "08022261122", "Indiranagar 100ft Road, Bengaluru",
        "Bengaluru", "Karnataka", "560038", 12.9716, 77.6412, adminId
      ]
    ).lastInsertRowid;

    const bankStocks = [
      { bankId: cityBankId, actor: cityBankUserId, units: { "A+": 14, "A-": 3, "B+": 18, "B-": 2, "O+": 22, "O-": 5, "AB+": 9, "AB-": 0 } },
      { bankId: lifeBankId, actor: lifeBankUserId, units: { "A+": 7, "A-": 6, "B+": 12, "B-": 4, "O+": 15, "O-": 2, "AB+": 5, "AB-": 1 } },
      { bankId: blrBankId, actor: adminId, units: { "A+": 20, "A-": 5, "B+": 16, "B-": 3, "O+": 25, "O-": 6, "AB+": 10, "AB-": 2 } }
    ];

    for (const stock of bankStocks) {
      for (const group of BLOOD_GROUPS) {
        const units = stock.units[group] ?? 0;
        const status = computeStockStatus(units);
        db.execute(
          `INSERT INTO blood_inventory (blood_bank_id, blood_group, units_available, status, updated_by)
           VALUES (?, ?, ?, ?, ?)`,
          [stock.bankId, group, units, status, stock.actor]
        );
        db.execute(
          `INSERT INTO inventory_history (blood_bank_id, blood_group, previous_units, delta_units, new_units, reason, changed_by)
           VALUES (?, ?, 0, ?, ?, 'Initial verified stock onboarding', ?)`,
          [stock.bankId, group, units, units, stock.actor]
        );
      }
    }

    // 4. Seed IoT Transport Devices (modular capabilities + sensors)
    const dev1KeyHash = hashApiKey("dev-key-mtbox001-local");
    const dev2KeyHash = hashApiKey("dev-key-mtbox002-local");

    const device1Id = db.execute(
      `INSERT INTO devices (
        device_uid, name, hardware_model, api_key_hash, capabilities_json, cooling_policy_json,
        status, firmware_version, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'online', '1.2.0', datetime('now'))`,
      [
        "MT-BOX-001",
        "MedTrack Smart Cooler #1",
        "ESP32-WROOM-32",
        dev1KeyHash,
        JSON.stringify(["temperature", "gps", "reed_switch", "peltier_relay", "servo_latch", "keypad_otp", "buzzer_led"]),
        JSON.stringify({
          targetMinC: config.telemetry.tempMinC,
          targetMaxC: config.telemetry.tempMaxC,
          hysteresisC: config.telemetry.tempHysteresisC,
          minSwitchIntervalSec: 30
        })
      ]
    ).lastInsertRowid;

    const device2Id = db.execute(
      `INSERT INTO devices (
        device_uid, name, hardware_model, api_key_hash, capabilities_json, cooling_policy_json,
        status, firmware_version, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'offline', '1.2.0', datetime('now', '-15 minutes'))`,
      [
        "MT-BOX-002",
        "MedTrack Smart Cooler #2",
        "ESP32-S3-DevKit",
        dev2KeyHash,
        JSON.stringify(["temperature", "gps", "reed_switch", "peltier_relay", "servo_latch", "rfid_rc522", "battery"]),
        JSON.stringify({
          targetMinC: config.telemetry.tempMinC,
          targetMaxC: config.telemetry.tempMaxC,
          hysteresisC: config.telemetry.tempHysteresisC,
          minSwitchIntervalSec: 30
        })
      ]
    ).lastInsertRowid;

    const defaultSensors = [
      { type: "temperature", label: "Internal Chamber Temp (DS18B20)", unit: "°C", min: 4.0, max: 8.0 },
      { type: "gps", label: "GPS Neo-6M Module", unit: "deg", min: null, max: null },
      { type: "reed_switch", label: "Door Reed Switch", unit: "state", min: null, max: null },
      { type: "battery", label: "LiFePO4 Pack Voltage", unit: "V", min: 11.2, max: 14.4 }
    ];
    for (const devId of [device1Id, device2Id]) {
      for (const s of defaultSensors) {
        db.execute(
          `INSERT INTO device_sensors (device_id, sensor_type, label, unit, min_threshold, max_threshold)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [devId, s.type, s.label, s.unit, s.min, s.max]
        );
      }
    }

    // 5. Seed Sample Blood Request & Active Transport so dashboards immediately demonstrate real flow
    const req1Id = db.execute(
      `INSERT INTO blood_requests (
        request_code, requester_hospital_id, requester_user_id, blood_bank_id, blood_group,
        units_requested, urgency, patient_reference, recipient_contact, notes, status, decided_by, decided_at
      ) VALUES ('BR-1001', ?, ?, ?, 'O-', 2, 'urgent', 'ICU-WARD-3B', '9822011101', 'Trauma surgery backup', 'dispatched', ?, datetime('now', '-25 minutes'))`,
      [hospitalIds[0], rubyUserId, cityBankId, cityBankUserId]
    ).lastInsertRowid;

    db.execute(
      `INSERT INTO blood_requests (
        request_code, requester_hospital_id, requester_user_id, blood_bank_id, blood_group,
        units_requested, urgency, patient_reference, recipient_contact, notes, status
      ) VALUES ('BR-1002', ?, ?, ?, 'A+', 4, 'normal', 'CARDIAC-2A', '9822011102', 'Scheduled cardiac bypass', 'pending')`,
      [hospitalIds[1], kemUserId, lifeBankId]
    );

    const transportId = db.execute(
      `INSERT INTO transports (
        transport_code, blood_request_id, device_id, origin_blood_bank_id, destination_hospital_id,
        recipient_user_id, recipient_contact, status, dispatched_at
      ) VALUES ('TR-5001', ?, ?, ?, ?, ?, '9822011101', 'in_transit', datetime('now', '-20 minutes'))`,
      [req1Id, device1Id, cityBankId, hospitalIds[0], rubyUserId]
    ).lastInsertRowid;

    // Seed initial GPS journey points between City Blood Bank (18.5308, 73.8475) and Ruby Hall Clinic (18.5204, 73.8567)
    const gpsWaypoints = [
      { lat: 18.5308, lng: 73.8475, speed: 0, minsAgo: 20 },
      { lat: 18.5282, lng: 73.8501, speed: 28, minsAgo: 14 },
      { lat: 18.5256, lng: 73.8529, speed: 32, minsAgo: 8 },
      { lat: 18.5231, lng: 73.8548, speed: 24, minsAgo: 1 }
    ];
    for (const wp of gpsWaypoints) {
      db.execute(
        `INSERT INTO gps_locations (device_id, transport_id, latitude, longitude, speed_kmh, satellites, fix_valid, is_simulated, recorded_at)
         VALUES (?, ?, ?, ?, ?, 8, 1, 1, datetime('now', ?))`,
        [device1Id, transportId, wp.lat, wp.lng, wp.speed, `-${wp.minsAgo} minutes`]
      );
    }

    // Seed temperature history within 4-8C range
    const tempSeries = [
      { temp: 5.8, cooling: 0, minsAgo: 20 },
      { temp: 6.4, cooling: 0, minsAgo: 15 },
      { temp: 7.6, cooling: 1, minsAgo: 10 },
      { temp: 6.9, cooling: 1, minsAgo: 5 },
      { temp: 5.4, cooling: 0, minsAgo: 1 }
    ];
    for (const pt of tempSeries) {
      db.execute(
        `INSERT INTO sensor_readings (device_id, transport_id, sensor_type, value_numeric, unit, quality_status, cooling_active, is_simulated, recorded_at)
         VALUES (?, ?, 'temperature', ?, '°C', 'ok', ?, 1, datetime('now', ?))`,
        [device1Id, transportId, pt.temp, pt.cooling, `-${pt.minsAgo} minutes`]
      );
    }

    db.execute(
      `INSERT INTO alerts (target_role, target_hospital_id, device_id, transport_id, severity, category, title, message)
       VALUES ('hospital', ?, ?, ?, 'info', 'transport', 'Blood Shipment In Transit', 'Transport TR-5001 (2 units O-) is en route via MT-BOX-001.')`,
      [hospitalIds[0], device1Id, transportId]
    );

    return { seeded: true, adminId, rubyUserId, patientUserId, cityBankId };
  });
}
