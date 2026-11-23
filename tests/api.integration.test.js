import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../backend/db/adapter.js";
import { runMigrations } from "../backend/db/migrator.js";
import { seedDatabase } from "../backend/db/seed.js";
import { createApp } from "../server.js";

let db;
let server;
let baseUrl;

async function api(path, { method = "GET", body = null, token = null, deviceHeaders = null } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (deviceHeaders) Object.assign(headers, deviceHeaders);
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

describe("MedTrack End-to-End API & Security Integration", () => {
  before(async () => {
    db = await createDatabase(":memory:");
    runMigrations(db);
    seedDatabase(db);
    const app = createApp(db);
    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(() => {
    if (server) server.close();
    if (db) db.close();
  });

  it("exposes /api/v1/health and OpenAPI /api/v1/docs", async () => {
    const health = await api("/health");
    assert.equal(health.status, 200);
    assert.equal(health.data.ok, true);

    const docs = await api("/docs");
    assert.equal(docs.status, 200);
    assert.equal(docs.data.openapi, "3.0.3");
    assert.ok(docs.data.paths["/emergency-requests"]);
    assert.ok(docs.data.paths["/auth/reset-password"]);
  });

  it("supports registration, contact OTP verification, password reset, and user suspension", async () => {
    const reg = await api("/auth/register", {
      method: "POST",
      body: {
        firstName: "Asha",
        lastName: "Patil",
        email: "asha.patil@medtrack.in",
        phone: "9890123456",
        role: "patient",
        password: "Password@123"
      }
    });
    assert.equal(reg.status, 201);
    const token = reg.data.token;

    // Request and confirm contact verification
    const sendCode = await api("/auth/verify-contact", {
      method: "POST",
      token,
      body: { channel: "email" }
    });
    assert.equal(sendCode.status, 200);
    const verCode = sendCode.data.simulationVerificationCode;
    assert.match(verCode, /^[0-9]{6}$/);

    const badVerify = await api("/auth/verify-contact", {
      method: "POST",
      token,
      body: { channel: "email", code: verCode === "000000" ? "111111" : "000000" }
    });
    assert.equal(badVerify.status, 400);

    const okVerify = await api("/auth/verify-contact", {
      method: "POST",
      token,
      body: { channel: "email", code: verCode }
    });
    assert.equal(okVerify.status, 200);
    assert.equal(okVerify.data.verified, true);
    assert.equal(okVerify.data.user.emailVerified, true);

    // Password reset flow
    const resetReq = await api("/auth/request-password-reset", {
      method: "POST",
      body: { email: "asha.patil@medtrack.in" }
    });
    assert.equal(resetReq.status, 200);
    const resetToken = resetReq.data.simulationResetToken;
    assert.ok(resetToken);

    const resetConfirm = await api("/auth/reset-password", {
      method: "POST",
      body: { email: "asha.patil@medtrack.in", token: resetToken, newPassword: "NewPassword@456" }
    });
    assert.equal(resetConfirm.status, 200);

    // Old password fails, new password succeeds
    const oldLogin = await api("/auth/login", {
      method: "POST",
      body: { email: "asha.patil@medtrack.in", password: "Password@123" }
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await api("/auth/login", {
      method: "POST",
      body: { email: "asha.patil@medtrack.in", password: "NewPassword@456" }
    });
    assert.equal(newLogin.status, 200);

    // Admin suspends user -> login & authenticated routes blocked
    const adminLogin = await api("/auth/login", {
      method: "POST",
      body: { email: "admin@medtrack.in", password: "MedTrack@2026" }
    });
    const suspend = await api(`/admin/users/${reg.data.user.id}/role`, {
      method: "PATCH",
      token: adminLogin.data.token,
      body: { role: "patient", status: "suspended" }
    });
    assert.equal(suspend.status, 200);

    const suspendedLogin = await api("/auth/login", {
      method: "POST",
      body: { email: "asha.patil@medtrack.in", password: "NewPassword@456" }
    });
    assert.equal(suspendedLogin.status, 403);
    const suspendedMe = await api("/auth/me", { token: newLogin.data.token });
    assert.equal(suspendedMe.status, 401);
  });

  it("enforces RBAC, unapproved facility hiding, and hospital/blood bank registration -> verification -> PATCH", async () => {
    const reg = await api("/hospitals/register", {
      method: "POST",
      body: {
        hospitalName: "Sahyadri Specialty Hospital",
        registrationNumber: "MH-PUNE-TEST-991",
        hospitalType: "Tertiary Care",
        contactPerson: "Dr. Kiran Joshi",
        officialEmail: "sahyadri.test@medtrack.in",
        mobile: "9822099887",
        password: "Password@123",
        address: "Deccan Gymkhana, Pune",
        state: "Maharashtra",
        city: "Pune",
        pinCode: "411004",
        latitude: 18.515,
        longitude: 73.841
      }
    });
    assert.equal(reg.status, 201);
    assert.equal(reg.data.hospital.verificationStatus, "pending");
    const newHospitalId = reg.data.hospital.id;

    // Pending hospital is hidden from public GET /hospitals/:id
    const publicPendingGet = await api(`/hospitals/${newHospitalId}`);
    assert.equal(publicPendingGet.status, 404);

    // Owner CAN view their own pending hospital
    const ownerPendingGet = await api(`/hospitals/${newHospitalId}`, { token: reg.data.token });
    assert.equal(ownerPendingGet.status, 200);

    // Register a pending blood bank and verify public inventory/detail hiding + PATCH
    const bankReg = await api("/blood-banks/register", {
      method: "POST",
      body: {
        name: "Deccan Blood Center",
        licenseNumber: "BB-MH-TEST-771",
        contactPerson: "Dr. Neha Kulkarni",
        email: "deccan.bank@medtrack.in",
        phone: "9822077112",
        password: "Password@123",
        address: "FC Road, Pune",
        state: "Maharashtra",
        city: "Pune",
        pinCode: "411004",
        latitude: 18.521,
        longitude: 73.842
      }
    });
    assert.equal(bankReg.status, 201);
    const newBankId = bankReg.data.bloodBank.id;

    assert.equal((await api(`/blood-banks/${newBankId}`)).status, 404);
    assert.equal((await api(`/inventory/bank/${newBankId}`)).status, 404);

    // Patient cannot verify facilities
    const patientLogin = await api("/auth/login", {
      method: "POST",
      body: { email: "patient@medtrack.in", password: "MedTrack@2026" }
    });
    const forbiddenVerify = await api(`/admin/facilities/hospital/${newHospitalId}/verify`, {
      method: "PATCH",
      token: patientLogin.data.token,
      body: { status: "approved" }
    });
    assert.equal(forbiddenVerify.status, 403);

    // Blood requests cannot target unapproved blood bank
    const rubyLogin = await api("/auth/login", {
      method: "POST",
      body: { email: "ruby@medtrack.in", password: "MedTrack@2026" }
    });
    const unapprovedReq = await api("/blood-requests", {
      method: "POST",
      token: rubyLogin.data.token,
      body: {
        bloodBankId: newBankId,
        bloodGroup: "O+",
        unitsRequested: 1,
        urgency: "normal",
        recipientContact: "9822011101"
      }
    });
    assert.equal(unapprovedReq.status, 400);

    // Admin approves hospital and blood bank
    const adminLogin = await api("/auth/login", {
      method: "POST",
      body: { email: "admin@medtrack.in", password: "MedTrack@2026" }
    });
    assert.equal(adminLogin.status, 200);

    const approve = await api(`/admin/facilities/hospital/${newHospitalId}/verify`, {
      method: "PATCH",
      token: adminLogin.data.token,
      body: { status: "approved" }
    });
    assert.equal(approve.status, 200);
    assert.equal(approve.data.facility.verification_status, "approved");

    const approveBank = await api(`/admin/facilities/blood_bank/${newBankId}/verify`, {
      method: "PATCH",
      token: adminLogin.data.token,
      body: { status: "approved" }
    });
    assert.equal(approveBank.status, 200);

    // Blood bank can update its own profile & coordinates
    const patchBank = await api(`/blood-banks/${newBankId}`, {
      method: "PATCH",
      token: bankReg.data.token,
      body: { latitude: 18.525, longitude: 73.845, city: "Pune" }
    });
    assert.equal(patchBank.status, 200);
    assert.equal(patchBank.data.bloodBank.latitude, 18.525);

    // Cross-hospital PATCH forbidden
    const crossPatch = await api(`/hospitals/${newHospitalId}`, {
      method: "PATCH",
      token: rubyLogin.data.token,
      body: { city: "Mumbai" }
    });
    assert.equal(crossPatch.status, 403);

    // Approved hospital now visible in public discovery
    const list = await api("/hospitals?city=Pune");
    assert.ok(list.data.hospitals.some((h) => h.id === newHospitalId));

    // Invalid threshold order rejected in inventory PUT
    const badThresholds = await api(`/inventory/bank/${newBankId}`, {
      method: "PUT",
      token: bankReg.data.token,
      body: { bloodGroup: "A+", unitsAvailable: 5, lowThreshold: 3, criticalThreshold: 5 }
    });
    assert.equal(badThresholds.status, 400);
  });

  it("runs blood inventory -> request -> dispatch -> OTP lockout/verify -> strict door-access -> telemetry -> delivery & IDOR checks", async () => {
    const hospitalLogin = await api("/auth/login", {
      method: "POST",
      body: { email: "ruby@medtrack.in", password: "MedTrack@2026" }
    });
    const otherHospitalLogin = await api("/auth/login", {
      method: "POST",
      body: { email: "kem@medtrack.in", password: "MedTrack@2026" }
    });
    const bankLogin = await api("/auth/login", {
      method: "POST",
      body: { email: "lifeblood@medtrack.in", password: "MedTrack@2026" }
    });
    const otherBankLogin = await api("/auth/login", {
      method: "POST",
      body: { email: "cityblood@medtrack.in", password: "MedTrack@2026" }
    });
    const patientLogin = await api("/auth/login", {
      method: "POST",
      body: { email: "patient@medtrack.in", password: "MedTrack@2026" }
    });
    const adminLogin = await api("/auth/login", {
      method: "POST",
      body: { email: "admin@medtrack.in", password: "MedTrack@2026" }
    });

    // Provision a dedicated IoT box
    const devReg = await api("/devices/register", {
      method: "POST",
      token: adminLogin.data.token,
      body: { deviceUid: "MT-BOX-TEST-99", name: "Test Cooler 99" }
    });
    assert.equal(devReg.status, 201);
    const deviceId = devReg.data.device.id;
    const deviceHeaders = {
      "X-Device-Id": "MT-BOX-TEST-99",
      "X-Device-Key": devReg.data.deviceApiKey
    };

    // Invalid cooling hysteresis config is rejected
    const badDevConfig = await api(`/devices/${deviceId}/config`, {
      method: "PATCH",
      token: adminLogin.data.token,
      body: { targetMinC: 4, targetMaxC: 6, hysteresisC: 1.5 }
    });
    assert.equal(badDevConfig.status, 400);

    // Blood bank updates AB- stock
    const bankProfile = await api("/blood-banks/my/profile", { token: bankLogin.data.token });
    const bankId = bankProfile.data.bloodBank.id;
    const invUpdate = await api(`/inventory/bank/${bankId}`, {
      method: "PUT",
      token: bankLogin.data.token,
      body: { bloodGroup: "AB-", unitsAvailable: 10, reason: "Fresh donor unit verified" }
    });
    assert.equal(invUpdate.status, 200);
    assert.equal(invUpdate.data.item.status, "Sufficient");

    // Hospital requests 2 units of AB-
    const reqRes = await api("/blood-requests", {
      method: "POST",
      token: hospitalLogin.data.token,
      body: {
        bloodBankId: bankId,
        bloodGroup: "AB-",
        unitsRequested: 2,
        urgency: "urgent",
        recipientContact: "9822011101"
      }
    });
    assert.equal(reqRes.status, 201);
    const reqId = reqRes.data.bloodRequest.id;

    // Cross-bank cannot accept someone else's blood request
    const crossAccept = await api(`/blood-requests/${reqId}/accept`, {
      method: "PATCH",
      token: otherBankLogin.data.token
    });
    assert.equal(crossAccept.status, 403);

    // Blood bank accepts & dispatches via MT-BOX-TEST-99
    const accRes = await api(`/blood-requests/${reqId}/accept`, {
      method: "PATCH",
      token: bankLogin.data.token
    });
    assert.equal(accRes.status, 200);

    const dispRes = await api("/transport/dispatch", {
      method: "POST",
      token: bankLogin.data.token,
      body: { bloodRequestId: reqId, deviceId }
    });
    assert.equal(dispRes.status, 201);
    const transportId = dispRes.data.transport.id;

    // Cross-hospital IDOR protection checks across transport, OTP, GPS, telemetry
    assert.equal((await api(`/transport/${transportId}`, { token: otherHospitalLogin.data.token })).status, 403);
    assert.equal((await api(`/otp/${transportId}/status`, { token: otherHospitalLogin.data.token })).status, 403);
    assert.equal((await api(`/access/${transportId}/logs`, { token: otherHospitalLogin.data.token })).status, 403);
    assert.equal((await api(`/gps/${transportId}/route`, { token: otherHospitalLogin.data.token })).status, 403);
    assert.equal((await api(`/temperature/${deviceId}/history`, { token: otherHospitalLogin.data.token })).status, 403);
    assert.equal((await api("/otp/generate", { method: "POST", token: otherHospitalLogin.data.token, body: { transportId } })).status, 403);
    assert.equal((await api("/sensors/simulate", { method: "POST", token: patientLogin.data.token, body: { deviceId, temperatureC: 5.5 } })).status, 403);

    // Verify stock deducted from 10 -> 8
    const invAfter = await api(`/inventory/bank/${bankId}`, { token: bankLogin.data.token });
    const abNeg = invAfter.data.inventory.find((i) => i.blood_group === "AB-");
    assert.equal(abNeg.units_available, 8);

    // Unauthorized device request fails
    const badDeviceCall = await api("/otp/verify", {
      method: "POST",
      deviceHeaders: { "X-Device-Id": "MT-BOX-TEST-99", "X-Device-Key": "wrong-key" },
      body: { otp: "123456" }
    });
    assert.equal(badDeviceCall.status, 401);

    // Generate OTP -> confirm plaintext OTP is not stored in DB
    const otpGen = await api("/otp/generate", {
      method: "POST",
      token: hospitalLogin.data.token,
      body: { transportId }
    });
    assert.equal(otpGen.status, 201);
    const validOtp = otpGen.data.simulationOtpPreview;
    assert.match(validOtp, /^[0-9]{6}$/);
    const dbOtpRow = db.queryOne("SELECT otp_hash FROM otp_tokens WHERE transport_id = ? ORDER BY id DESC LIMIT 1", [transportId]);
    assert.notEqual(dbOtpRow.otp_hash, validOtp);

    // Test lockout after 5 wrong OTP attempts
    const wrongOtp = validOtp === "111111" ? "222222" : "111111";
    for (let i = 0; i < 4; i++) {
      const failAttempt = await api("/otp/verify", {
        method: "POST",
        deviceHeaders,
        body: { transportId, otp: wrongOtp }
      });
      assert.equal(failAttempt.status, 401);
      assert.equal(failAttempt.data.unlockAuthorized, false);
    }
    const fifthAttempt = await api("/otp/verify", {
      method: "POST",
      deviceHeaders,
      body: { transportId, otp: wrongOtp }
    });
    assert.equal(fifthAttempt.status, 429);

    // Regenerate fresh OTP and verify successfully
    const otpGen2 = await api("/otp/generate", {
      method: "POST",
      token: hospitalLogin.data.token,
      body: { transportId }
    });
    const validOtp2 = otpGen2.data.simulationOtpPreview;
    const okVerify = await api("/otp/verify", {
      method: "POST",
      deviceHeaders,
      body: { transportId, otp: validOtp2 }
    });
    assert.equal(okVerify.status, 200);
    assert.equal(okVerify.data.unlockAuthorized, true);
    assert.ok(okVerify.data.unlockToken);

    // Single-use OTP cannot be reused
    const reuseAttempt = await api("/otp/verify", {
      method: "POST",
      deviceHeaders,
      body: { transportId, otp: validOtp2 }
    });
    assert.equal(reuseAttempt.status, 400);

    // Door opened WITHOUT unlockToken MUST be logged as unauthorized_door_open!
    const noTokenDoorOpen = await api("/access/door-event", {
      method: "POST",
      deviceHeaders,
      body: { transportId, eventType: "door_opened" }
    });
    assert.equal(noTokenDoorOpen.status, 201);
    assert.equal(noTokenDoorOpen.data.recordedEventType, "unauthorized_door_open");
    assert.equal(noTokenDoorOpen.data.success, false);

    // Door opened WITH valid unlockToken succeeds
    const doorOpen = await api("/access/door-event", {
      method: "POST",
      deviceHeaders,
      body: { transportId, eventType: "door_opened", unlockToken: okVerify.data.unlockToken }
    });
    assert.equal(doorOpen.status, 201);
    assert.equal(doorOpen.data.recordedEventType, "door_opened");
    assert.equal(doorOpen.data.success, true);

    // Closing the door revokes the active unlockToken immediately
    const doorClose = await api("/access/door-event", {
      method: "POST",
      deviceHeaders,
      body: { transportId, eventType: "door_closed" }
    });
    assert.equal(doorClose.status, 201);
    const postCloseOpen = await api("/access/door-event", {
      method: "POST",
      deviceHeaders,
      body: { transportId, eventType: "door_opened", unlockToken: okVerify.data.unlockToken }
    });
    assert.equal(postCloseOpen.data.recordedEventType, "unauthorized_door_open");

    // Device posts high temp excursion -> resolves -> GPS update
    const highTemp = await api("/sensors/readings", {
      method: "POST",
      deviceHeaders,
      body: { sensorType: "temperature", valueNumeric: 9.4, unit: "°C" }
    });
    assert.equal(highTemp.status, 201);
    assert.equal(highTemp.data.evaluation.excursionType, "high");
    assert.equal(highTemp.data.evaluation.peltierCommand, "ON");

    const normTemp = await api("/sensors/readings", {
      method: "POST",
      deviceHeaders,
      body: { sensorType: "temperature", valueNumeric: 5.5, unit: "°C", currentlyCooling: true }
    });
    assert.equal(normTemp.status, 201);
    assert.equal(normTemp.data.evaluation.qualityStatus, "ok");

    const gpsRes = await api("/gps/update", {
      method: "POST",
      deviceHeaders,
      body: { latitude: 18.522, longitude: 73.855, speedKmh: 30, satellites: 8, fixValid: true }
    });
    assert.equal(gpsRes.status, 201);

    const routeRes = await api(`/gps/${transportId}/route`, { token: hospitalLogin.data.token });
    assert.equal(routeRes.status, 200);
    assert.equal(routeRes.data.points.length, 1);

    // Deliver transport -> cannot re-deliver or issue new OTP after delivery
    const deliverRes = await api(`/transport/${transportId}/deliver`, {
      method: "PATCH",
      token: hospitalLogin.data.token
    });
    assert.equal(deliverRes.status, 200);
    assert.equal(deliverRes.data.transport.status, "delivered");

    const reDeliver = await api(`/transport/${transportId}/deliver`, {
      method: "PATCH",
      token: hospitalLogin.data.token
    });
    assert.equal(reDeliver.status, 409);

    const postDeliverOtp = await api("/otp/generate", {
      method: "POST",
      token: hospitalLogin.data.token,
      body: { transportId }
    });
    assert.equal(postDeliverOtp.status, 409);
  });

  it("persists emergency & ambulance requests, enforces role-scoped alert acknowledgement", async () => {
    const rubyLogin = await api("/auth/login", {
      method: "POST",
      body: { email: "ruby@medtrack.in", password: "MedTrack@2026" }
    });
    const kemLogin = await api("/auth/login", {
      method: "POST",
      body: { email: "kem@medtrack.in", password: "MedTrack@2026" }
    });
    const patientLogin = await api("/auth/login", {
      method: "POST",
      body: { email: "patient@medtrack.in", password: "MedTrack@2026" }
    });
    const rubyProfile = await api("/hospitals/my/profile", { token: rubyLogin.data.token });
    const rubyId = rubyProfile.data.hospital.id;

    // Create persisted emergency request targeted at Ruby Hall Clinic
    const erCreate = await api("/emergency-requests", {
      method: "POST",
      token: patientLogin.data.token,
      body: {
        requestType: "ambulance",
        requirement: "Ambulance",
        hospitalId: rubyId,
        requesterName: "Rohan Mehta",
        requesterPhone: "9876501234",
        notes: "Chest pain near Sassoon Road"
      }
    });
    assert.equal(erCreate.status, 201);
    assert.match(erCreate.data.emergencyRequest.request_code, /^AMB-/);
    const erId = erCreate.data.emergencyRequest.id;

    // Patient sees their own request; Ruby Hall sees it; KEM cannot modify Ruby's targeted request
    const kemUpdate = await api(`/emergency-requests/${erId}/status`, {
      method: "PATCH",
      token: kemLogin.data.token,
      body: { status: "accepted" }
    });
    assert.equal(kemUpdate.status, 403);

    const rubyUpdate = await api(`/emergency-requests/${erId}/status`, {
      method: "PATCH",
      token: rubyLogin.data.token,
      body: { status: "dispatched" }
    });
    assert.equal(rubyUpdate.status, 200);
    assert.equal(rubyUpdate.data.emergencyRequest.status, "dispatched");

    // Alert scoping: Ruby Hall receives alert for this emergency; Patient cannot acknowledge Ruby's alert
    const rubyAlerts = await api("/alerts", { token: rubyLogin.data.token });
    const targetAlert = rubyAlerts.data.alerts.find((a) => a.title.includes(erCreate.data.emergencyRequest.request_code));
    assert.ok(targetAlert, "Expected hospital alert for emergency request");

    const patientAck = await api(`/alerts/${targetAlert.id}/acknowledge`, {
      method: "PATCH",
      token: patientLogin.data.token
    });
    assert.equal(patientAck.status, 403);

    const rubyAck = await api(`/alerts/${targetAlert.id}/acknowledge`, {
      method: "PATCH",
      token: rubyLogin.data.token
    });
    assert.equal(rubyAck.status, 200);
    assert.ok(rubyAck.data.alert.acknowledged_at);
  });

  it("generates device disconnection & sensor failure alerts, supports device heartbeat, and attaches modular expansion sensors", async () => {
    const adminLogin = await api("/auth/login", {
      method: "POST",
      body: { email: "admin@medtrack.in", password: "MedTrack@2026" }
    });
    assert.equal(adminLogin.status, 200);

    // Seeded MT-BOX-002 has last_seen_at -15 minutes -> GET /alerts triggers device_offline alert once
    const alertsBefore = await api("/alerts", { token: adminLogin.data.token });
    assert.equal(alertsBefore.status, 200);
    const offlineAlert = alertsBefore.data.alerts.find(
      (a) => a.category === "device_offline" && a.title.includes("MT-BOX-002")
    );
    assert.ok(offlineAlert, "Expected device_offline alert for disconnected MT-BOX-002");

    // Register a fresh device and test heartbeat + modular expansion sensors + sensor_failure alert
    const devReg = await api("/devices/register", {
      method: "POST",
      token: adminLogin.data.token,
      body: { deviceUid: "MT-BOX-EXP-01", name: "Expansion Test Cooler" }
    });
    assert.equal(devReg.status, 201);
    const devId = devReg.data.device.id;
    const devHeaders = {
      "X-Device-Id": "MT-BOX-EXP-01",
      "X-Device-Key": devReg.data.deviceApiKey
    };

    // Update policy and status ('offline' / 'maintenance') cleanly
    const cfgRes = await api(`/devices/${devId}/config`, {
      method: "PATCH",
      token: adminLogin.data.token,
      body: { targetMinC: 3.5, targetMaxC: 7.5, hysteresisC: 0.5, status: "offline" }
    });
    assert.equal(cfgRes.status, 200);
    assert.equal(cfgRes.data.coolingPolicy.targetMinC, 3.5);

    // Device-UID heartbeat returns updated cooling policy
    const hbRes = await api("/devices/heartbeat", {
      method: "POST",
      deviceHeaders: devHeaders
    });
    assert.equal(hbRes.status, 200);
    assert.equal(hbRes.data.coolingPolicy.targetMaxC, 7.5);

    // Attach future modular sensors (humidity & mpu6050) without schema change
    const addHum = await api(`/devices/${devId}/sensors`, {
      method: "POST",
      token: adminLogin.data.token,
      body: { sensorType: "humidity", label: "Chamber Humidity", unit: "%RH", minThreshold: 20, maxThreshold: 80 }
    });
    assert.equal(addHum.status, 201);
    assert.ok(addHum.data.sensors.some((s) => s.sensor_type === "humidity"));

    const humReading = await api("/sensors/readings", {
      method: "POST",
      deviceHeaders: devHeaders,
      body: { sensorType: "humidity", valueNumeric: 54.2, unit: "%RH" }
    });
    assert.equal(humReading.status, 201);
    assert.equal(humReading.data.qualityStatus, "ok");

    // Trigger sensor failure alert
    const faultReading = await api("/sensors/readings", {
      method: "POST",
      deviceHeaders: devHeaders,
      body: { sensorType: "temperature", sensorError: true }
    });
    assert.equal(faultReading.status, 201);
    assert.equal(faultReading.data.evaluation.excursionType, "sensor_failure");

    const alertsAfter = await api("/alerts", { token: adminLogin.data.token });
    assert.ok(
      alertsAfter.data.alerts.some((a) => a.title.includes("Sensor Failure on MT-BOX-EXP-01")),
      "Expected sensor failure alert"
    );
  });
});
