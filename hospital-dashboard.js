let hospitalData = {
  id: null,
  general: 32,
  icu: 4,
  emergency: 8,
  ambulances: 2
};

let transportsList = [];
let selectedTransport = null;
let routeMapRef = null;
let profileMapRef = null;
let profileMarker = null;
let lastSimUnlockToken = null;

function esc(v) {
  return window.medtrackApi ? window.medtrackApi.escapeHtml(v) : String(v ?? "");
}

function fmt(ts) {
  return window.medtrackApi ? window.medtrackApi.formatLocalTime(ts) : String(ts ?? "—");
}

function setFeedback(msg, isError = false) {
  const el = document.getElementById("hospitalFeedback");
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? "#dc2626" : "#087f5b";
}

function updateDashboardDom() {
  document.getElementById("generalBeds").textContent = hospitalData.general;
  document.getElementById("icuBeds").textContent = hospitalData.icu;
  document.getElementById("emergencyBeds").textContent = hospitalData.emergency;
  document.getElementById("ambulances").textContent = hospitalData.ambulances;
  localStorage.setItem("hospitalLiveData", JSON.stringify(hospitalData));
}

async function persistHospitalCounters() {
  updateDashboardDom();
  if (!hospitalData.id || !window.medtrackApi?.getToken()) return;
  try {
    await window.medtrackApi.request(`/hospitals/${hospitalData.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        generalBeds: hospitalData.general,
        icuBeds: hospitalData.icu,
        emergencyBeds: hospitalData.emergency,
        ambulances: hospitalData.ambulances
      })
    });
    document.getElementById("lastUpdatedText").textContent = "Saved to server just now";
    setFeedback("Updated live");
  } catch (err) {
    setFeedback(err.message, true);
  }
}

function changeBed(type, amount) {
  if (hospitalData[type] <= 0 && amount < 0) return;
  hospitalData[type] += amount;
  persistHospitalCounters();
}

function changeAmbulance(amount) {
  if (hospitalData.ambulances <= 0 && amount < 0) return;
  hospitalData.ambulances += amount;
  persistHospitalCounters();
}

async function toggleFacility(button) {
  const status = button.querySelector("span");
  if (status.textContent.trim() === "AVAILABLE") {
    status.textContent = "UNAVAILABLE";
    status.style.color = "#dc2626";
  } else {
    status.textContent = "AVAILABLE";
    status.style.color = "#087f5b";
  }

  if (hospitalData.id && window.medtrackApi?.getToken()) {
    const activeFacilities = [];
    document.querySelectorAll(".facility-grid button").forEach((btn) => {
      if (btn.querySelector("span")?.textContent.trim() === "AVAILABLE" && btn.dataset.facility) {
        activeFacilities.push(btn.dataset.facility);
      }
    });
    try {
      await window.medtrackApi.request(`/hospitals/${hospitalData.id}`, {
        method: "PATCH",
        body: JSON.stringify({ facilities: activeFacilities })
      });
      setFeedback("Facilities updated");
    } catch (err) {
      setFeedback(err.message, true);
    }
  }
}

function switchHospitalTab(tabName, button) {
  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.style.display = "none";
  });
  document.querySelectorAll(".tab-bar .tab-btn").forEach((b) => b.classList.remove("active"));
  const panel = document.getElementById(`tab-${tabName}`);
  if (panel) panel.style.display = "block";
  if (button) button.classList.add("active");

  if (tabName === "iot" && routeMapRef) {
    setTimeout(() => routeMapRef.invalidateSize(), 120);
  }
  if (tabName === "profile") {
    if (!profileMapRef && hospitalData.id) {
      const lat = Number(document.getElementById("profLat").value) || 18.5204;
      const lng = Number(document.getElementById("profLng").value) || 73.8567;
      initProfileMap(lat, lng);
    }
    if (profileMapRef) {
      setTimeout(() => profileMapRef.invalidateSize(), 120);
    }
  }
}

function renderContactVerifyBanner(user) {
  const banner = document.getElementById("contactVerifyBanner");
  if (!banner) return;
  if (!user || user.emailVerified) {
    banner.style.display = "none";
    return;
  }
  banner.style.display = "block";
  banner.innerHTML = `
    <div class="disclaimer-banner" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
      <div>
        <strong>Email Verification Pending:</strong> Verify <code>${esc(user.email)}</code> to enable full dispatch alerts.
        <span id="verifyCodeMsg" style="margin-left:8px;"></span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button type="button" id="sendVerifyCodeBtn" class="small-btn">Send Code</button>
        <input type="text" id="verifyCodeInput" maxlength="6" placeholder="6-digit code" style="width:110px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;">
        <button type="button" id="submitVerifyCodeBtn" class="primary-btn">Verify</button>
      </div>
    </div>
  `;

  document.getElementById("sendVerifyCodeBtn")?.addEventListener("click", async () => {
    try {
      const res = await window.medtrackApi.request("/auth/verify-contact", {
        method: "POST",
        body: JSON.stringify({ channel: "email" })
      });
      const msgEl = document.getElementById("verifyCodeMsg");
      if (res.simulationVerificationCode) {
        document.getElementById("verifyCodeInput").value = res.simulationVerificationCode;
        if (msgEl) msgEl.textContent = `Dev preview code: ${res.simulationVerificationCode}`;
      } else if (msgEl) {
        msgEl.textContent = res.message || "Code sent.";
      }
    } catch (err) {
      setFeedback(err.message, true);
    }
  });

  document.getElementById("submitVerifyCodeBtn")?.addEventListener("click", async () => {
    const code = document.getElementById("verifyCodeInput")?.value.trim();
    if (!code) return;
    try {
      const res = await window.medtrackApi.request("/auth/verify-contact", {
        method: "POST",
        body: JSON.stringify({ channel: "email", code })
      });
      if (res.user) {
        window.medtrackApi.setSession(null, res.user);
      }
      setFeedback("Contact email verified!");
      banner.style.display = "none";
    } catch (err) {
      setFeedback(err.message, true);
    }
  });
}

function showHospitalOnboardingBanner() {
  hospitalData.id = null;
  hospitalData.general = 0;
  hospitalData.icu = 0;
  hospitalData.emergency = 0;
  hospitalData.ambulances = 0;
  updateDashboardDom();
  document.getElementById("hospitalTitle").textContent = "Complete Hospital Onboarding";
  document.getElementById("hospitalSubtitle").textContent = "No hospital facility profile is linked to this account yet.";
  document.getElementById("verificationBadge").textContent = "⏳ PROFILE REQUIRED";
  const onboarding = document.getElementById("hospitalOnboardingBanner");
  onboarding.style.display = "block";
  onboarding.innerHTML = `
    <div class="feedback-banner error" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
      <span>This account does not have a registered hospital facility yet. Register your hospital and map pin to enable bed &amp; blood workflows.</span>
      <a href="hospital-register.html" class="primary-btn">Register Hospital Facility →</a>
    </div>
  `;
}

async function loadHospitalProfile() {
  const user = window.medtrackApi?.getUser();
  if (!user) return;
  try {
    const meRes = await window.medtrackApi.request("/auth/me").catch(() => null);
    if (meRes?.user) {
      window.medtrackApi.setSession(null, meRes.user);
      renderContactVerifyBanner(meRes.user);
      if (meRes.facility === null) {
        showHospitalOnboardingBanner();
        return;
      }
    } else {
      renderContactVerifyBanner(user);
    }

    const data = await window.medtrackApi.request("/hospitals/my/profile");
    const h = data.hospital;
    hospitalData.id = h.id;
    hospitalData.general = h.beds.general;
    hospitalData.icu = h.beds.icu;
    hospitalData.emergency = h.beds.emergency;
    hospitalData.ambulances = h.ambulances;
    updateDashboardDom();

    document.getElementById("hospitalOnboardingBanner").style.display = "none";
    document.getElementById("hospitalTitle").textContent = h.name;
    document.getElementById("hospitalSubtitle").textContent = `${h.city}, ${h.state} • Reg: ${h.registrationNumber}`;
    const badge = document.getElementById("verificationBadge");
    badge.textContent =
      h.verificationStatus === "approved"
        ? "✓ VERIFIED HOSPITAL"
        : `⏳ VERIFICATION: ${h.verificationStatus.toUpperCase()}`;

    document.querySelectorAll(".facility-grid button").forEach((btn) => {
      const fName = btn.dataset.facility;
      const span = btn.querySelector("span");
      if (!fName || !span) return;
      const enabled = Array.isArray(h.facilitiesList) && h.facilitiesList.includes(fName);
      span.textContent = enabled ? "AVAILABLE" : "UNAVAILABLE";
      span.style.color = enabled ? "#087f5b" : "#dc2626";
    });

    document.getElementById("profName").value = h.name;
    document.getElementById("profMobile").value = h.mobile;
    document.getElementById("profAddress").value = h.address;
    document.getElementById("profCity").value = h.city;
    document.getElementById("profState").value = h.state;
    document.getElementById("profLat").value = h.latitude;
    document.getElementById("profLng").value = h.longitude;
    document.getElementById("hospReqContact").value = h.mobile;

    initProfileMap(h.latitude, h.longitude);
  } catch (err) {
    if (err.status === 404) {
      showHospitalOnboardingBanner();
    } else {
      setFeedback(err.message, true);
    }
  }
}

function initProfileMap(lat, lng) {
  const el = document.getElementById("profileLocationMap");
  if (!el || typeof L === "undefined") return;
  if (!profileMapRef) {
    profileMapRef = L.map("profileLocationMap").setView([lat, lng], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(profileMapRef);
    profileMapRef.on("click", (e) => {
      document.getElementById("profLat").value = e.latlng.lat.toFixed(6);
      document.getElementById("profLng").value = e.latlng.lng.toFixed(6);
      if (profileMarker) profileMarker.setLatLng(e.latlng);
    });
    window.addEventListener("resize", () => profileMapRef && profileMapRef.invalidateSize());
  } else {
    profileMapRef.setView([lat, lng], 13);
  }
  if (profileMarker) profileMapRef.removeLayer(profileMarker);
  profileMarker = L.marker([lat, lng], { draggable: true }).addTo(profileMapRef);
  profileMarker.on("dragend", (e) => {
    const pos = e.target.getLatLng();
    document.getElementById("profLat").value = pos.lat.toFixed(6);
    document.getElementById("profLng").value = pos.lng.toFixed(6);
  });
}

async function loadEmergencyRequests() {
  const listEl = document.getElementById("hospitalEmergencyList");
  if (!listEl) return;

  if (!window.medtrackApi?.getToken()) {
    listEl.innerHTML = `<div class="panel-card"><p>Sign in as hospital staff to view and respond to live emergency &amp; ambulance requests.</p></div>`;
    return;
  }

  try {
    const res = await window.medtrackApi.request("/emergency-requests");
    const requests = res.requests || [];
    if (!requests.length) {
      listEl.innerHTML = `<div class="panel-card"><p>No active emergency or ambulance requests right now.</p></div>`;
      return;
    }

    listEl.innerHTML = requests
      .map(
        (er) => `
        <div class="request-card" style="flex-wrap:wrap;">
          <div>
            <strong>${esc(er.request_code)} • ${esc(String(er.request_type).toUpperCase())} (${esc(er.requirement)})</strong>
            <p>Caller: ${esc(er.requester_name)} (${esc(er.requester_phone)})${er.notes ? ` • ${esc(er.notes)}` : ""}</p>
            <small>Created: ${esc(fmt(er.created_at))}${er.hospital_name ? ` • Assigned: ${esc(er.hospital_name)}` : " • Network Broadcast"}</small>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <span class="status ${er.status === "resolved" || er.status === "accepted" ? "available" : er.status === "cancelled" ? "limited" : "busy"}">${esc(String(er.status).toUpperCase())}</span>
            ${
              er.status === "pending"
                ? `<button type="button" class="primary-btn" onclick="updateEmergencyStatus(${Number(er.id)}, 'accepted')">Accept</button>`
                : ""
            }
            ${
              er.status === "accepted"
                ? `<button type="button" class="primary-btn" onclick="updateEmergencyStatus(${Number(er.id)}, 'dispatched')">🚑 Dispatch</button>`
                : ""
            }
            ${
              er.status === "accepted" || er.status === "dispatched"
                ? `<button type="button" class="small-btn" onclick="updateEmergencyStatus(${Number(er.id)}, 'resolved')">Resolve</button>`
                : ""
            }
          </div>
        </div>
      `
      )
      .join("");
  } catch (err) {
    listEl.innerHTML = `<div class="panel-card"><p>${esc(err.message)}</p></div>`;
  }
}

window.updateEmergencyStatus = async function (id, status) {
  try {
    await window.medtrackApi.request(`/emergency-requests/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    setFeedback(`Emergency request #${id} marked ${status.toUpperCase()}.`);
    await loadEmergencyRequests();
  } catch (err) {
    setFeedback(err.message, true);
  }
};

async function loadBloodBanksAndRequests() {
  if (!window.medtrackApi?.getToken()) return;
  try {
    const [banksRes, reqRes] = await Promise.all([
      window.medtrackApi.request("/blood-banks"),
      window.medtrackApi.request("/blood-requests")
    ]);

    const sel = document.getElementById("hospReqBankSelect");
    const banks = banksRes.bloodBanks || [];
    sel.innerHTML = banks.length
      ? banks.map((b) => `<option value="${Number(b.id)}">${esc(b.name)} (${esc(b.city)})</option>`).join("")
      : `<option value="">No verified blood banks available</option>`;

    const listEl = document.getElementById("hospitalBloodRequestsList");
    const reqs = reqRes.requests || [];
    if (!reqs.length) {
      listEl.innerHTML = `<div class="panel-card"><p>No blood requests yet.</p></div>`;
      return;
    }
    listEl.innerHTML = reqs
      .map(
        (r) => `
        <div class="request-card">
          <div>
            <strong>${esc(r.request_code)} • ${esc(r.blood_group)} (${Number(r.units_requested)} units)</strong>
            <p>Blood Bank: ${esc(r.blood_bank_name)} (${esc(r.blood_bank_city)}) • Urgency: ${esc(String(r.urgency).toUpperCase())}</p>
            <small>Created: ${esc(fmt(r.created_at))}${r.transport_code ? ` • Transport: ${esc(r.transport_code)}` : ""}${r.rejection_reason ? ` • Reason: ${esc(r.rejection_reason)}` : ""}</small>
          </div>
          <span class="status ${r.status === "delivered" || r.status === "accepted" ? "available" : r.status === "rejected" ? "busy" : "limited"}">${esc(String(r.status).toUpperCase())}</span>
        </div>
      `
      )
      .join("");
  } catch (err) {
    setFeedback(err.message, true);
  }
}

async function loadTransports() {
  if (!window.medtrackApi?.getToken()) return;
  try {
    const res = await window.medtrackApi.request("/transport");
    transportsList = res.transports || [];
    const sel = document.getElementById("activeTransportSelect");
    if (!transportsList.length) {
      sel.innerHTML = `<option value="">No transports assigned</option>`;
      document.getElementById("transportSummaryCards").innerHTML = `<p>No active blood transports.</p>`;
      return;
    }
    sel.innerHTML = transportsList
      .map(
        (t) =>
          `<option value="${Number(t.id)}">${esc(t.transport_code)} — ${esc(t.blood_group)} (${Number(t.units_requested)}u) via ${esc(t.device_uid)} [${esc(t.status)}]</option>`
      )
      .join("");
    await selectTransport(transportsList[0].id);
  } catch (err) {
    setFeedback(err.message, true);
  }
}

async function selectTransport(transportId) {
  selectedTransport = transportsList.find((t) => t.id === Number(transportId)) || null;
  if (!selectedTransport) return;

  try {
    const [tempData, excData, gpsData, otpData, devData, readingsData] = await Promise.all([
      window.medtrackApi.request(`/temperature/${selectedTransport.device_id}/history`),
      window.medtrackApi.request(`/temperature/${selectedTransport.device_id}/excursions`),
      window.medtrackApi.request(`/gps/${selectedTransport.id}/route`),
      window.medtrackApi.request(`/otp/${selectedTransport.id}/status`),
      window.medtrackApi.request(`/devices/${selectedTransport.device_id}`).catch(() => ({ device: null })),
      window.medtrackApi.request(`/sensors/${selectedTransport.device_id}?limit=30`).catch(() => ({ readings: [] }))
    ]);

    const latestTemp = tempData.latest;
    const tempDisplay =
      latestTemp && latestTemp.temperatureC !== null
        ? `${Number(latestTemp.temperatureC).toFixed(1)}°C`
        : "N/A";
    const tempNote = tempData.isStale
      ? "STALE READING"
      : latestTemp?.qualityStatus?.toUpperCase() || "UNKNOWN";

    const logs = otpData.logs || [];
    const doorOtp = window.medtrackIot.summarizeDoorAndOtp(otpData.otpStatus, logs);

    document.getElementById("transportSummaryCards").innerHTML = `
      <div class="dashboard-card">
        <span>Box Connectivity</span>
        <strong style="font-size:20px;">${esc(String(tempData.connectivity).toUpperCase())}</strong>
        <small>${esc(selectedTransport.device_uid)}</small>
      </div>
      <div class="dashboard-card">
        <span>Chamber Temperature</span>
        <strong style="font-size:22px;color:${latestTemp?.qualityStatus === "critical" || latestTemp?.qualityStatus === "sensor_error" ? "#dc2626" : "#087f5b"}">${esc(tempDisplay)}</strong>
        <small>${esc(tempNote)}${latestTemp?.coolingActive ? " • Peltier ON" : " • Peltier OFF"}</small>
      </div>
      <div class="dashboard-card">
        <span>Door &amp; Lock Status</span>
        <strong style="font-size:18px;color:${doorOtp.doorAlert ? "#dc2626" : "#102a27"}">${esc(doorOtp.doorState)}</strong>
        <small>Servo: ${esc(doorOtp.lockState)}</small>
      </div>
      <div class="dashboard-card">
        <span>OTP Access Status</span>
        <strong style="font-size:18px;color:${doorOtp.otpTone === "danger" ? "#dc2626" : doorOtp.otpTone === "warn" ? "#d97706" : "#087f5b"}">${esc(doorOtp.otpState)}</strong>
        <small>${esc(doorOtp.otpDetail)}</small>
      </div>
      <div class="dashboard-card">
        <span>Shipment Status</span>
        <strong style="font-size:20px;">${esc(String(selectedTransport.status).toUpperCase())}</strong>
        <small>${esc(selectedTransport.blood_group)} • ${Number(selectedTransport.units_requested)} units</small>
      </div>
      <div class="dashboard-card">
        <span>Excursions</span>
        <strong style="font-size:22px;">${(excData.excursions || []).length}</strong>
        <small>Target ${Number(tempData.coolingPolicy?.targetMinC ?? 4)}°C – ${Number(tempData.coolingPolicy?.targetMaxC ?? 8)}°C</small>
      </div>
    `;

    routeMapRef = window.medtrackIot.renderTransportRouteMap(
      routeMapRef,
      "transportRouteMap",
      selectedTransport,
      gpsData.points || []
    );

    const latestGps = gpsData.latest;
    document.getElementById("gpsStatusMeta").textContent = latestGps
      ? `Last Box GPS: ${Number(latestGps.latitude).toFixed(5)}, ${Number(latestGps.longitude).toFixed(5)} • Updated: ${fmt(latestGps.recorded_at)} ${gpsData.stale ? "⚠️ STALE GPS" : "🟢 LIVE"}${latestGps.is_simulated ? " [SIMULATED]" : ""}`
      : "No GPS updates received yet.";

    window.medtrackIot.renderTemperatureChart(
      "tempChartContainer",
      tempData.history || [],
      tempData.coolingPolicy
    );

    const excursions = excData.excursions || [];
    document.getElementById("tempExcursionsList").innerHTML = `
      ${excursions.length
        ? excursions
            .slice(0, 4)
            .map(
              (ex) =>
                `<div style="padding:6px 0;border-bottom:1px solid var(--border);">⚠️ <strong>${esc(String(ex.excursion_type).toUpperCase())}</strong> (${ex.observed_value_c !== null ? `${Number(ex.observed_value_c)}°C` : "ERR"}) at ${esc(fmt(ex.started_at))} ${ex.resolved_at ? "✓ Resolved" : "🔴 Active"}</div>`
            )
            .join("")
        : `<span style="color:var(--primary);">✓ No temperature excursions recorded.</span>`}
      <div id="hospitalModularSensors" style="margin-top:10px;"></div>
    `;

    window.medtrackIot.renderModularSensors(
      "hospitalModularSensors",
      devData?.device?.sensors || [],
      readingsData?.readings || []
    );

    document.getElementById("accessLogsList").innerHTML = logs.length
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
  } catch (err) {
    setFeedback(err.message, true);
  }
}

async function generateTransportOtp() {
  if (!selectedTransport) return;
  try {
    const res = await window.medtrackApi.request("/otp/generate", {
      method: "POST",
      body: JSON.stringify({ transportId: selectedTransport.id })
    });
    const box = document.getElementById("otpDisplayBox");
    box.innerHTML = `
      <div class="feedback-banner success">
        OTP dispatched to ${esc(res.recipientContact)} (expires in ${Number(res.ttlSeconds)}s).
        ${res.simulationOtpPreview ? `<br><strong>Dev Notification Preview OTP:</strong> <code>${esc(res.simulationOtpPreview)}</code>` : ""}
      </div>
    `;
    await selectTransport(selectedTransport.id);
  } catch (err) {
    setFeedback(err.message, true);
  }
}

async function markTransportDelivered() {
  if (!selectedTransport) return;
  try {
    await window.medtrackApi.request(`/transport/${selectedTransport.id}/deliver`, { method: "PATCH" });
    setFeedback("Delivery confirmed.");
    await loadTransports();
    await loadBloodBanksAndRequests();
  } catch (err) {
    setFeedback(err.message, true);
  }
}

async function simulateTemperature(sensorError) {
  if (!selectedTransport) return;
  const fb = document.getElementById("simFeedback");
  try {
    const temp = Number(document.getElementById("simTempInput").value);
    const res = await window.medtrackApi.request("/sensors/simulate", {
      method: "POST",
      body: JSON.stringify({
        deviceId: selectedTransport.device_id,
        transportId: selectedTransport.id,
        ...(sensorError ? { sensorError: true } : { temperatureC: temp })
      })
    });
    const ev = res.temperature.evaluation;
    fb.style.color = ev.alertSeverity === "critical" ? "#dc2626" : "#087f5b";
    fb.textContent = `[SIMULATED] ${ev.reason} | Peltier Command: ${ev.peltierCommand}`;
    await selectTransport(selectedTransport.id);
  } catch (err) {
    fb.style.color = "#dc2626";
    fb.textContent = err.message;
  }
}

async function simulateKeypadVerify() {
  if (!selectedTransport) return;
  const fb = document.getElementById("simFeedback");
  const otp = document.getElementById("simOtpInput").value.trim();
  try {
    const res = await window.medtrackApi.request("/otp/simulate-verify", {
      method: "POST",
      body: JSON.stringify({ transportId: selectedTransport.id, otp })
    });
    lastSimUnlockToken = res.unlockToken;
    fb.style.color = "#087f5b";
    fb.textContent = `[SIMULATED] OTP Verified! Servo Latch UNLOCKED (token expires ${fmt(res.unlockExpiresAt)}).`;
    await selectTransport(selectedTransport.id);
  } catch (err) {
    fb.style.color = "#dc2626";
    fb.textContent = `[SIMULATED] ${err.message}`;
    await selectTransport(selectedTransport.id);
  }
}

async function simulateDoorEvent(eventType) {
  if (!selectedTransport) return;
  const fb = document.getElementById("simFeedback");
  try {
    const res = await window.medtrackApi.request("/access/simulate-door-event", {
      method: "POST",
      body: JSON.stringify({
        transportId: selectedTransport.id,
        eventType,
        unlockToken: lastSimUnlockToken || undefined
      })
    });
    if (eventType === "door_closed") {
      lastSimUnlockToken = null;
    }
    fb.style.color = res.success ? "#087f5b" : "#dc2626";
    fb.textContent = `[SIMULATED] Reed switch recorded: ${res.recordedEventType}`;
    await selectTransport(selectedTransport.id);
  } catch (err) {
    fb.style.color = "#dc2626";
    fb.textContent = err.message;
  }
}

async function simulateGpsMove() {
  if (!selectedTransport) return;
  const fb = document.getElementById("simFeedback");
  const baseLat = selectedTransport.dest_lat || 18.5204;
  const baseLng = selectedTransport.dest_lng || 73.8567;
  const jitterLat = baseLat + (Math.random() - 0.5) * 0.008;
  const jitterLng = baseLng + (Math.random() - 0.5) * 0.008;
  try {
    await window.medtrackApi.request("/sensors/simulate", {
      method: "POST",
      body: JSON.stringify({
        deviceId: selectedTransport.device_id,
        transportId: selectedTransport.id,
        latitude: Number(jitterLat.toFixed(6)),
        longitude: Number(jitterLng.toFixed(6)),
        speedKmh: 28
      })
    });
    fb.style.color = "#087f5b";
    fb.textContent = `[SIMULATED] GPS updated to ${jitterLat.toFixed(5)}, ${jitterLng.toFixed(5)}`;
    await selectTransport(selectedTransport.id);
  } catch (err) {
    fb.style.color = "#dc2626";
    fb.textContent = err.message;
  }
}

async function loadAlerts() {
  if (!window.medtrackApi?.getToken()) return;
  try {
    const res = await window.medtrackApi.request("/alerts");
    const list = document.getElementById("hospitalAlertsList");
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
              : `<button class="small-btn" onclick="ackAlert(${Number(a.id)})">Acknowledge</button>`
          }
        </div>
      `
      )
      .join("");
  } catch (err) {
    setFeedback(err.message, true);
  }
}

window.ackAlert = async function (id) {
  try {
    await window.medtrackApi.request(`/alerts/${id}/acknowledge`, { method: "PATCH" });
    setFeedback("Alert acknowledged.");
    await loadAlerts();
  } catch (err) {
    setFeedback(err.message, true);
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  updateDashboardDom();

  const user = window.medtrackApi?.getUser();
  if (!user) {
    setFeedback("Demo view mode — login as Hospital Staff to sync live updates.");
    await loadEmergencyRequests();
    return;
  }

  await loadHospitalProfile();
  await Promise.all([
    loadEmergencyRequests(),
    loadBloodBanksAndRequests(),
    loadTransports(),
    loadAlerts()
  ]);

  document.getElementById("activeTransportSelect")?.addEventListener("change", (e) => {
    if (e.target.value) selectTransport(e.target.value);
  });

  const syncProfileCoords = () => {
    const lat = Number(document.getElementById("profLat")?.value);
    const lng = Number(document.getElementById("profLng")?.value);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      if (profileMarker) profileMarker.setLatLng([lat, lng]);
      if (profileMapRef) profileMapRef.setView([lat, lng], Math.max(profileMapRef.getZoom(), 12));
    }
  };
  document.getElementById("profLat")?.addEventListener("change", syncProfileCoords);
  document.getElementById("profLng")?.addEventListener("change", syncProfileCoords);

  document.getElementById("hospitalBloodReqForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await window.medtrackApi.request("/blood-requests", {
        method: "POST",
        body: JSON.stringify({
          bloodBankId: Number(document.getElementById("hospReqBankSelect").value),
          bloodGroup: document.getElementById("hospReqGroup").value,
          unitsRequested: Number(document.getElementById("hospReqUnits").value),
          urgency: document.getElementById("hospReqUrgency").value,
          recipientContact: document.getElementById("hospReqContact").value.trim(),
          notes: document.getElementById("hospReqNotes").value.trim() || undefined
        })
      });
      setFeedback("Blood request submitted!");
      await loadBloodBanksAndRequests();
    } catch (err) {
      setFeedback(err.message, true);
    }
  });

  document.getElementById("hospitalProfileForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!hospitalData.id) return;
    try {
      await window.medtrackApi.request(`/hospitals/${hospitalData.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: document.getElementById("profName").value.trim(),
          mobile: document.getElementById("profMobile").value.trim(),
          address: document.getElementById("profAddress").value.trim(),
          city: document.getElementById("profCity").value.trim(),
          state: document.getElementById("profState").value.trim(),
          latitude: Number(document.getElementById("profLat").value),
          longitude: Number(document.getElementById("profLng").value)
        })
      });
      setFeedback("Hospital profile and map coordinates saved.");
      await loadHospitalProfile();
    } catch (err) {
      setFeedback(err.message, true);
    }
  });
});

window.changeBed = changeBed;
window.changeAmbulance = changeAmbulance;
window.toggleFacility = toggleFacility;
window.switchHospitalTab = switchHospitalTab;
window.generateTransportOtp = generateTransportOtp;
window.markTransportDelivered = markTransportDelivered;
window.simulateTemperature = simulateTemperature;
window.simulateKeypadVerify = simulateKeypadVerify;
window.simulateDoorEvent = simulateDoorEvent;
window.simulateGpsMove = simulateGpsMove;