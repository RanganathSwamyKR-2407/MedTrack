function escApp(v) {
  return window.medtrackApi ? window.medtrackApi.escapeHtml(v) : String(v ?? "");
}

function calculateHospitalScore(hospital, requirement = "all") {
  let score = 0;
  if (hospital.status === "active") score += 20;
  if (hospital.emergency) score += 20;
  if (hospital.beds.icu > 0) score += 20;
  if (hospital.ambulances > 0) score += 10;

  if (
    requirement !== "all" &&
    (hospital.specialists.includes(requirement) ||
      (Array.isArray(hospital.facilitiesList) && hospital.facilitiesList.includes(requirement)))
  ) {
    score += 25;
  }

  if (hospital.travelTime <= 10) score += 15;
  else if (hospital.travelTime <= 20) score += 10;
  else score += 5;

  return score;
}

function renderHospitals(list = hospitals) {
  const container = document.getElementById("hospitalList");
  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = `
      <div class="no-results">
        <h2>No hospitals found</h2>
        <p>Try changing your search or filter.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = list
    .map((hospital) => {
      const statusText = hospital.status === "active" ? "AVAILABLE" : "LIMITED";
      const statusClass = hospital.status === "active" ? "available" : "limited";
      const distanceLabel =
        hospital.distanceKm !== null && hospital.distanceKm !== undefined
          ? `${hospital.distanceKm} km`
          : `${hospital.travelTime} min`;

      return `
        <article class="hospital-card">
          <div class="hospital-card-top">
            <div>
              <span class="hospital-type">VERIFIED</span>
              <h2>${escApp(hospital.name)}</h2>
              <p>📍 ${escApp(hospital.address)}${hospital.city ? `, ${escApp(hospital.city)}` : ""}</p>
            </div>
            <div class="rating">⭐ ${escApp(hospital.rating)}</div>
          </div>
          <div class="hospital-status-row">
            <span class="status ${statusClass}">● ${statusText}</span>
            <span>⏱ ${escApp(distanceLabel)}</span>
            <span>🚑 ${Number(hospital.ambulances)}</span>
          </div>
          <div class="resource-grid">
            <div><strong>${Number(hospital.beds.general)}</strong><small>General</small></div>
            <div><strong>${Number(hospital.beds.icu)}</strong><small>ICU</small></div>
            <div><strong>${Number(hospital.beds.emergency)}</strong><small>Emergency</small></div>
          </div>
          <div class="hospital-footer">
            <small>Updated ${escApp(hospital.lastUpdated)}</small>
            <div class="hospital-footer-actions">
              <a href="hospital.html?id=${Number(hospital.id)}" class="small-btn">View</a>
              <button onclick="navigateToHospital(${Number(hospital.id)})" class="primary-btn small">Locate</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function filterHospitals() {
  const search = document.getElementById("hospitalSearch")?.value.toLowerCase() || "";
  const availability = document.getElementById("availabilityFilter")?.value || "all";
  const requirement = document.getElementById("requirementFilter")?.value || "all";
  const sort = document.getElementById("sortFilter")?.value || "score";

  let filtered = hospitals.filter((hospital) => {
    const matchesSearch =
      hospital.name.toLowerCase().includes(search) ||
      hospital.address.toLowerCase().includes(search) ||
      (hospital.city || "").toLowerCase().includes(search) ||
      (hospital.state || "").toLowerCase().includes(search) ||
      hospital.specialists.join(" ").toLowerCase().includes(search);

    let matchesAvailability = true;
    if (availability === "emergency") matchesAvailability = hospital.emergency;
    if (availability === "icu") matchesAvailability = hospital.beds.icu > 0;
    if (availability === "ambulance") matchesAvailability = hospital.ambulances > 0;

    return matchesSearch && matchesAvailability;
  });

  if (sort === "score") {
    filtered.sort((a, b) => calculateHospitalScore(b, requirement) - calculateHospitalScore(a, requirement));
  } else if (sort === "distance") {
    filtered.sort((a, b) => (a.distanceKm ?? a.travelTime) - (b.distanceKm ?? b.travelTime));
  } else if (sort === "beds") {
    filtered.sort((a, b) => b.beds.general - a.beds.general);
  } else if (sort === "icu") {
    filtered.sort((a, b) => b.beds.icu - a.beds.icu);
  }

  renderHospitals(filtered);
}

function smartRecommend() {
  const requirementEl = document.getElementById("requirementFilter");
  const requirement = requirementEl ? requirementEl.value : "all";

  let results = hospitals.map((hospital) => ({
    hospital,
    score: calculateHospitalScore(hospital, requirement)
  }));
  results.sort((a, b) => b.score - a.score);
  if (results.length > 0) {
    renderSmartRecommendation(results[0], requirement);
  }
}

function renderSmartRecommendation(result, requirement) {
  const container = document.getElementById("hospitalList");
  if (!container) return;

  const hospital = result.hospital;
  container.innerHTML = `
    <article class="best-match-card">
      <span class="recommendation-label">⭐ BEST MATCH</span>
      <h2>${escApp(hospital.name)}</h2>
      <p>📍 ${escApp(hospital.address)}${hospital.city ? `, ${escApp(hospital.city)}` : ""}</p>
      <div class="match-score">Smart Match Score: <strong>${Number(result.score)}</strong></div>
      <div class="resource-grid">
        <div><strong>${Number(hospital.beds.icu)}</strong><small>ICU Beds</small></div>
        <div><strong>${Number(hospital.ambulances)}</strong><small>Ambulances</small></div>
        <div><strong>${Number(hospital.travelTime)}</strong><small>ETA Minutes</small></div>
      </div>
      <div class="recommendation-reason">
        <strong>Why this hospital?</strong>
        <p>${
          requirement === "all"
            ? "Strong emergency capability, available ICU resources and ambulance support."
            : `This hospital provides ${escApp(requirement)} support and currently has suitable availability.`
        }</p>
      </div>
      <div class="card-actions">
        <a href="hospital.html?id=${Number(hospital.id)}" class="primary-btn">View Hospital</a>
        <button onclick="navigateToHospital(${Number(hospital.id)})" class="small-btn">Locate on Map</button>
      </div>
    </article>
  `;
}

async function loadHospitalDetails() {
  const element = document.getElementById("hospitalDetails");
  if (!element) return;

  const params = new URLSearchParams(window.location.search);
  const id = Number(params.get("id"));

  let hospital = hospitals.find((h) => h.id === id);
  try {
    const res = await fetch(`/api/v1/hospitals/${id}`);
    if (res.ok) {
      const data = await res.json();
      if (data.hospital) hospital = data.hospital;
    }
  } catch {
    // fallback to local list
  }

  if (!hospital) {
    element.innerHTML = `
      <div class="no-results">
        <h1>Hospital not found</h1>
        <a href="hospitals.html" class="primary-btn">Back to Hospitals</a>
      </div>
    `;
    return;
  }

  const fac = hospital.facilities || {};
  element.innerHTML = `
    <section class="hospital-detail-header">
      <div>
        <span class="hospital-type">✓ VERIFIED HOSPITAL</span>
        <h1>${escApp(hospital.name)}</h1>
        <p>📍 ${escApp(hospital.address)}${hospital.city ? `, ${escApp(hospital.city)}, ${escApp(hospital.state)}` : ""}</p>
        <p>⭐ ${escApp(hospital.rating)}</p>
      </div>
      <a href="tel:${escApp(hospital.phone || "")}" class="primary-btn">📞 Call Hospital</a>
    </section>
    <section class="detail-grid">
      <div class="detail-card">
        <h3>🛏 Bed Availability</h3>
        <div class="detail-stat"><span>General Beds</span><strong>${Number(hospital.beds.general)}</strong></div>
        <div class="detail-stat"><span>ICU</span><strong>${Number(hospital.beds.icu)}</strong></div>
        <div class="detail-stat"><span>Emergency</span><strong>${Number(hospital.beds.emergency)}</strong></div>
      </div>
      <div class="detail-card">
        <h3>🏥 Facilities</h3>
        <p>${fac.ventilator ? "🟢" : "🔴"} Ventilator</p>
        <p>${fac.oxygen ? "🟢" : "🔴"} Oxygen</p>
        <p>${fac.blood ? "🟢" : "🔴"} Blood Bank</p>
        <p>${fac.ct ? "🟢" : "🔴"} CT Scan</p>
        <p>${fac.mri ? "🟢" : "🔴"} MRI</p>
      </div>
      <div class="detail-card">
        <h3>👨‍⚕️ Specialists</h3>
        ${(hospital.specialists || []).map((s) => `<span class="specialty-tag">${escApp(s)}</span>`).join("")}
      </div>
      <div class="detail-card">
        <h3>🚑 Emergency</h3>
        <p>Emergency: <strong>${hospital.emergency ? "Available" : "Unavailable"}</strong></p>
        <p>Ambulances: <strong>${Number(hospital.ambulances)}</strong></p>
        <p>Contact: <strong>${escApp(hospital.phone || "N/A")}</strong></p>
        <a href="https://www.google.com/maps/dir/?api=1&destination=${Number(hospital.latitude)},${Number(hospital.longitude)}" target="_blank" rel="noopener noreferrer" class="primary-btn" style="display:inline-block;margin-top:8px;">🗺 Open Directions</a>
      </div>
    </section>
    <div class="last-updated">🟢 Last updated: ${escApp(hospital.lastUpdated)}</div>
  `;
}

document.addEventListener("DOMContentLoaded", async () => {
  if (typeof loadHospitalsFromApi === "function") {
    await loadHospitalsFromApi();
    if (typeof window.refreshHospitalMap === "function") {
      window.refreshHospitalMap();
    }
  }

  const params = new URLSearchParams(window.location.search);
  const reqParam = params.get("requirement");
  const reqSelect = document.getElementById("requirementFilter");
  if (reqParam && reqSelect) {
    reqSelect.value = reqParam;
    smartRecommend();
  } else {
    renderHospitals();
  }

  loadHospitalDetails();
});