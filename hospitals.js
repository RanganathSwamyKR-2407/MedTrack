// ============================================
// MEDTRACK INDIA - HOSPITAL DATA & API BRIDGE
// ============================================

let hospitals = [
  {
    id: 1,
    name: "Ruby Hall Clinic",
    city: "Pune",
    state: "Maharashtra",
    address: "Sassoon Road, Pune",
    phone: "02026163391",
    latitude: 18.5204,
    longitude: 73.8567,
    beds: { general: 32, icu: 5, emergency: 8 },
    specialists: ["Cardiology", "Neurology", "Emergency Medicine"],
    facilitiesList: ["ICU", "Emergency", "Cardiology", "CT Scan", "MRI", "Ambulance", "Ventilator", "Oxygen", "Blood Bank"],
    facilities: { ventilator: true, oxygen: true, blood: true, ct: true, mri: true },
    ambulances: 2,
    rating: 4.5,
    travelTime: 12,
    emergency: true,
    verified: true,
    status: "active",
    lastUpdated: "2 minutes ago"
  },
  {
    id: 2,
    name: "KEM Hospital Pune",
    city: "Pune",
    state: "Maharashtra",
    address: "Rasta Peth, Pune",
    phone: "02026125600",
    latitude: 18.5200,
    longitude: 73.8620,
    beds: { general: 45, icu: 8, emergency: 12 },
    specialists: ["Cardiology", "Orthopedics", "Emergency Medicine"],
    facilitiesList: ["ICU", "Emergency", "Cardiology", "Orthopedics", "CT Scan", "Ambulance", "Ventilator", "Oxygen", "Blood Bank"],
    facilities: { ventilator: true, oxygen: true, blood: true, ct: true, mri: false },
    ambulances: 3,
    rating: 4.4,
    travelTime: 15,
    emergency: true,
    verified: true,
    status: "active",
    lastUpdated: "4 minutes ago"
  },
  {
    id: 3,
    name: "Manipal Hospital",
    city: "Bengaluru",
    state: "Karnataka",
    address: "HAL Airport Road, Bengaluru",
    phone: "08025024444",
    latitude: 12.9592,
    longitude: 77.6470,
    beds: { general: 60, icu: 10, emergency: 15 },
    specialists: ["Cardiology", "Neurology", "Emergency Medicine"],
    facilitiesList: ["ICU", "Emergency", "Cardiology", "Neurology", "MRI", "CT Scan", "Ambulance", "Ventilator", "Oxygen", "Blood Bank"],
    facilities: { ventilator: true, oxygen: true, blood: true, ct: true, mri: true },
    ambulances: 4,
    rating: 4.6,
    travelTime: 10,
    emergency: true,
    verified: true,
    status: "active",
    lastUpdated: "3 minutes ago"
  },
  {
    id: 4,
    name: "KLE Hospital",
    city: "Belgaum",
    state: "Karnataka",
    address: "Nehru Nagar, Belgaum",
    phone: "08312473777",
    latitude: 15.8497,
    longitude: 74.4977,
    beds: { general: 40, icu: 6, emergency: 10 },
    specialists: ["Cardiology", "Orthopedics", "Emergency Medicine"],
    facilitiesList: ["ICU", "Emergency", "Cardiology", "Orthopedics", "CT Scan", "Ambulance", "Ventilator", "Oxygen", "Blood Bank"],
    facilities: { ventilator: true, oxygen: true, blood: true, ct: true, mri: false },
    ambulances: 2,
    rating: 4.5,
    travelTime: 8,
    emergency: true,
    verified: true,
    status: "active",
    lastUpdated: "1 minute ago"
  },
  {
    id: 5,
    name: "Apollo Hospital",
    city: "Hyderabad",
    state: "Telangana",
    address: "Jubilee Hills, Hyderabad",
    phone: "04023607777",
    latitude: 17.4239,
    longitude: 78.4738,
    beds: { general: 70, icu: 12, emergency: 18 },
    specialists: ["Cardiology", "Oncology", "Emergency Medicine"],
    facilitiesList: ["ICU", "Emergency", "Cardiology", "Oncology", "MRI", "CT Scan", "Ambulance", "Ventilator", "Oxygen", "Blood Bank"],
    facilities: { ventilator: true, oxygen: true, blood: true, ct: true, mri: true },
    ambulances: 5,
    rating: 4.7,
    travelTime: 14,
    emergency: true,
    verified: true,
    status: "active",
    lastUpdated: "2 minutes ago"
  },
  {
    id: 6,
    name: "AIIMS Delhi",
    city: "New Delhi",
    state: "Delhi",
    address: "Ansari Nagar, New Delhi",
    phone: "01126588500",
    latitude: 28.5672,
    longitude: 77.2100,
    beds: { general: 90, icu: 15, emergency: 20 },
    specialists: ["Cardiology", "Neurology", "Oncology", "Emergency Medicine", "Trauma"],
    facilitiesList: ["ICU", "Emergency", "Cardiology", "Neurology", "Oncology", "MRI", "CT Scan", "Ambulance", "Ventilator", "Oxygen", "Blood Bank"],
    facilities: { ventilator: true, oxygen: true, blood: true, ct: true, mri: true },
    ambulances: 6,
    rating: 4.8,
    travelTime: 18,
    emergency: true,
    verified: true,
    status: "active",
    lastUpdated: "5 minutes ago"
  },
  {
    id: 7,
    name: "CMC Hospital",
    city: "Vellore",
    state: "Tamil Nadu",
    address: "Ida Scudder Road, Vellore",
    phone: "04162281000",
    latitude: 12.9249,
    longitude: 79.1350,
    beds: { general: 55, icu: 9, emergency: 14 },
    specialists: ["Cardiology", "Neurology", "Emergency Medicine"],
    facilitiesList: ["ICU", "Emergency", "Cardiology", "Neurology", "MRI", "CT Scan", "Ambulance", "Ventilator", "Oxygen", "Blood Bank"],
    facilities: { ventilator: true, oxygen: true, blood: true, ct: true, mri: true },
    ambulances: 3,
    rating: 4.7,
    travelTime: 11,
    emergency: true,
    verified: true,
    status: "active",
    lastUpdated: "3 minutes ago"
  },
  {
    id: 8,
    name: "Fortis Hospital",
    city: "Mumbai",
    state: "Maharashtra",
    address: "Mulund West, Mumbai",
    phone: "02267994444",
    latitude: 19.1726,
    longitude: 72.9567,
    beds: { general: 48, icu: 7, emergency: 11 },
    specialists: ["Cardiology", "Orthopedics", "Emergency Medicine"],
    facilitiesList: ["ICU", "Emergency", "Cardiology", "Orthopedics", "CT Scan", "MRI", "Ambulance", "Ventilator", "Oxygen", "Blood Bank"],
    facilities: { ventilator: true, oxygen: true, blood: true, ct: true, mri: true },
    ambulances: 3,
    rating: 4.6,
    travelTime: 13,
    emergency: true,
    verified: true,
    status: "active",
    lastUpdated: "2 minutes ago"
  }
];

