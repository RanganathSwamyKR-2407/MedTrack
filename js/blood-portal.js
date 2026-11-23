(function () {
  let selectedGroup = "";
  let userLat = null;
  let userLng = null;
  let bloodMap = null;
  let bankMarkers = [];

  function initBloodMap() {
    const el = document.getElementById("bloodMap");
    if (!el || typeof L === "undefined") return;
    bloodMap = L.map("bloodMap").setView([18.5204, 73.8567], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(bloodMap);
    window.addEventListener("resize", () => bloodMap && bloodMap.invalidateSize());
  }

  function statusBadgeClass(status) {
    if (status === "Sufficient") return "available";
    if (status === "Low") return "limited";
    return "busy";
  }

  function esc(v) {
    return window.medtrackApi ? window.medtrackApi.escapeHtml(v) : String(v ?? "");
  }

  function fmt(ts) {
    return window.medtrackApi ? window.medtrackApi.formatLocalTime(ts) : String(ts ?? "");
  }

  function updateBloodMapMarkers(results) {
    if (!bloodMap) return;
    bankMarkers.forEach((m) => bloodMap.removeLayer(m));
    bankMarkers = [];

    const seen = new Map();
    results.forEach((r) => {
      if (!seen.has(r.bloodBankId)) seen.set(r.bloodBankId, r);
    });

    seen.forEach((bank) => {
      const m = L.marker([bank.latitude, bank.longitude]).addTo(bloodMap);
      m.bindPopup(`
        <div style="min-width:200px">
          <strong>🩸 ${esc(bank.bloodBankName)}</strong><br>
          <small>${esc(bank.address)}, ${esc(bank.city)}</small><br>
          <small>📞 ${esc(bank.phone)}</small>
        </div>
      `);
      bankMarkers.push(m);
    });

    if (userLat !== null && userLng !== null) {
      bloodMap.setView([userLat, userLng], 11);
    }
  }

  async function searchBlood() {
    const city = document.getElementById("bloodCityFilter")?.value.trim() || "";
    const onlyAvailable = document.getElementById("bloodAvailabilityOnly")?.value || "false";
    const params = new URLSearchParams();
    if (selectedGroup) params.set("bloodGroup", selectedGroup);
    if (city) params.set("city", city);
    if (onlyAvailable === "true") params.set("onlyAvailable", "true");
    if (userLat !== null && userLng !== null) {
      params.set("lat", String(userLat));
      params.set("lng", String(userLng));
    }

    const container = document.getElementById("bloodResults");
    try {
      const data = await window.medtrackApi.request(`/inventory/search?${params.toString()}`);
      const results = data.results || [];
      updateBloodMapMarkers(results);

      if (results.length === 0) {
        container.innerHTML = `
          <div class="no-results">
            <h2>No matching blood stock found</h2>
            <p>Try selecting another blood group or clearing the city filter.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = results
        .map(
          (item) => `
          <div class="blood-card">
            <div class="blood-group">${esc(item.bloodGroup)}</div>
            <div class="blood-card-info">
              <h3>${esc(item.bloodBankName)}</h3>
              <p>${esc(item.city)}, ${esc(item.state)}${item.distanceKm !== null ? ` • ${esc(item.distanceKm)} km away` : ""}</p>
              <small>Updated: ${esc(fmt(item.updatedAt))}</small>
            </div>
            <div class="blood-card-stock">
              <span class="status ${statusBadgeClass(item.status)}">${esc(item.status.toUpperCase())}</span>
              <strong>${Number(item.unitsAvailable)} units</strong>
            </div>
            <div class="blood-card-actions">
              <a href="tel:${esc(item.phone)}" class="small-btn">Call</a>
              <button
                type="button"
                class="primary-btn js-open-blood-req"
                data-bank-id="${Number(item.bloodBankId)}"
                data-bank-name="${esc(item.bloodBankName)}"
                data-blood-group="${esc(item.bloodGroup)}"
              >Request</button>
            </div>
          </div>
        `
        )
        .join("");

      container.querySelectorAll(".js-open-blood-req").forEach((btn) => {
        btn.addEventListener("click", () => {
          window.openBloodRequestForm(
            Number(btn.dataset.bankId),
            btn.dataset.bankName,
            btn.dataset.bloodGroup
          );
        });
      });
    } catch (err) {
      container.innerHTML = `<div class="no-results"><p>${esc(err.message)}</p></div>`;
    }
  }

  window.openBloodRequestForm = function (bankId, bankName, bloodGroup) {
    const user = window.medtrackApi.getUser();
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    const panel = document.getElementById("bloodRequestPanel");
    panel.style.display = "block";
    document.getElementById("reqBloodBankId").value = bankId;
    document.getElementById("reqBloodGroup").value = bloodGroup;
    document.getElementById("reqPanelTitle").textContent = `Request Blood from ${bankName}`;
    document.getElementById("reqContact").value = user.phone || "";
    panel.scrollIntoView({ behavior: "smooth" });
  };

  window.closeBloodRequestForm = function () {
    document.getElementById("bloodRequestPanel").style.display = "none";
  };

  document.addEventListener("DOMContentLoaded", () => {
    initBloodMap();

    document.querySelectorAll("#bloodGroupButtons button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#bloodGroupButtons button").forEach((b) => b.classList.remove("active-group"));
        btn.classList.add("active-group");
        selectedGroup = btn.dataset.group || "";
        searchBlood();
      });
    });

    document.getElementById("searchBloodBtn")?.addEventListener("click", searchBlood);
    document.getElementById("bloodAvailabilityOnly")?.addEventListener("change", searchBlood);
    document.getElementById("useMyLocationBlood")?.addEventListener("click", () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition((pos) => {
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;
        searchBlood();
      });
    });

    document.getElementById("bloodRequestForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fb = document.getElementById("bloodRequestFeedback");
      try {
        const payload = {
          bloodBankId: Number(document.getElementById("reqBloodBankId").value),
          bloodGroup: document.getElementById("reqBloodGroup").value,
          unitsRequested: Number(document.getElementById("reqUnits").value),
          urgency: document.getElementById("reqUrgency").value,
          recipientContact: document.getElementById("reqContact").value.trim(),
          patientReference: document.getElementById("reqPatientRef").value.trim() || undefined,
          notes: document.getElementById("reqNotes").value.trim() || undefined
        };
        const res = await window.medtrackApi.request("/blood-requests", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        fb.style.display = "block";
        fb.className = "feedback-banner success";
        fb.textContent = `Blood request ${res.bloodRequest.request_code} created! Track status in your dashboard.`;
      } catch (err) {
        fb.style.display = "block";
        fb.className = "feedback-banner error";
        fb.textContent = err.message;
      }
    });

    searchBlood();
  });
})();
