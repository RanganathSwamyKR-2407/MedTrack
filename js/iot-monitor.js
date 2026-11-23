/**
 * Shared IoT Transport Monitor: renders live Leaflet journey map, temperature chart (4-8C safe band),
 * excursion history, OTP access status, and clearly labeled Simulation Mode controls.
 */
(function (global) {
  function esc(v) {
    return global.medtrackApi ? global.medtrackApi.escapeHtml(v) : String(v ?? "");
  }

  function fmt(ts) {
    return global.medtrackApi ? global.medtrackApi.formatLocalTime(ts) : String(ts ?? "—");
  }

  function renderTemperatureChart(containerId, history = [], policy = { targetMinC: 4, targetMaxC: 8 }) {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!history.length) {
      el.innerHTML = `<p style="color:var(--muted);font-size:13px;">No temperature telemetry recorded yet.</p>`;
      return;
    }

    const width = 560;
    const height = 200;
    const pad = 34;
    const minC = Number(policy.targetMinC ?? 4);
    const maxC = Number(policy.targetMaxC ?? 8);

    const temps = history.map((p) => Number(p.temperatureC)).filter((v) => Number.isFinite(v));
    const yMin = Math.min(0, minC - 2, ...temps);
    const yMax = Math.max(14, maxC + 3, ...temps);

    const xScale = (i) =>
      history.length === 1 ? width / 2 : pad + (i / (history.length - 1)) * (width - pad * 2);
    const yScale = (val) =>
      height - pad - ((val - yMin) / (yMax - yMin || 1)) * (height - pad * 2);

    const safeTop = yScale(maxC);
    const safeBottom = yScale(minC);

    const points = history
      .map((p, i) => {
        if (!Number.isFinite(Number(p.temperatureC))) return null;
        return `${xScale(i).toFixed(1)},${yScale(Number(p.temperatureC)).toFixed(1)}`;
      })
      .filter(Boolean);

    const circles = history
      .map((p, i) => {
        const val = Number(p.temperatureC);
        if (!Number.isFinite(val)) return "";
        const color = p.qualityStatus === "critical" || p.qualityStatus === "sensor_error"
          ? "#dc2626"
          : p.qualityStatus === "warning"
            ? "#d97706"
            : "#087f5b";
        return `<circle cx="${xScale(i).toFixed(1)}" cy="${yScale(val).toFixed(1)}" r="4.5" fill="${color}">
          <title>${val}°C (${esc(fmt(p.recordedAt))})${p.isSimulated ? " [SIMULATED]" : ""}</title>
        </circle>`;
      })
      .join("");

    el.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;background:#fbfdfc;border:1px solid var(--border);border-radius:10px;">
        <rect x="${pad}" y="${safeTop}" width="${width - pad * 2}" height="${Math.max(4, safeBottom - safeTop)}" fill="rgba(8,127,91,0.10)" />
        <line x1="${pad}" y1="${safeTop}" x2="${width - pad}" y2="${safeTop}" stroke="#087f5b" stroke-dasharray="4 4" stroke-width="1" />
        <line x1="${pad}" y1="${safeBottom}" x2="${width - pad}" y2="${safeBottom}" stroke="#087f5b" stroke-dasharray="4 4" stroke-width="1" />
        <text x="4" y="${safeTop + 4}" font-size="11" font-weight="700" fill="#087f5b">${maxC}°C</text>
        <text x="4" y="${safeBottom + 4}" font-size="11" font-weight="700" fill="#087f5b">${minC}°C</text>
        ${points.length > 1 ? `<polyline fill="none" stroke="#102a27" stroke-width="2" points="${points.join(" ")}" />` : ""}
        ${circles}
      </svg>
    `;
  }

  function renderTransportRouteMap(mapRef, containerId, transport, points) {
    const el = document.getElementById(containerId);
    if (!el || typeof L === "undefined") return mapRef;

    if (!mapRef) {
      mapRef = L.map(containerId).setView([18.5204, 73.8567], 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(mapRef);
      window.addEventListener("resize", () => mapRef.invalidateSize());
    }

    mapRef.eachLayer((layer) => {
      if (!(layer instanceof L.TileLayer)) {
        mapRef.removeLayer(layer);
      }
    });

    const bounds = [];
    if (transport.origin_lat && transport.origin_lng) {
      L.marker([transport.origin_lat, transport.origin_lng])
        .addTo(mapRef)
        .bindPopup(`🩸 Origin: ${esc(transport.origin_bank_name)}`);
      bounds.push([transport.origin_lat, transport.origin_lng]);
    }
    if (transport.dest_lat && transport.dest_lng) {
      L.marker([transport.dest_lat, transport.dest_lng])
        .addTo(mapRef)
        .bindPopup(`🏥 Destination: ${esc(transport.destination_hospital_name || "Recipient")}`);
      bounds.push([transport.dest_lat, transport.dest_lng]);
    }

    if (Array.isArray(points) && points.length > 0) {
      const latlngs = points.map((p) => [p.latitude, p.longitude]);
      L.polyline(latlngs, { color: "#087f5b", weight: 4 }).addTo(mapRef);
      const latest = points[points.length - 1];
      L.circleMarker([latest.latitude, latest.longitude], {
        radius: 9,
        color: "#dc2626",
        fillColor: "#ef4444",
        fillOpacity: 0.9
      })
        .addTo(mapRef)
        .bindPopup(
          `📦 Box ${esc(transport.device_uid)}<br>Speed: ${esc(latest.speed_kmh || 0)} km/h<br>Updated: ${esc(fmt(latest.recorded_at))}`
        )
        .openPopup();
      latlngs.forEach((ll) => bounds.push(ll));
    }

    if (bounds.length > 0) {
      mapRef.fitBounds(bounds, { padding: [30, 30] });
    }
    setTimeout(() => mapRef.invalidateSize(), 150);
    return mapRef;
  }

  function summarizeDoorAndOtp(otpStatus, logs = []) {
    const latestDoorEvent = logs.find((l) =>
      ["door_opened", "door_closed", "unauthorized_door_open"].includes(l.event_type)
    );
    let doorState = "CLOSED";
    let doorAlert = false;
    if (!latestDoorEvent) {
      doorState = "CLOSED (IDLE)";
    } else if (latestDoorEvent.event_type === "unauthorized_door_open") {
      doorState = "OPEN (UNAUTH)";
      doorAlert = true;
    } else if (latestDoorEvent.event_type === "door_opened") {
      doorState = "OPEN";
    } else {
      doorState = "CLOSED";
    }

    const nowMs = Date.now();
    const unlockExpMs = otpStatus?.unlock_expires_at ? new Date(otpStatus.unlock_expires_at).getTime() : 0;
    const isUnlocked = Boolean(unlockExpMs && unlockExpMs >= nowMs && latestDoorEvent?.event_type !== "door_closed");
    const lockState = isUnlocked ? "UNLOCKED" : "LOCKED";

    let otpState = "NONE";
    let otpDetail = "No OTP issued yet";
    let otpTone = "neutral";
    if (otpStatus) {
      const lockedMs = otpStatus.locked_until ? new Date(otpStatus.locked_until).getTime() : 0;
      const expMs = otpStatus.expires_at ? new Date(otpStatus.expires_at).getTime() : 0;
      if (lockedMs && lockedMs > nowMs && !otpStatus.used_at) {
        otpState = "LOCKED OUT";
        otpDetail = `Locked until ${fmt(otpStatus.locked_until)}`;
        otpTone = "danger";
      } else if (otpStatus.used_at) {
        otpState = "VERIFIED / USED";
        otpDetail = `Used at ${fmt(otpStatus.used_at)}`;
        otpTone = "ok";
      } else if (expMs && expMs < nowMs) {
        otpState = "EXPIRED";
        otpDetail = `Expired at ${fmt(otpStatus.expires_at)}`;
        otpTone = "warn";
      } else {
        otpState = "ACTIVE";
        otpDetail = `Expires ${fmt(otpStatus.expires_at)}`;
        otpTone = "ok";
      }
    }

    return { doorState, doorAlert, lockState, otpState, otpDetail, otpTone };
  }

  function renderModularSensors(containerId, sensors = [], readings = []) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const extraSensors = (sensors || []).filter(
      (s) => !["temperature", "gps", "reed_switch"].includes(s.sensor_type)
    );
    if (!extraSensors.length) {
      el.innerHTML = `<span style="font-size:12px;color:var(--muted);">Core sensors active (DS18B20, Neo-6M GPS, Reed Switch). Expansion modules supported via <code>device_sensors</code>.</span>`;
      return;
    }
    const latestByType = new Map();
    for (const r of readings || []) {
      if (!latestByType.has(r.sensor_type)) latestByType.set(r.sensor_type, r);
    }
    el.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        ${extraSensors
          .map((s) => {
            const latest = latestByType.get(s.sensor_type);
            const valText = latest
              ? latest.value_numeric !== null && latest.value_numeric !== undefined
                ? `${Number(latest.value_numeric).toFixed(1)} ${esc(s.unit)}`
                : esc(latest.value_json || "OK")
              : "Awaiting reading";
            return `<span class="status available" style="font-size:11px;">🔌 ${esc(s.label)}: ${valText}</span>`;
          })
          .join("")}
      </div>
    `;
  }

  global.medtrackIot = {
    renderTemperatureChart,
    renderTransportRouteMap,
    summarizeDoorAndOtp,
    renderModularSensors
  };
})(window);