function hydrateHospitalAliases(list) {
  list.forEach((hospital) => {
    hospital.lat = hospital.latitude;
    hospital.lng = hospital.longitude;
    hospital.icu = hospital.beds.icu;
    hospital.ambulance = hospital.ambulances;
    hospital.specialties = hospital.specialists;
  });
}

hydrateHospitalAliases(hospitals);

async function loadHospitalsFromApi(lat = null, lng = null) {
  try {
    const query =
      lat !== null && lng !== null ? `?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}` : "";
    const res = await fetch(`/api/v1/hospitals${query}`);
    if (!res.ok) return hospitals;
    const data = await res.json();
    if (Array.isArray(data.hospitals) && data.hospitals.length > 0) {
      hospitals = data.hospitals;
      hydrateHospitalAliases(hospitals);
      window.hospitals = hospitals;
    }
  } catch {
    // Graceful fallback to embedded baseline hospitals when API is unreachable
  }
  return hospitals;
}

function searchHospitals(searchText = "") {
  const search = searchText.trim().toLowerCase();
  if (!search) return hospitals;
  return hospitals.filter((hospital) => {
    const fList = Array.isArray(hospital.facilitiesList) ? hospital.facilitiesList : [];
    return (
      hospital.name.toLowerCase().includes(search) ||
      hospital.city.toLowerCase().includes(search) ||
      hospital.state.toLowerCase().includes(search) ||
      hospital.address.toLowerCase().includes(search) ||
      hospital.specialists.join(" ").toLowerCase().includes(search) ||
      fList.join(" ").toLowerCase().includes(search)
    );
  });
}

function getHospitalById(id) {
  return hospitals.find((hospital) => hospital.id === Number(id));
}

function viewHospital(id) {
  const hospital = getHospitalById(id);
  if (!hospital) return;
  window.location.href = `hospital.html?id=${hospital.id}`;
}

function navigateToHospital(id) {
  const hospital = getHospitalById(id);
  if (!hospital) return;
  if (typeof map !== "undefined" && map && typeof hospitalMarkers !== "undefined") {
    map.setView([hospital.latitude, hospital.longitude], 14);
    const idx = hospitals.findIndex((h) => h.id === hospital.id);
    if (idx !== -1 && hospitalMarkers[idx]) {
      hospitalMarkers[idx].openPopup();
    }
    const mapEl = document.getElementById("hospitalMap") || document.getElementById("homeMap");
    if (mapEl) mapEl.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  window.location.href = `hospital.html?id=${hospital.id}`;
}

function findBestHospital(requirement = "") {
  let results = [...hospitals];
  if (requirement) {
    const req = requirement.toLowerCase();
    results = results.filter((hospital) => {
      const fList = Array.isArray(hospital.facilitiesList) ? hospital.facilitiesList : [];
      return (
        hospital.specialists.some((s) => s.toLowerCase().includes(req)) ||
        fList.some((f) => f.toLowerCase().includes(req))
      );
    });
  }
  results = results.filter((hospital) => hospital.status !== "full");
  results.sort((a, b) => {
    const scoreA = a.rating * 20 + a.beds.icu * 5 + a.beds.general * 2 - a.travelTime;
    const scoreB = b.rating * 20 + b.beds.icu * 5 + b.beds.general * 2 - b.travelTime;
    return scoreB - scoreA;
  });
  return results;
}

window.hospitals = hospitals;
window.loadHospitalsFromApi = loadHospitalsFromApi;
window.searchHospitals = searchHospitals;
window.getHospitalById = getHospitalById;
window.viewHospital = viewHospital;
window.navigateToHospital = navigateToHospital;
window.findBestHospital = findBestHospital;