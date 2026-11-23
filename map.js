// ==========================================
// MEDTRACK INDIA - LIVE GPS MAP
// ==========================================

let map;
let userMarker;
let hospitalMarkers = [];

const INDIA_CENTER = [22.5937, 78.9629];
const INDIA_ZOOM = 5;

function initializeMap() {
  const mapElement =
    document.getElementById("homeMap") || document.getElementById("hospitalMap");

  if (!mapElement || typeof L === "undefined") {
    return;
  }

  const targetId = mapElement.id;
  map = L.map(targetId).setView(INDIA_CENTER, INDIA_ZOOM);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  showAllHospitals();
  detectUserLocation();

  const onResize = () => {
    if (map) map.invalidateSize();
  };
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", () => setTimeout(onResize, 150));
}

function clearHospitalMarkers() {
  hospitalMarkers.forEach((m) => {
    if (map && map.hasLayer(m)) map.removeLayer(m);
  });
  hospitalMarkers = [];
}

function escMap(v) {
  return window.medtrackApi ? window.medtrackApi.escapeHtml(v) : String(v ?? "");
}

function showAllHospitals() {
  if (typeof hospitals === "undefined" || !map) return;
  clearHospitalMarkers();

  hospitals.forEach((hospital) => {
    const marker = L.marker([hospital.latitude, hospital.longitude]).addTo(map);
    marker.bindPopup(`
      <div style="min-width:220px">
        <h3 style="margin-bottom:8px">🏥 ${escMap(hospital.name)}</h3>
        <p>📍 ${escMap(hospital.city)}, ${escMap(hospital.state)}</p>
        <p>🟢 Emergency: ${hospital.emergency ? "Available" : "Unavailable"}</p>
        <p>🛏️ ICU: ${Number(hospital.beds.icu)} beds</p>
        <p>🏥 General Beds: ${Number(hospital.beds.general)}</p>
        <p>🚑 Ambulances: ${Number(hospital.ambulances)}</p>
        <div style="display:flex;gap:8px;margin-top:6px;">
          <a href="hospital.html?id=${Number(hospital.id)}" style="color:#087f5b;font-weight:700;">View Details →</a>
          <a href="https://www.google.com/maps/dir/?api=1&destination=${Number(hospital.latitude)},${Number(hospital.longitude)}" target="_blank" rel="noopener noreferrer" style="color:#0f172a;font-weight:600;">Directions ↗</a>
        </div>
      </div>
    `);
    hospitalMarkers.push(marker);
  });
}

function detectUserLocation() {
  if (!navigator.geolocation || !map) {
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async function (position) {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;

      if (typeof loadHospitalsFromApi === "function") {
        await loadHospitalsFromApi(latitude, longitude);
        showAllHospitals();
        if (typeof filterHospitals === "function" && document.getElementById("hospitalList")) {
          filterHospitals();
        }
      }

      map.setView([latitude, longitude], 11);

      if (userMarker && map.hasLayer(userMarker)) {
        map.removeLayer(userMarker);
      }
      userMarker = L.marker([latitude, longitude]).addTo(map);
      userMarker.bindPopup("📍 <strong>You are here</strong>").openPopup();

      const nearest = findNearestHospitals(latitude, longitude, 10);
      updateHospitalPopups(nearest);
    },
    function () {
      if (map) {
        map.setView(INDIA_CENTER, INDIA_ZOOM);
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
  );
}

function findNearestHospitals(latitude, longitude, limit) {
  const earthRadiusKm = 6371;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;

  return hospitals
    .map((hospital) => {
      const latitudeDifference = toRadians(hospital.latitude - latitude);
      const longitudeDifference = toRadians(hospital.longitude - longitude);
      const originLatitude = toRadians(latitude);
      const hospitalLatitude = toRadians(hospital.latitude);

      const distance =
        2 *
        earthRadiusKm *
        Math.asin(
          Math.sqrt(
            Math.sin(latitudeDifference / 2) ** 2 +
              Math.cos(originLatitude) *
                Math.cos(hospitalLatitude) *
                Math.sin(longitudeDifference / 2) ** 2
          )
        );

      return { ...hospital, distance };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

function updateHospitalPopups(nearestHospitals) {
  nearestHospitals.forEach((hospital) => {
    const markerIndex = hospitals.findIndex((item) => item.id === hospital.id);
    if (markerIndex === -1) return;
    const marker = hospitalMarkers[markerIndex];
    if (!marker) return;

    marker.bindPopup(`
      <div style="min-width:240px">
        <h3>🏥 ${escMap(hospital.name)}</h3>
        <p>📍 ${escMap(hospital.city)}, ${escMap(hospital.state)}</p>
        <hr>
        <p>📏 <strong>${hospital.distance.toFixed(1)} km away</strong></p>
        <p>🟢 Emergency: ${hospital.emergency ? "Available" : "Unavailable"}</p>
        <p>🛏️ ICU: ${Number(hospital.beds.icu)} beds</p>
        <p>🏥 Beds: ${Number(hospital.beds.general)}</p>
        <p>🚑 Ambulances: ${Number(hospital.ambulances)}</p>
        <p>❤️ ${escMap((hospital.specialists || []).join(", "))}</p>
        <a
          href="https://www.google.com/maps/dir/?api=1&destination=${Number(hospital.latitude)},${Number(hospital.longitude)}"
          target="_blank"
          rel="noopener noreferrer"
          style="display:block;text-align:center;text-decoration:none;width:100%;padding:9px;border:0;border-radius:7px;background:#087f5b;color:white;cursor:pointer;"
        >
          🧭 Get Directions
        </a>
      </div>
    `);
  });
}

window.getUserLocation = detectUserLocation;
window.refreshHospitalMap = showAllHospitals;

document.addEventListener("DOMContentLoaded", function () {
  initializeMap();
});