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

  const userId = Number(user.id);

  if (transport.recipient_user_id != null && Number(transport.recipient_user_id) === userId) {
    return true;
  }

  if (user.role === "hospital") {
    const hosp = getUserHospital(db, user.id);
    if (hosp && transport.destination_hospital_id != null && Number(transport.destination_hospital_id) === Number(hosp.id)) {
      return true;
    }
    // Also verify if this hospital created the blood request associated with the transport
    if (transport.blood_request_id) {
      const br = db.queryOne("SELECT requester_hospital_id, requester_user_id FROM blood_requests WHERE id = ?", [transport.blood_request_id]);
      if (br) {
        if (br.requester_user_id != null && Number(br.requester_user_id) === userId) return true;
        if (hosp && br.requester_hospital_id != null && Number(br.requester_hospital_id) === Number(hosp.id)) return true;
      }
    }
    return false;
  }

  if (user.role === "blood_bank") {
    const bank = getUserBloodBank(db, user.id);
    if (bank && transport.origin_blood_bank_id != null && Number(transport.origin_blood_bank_id) === Number(bank.id)) {
      return true;
    }
    if (transport.blood_request_id) {
      const br = db.queryOne("SELECT blood_bank_id FROM blood_requests WHERE id = ?", [transport.blood_request_id]);
      if (br && bank && Number(br.blood_bank_id) === Number(bank.id)) return true;
    }
    return false;
  }

  if (user.role === "patient") {
    if (transport.blood_request_id) {
      const br = db.queryOne("SELECT requester_user_id FROM blood_requests WHERE id = ?", [transport.blood_request_id]);
      if (br && Number(br.requester_user_id) === userId) return true;
    }
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
