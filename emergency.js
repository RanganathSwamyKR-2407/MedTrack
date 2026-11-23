let activeEmergencyRequirement = "Emergency";

function escEmergency(v) {
  return window.medtrackApi ? window.medtrackApi.escapeHtml(v) : String(v ?? "");
}

async function startEmergency(requirement) {
  activeEmergencyRequirement = requirement;
  const result = document.getElementById("emergencyResult");
  if (!result) return;

  result.innerHTML = `
    <div class="searching-card">
      <div class="loading-circle">⟳</div>
      <h2>Finding the best option...</h2>
      <p>Checking live hospital availability, emergency services, and travel time.</p>
    </div>
  `;

  if (typeof loadHospitalsFromApi === "function") {
    await loadHospitalsFromApi();
  }

  let suitable = (window.hospitals || []).filter((hospital) => {
    const fList = Array.isArray(hospital.facilitiesList) ? hospital.facilitiesList : [];
    if (requirement === "ICU") return hospital.beds.icu > 0 && hospital.emergency;
    if (requirement === "Emergency") return hospital.emergency;
    if (requirement === "Ambulance") return hospital.ambulances > 0;
    if (requirement === "Blood") return Boolean(hospital.facilities?.blood) || fList.includes("Blood Bank");
    return (
      (hospital.specialists || []).includes(requirement) ||
      fList.includes(requirement)
    );
  });

  suitable.sort((a, b) => (a.distanceKm ?? a.travelTime) - (b.distanceKm ?? b.travelTime));
  const best = suitable[0];

  if (!best) {
    result.innerHTML = `
      <div class="searching-card">
        <h2>No suitable facility found</h2>
        <p>Try another requirement or broadcast an emergency alert to the hospital network.</p>
      </div>
    `;
    return;
  }

  const user = window.medtrackApi?.getUser();
  const defaultName = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "";
  const defaultPhone = user?.phone || "";

  result.innerHTML = `
    <div class="best-emergency">
      <div class="best-label">⭐ BEST MATCH</div>
      <h2>${escEmergency(best.name)}</h2>
      <p>📍 ${escEmergency(best.address)}${best.city ? `, ${escEmergency(best.city)}` : ""}</p>

      <div class="emergency-stats">
        <div>
          <strong>${Number(best.travelTime)} min</strong>
          <span>Estimated ETA</span>
        </div>
        <div>
          <strong>${Number(best.beds.icu)}</strong>
          <span>ICU Beds</span>
        </div>
        <div>
          <strong>${Number(best.ambulances)}</strong>
          <span>Ambulances</span>
        </div>
      </div>

      <div class="emergency-status">
        🟢 Emergency Available &nbsp;&nbsp; ✓ Verified
      </div>

      <div class="emergency-caller-box">
        <div class="emergency-caller-grid">
          <div>
            <label for="emergencyCallerName">Caller Name</label>
            <input type="text" id="emergencyCallerName" value="${escEmergency(defaultName)}" placeholder="Your name">
          </div>
          <div>
            <label for="emergencyCallerPhone">Contact Phone</label>
            <input type="tel" id="emergencyCallerPhone" value="${escEmergency(defaultPhone)}" placeholder="10-digit mobile">
          </div>
        </div>
      </div>

      <div class="card-actions">
        <a href="tel:${escEmergency(best.phone)}" class="emergency-btn">📞 CALL</a>
        <a href="https://www.google.com/maps/dir/?api=1&destination=${Number(best.latitude ?? best.lat)},${Number(best.longitude ?? best.lng)}" target="_blank" rel="noopener noreferrer" class="primary-btn">🗺 NAVIGATE</a>
        <button type="button" class="small-btn" onclick="createEmergencyRequest(${Number(best.id)})">🚨 REQUEST HELP</button>
      </div>

      <div id="emergencySubmitFeedback" style="margin-top:12px;"></div>
    </div>
  `;
}

async function createEmergencyRequest(hospitalId) {
  const fb = document.getElementById("emergencySubmitFeedback");
  const requesterName =
    document.getElementById("emergencyCallerName")?.value.trim() || "Emergency Caller";
  const requesterPhone =
    document.getElementById("emergencyCallerPhone")?.value.trim() || "108";

  try {
    const res = await window.medtrackApi.request("/emergency-requests", {
      method: "POST",
      body: JSON.stringify({
        requestType: activeEmergencyRequirement === "Ambulance" ? "ambulance" : "emergency",
        requirement: activeEmergencyRequirement,
        hospitalId,
        requesterName,
        requesterPhone
      })
    });
    const er = res.emergencyRequest;
    if (fb) {
      fb.innerHTML = `
        <div style="background:#e8f8f0;color:#087f5b;border:1px solid #bbf7d0;padding:12px;border-radius:8px;font-size:13px;font-weight:600;">
          ✓ Emergency request <strong>${escEmergency(er.request_code)}</strong> sent to hospital dashboard (Status: ${escEmergency(er.status.toUpperCase())}).
        </div>
      `;
    }
  } catch (err) {
    if (fb) {
      fb.innerHTML = `
        <div style="background:#ffe8e8;color:#b91c1c;border:1px solid #fecaca;padding:12px;border-radius:8px;font-size:13px;font-weight:600;">
          ${escEmergency(err.message)}
        </div>
      `;
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (typeof loadHospitalsFromApi === "function") {
    loadHospitalsFromApi();
  }
});

window.startEmergency = startEmergency;
window.createEmergencyRequest = createEmergencyRequest;