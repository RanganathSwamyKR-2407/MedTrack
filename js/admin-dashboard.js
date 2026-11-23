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

  document.addEventListener("DOMContentLoaded", () => {
    loadAdminDashboard();
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
