(function () {
  let facilityMode = "hospital";
  let regMap = null;
  let pinMarker = null;

  function updateMarker(lat, lng) {
    document.getElementById("latitude").value = Number(lat).toFixed(6);
    document.getElementById("longitude").value = Number(lng).toFixed(6);
    if (pinMarker) {
      pinMarker.setLatLng([lat, lng]);
    } else if (regMap) {
      pinMarker = L.marker([lat, lng], { draggable: true }).addTo(regMap);
      pinMarker.on("dragend", (e) => {
        const pos = e.target.getLatLng();
        updateMarker(pos.lat, pos.lng);
      });
    }
    if (regMap) regMap.setView([lat, lng], Math.max(regMap.getZoom(), 12));
  }

  window.setFacilityMode = function (mode) {
    facilityMode = mode;
    document.getElementById("modeHospitalBtn").classList.toggle("active", mode === "hospital");
    document.getElementById("modeBloodBankBtn").classList.toggle("active", mode === "blood_bank");
    document.getElementById("hospitalTypeGroup").style.display = mode === "hospital" ? "block" : "none";
    document.getElementById("lblFacilityName").textContent =
      mode === "hospital" ? "Hospital Name" : "Blood Bank Name";
    document.getElementById("lblRegNumber").textContent =
      mode === "hospital" ? "Hospital Registration / License Number" : "Blood Bank License Number";
  };

  window.detectPinLocation = function () {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      updateMarker(pos.coords.latitude, pos.coords.longitude);
    });
  };

  document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("type") === "blood_bank") {
      window.setFacilityMode("blood_bank");
    }

    if (typeof L !== "undefined") {
      regMap = L.map("registerLocationMap").setView([18.5204, 73.8567], 6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(regMap);

      updateMarker(18.5204, 73.8567);
      regMap.on("click", (e) => {
        updateMarker(e.latlng.lat, e.latlng.lng);
      });
      const onResize = () => regMap && regMap.invalidateSize();
      window.addEventListener("resize", onResize);
      window.addEventListener("orientationchange", () => setTimeout(onResize, 150));
    }

    const syncFromInputs = () => {
      const lat = Number(document.getElementById("latitude")?.value);
      const lng = Number(document.getElementById("longitude")?.value);
      if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        if (pinMarker) pinMarker.setLatLng([lat, lng]);
        if (regMap) regMap.setView([lat, lng], Math.max(regMap.getZoom(), 12));
      }
    };
    document.getElementById("latitude")?.addEventListener("change", syncFromInputs);
    document.getElementById("longitude")?.addEventListener("change", syncFromInputs);

    document.getElementById("facilityRegisterForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fb = document.getElementById("facilityRegFeedback");
      const lat = Number(document.getElementById("latitude").value);
      const lng = Number(document.getElementById("longitude").value);

      try {
        let res;
        if (facilityMode === "hospital") {
          res = await window.medtrackApi.request("/hospitals/register", {
            method: "POST",
            body: JSON.stringify({
              hospitalName: document.getElementById("facilityName").value.trim(),
              registrationNumber: document.getElementById("registrationNumber").value.trim(),
              hospitalType: document.getElementById("hospitalType").value,
              contactPerson: document.getElementById("contactPerson").value.trim(),
              officialEmail: document.getElementById("officialEmail").value.trim(),
              mobile: document.getElementById("mobile").value.trim(),
              password: document.getElementById("facilityPassword").value,
              address: document.getElementById("address").value.trim(),
              state: document.getElementById("state").value.trim(),
              city: document.getElementById("city").value.trim(),
              pinCode: document.getElementById("pinCode").value.trim(),
              latitude: lat,
              longitude: lng
            })
          });
        } else {
          res = await window.medtrackApi.request("/blood-banks/register", {
            method: "POST",
            body: JSON.stringify({
              name: document.getElementById("facilityName").value.trim(),
              licenseNumber: document.getElementById("registrationNumber").value.trim(),
              contactPerson: document.getElementById("contactPerson").value.trim(),
              email: document.getElementById("officialEmail").value.trim(),
              phone: document.getElementById("mobile").value.trim(),
              password: document.getElementById("facilityPassword").value,
              address: document.getElementById("address").value.trim(),
              state: document.getElementById("state").value.trim(),
              city: document.getElementById("city").value.trim(),
              pinCode: document.getElementById("pinCode").value.trim(),
              latitude: lat,
              longitude: lng
            })
          });
        }

        if (res.token) {
          const me = await fetch("/api/v1/auth/me", {
            headers: { Authorization: `Bearer ${res.token}` }
          }).then((r) => r.json());
          if (me.user) window.medtrackApi.setSession(res.token, me.user);
        }

        fb.style.display = "block";
        fb.className = "feedback-banner success";
        fb.textContent =
          "Facility registered! Status is PENDING until verified by an administrator. Redirecting to dashboard...";
        setTimeout(() => {
          window.location.href =
            facilityMode === "hospital" ? "hospital-dashboard.html" : "blood-bank-dashboard.html";
        }, 1200);
      } catch (err) {
        fb.style.display = "block";
        fb.className = "feedback-banner error";
        fb.textContent = err.message;
      }
    });
  });
})();
