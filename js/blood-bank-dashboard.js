(function () {
  let bankProfile = null;
  let availableDevices = [];
  let bankMapRef = null;
  let bankProfileMapRef = null;
  let bankProfileMarker = null;

  function esc(v) {
    return window.medtrackApi ? window.medtrackApi.escapeHtml(v) : String(v ?? "");
  }

  function fmt(ts) {
    return window.medtrackApi ? window.medtrackApi.formatLocalTime(ts) : String(ts ?? "—");
  }

  function showFeedback(msg, isError = false) {
    const el = document.getElementById("bankFeedback");
    el.style.display = "block";
    el.className = `feedback-banner ${isError ? "error" : "success"}`;
    el.textContent = msg;
  }

  window.switchBankTab = function (name, btn) {
    document.querySelectorAll(".bank-tab-panel").forEach((p) => (p.style.display = "none"));
    document.querySelectorAll(".tab-bar .tab-btn").forEach((b) => b.classList.remove("active"));
    document.getElementById(`bank-tab-${name}`).style.display = "block";
    if (btn) btn.classList.add("active");
    if (name === "transports" && bankMapRef) {
      setTimeout(() => bankMapRef.invalidateSize(), 120);
    }
    if (name === "profile") {
      if (!bankProfileMapRef && bankProfile) {
        initBankProfileMap(bankProfile.latitude, bankProfile.longitude);
      }
      if (bankProfileMapRef) {
        setTimeout(() => bankProfileMapRef.invalidateSize(), 120);
      }
    }
  };

  function statusClass(status) {
    if (status === "Sufficient") return "available";
    if (status === "Low") return "limited";
    return "busy";
  }

  function renderBankVerifyBanner(user) {
    const banner = document.getElementById("bankContactVerifyBanner");
    if (!banner) return;
    if (!user || user.emailVerified) {
      banner.style.display = "none";
      return;
    }
    banner.style.display = "block";
    banner.innerHTML = `
      <div class="disclaimer-banner" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div>
          <strong>Email Verification Pending:</strong> Verify <code>${esc(user.email)}</code>.
          <span id="bankVerifyCodeMsg" style="margin-left:8px;"></span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button type="button" id="bankSendVerifyCodeBtn" class="small-btn">Send Code</button>
          <input type="text" id="bankVerifyCodeInput" maxlength="6" placeholder="6-digit code" style="width:110px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;">
          <button type="button" id="bankSubmitVerifyCodeBtn" class="primary-btn">Verify</button>
        </div>
      </div>
    `;

    document.getElementById("bankSendVerifyCodeBtn")?.addEventListener("click", async () => {
      try {
        const res = await window.medtrackApi.request("/auth/verify-contact", {
          method: "POST",
          body: JSON.stringify({ channel: "email" })
        });
        const msgEl = document.getElementById("bankVerifyCodeMsg");
        if (res.simulationVerificationCode) {
          document.getElementById("bankVerifyCodeInput").value = res.simulationVerificationCode;
          if (msgEl) msgEl.textContent = `Dev preview code: ${res.simulationVerificationCode}`;
        } else if (msgEl) {
          msgEl.textContent = res.message || "Code sent.";
        }
      } catch (err) {
        showFeedback(err.message, true);
      }
    });

    document.getElementById("bankSubmitVerifyCodeBtn")?.addEventListener("click", async () => {
      const code = document.getElementById("bankVerifyCodeInput")?.value.trim();
      if (!code) return;
      try {
        const res = await window.medtrackApi.request("/auth/verify-contact", {
          method: "POST",
          body: JSON.stringify({ channel: "email", code })
        });
        if (res.user) window.medtrackApi.setSession(null, res.user);
        showFeedback("Contact email verified!");
        banner.style.display = "none";
      } catch (err) {
        showFeedback(err.message, true);
      }
    });
  }

  function initBankProfileMap(lat, lng) {
    const el = document.getElementById("bankProfileMap");
    if (!el || typeof L === "undefined") return;
    if (!bankProfileMapRef) {
      bankProfileMapRef = L.map("bankProfileMap").setView([lat, lng], 13);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(bankProfileMapRef);
      bankProfileMapRef.on("click", (e) => {
        document.getElementById("bankProfLat").value = e.latlng.lat.toFixed(6);
        document.getElementById("bankProfLng").value = e.latlng.lng.toFixed(6);
        if (bankProfileMarker) bankProfileMarker.setLatLng(e.latlng);
      });
      window.addEventListener("resize", () => bankProfileMapRef && bankProfileMapRef.invalidateSize());
    } else {
      bankProfileMapRef.setView([lat, lng], 13);
    }
    if (bankProfileMarker) bankProfileMapRef.removeLayer(bankProfileMarker);
    bankProfileMarker = L.marker([lat, lng], { draggable: true }).addTo(bankProfileMapRef);
    bankProfileMarker.on("dragend", (e) => {
      const pos = e.target.getLatLng();
      document.getElementById("bankProfLat").value = pos.lat.toFixed(6);
      document.getElementById("bankProfLng").value = pos.lng.toFixed(6);
    });
  }

  function showBankOnboardingBanner() {
    document.getElementById("bankTitle").textContent = "Complete Blood Bank Onboarding";
    document.getElementById("bankSubtitle").textContent = "No blood bank facility profile is linked to this account yet.";
    document.getElementById("bankVerifiedBadge").textContent = "⏳ PROFILE REQUIRED";
    const onboarding = document.getElementById("bankOnboardingBanner");
    onboarding.style.display = "block";
    onboarding.innerHTML = `
      <div class="feedback-banner error" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <span>This account does not have a registered blood bank facility yet. Register your blood bank and map pin to manage inventory &amp; IoT dispatch.</span>
        <a href="hospital-register.html?type=blood_bank" class="primary-btn">Register Blood Bank →</a>
      </div>
    `;
  }

  async function loadBankData() {
    const user = window.medtrackApi.getUser();
    if (!user) {
      window.location.href = "login.html";
      return;
    }

    try {
      const meRes = await window.medtrackApi.request("/auth/me").catch(() => null);
      if (meRes?.user) {
        window.medtrackApi.setSession(null, meRes.user);
        renderBankVerifyBanner(meRes.user);
        if (meRes.facility === null) {
          showBankOnboardingBanner();
          return;
        }
      } else {
        renderBankVerifyBanner(user);
      }

      const profileRes = await window.medtrackApi.request("/blood-banks/my/profile");
      bankProfile = profileRes.bloodBank;
      document.getElementById("bankOnboardingBanner").style.display = "none";
      document.getElementById("bankTitle").textContent = bankProfile.name;
      document.getElementById("bankSubtitle").textContent = `${bankProfile.city}, ${bankProfile.state} • License: ${bankProfile.licenseNumber}`;
      document.getElementById("bankVerifiedBadge").textContent =
        bankProfile.verificationStatus === "approved"
          ? "✓ VERIFIED BLOOD BANK"
          : `⏳ VERIFICATION: ${bankProfile.verificationStatus.toUpperCase()}`;

      document.getElementById("bankProfName").value = bankProfile.name;
      document.getElementById("bankProfPhone").value = bankProfile.phone;
      document.getElementById("bankProfAddress").value = bankProfile.address;
      document.getElementById("bankProfCity").value = bankProfile.city;
      document.getElementById("bankProfState").value = bankProfile.state;
      document.getElementById("bankProfLat").value = bankProfile.latitude;
      document.getElementById("bankProfLng").value = bankProfile.longitude;
      initBankProfileMap(bankProfile.latitude, bankProfile.longitude);

      // Load devices & transports BEFORE rendering requests so dispatch dropdown has devices ready
      await loadDevicesAndTransports();
      await Promise.all([loadInventory(), loadRequests(), loadHistory(), loadBankAlerts()]);
    } catch (err) {
      if (err.status === 404) {
        showBankOnboardingBanner();
      } else {
        showFeedback(err.message, true);
      }
    }
  }

  async function loadInventory() {
    const res = await window.medtrackApi.request(`/inventory/bank/${bankProfile.id}`);
    const grid = document.getElementById("inventoryGrid");
    grid.innerHTML = (res.inventory || [])
      .map(
        (item) => `
      <div class="dashboard-card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:800;color:var(--danger);font-size:18px;">${esc(item.blood_group)}</span>
          <span class="status ${statusClass(item.status)}">${esc(item.status.toUpperCase())}</span>
        </div>
        <strong id="units-${esc(item.blood_group)}">${Number(item.units_available)}</strong>
        <small style="display:block;color:var(--muted);margin-bottom:10px;">Updated: ${esc(fmt(item.updated_at))}</small>
        <div style="display:flex;gap:6px;align-items:center;">
          <input type="number" min="0" id="input-${esc(item.blood_group)}" value="${Number(item.units_available)}" style="width:72px;padding:6px;border:1px solid var(--border);border-radius:6px;">
          <button type="button" class="small-btn" onclick="updateBloodUnits('${esc(item.blood_group)}')">Save</button>
        </div>
      </div>
    `
      )
      .join("");
  }

  window.updateBloodUnits = async function (bloodGroup) {
    const units = Number(document.getElementById(`input-${bloodGroup}`).value);
    try {
      await window.medtrackApi.request(`/inventory/bank/${bankProfile.id}`, {
        method: "PUT",
        body: JSON.stringify({
          bloodGroup,
          unitsAvailable: units,
          reason: "Blood bank dashboard stock update"
        })
      });
      showFeedback(`Updated ${bloodGroup} stock to ${units} unit(s).`);
      await Promise.all([loadInventory(), loadHistory()]);
    } catch (err) {
      showFeedback(err.message, true);
    }
  };

  async function loadRequests() {
    const res = await window.medtrackApi.request("/blood-requests");
    const list = document.getElementById("bankRequestsList");
    const reqs = res.requests || [];
    if (!reqs.length) {
      list.innerHTML = `<div class="panel-card"><p>No blood requests received.</p></div>`;
      return;
    }

    const freeDevices = availableDevices.filter((d) => !d.inUse && d.status !== "maintenance");
    const devOptions = availableDevices.length
      ? availableDevices
          .map((d) => {
            const unavailable = d.inUse || d.status === "maintenance";
            const suffix = d.status === "maintenance"
              ? "maintenance"
              : d.inUse
                ? `in use: ${d.activeTransportCode || "active"}`
                : d.connectivity;
            return `<option value="${Number(d.id)}" ${unavailable ? "disabled" : ""}>${esc(d.deviceUid)} (${esc(suffix)})</option>`;
          })
          .join("")
      : `<option value="">No IoT boxes registered</option>`;

    list.innerHTML = reqs
      .map(
        (r) => `
      <div class="request-card">
        <div>
          <strong>${esc(r.request_code)} • ${esc(r.blood_group)} (${Number(r.units_requested)} units)</strong>
          <p>From: ${esc(r.hospital_name || "Patient")} • Urgency: ${esc(String(r.urgency).toUpperCase())} • Contact: ${esc(r.recipient_contact)}</p>
          <small>Status: <strong>${esc(String(r.status).toUpperCase())}</strong> • ${esc(fmt(r.created_at))}${r.rejection_reason ? ` • Reason: ${esc(r.rejection_reason)}` : ""}</small>
          <div id="rejectBox-${Number(r.id)}" style="display:none;margin-top:10px;gap:8px;align-items:center;flex-wrap:wrap;">
            <input type="text" id="rejectReason-${Number(r.id)}" value="Stock reserved for critical trauma" placeholder="Enter rejection reason" style="padding:8px 10px;border:1px solid var(--border);border-radius:7px;flex:1 1 200px;min-width:0;max-width:100%;">
            <button type="button" class="primary-btn" style="background:#dc2626;" onclick="confirmRejectBloodReq(${Number(r.id)})">Confirm Reject</button>
            <button type="button" class="small-btn" onclick="cancelRejectBloodReq(${Number(r.id)})">Cancel</button>
          </div>
        </div>
        <div class="request-card-actions">
          ${
            r.status === "pending"
              ? `
            <button class="primary-btn" onclick="acceptBloodReq(${Number(r.id)})">Accept</button>
            <button class="small-btn" onclick="showRejectBloodReq(${Number(r.id)})">Reject</button>
          `
              : ""
          }
          ${
            r.status === "accepted"
              ? `
            <select id="dispatchDev-${Number(r.id)}" style="padding:8px;min-height:40px;border:1px solid var(--border);border-radius:7px;max-width:100%;">${devOptions}</select>
            <button class="primary-btn" ${freeDevices.length ? "" : "disabled title='No free IoT box available'"} onclick="dispatchBloodReq(${Number(r.id)})">📦 Dispatch IoT Box</button>
          `
              : ""
          }
          ${
            r.transport_code
              ? `<span class="status available">BOX: ${esc(r.transport_code)}</span>`
              : ""
          }
        </div>
      </div>
    `
      )
      .join("");
  }

  window.acceptBloodReq = async function (id) {
    try {
      await window.medtrackApi.request(`/blood-requests/${id}/accept`, { method: "PATCH" });
      showFeedback("Blood request accepted. Assign an IoT transport box to dispatch.");
      await loadRequests();
    } catch (err) {
      showFeedback(err.message, true);
    }
  };

  window.showRejectBloodReq = function (id) {
    const box = document.getElementById(`rejectBox-${id}`);
    if (box) box.style.display = "flex";
  };

  window.cancelRejectBloodReq = function (id) {
    const box = document.getElementById(`rejectBox-${id}`);
    if (box) box.style.display = "none";
  };

  window.confirmRejectBloodReq = async function (id) {
    const reason = document.getElementById(`rejectReason-${id}`)?.value.trim();
    if (!reason || reason.length < 3) {
      showFeedback("Please provide a rejection reason (at least 3 characters).", true);
      return;
    }
    try {
      await window.medtrackApi.request(`/blood-requests/${id}/reject`, {
        method: "PATCH",
        body: JSON.stringify({ reason })
      });
      showFeedback("Blood request rejected.");
      await loadRequests();
    } catch (err) {
      showFeedback(err.message, true);
    }
  };

  window.dispatchBloodReq = async function (requestId) {
    const deviceId = Number(document.getElementById(`dispatchDev-${requestId}`).value);
    if (!deviceId) {
      showFeedback("No available IoT transport box selected.", true);
      return;
    }
    try {
      const res = await window.medtrackApi.request("/transport/dispatch", {
        method: "POST",
        body: JSON.stringify({ bloodRequestId: requestId, deviceId })
      });
      showFeedback(`Dispatched ${res.transport.transport_code}! Inventory deducted and logged.`);
      await loadDevicesAndTransports();
      await Promise.all([loadInventory(), loadRequests(), loadHistory()]);
    } catch (err) {
      showFeedback(err.message, true);
    }
  };

  async function loadDevicesAndTransports() {
    const [devRes, trRes] = await Promise.all([
      window.medtrackApi.request("/devices"),
      window.medtrackApi.request("/transport")
    ]);
    availableDevices = devRes.devices || [];
    const transports = trRes.transports || [];
    const list = document.getElementById("bankTransportsList");
    if (!transports.length) {
      list.innerHTML = `<div class="panel-card"><p>No active transports yet.</p></div>`;
      return;
    }

    list.innerHTML = transports
      .map(
        (t) => `
      <div class="request-card" style="flex-wrap:wrap;">
        <div>
          <strong>${esc(t.transport_code)} • ${esc(t.blood_group)} (${Number(t.units_requested)}u)</strong>
          <p>To: ${esc(t.destination_hospital_name || "Recipient")} • Device: ${esc(t.device_uid)}</p>
          <small>Dispatched: ${esc(fmt(t.dispatched_at))} • Status: ${esc(String(t.status).toUpperCase())}</small>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="small-btn" onclick="inspectBankTransport(${Number(t.id)})">Inspect Telemetry</button>
          ${
            t.status !== "delivered" && t.status !== "cancelled"
              ? `<button type="button" class="primary-btn" onclick="markBankTransportDelivered(${Number(t.id)})">✓ Mark Delivered</button>`
              : ""
          }
        </div>
      </div>
    `
      )
      .join("");

    await inspectBankTransport(transports[0].id, transports[0]);
  }

  window.markBankTransportDelivered = async function (transportId) {
    try {
      await window.medtrackApi.request(`/transport/${transportId}/deliver`, { method: "PATCH" });
      showFeedback("Shipment marked delivered and IoT box released.");
      await loadDevicesAndTransports();
      await loadRequests();
    } catch (err) {
      showFeedback(err.message, true);
    }
  };

  window.inspectBankTransport = async function (transportId, cachedObj = null) {
    const tr =
      cachedObj ||
      (await window.medtrackApi.request(`/transport/${transportId}`)).transport;
    const [gpsData, tempData, otpData, devData, readingsData] = await Promise.all([
      window.medtrackApi.request(`/gps/${tr.id}/route`),
      window.medtrackApi.request(`/temperature/${tr.device_id}/history`),
      window.medtrackApi.request(`/otp/${tr.id}/status`),
      window.medtrackApi.request(`/devices/${tr.device_id}`).catch(() => ({ device: null })),
      window.medtrackApi.request(`/sensors/${tr.device_id}?limit=30`).catch(() => ({ readings: [] }))
    ]);
    bankMapRef = window.medtrackIot.renderTransportRouteMap(
      bankMapRef,
      "bankTransportMap",
      tr,
      gpsData.points || []
    );
    window.medtrackIot.renderTemperatureChart(
      "bankTempChart",
      tempData.history || [],
      tempData.coolingPolicy
    );
    const logs = otpData.logs || [];
    const doorOtp = window.medtrackIot.summarizeDoorAndOtp(otpData.otpStatus, logs);
    const latest = tempData.latest;
    const summaryEl = document.getElementById("bankTransportSummaryCards");
    if (summaryEl) {
      const tempText = latest && latest.temperatureC !== null ? `${Number(latest.temperatureC).toFixed(1)}°C` : "N/A";
      summaryEl.innerHTML = `
        <div class="dashboard-card">
          <span>Box Connectivity</span>
          <strong style="font-size:20px;">${esc(String(tempData.connectivity).toUpperCase())}</strong>
          <small>${esc(tr.device_uid)}</small>
        </div>
        <div class="dashboard-card">
          <span>Chamber Temp</span>
          <strong style="font-size:22px;color:${latest?.qualityStatus === "critical" || latest?.qualityStatus === "sensor_error" ? "#dc2626" : "#087f5b"}">${esc(tempText)}</strong>
          <small>Peltier: ${latest?.coolingActive ? "ON" : "OFF"}</small>
        </div>
        <div class="dashboard-card">
          <span>Door &amp; Lock</span>
          <strong style="font-size:18px;color:${doorOtp.doorAlert ? "#dc2626" : "#102a27"}">${esc(doorOtp.doorState)}</strong>
          <small>Servo: ${esc(doorOtp.lockState)}</small>
        </div>
        <div class="dashboard-card">
          <span>OTP Status</span>
          <strong style="font-size:18px;color:${doorOtp.otpTone === "danger" ? "#dc2626" : doorOtp.otpTone === "warn" ? "#d97706" : "#087f5b"}">${esc(doorOtp.otpState)}</strong>
          <small>${esc(doorOtp.otpDetail)}</small>
        </div>
      `;
    }
    const meta = document.getElementById("bankCoolingMeta");
    if (meta) {
      meta.textContent = latest
        ? `Latest: ${latest.temperatureC ?? "ERR"}°C • Connectivity: ${String(tempData.connectivity).toUpperCase()} • Peltier: ${latest.coolingActive ? "ON" : "OFF"} • Policy: ${tempData.coolingPolicy.targetMinC}°C–${tempData.coolingPolicy.targetMaxC}°C`
        : `Policy: ${tempData.coolingPolicy.targetMinC}°C–${tempData.coolingPolicy.targetMaxC}°C`;
    }
    window.medtrackIot.renderModularSensors(
      "bankModularSensors",
      devData?.device?.sensors || [],
      readingsData?.readings || []
    );
    const logsEl = document.getElementById("bankAccessLogs");
    if (logsEl) {
      logsEl.innerHTML = logs.length
        ? logs
            .slice(0, 8)
            .map(
              (l) => `
              <div class="request-card" style="padding:12px 14px;">
                <div>
                  <strong>${esc(String(l.event_type).toUpperCase())}</strong>
                  <p>${esc(l.details || "")}</p>
                </div>
                <small>${esc(fmt(l.created_at))}</small>
              </div>
            `
            )
            .join("")
        : `<p style="font-size:13px;color:var(--muted);">No door access events yet.</p>`;
    }
  };

  async function loadHistory() {
    const res = await window.medtrackApi.request(`/inventory/bank/${bankProfile.id}/history`);
    const body = document.getElementById("inventoryHistoryBody");
    body.innerHTML = (res.history || [])
      .map(
        (h) => `
      <tr>
        <td data-label="Timestamp">${esc(fmt(h.created_at))}</td>
        <td data-label="Blood Group"><strong>${esc(h.blood_group)}</strong></td>
        <td data-label="Previous">${Number(h.previous_units)}</td>
        <td data-label="Delta" style="color:${h.delta_units >= 0 ? "#087f5b" : "#dc2626"};font-weight:700;">${h.delta_units >= 0 ? `+${Number(h.delta_units)}` : Number(h.delta_units)}</td>
        <td data-label="New">${Number(h.new_units)}</td>
        <td data-label="Reason">${esc(h.reason)}</td>
        <td data-label="Account">${esc(h.changed_by_email || "System")}</td>
      </tr>
    `
      )
      .join("");
  }

  async function loadBankAlerts() {
    const list = document.getElementById("bankAlertsList");
    if (!list) return;
    const res = await window.medtrackApi.request("/alerts");
    const alerts = res.alerts || [];
    if (!alerts.length) {
      list.innerHTML = `<div class="panel-card"><p>No alerts.</p></div>`;
      return;
    }
    list.innerHTML = alerts
      .map(
        (a) => `
      <div class="request-card">
        <div>
          <span class="status ${a.severity === "critical" ? "busy" : a.severity === "warning" ? "limited" : "available"}">${esc(String(a.severity).toUpperCase())}</span>
          <strong style="margin-left:8px;">${esc(a.title)}</strong>
          <p style="margin-top:4px;">${esc(a.message)}</p>
          <small>${esc(fmt(a.created_at))}</small>
        </div>
        ${
          a.acknowledged_at
            ? `<small style="color:var(--primary);">✓ Acknowledged</small>`
            : `<button class="small-btn" onclick="ackBankAlert(${Number(a.id)})">Acknowledge</button>`
        }
      </div>
    `
      )
      .join("");
  }

  window.ackBankAlert = async function (id) {
    try {
      await window.medtrackApi.request(`/alerts/${id}/acknowledge`, { method: "PATCH" });
      showFeedback("Alert acknowledged.");
      await loadBankAlerts();
    } catch (err) {
      showFeedback(err.message, true);
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    loadBankData();

    const syncBankCoords = () => {
      const lat = Number(document.getElementById("bankProfLat")?.value);
      const lng = Number(document.getElementById("bankProfLng")?.value);
      if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        if (bankProfileMarker) bankProfileMarker.setLatLng([lat, lng]);
        if (bankProfileMapRef) bankProfileMapRef.setView([lat, lng], Math.max(bankProfileMapRef.getZoom(), 12));
      }
    };
    document.getElementById("bankProfLat")?.addEventListener("change", syncBankCoords);
    document.getElementById("bankProfLng")?.addEventListener("change", syncBankCoords);

    document.getElementById("bankProfileForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!bankProfile) return;
      try {
        await window.medtrackApi.request(`/blood-banks/${bankProfile.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: document.getElementById("bankProfName").value.trim(),
            phone: document.getElementById("bankProfPhone").value.trim(),
            address: document.getElementById("bankProfAddress").value.trim(),
            city: document.getElementById("bankProfCity").value.trim(),
            state: document.getElementById("bankProfState").value.trim(),
            latitude: Number(document.getElementById("bankProfLat").value),
            longitude: Number(document.getElementById("bankProfLng").value)
          })
        });
        showFeedback("Blood bank profile and coordinates saved.");
        await loadBankData();
      } catch (err) {
        showFeedback(err.message, true);
      }
    });
  });
})();
