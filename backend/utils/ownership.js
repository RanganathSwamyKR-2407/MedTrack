export function getUserHospital(db, userId) {
  if (!userId) return null;
  return db.queryOne("SELECT * FROM hospitals WHERE user_id = ?", [userId]);
}

export function getUserBloodBank(db, userId) {
  if (!userId) return null;
  return db.queryOne("SELECT * FROM blood_banks WHERE user_id = ?", [userId]);
}

export function canAccessTransport(db, user, transport) {
  if (!user || !transport) return false;
  if (user.role === "admin") return true;
  if (transport.recipient_user_id && transport.recipient_user_id === user.id) return true;
  if (user.role === "hospital") {
    const hosp = getUserHospital(db, user.id);
    return Boolean(hosp && transport.destination_hospital_id === hosp.id);
  }
  if (user.role === "blood_bank") {
    const bank = getUserBloodBank(db, user.id);
    return Boolean(bank && transport.origin_blood_bank_id === bank.id);
  }
  return false;
}

export function canAccessDevice(db, user, deviceId) {
  if (!user || !deviceId) return false;
  if (user.role === "admin") return true;
  if (user.role === "blood_bank") {
    const bank = getUserBloodBank(db, user.id);
    if (!bank) return false;
    // Blood banks can inspect devices assigned to their transports or unassigned fleet devices
    const assignedElsewhere = db.queryOne(
      `SELECT id, origin_blood_bank_id FROM transports
       WHERE device_id = ? AND status IN ('assigned', 'in_transit', 'arrived')
       ORDER BY id DESC LIMIT 1`,
      [deviceId]
    );
    return !assignedElsewhere || assignedElsewhere.origin_blood_bank_id === bank.id;
  }
  if (user.role === "hospital") {
    const hosp = getUserHospital(db, user.id);
    if (!hosp) return false;
    const match = db.queryOne(
      `SELECT id FROM transports
       WHERE device_id = ? AND destination_hospital_id = ?
       ORDER BY id DESC LIMIT 1`,
      [deviceId, hosp.id]
    );
    return Boolean(match);
  }
  if (user.role === "patient") {
    const match = db.queryOne(
      `SELECT id FROM transports
       WHERE device_id = ? AND recipient_user_id = ?
       ORDER BY id DESC LIMIT 1`,
      [deviceId, user.id]
    );
    return Boolean(match);
  }
  return false;
}

export function parsePositiveIntId(raw) {
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 ? num : null;
}
