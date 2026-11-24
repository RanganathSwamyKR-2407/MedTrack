(function () {
  function esc(v) {
    return window.medtrackApi ? window.medtrackApi.escapeHtml(v) : String(v ?? "");
  }

  function fmt(ts) {
    return window.medtrackApi ? window.medtrackApi.formatLocalTime(ts) : String(ts ?? "—");
  }

  function showAdminFeedback(msg, isError = false) {
    const el = document.getElementById("adminFeedback");
    el.style.display = "block";
    el.className = `feedback-banner ${isError ? "error" : "success"}`;
    el.textContent = msg;
  }

  window.switchAdminTab = function (name, btn) {
    document.querySelectorAll(".admin-tab-panel").forEach((p) => (p.style.display = "none"));
    document.querySelectorAll(".tab-bar .tab-btn").forEach((b) => b.classList.remove("active"));
    document.getElementById(`admin-tab-${name}`).style.display = "block";
    if (btn) btn.classList.add("active");
  };

  async function loadAdminDashboard() {
    const user = window.medtrackApi.getUser();
    if (!user || user.role !== "admin") {
      window.location.href = "login.html";
      return;
    }

    try {
      const [overview, health, usersRes, auditRes, alertsRes] = await Promise.all([
        window.medtrackApi.request("/admin/overview"),
        window.medtrackApi.request("/admin/health"),
        window.medtrackApi.request("/admin/users"),
        window.medtrackApi.request("/admin/audit-logs"),
        window.medtrackApi.request("/alerts")
      ]);

      document.getElementById("systemHealthBadge").textContent = `● ${String(health.status).toUpperCase()} (${String(health.databaseDriver).toUpperCase()})`;
      document.getElementById("adminHealthCards").innerHTML = `
        <div class="dashboard-card"><span>Registered Hospitals</span><strong>${overview.hospitals.length}</strong></div>
        <div class="dashboard-card"><span>Blood Banks</span><strong>${overview.bloodBanks.length}</strong></div>
        <div class="dashboard-card"><span>IoT Boxes Online</span><strong>${Number(health.devicesOnline)}/${Number(health.devicesTotal)}</strong></div>
        <div class="dashboard-card"><span>Open Temp Excursions</span><strong style="color:${health.openTemperatureExcursions > 0 ? "#dc2626" : "#087f5b"}">${Number(health.openTemperatureExcursions)}</strong></div>
      `;

      renderFacilities(overview.hospitals, overview.bloodBanks);
      renderBloodOverview(overview.inventorySummary);
      renderDevicesAndExcursions(overview.devices, overview.excursions);
      renderAdminAlerts(alertsRes.alerts || []);
      renderAccessLogs(overview.accessLogs);
      renderAuditLogs(auditRes.logs || []);
      renderUsers(usersRes.users || []);
      await loadAdminTransports();
    } catch (err) {
      showAdminFeedback(err.message, true);
    }
  }

  function renderFacilities(hospitals, banks) {
    document.getElementById("adminHospitalsList").innerHTML = hospitals
      .map(
        (h) => `
      <div class="request-card">
        <div>
          <strong>🏥 ${esc(h.name)}</strong>
          <p>${esc(h.city)}, ${esc(h.state)} • Reg: ${esc(h.registration_number)} • ${esc(h.official_email)}</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <span class="status ${h.verification_status === "approved" ? "available" : h.verification_status === "rejected" ? "busy" : "limited"}">${esc(String(h.verification_status).toUpperCase())}</span>
          ${
            h.verification_status !== "approved"
              ? `<button class="primary-btn" onclick="verifyFacility('hospital', ${Number(h.id)}, 'approved')">Approve</button>`
              : ""
          }
          ${
            h.verification_status !== "rejected"
              ? `<button class="small-btn" onclick="verifyFacility('hospital', ${Number(h.id)}, 'rejected')">Reject</button>`
              : ""
          }
        </div>
      </div>
    `
      )
      .join("");

    document.getElementById("adminBloodBanksList").innerHTML = banks
      .map(
        (b) => `
      <div class="request-card">
        <div>
          <strong>🩸 ${esc(b.name)}</strong>
          <p>${esc(b.city)}, ${esc(b.state)} • License: ${esc(b.license_number)} • ${esc(b.email)}</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <span class="status ${b.verification_status === "approved" ? "available" : b.verification_status === "rejected" ? "busy" : "limited"}">${esc(String(b.verification_status).toUpperCase())}</span>
          ${
            b.verification_status !== "approved"
              ? `<button class="primary-btn" onclick="verifyFacility('blood_bank', ${Number(b.id)}, 'approved')">Approve</button>`
              : ""
          }
          ${
            b.verification_status !== "rejected"
              ? `<button class="small-btn" onclick="verifyFacility('blood_bank', ${Number(b.id)}, 'rejected')">Reject</button>`
              : ""
          }
        </div>
      </div>
    `
      )
      .join("");
  }

  window.verifyFacility = async function (type, id, status) {
    try {
      await window.medtrackApi.request(`/admin/facilities/${type}/${id}/verify`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      showAdminFeedback(`Updated ${type} #${id} to ${status}.`);
      await loadAdminDashboard();
    } catch (err) {
      showAdminFeedback(err.message, true);
    }
  };

  function renderBloodOverview(summary) {
    document.getElementById("adminBloodSummary").innerHTML = summary
      .map(
        (s) => `
      <div class="dashboard-card">
        <span>Blood Group ${esc(s.blood_group)}</span>
        <strong>${Number(s.total_units)}</strong>
        <small>Total network units</small>
      </div>
    `
      )
      .join("");
  }

  function renderDevicesAndExcursions(devices, excursions) {
    document.getElementById("adminDevicesList").innerHTML = devices
      .map(
        (d) => {
          const policy = JSON.parse(d.cooling_policy_json || "{}");
          const sensors = d.sensors || [];
          return `
      <div class="request-card">
        <div>
          <strong>📦 ${esc(d.device_uid)} — ${esc(d.name)}</strong>
          <p>Model: ${esc(d.hardware_model)} • Firmware: ${esc(d.firmware_version)} • Last seen: ${esc(d.last_seen_at ? fmt(d.last_seen_at) : "Never")}</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0;">
            ${sensors.map((s) => `<span class="status available" style="font-size:11px;">${esc(s.sensor_type)} (${esc(s.unit)})</span>`).join("")}
          </div>
          <div class="device-policy-row">
            <label>Min °C <input type="number" step="0.5" id="devMin-${Number(d.id)}" value="${Number(policy.targetMinC ?? 4)}"></label>
            <label>Max °C <input type="number" step="0.5" id="devMax-${Number(d.id)}" value="${Number(policy.targetMaxC ?? 8)}"></label>
            <label>Hyst °C <input type="number" step="0.1" id="devHyst-${Number(d.id)}" value="${Number(policy.hysteresisC ?? 0.5)}"></label>
            <select id="devStatus-${Number(d.id)}">
              <option value="online" ${d.status === "online" ? "selected" : ""}>online</option>
              <option value="offline" ${d.status === "offline" ? "selected" : ""}>offline</option>
              <option value="maintenance" ${d.status === "maintenance" ? "selected" : ""}>maintenance</option>
            </select>
            <button type="button" class="small-btn" onclick="saveDeviceConfig(${Number(d.id)})">Save Policy</button>
          </div>
          <div class="device-policy-row" style="margin-top:8px;">
            <select id="addSensorType-${Number(d.id)}">
              <option value="humidity">humidity (%RH)</option>
              <option value="mpu6050">mpu6050 (g-force)</option>
              <option value="load_cell">load_cell (g)</option>
              <option value="battery">battery (V)</option>
            </select>
            <button type="button" class="small-btn" onclick="attachDeviceSensor(${Number(d.id)})">+ Attach Sensor</button>
          </div>
        </div>
        <span class="status ${d.connectivity === "online" ? "available" : d.connectivity === "stale" ? "limited" : "busy"}">${esc(String(d.connectivity).toUpperCase())}</span>
      </div>
    `;
        }
      )
      .join("");

    document.getElementById("adminExcursionsList").innerHTML = excursions.length
      ? excursions
          .map(
            (e) => `
        <div class="request-card">
          <div>
            <strong>${esc(e.device_uid)} • ${esc(String(e.excursion_type).toUpperCase())}</strong>
            <p>${esc(e.notes || "")}</p>
            <small>Started: ${esc(fmt(e.started_at))}${e.resolved_at ? ` • Resolved: ${esc(fmt(e.resolved_at))}` : ""}</small>
          </div>
          <span class="status ${e.resolved_at ? "available" : "busy"}">${e.resolved_at ? "RESOLVED" : "ACTIVE"}</span>
        </div>
      `
          )
          .join("")
      : `<div class="panel-card"><p>No temperature excursions logged.</p></div>`;
  }

  window.attachDeviceSensor = async function (deviceId) {
    const presetMap = {
      humidity: { label: "Chamber Humidity (DHT22/SHT31)", unit: "%RH", minThreshold: 20, maxThreshold: 80 },
      mpu6050: { label: "Vibration & Tilt (MPU6050)", unit: "g", minThreshold: 0, maxThreshold: 2.5 },
      load_cell: { label: "Blood Bag Mass (HX711)", unit: "g", minThreshold: 50, maxThreshold: 5000 },
      battery: { label: "LiFePO4 Pack Voltage", unit: "V", minThreshold: 11.2, maxThreshold: 14.4 }
    };
    const sensorType = document.getElementById(`addSensorType-${deviceId}`)?.value;
    const preset = presetMap[sensorType];
    if (!preset) return;
    try {
      await window.medtrackApi.request(`/devices/${deviceId}/sensors`, {
        method: "POST",
        body: JSON.stringify({ sensorType, ...preset })
      });
      showAdminFeedback(`Attached ${sensorType} module to device #${deviceId}.`);
      await loadAdminDashboard();
    } catch (err) {
      showAdminFeedback(err.message, true);
    }
  };

  window.saveDeviceConfig = async function (deviceId) {
    try {
      await window.medtrackApi.request(`/devices/${deviceId}/config`, {
        method: "PATCH",
        body: JSON.stringify({
          targetMinC: Number(document.getElementById(`devMin-${deviceId}`).value),
          targetMaxC: Number(document.getElementById(`devMax-${deviceId}`).value),
          hysteresisC: Number(document.getElementById(`devHyst-${deviceId}`).value),
          status: document.getElementById(`devStatus-${deviceId}`).value
        })
      });
      showAdminFeedback(`Updated cooling policy for device #${deviceId}.`);
      await loadAdminDashboard();
    } catch (err) {
      showAdminFeedback(err.message, true);
    }
  };

  function renderAdminAlerts(alerts) {
    const el = document.getElementById("adminAlertsList");
    if (!el) return;
    el.innerHTML = alerts.length
      ? alerts
          .map(
            (a) => `
        <div class="request-card">
          <div>
            <span class="status ${a.severity === "critical" ? "busy" : a.severity === "warning" ? "limited" : "available"}">${esc(String(a.severity).toUpperCase())}</span>
            <strong style="margin-left:8px;">${esc(a.title)}</strong>
            <p style="margin-top:4px;">${esc(a.message)}</p>
            <small>${esc(String(a.category).toUpperCase())} • ${esc(fmt(a.created_at))}</small>
          </div>
          ${
            a.acknowledged_at
              ? `<small style="color:var(--primary);">✓ Acknowledged</small>`
              : `<button type="button" class="small-btn" onclick="ackAdminAlert(${Number(a.id)})">Acknowledge</button>`
          }
        </div>
      `
          )
          .join("")
      : `<div class="panel-card"><p>No system alerts.</p></div>`;
  }

  window.ackAdminAlert = async function (alertId) {
    try {
      await window.medtrackApi.request(`/alerts/${alertId}/acknowledge`, { method: "PATCH" });
      showAdminFeedback("Alert acknowledged.");
      await loadAdminDashboard();
    } catch (err) {
      showAdminFeedback(err.message, true);
    }
  };

  function renderAccessLogs(logs) {
    document.getElementById("adminAccessLogs").innerHTML = logs.length
      ? logs
          .map(
            (l) => `
        <div class="request-card">
          <div>
            <strong>${esc(l.device_uid)} • ${esc(String(l.event_type).toUpperCase())}</strong>
            <p>${esc(l.details || "")}</p>
            <small>${esc(fmt(l.created_at))}</small>
          </div>
          <span class="status ${l.success ? "available" : "busy"}">${l.success ? "SUCCESS" : "ALERT"}</span>
        </div>
      `
          )
          .join("")
      : `<div class="panel-card"><p>No access logs recorded.</p></div>`;
  }

  function renderAuditLogs(logs) {
    const el = document.getElementById("adminAuditLogs");
    if (!el) return;
    el.innerHTML = logs.length
      ? logs
          .slice(0, 30)
          .map(
            (l) => `
        <div class="request-card" style="padding:12px 16px;">
          <div>
            <strong>${esc(l.action)}</strong>
            <p>Actor: ${esc(l.actor_email || l.actor_role || "System")} • Entity: ${esc(l.entity_type || "—")} #${esc(l.entity_id ?? "—")}</p>
            <small>${esc(fmt(l.created_at))}</small>
          </div>
          <span class="status available">${esc(l.actor_role || "system")}</span>
        </div>
      `
          )
          .join("")
      : `<div class="panel-card"><p>No audit logs recorded.</p></div>`;
  }

  function renderUsers(users) {
    document.getElementById("adminUsersBody").innerHTML = users
      .map(
        (u) => `
      <tr>
        <td data-label="Name">${esc(u.first_name)} ${esc(u.last_name)}</td>
        <td data-label="Email">${esc(u.email)}</td>
        <td data-label="Phone">${esc(u.phone)}</td>
        <td data-label="Role">
          <select id="role-${Number(u.id)}" style="padding:5px;border:1px solid var(--border);border-radius:6px;">
            <option value="patient" ${u.role === "patient" ? "selected" : ""}>patient</option>
            <option value="hospital" ${u.role === "hospital" ? "selected" : ""}>hospital</option>
            <option value="blood_bank" ${u.role === "blood_bank" ? "selected" : ""}>blood_bank</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option>
          </select>
        </td>
        <td data-label="Status">
          <select id="status-${Number(u.id)}" style="padding:5px;border:1px solid var(--border);border-radius:6px;">
            <option value="active" ${u.status === "active" ? "selected" : ""}>active</option>
            <option value="suspended" ${u.status === "suspended" ? "selected" : ""}>suspended</option>
          </select>
        </td>
        <td data-label="Action"><button class="small-btn" onclick="saveUserRole(${Number(u.id)})">Update</button></td>
      </tr>
    `
      )
      .join("");
  }

  window.saveUserRole = async function (userId) {
    const role = document.getElementById(`role-${userId}`).value;
    const status = document.getElementById(`status-${userId}`).value;
    try {
      await window.medtrackApi.request(`/admin/users/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role, status })
      });
      showAdminFeedback(`Updated user #${userId} (${role} / ${status}).`);
    } catch (err) {
      showAdminFeedback(err.message, true);
    }
  };

  let adminTransportsList = [];
  let selectedAdminTransport = null;
  let lastAdminUnlockToken = null;

  async function loadAdminTransports() {
    try {
      const res = await window.medtrackApi.request("/transport");
      adminTransportsList = res.transports || [];
      const sel = document.getElementById("adminTransportSelect");
      if (!sel) return;

      if (!adminTransportsList.length) {
        sel.innerHTML = `<option value="">No active blood shipments found</option>`;
        const summary = document.getElementById("adminTransportSummaryCards");
        if (summary) summary.innerHTML = `<p style="color:var(--muted);font-size:13px;">No active blood transports currently in transit.</p>`;
        return;
      }

      sel.innerHTML = adminTransportsList
        .map(
          (t) =>
            `<option value="${Number(t.id)}">${esc(t.transport_code)} — ${esc(t.blood_group)} (${Number(t.units_requested)}u) via ${esc(t.device_uid)} to ${esc(t.destination_hospital_name || "Hospital")} [${esc(t.status)}]</option>`
        )
        .join("");

      const currentId = selectedAdminTransport ? selectedAdminTransport.id : adminTransportsList[0].id;
      sel.value = String(currentId);
      await onAdminTransportChange(currentId);
    } catch (err) {
      console.warn("Failed to load admin transports:", err.message);
    }
  }

  window.onAdminTransportChange = async function (transportId) {
    selectedAdminTransport = adminTransportsList.find((t) => t.id === Number(transportId)) || null;
    if (!selectedAdminTransport) return;

    try {
      const [otpRes, tempRes] = await Promise.all([
        window.medtrackApi.request(`/otp/${selectedAdminTransport.id}/status`),
        window.medtrackApi.request(`/temperature/${selectedAdminTransport.device_id}/history`).catch(() => ({ latest: null, isStale: true, connectivity: "offline" }))
      ]);

      const latestTemp = tempRes.latest;
      const tempDisplay = latestTemp && latestTemp.temperatureC !== null ? `${Number(latestTemp.temperatureC).toFixed(1)}°C` : "N/A";
      const logs = otpRes.logs || [];
      const doorOtp = window.medtrackIot ? window.medtrackIot.summarizeDoorAndOtp(otpRes.otpStatus, logs) : { doorState: "CLOSED", lockState: "LOCKED", otpState: "ACTIVE" };

      const cards = document.getElementById("adminTransportSummaryCards");
      if (cards) {
        cards.innerHTML = `
          <div class="dashboard-card">
            <span>Box Device</span>
            <strong style="font-size:18px;">${esc(selectedAdminTransport.device_uid)}</strong>
            <small>${esc(selectedAdminTransport.device_name || "ESP32 Box")}</small>
          </div>
          <div class="dashboard-card">
            <span>Destination Hospital</span>
            <strong style="font-size:18px;">${esc(selectedAdminTransport.destination_hospital_name || "Assigned Facility")}</strong>
            <small>Contact: ${esc(selectedAdminTransport.recipient_contact)}</small>
          </div>
          <div class="dashboard-card">
            <span>Blood Cargo</span>
            <strong style="font-size:18px;color:#dc2626;">${esc(selectedAdminTransport.blood_group)} (${Number(selectedAdminTransport.units_requested)} units)</strong>
            <small>Origin: ${esc(selectedAdminTransport.origin_bank_name || "Blood Bank")}</small>
          </div>
          <div class="dashboard-card">
            <span>Chamber Temp</span>
            <strong style="font-size:18px;">${esc(tempDisplay)}</strong>
            <small>${tempRes.isStale ? "STALE" : "LIVE"} • Target 4°C–8°C</small>
          </div>
          <div class="dashboard-card">
            <span>Door &amp; Servo Status</span>
            <strong style="font-size:18px;color:${doorOtp.lockState === "UNLOCKED" ? "#087f5b" : "#102a27"};">Servo: ${esc(doorOtp.lockState || "LOCKED")}</strong>
            <small>Status: ${esc(doorOtp.doorState || "CLOSED")}</small>
          </div>
          <div class="dashboard-card">
            <span>Shipment Status</span>
            <strong style="font-size:18px;color:#087f5b;">${esc(String(selectedAdminTransport.status).toUpperCase())}</strong>
            <small>Dispatched: ${esc(fmt(selectedAdminTransport.dispatched_at))}</small>
          </div>
        `;
      }

      renderAdminTransportLogs(logs);
    } catch (err) {
      console.warn("Failed to load transport details:", err.message);
    }
  };

  function renderAdminTransportLogs(logs) {
    const el = document.getElementById("adminTransportLogsList");
    if (!el) return;
    el.innerHTML = logs.length
      ? logs
          .map(
            (l) => `
        <div class="request-card" style="padding:10px 14px;">
          <div>
            <strong>${esc(String(l.event_type).toUpperCase())}</strong>
            <p style="margin:2px 0;font-size:13px;">${esc(l.details || "")}</p>
            <small>${esc(fmt(l.created_at))} • Source IP: ${esc(l.source_ip || "127.0.0.1")}</small>
          </div>
          <span class="status ${l.success ? "available" : "busy"}">${l.success ? "SUCCESS" : "ALERT"}</span>
        </div>
      `
          )
          .join("")
      : `<p style="font-size:13px;color:var(--muted);">No door access logs recorded for this transport yet.</p>`;
  }

  window.generateAdminOtp = async function () {
    const box = document.getElementById("adminOtpDisplayBox");
    if (!selectedAdminTransport) {
      showAdminFeedback("Please select an active blood shipment first.", true);
      if (box) box.innerHTML = `<div class="feedback-banner error">Please select an active blood shipment.</div>`;
      return;
    }

    const ttlVal = Number(document.getElementById("adminOtpTtl")?.value) || 300;
    const contactOverride = document.getElementById("adminOtpRecipientContact")?.value.trim();

    if (box) {
      box.innerHTML = `<div class="feedback-banner info">⏳ Generating authoritative Admin Master OTP...</div>`;
    }

    try {
      const res = await window.medtrackApi.request("/otp/generate", {
        method: "POST",
        body: JSON.stringify({
          transportId: Number(selectedAdminTransport.id),
          ttlSeconds: ttlVal,
          ...(contactOverride ? { recipientContact: contactOverride } : {})
        })
      });

      const otp = res.simulationOtpPreview || res.otpCode || "";
      const ttl = Number(res.ttlSeconds) || ttlVal;
      const recipient = res.recipientContact || selectedAdminTransport.recipient_contact || "Designated Recipient";

      if (box) {
        box.innerHTML = `
          <div class="feedback-banner success" style="padding:14px;border-left:4px solid #087f5b;background:#f0fdf4;">
            <div style="font-weight:700;font-size:15px;color:#087f5b;margin-bottom:4px;">
              ✓ Admin Master Access OTP Issued Successfully
            </div>
            <p style="margin:4px 0;font-size:13px;">
              Authoritative single-use OTP for <strong>${esc(selectedAdminTransport.transport_code)}</strong> dispatched to <strong>${esc(recipient)}</strong> (valid for <strong>${ttl}s</strong>).
            </p>
            ${otp ? `
              <div style="margin:10px 0;background:#fef9c3;padding:10px 14px;border-radius:6px;border:1px solid #fde047;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                <div>
                  <span style="font-size:11px;text-transform:uppercase;color:#854d0e;font-weight:700;">6-Digit Master OTP Code:</span><br>
                  <code style="font-size:24px;font-weight:800;letter-spacing:4px;color:#713f12;">${esc(otp)}</code>
                </div>
                <button type="button" class="small-btn" onclick="navigator.clipboard?.writeText('${esc(otp)}'); this.textContent='✓ Copied!';" style="margin:0;">Copy OTP</button>
              </div>
            ` : ""}
            <div style="margin-top:8px;font-size:12px;color:#166534;line-height:1.5;">
              <strong>Accepted across all verification modes:</strong><br>
              • <strong>Mode 1 (Hardware ESP32):</strong> Keypad on transport box directly posts to <code>/api/v1/otp/verify</code><br>
              • <strong>Mode 2 (Hospital Dashboard):</strong> Recipient hospital verifies on their portal keypad<br>
              • <strong>Mode 3 (Blood Bank Portal):</strong> Dispatcher verifies before release<br>
              • <strong>Mode 4 (Physical ESP32 WebServer):</strong> Direct HTTP call to <code>http://&lt;esp32_ip&gt;/unlock?otp=${esc(otp)}</code>
            </div>
          </div>
        `;
      }

      // Auto-fill test keypad in admin simulator
      const simInput = document.getElementById("adminSimOtpInput");
      if (simInput && otp) {
        simInput.value = otp;
      }

      showAdminFeedback(`Admin Master OTP generated for ${selectedAdminTransport.transport_code}.`);
      await onAdminTransportChange(selectedAdminTransport.id);
      await loadAdminDashboard();
    } catch (err) {
      showAdminFeedback(err.message, true);
      if (box) {
        box.innerHTML = `<div class="feedback-banner error">⚠️ Failed to generate OTP: ${esc(err.message)}</div>`;
      }
    }
  };

  window.markAdminTransportDelivered = async function () {
    if (!selectedAdminTransport) return;
    try {
      await window.medtrackApi.request(`/transport/${selectedAdminTransport.id}/deliver`, { method: "PATCH" });
      showAdminFeedback(`Transport ${selectedAdminTransport.transport_code} marked as delivered.`);
      await loadAdminTransports();
      await loadAdminDashboard();
    } catch (err) {
      showAdminFeedback(err.message, true);
    }
  };

  window.verifyAdminSimKeypad = async function () {
    if (!selectedAdminTransport) return;
    const fb = document.getElementById("adminSimFeedback");
    const otp = document.getElementById("adminSimOtpInput")?.value.trim();
    if (!otp) {
      if (fb) {
        fb.style.color = "#dc2626";
        fb.textContent = "Please enter the 6-digit OTP.";
      }
      return;
    }

    try {
      const res = await window.medtrackApi.request("/otp/simulate-verify", {
        method: "POST",
        body: JSON.stringify({ transportId: selectedAdminTransport.id, otp })
      });
      lastAdminUnlockToken = res.unlockToken;
      if (fb) {
        fb.style.color = "#087f5b";
        fb.textContent = `[SUCCESS] OTP Verified! Servo Latch UNLOCKED (token expires ${fmt(res.unlockExpiresAt)}).`;
      }

      const esp32Url = getAdminEsp32Url();
      if (esp32Url) {
        unlockAdminPhysicalBox(esp32Url, otp);
      }

      await onAdminTransportChange(selectedAdminTransport.id);
      await loadAdminDashboard();
    } catch (err) {
      if (fb) {
        fb.style.color = "#dc2626";
        fb.textContent = `[FAILED] ${err.message}`;
      }
      await onAdminTransportChange(selectedAdminTransport.id);
    }
  };

  window.simulateAdminDoorEvent = async function (eventType) {
    if (!selectedAdminTransport) return;
    const fb = document.getElementById("adminSimFeedback");
    try {
      const res = await window.medtrackApi.request("/access/simulate-door-event", {
        method: "POST",
        body: JSON.stringify({
          transportId: selectedAdminTransport.id,
          eventType,
          unlockToken: lastAdminUnlockToken || undefined
        })
      });
      if (eventType === "door_closed") {
        lastAdminUnlockToken = null;
      }
      if (fb) {
        fb.style.color = res.success ? "#087f5b" : "#dc2626";
        fb.textContent = `[SIMULATED] Reed switch recorded: ${res.recordedEventType}`;
      }
      await onAdminTransportChange(selectedAdminTransport.id);
      await loadAdminDashboard();
    } catch (err) {
      if (fb) {
        fb.style.color = "#dc2626";
        fb.textContent = err.message;
      }
    }
  };

  function getAdminEsp32Url() {
    const input = document.getElementById("adminEsp32BoxUrl");
    let url = input?.value.trim() || localStorage.getItem("medtrack_esp32_url") || "";
    if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
      url = `http://${url}`;
    }
    return url.replace(/\/+$/, "");
  }

  window.saveAdminEsp32Url = function () {
    const url = getAdminEsp32Url();
    if (url) {
      localStorage.setItem("medtrack_esp32_url", url);
    }
  };

  window.checkAdminPhysicalStatus = async function () {
    const meta = document.getElementById("adminEsp32StatusMeta");
    const badge = document.getElementById("adminEsp32ConnBadge");
    const url = getAdminEsp32Url();
    if (!url) {
      if (meta) meta.innerHTML = `<span style="color:#dc2626;">Please enter the ESP32 Box IP/URL first (e.g. http://192.168.1.100).</span>`;
      return;
    }
    saveAdminEsp32Url();
    if (meta) meta.innerHTML = `<span>Checking status at ${esc(url)}/status...</span>`;

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 4000);
      const resp = await fetch(`${url}/status`, { signal: ctrl.signal });
      clearTimeout(timeout);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (badge) {
        badge.textContent = "CONNECTED";
        badge.className = "status available";
      }
      const lockedStr = data.locked ? "🔒 LOCKED (0°)" : "🟢 UNLOCKED (90°)";
      const lidStr = data.lid_closed ? "Lid: CLOSED (Reed LOW)" : "⚠️ Lid: OPEN (Reed HIGH)";
      if (meta) {
        meta.innerHTML = `<span style="color:#087f5b;">✓ ESP32 Online (${esc(data.ip || url)}) • Servo: <strong>${esc(lockedStr)}</strong> • <strong>${esc(lidStr)}</strong></span>`;
      }
    } catch (err) {
      if (badge) {
        badge.textContent = "STANDALONE";
        badge.className = "status limited";
      }
      if (meta) {
        meta.innerHTML = `<span style="color:#b45309;">⚠️ Direct fetch to ${esc(url)} failed (${esc(err.message)}). Ensure your device and ESP32 are on the same Wi-Fi.</span>`;
      }
    }
  };

  window.unlockAdminPhysicalBox = async function (customUrl = null, otp = "") {
    const meta = document.getElementById("adminEsp32StatusMeta");
    const badge = document.getElementById("adminEsp32ConnBadge");
    const url = customUrl || getAdminEsp32Url();
    if (!url) {
      if (meta) meta.innerHTML = `<span style="color:#dc2626;">Please enter the ESP32 Box IP/URL first (e.g. http://192.168.1.100).</span>`;
      return;
    }
    saveAdminEsp32Url();
    if (meta) meta.innerHTML = `<span>Sending UNLOCK command to ESP32 on Pin 18...</span>`;

    try {
      const target = otp ? `${url}/unlock?otp=${encodeURIComponent(otp)}` : `${url}/unlock`;
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 4000);
      const resp = await fetch(target, { signal: ctrl.signal });
      clearTimeout(timeout);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await resp.json().catch(() => ({ status: "unlocked" }));
      if (badge) {
        badge.textContent = "UNLOCKED";
        badge.className = "status available";
      }
      if (meta) {
        meta.innerHTML = `<span style="color:#087f5b;font-weight:700;">🎉 Physical ESP32 Box UNLOCKED! Servo actuated to 90°. (Will auto-relock once lid is closed).</span>`;
      }
    } catch (err) {
      if (meta) {
        meta.innerHTML = `<span style="color:#dc2626;">⚠️ Unlock signal failed: ${esc(err.message)}. Check ESP32 Wi-Fi and IP address.</span>`;
      }
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    loadAdminDashboard();
    const savedUrl = localStorage.getItem("medtrack_esp32_url");
    const esp32Input = document.getElementById("adminEsp32BoxUrl");
    if (savedUrl && esp32Input) {
      esp32Input.value = savedUrl;
    }

    document.getElementById("registerDeviceForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const res = await window.medtrackApi.request("/devices/register", {
          method: "POST",
          body: JSON.stringify({
            deviceUid: document.getElementById("newDeviceUid").value.trim(),
            name: document.getElementById("newDeviceName").value.trim(),
            hardwareModel: document.getElementById("newDeviceModel").value.trim()
          })
        });
        document.getElementById("newDeviceKeyBox").innerHTML = `
          <div class="feedback-banner success">
            Device <strong>${esc(res.device.deviceUid)}</strong> provisioned! Copy API Key into firmware <code>config.h</code> (shown once): <code>${esc(res.deviceApiKey)}</code>
          </div>
        `;
        await loadAdminDashboard();
      } catch (err) {
        showAdminFeedback(err.message, true);
      }
    });
  });
})();
