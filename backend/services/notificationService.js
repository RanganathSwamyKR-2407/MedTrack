/**
 * NotificationService abstracts delivery channels (in-app alert, future SMS/Email/Webhook).
 * New providers (Twilio, SendGrid, Firebase Cloud Messaging) can be registered here without
 * modifying OTP or alert business logic.
 */
class NotificationService {
  constructor() {
    this.channels = new Map();
    this.recentDeliveries = [];
  }

  registerChannel(name, handler) {
    this.channels.set(name, handler);
  }

  createAlert(db, {
    targetRole = null,
    targetHospitalId = null,
    targetBloodBankId = null,
    deviceId = null,
    transportId = null,
    severity = "info",
    category = "general",
    title,
    message
  }) {
    const res = db.execute(
      `INSERT INTO alerts (
        target_role, target_hospital_id, target_blood_bank_id, device_id, transport_id,
        severity, category, title, message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        targetRole,
        targetHospitalId,
        targetBloodBankId,
        deviceId,
        transportId,
        severity,
        category,
        title,
        message
      ]
    );
    return res.lastInsertRowid;
  }

  async sendOtpNotification({ recipientContact, transportCode, expiresInSeconds, otpPreviewForChannel }) {
    const entry = {
      channel: "in-app-gateway",
      recipientContact,
      transportCode,
      expiresInSeconds,
      sentAt: new Date().toISOString()
    };

    for (const [name, handler] of this.channels.entries()) {
      try {
        await handler({ ...entry, otp: otpPreviewForChannel });
      } catch (err) {
        console.error(`[NotificationService:${name}] Delivery failed:`, err.message);
      }
    }

    this.recentDeliveries.unshift(entry);
    if (this.recentDeliveries.length > 50) {
      this.recentDeliveries.pop();
    }
    return entry;
  }
}

export const notificationService = new NotificationService();
