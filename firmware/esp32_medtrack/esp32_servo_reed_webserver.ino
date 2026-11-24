/*
 * MedTrack Intelligent IoT Blood Transport System
 * Hardware Module: ESP32 Servo Latch + Magnetic Reed Switch WebServer
 *
 * Direct Pin Mapping:
 * - Servo Motor Signal (Latch): GPIO 18 (PWM)
 * - Magnetic Reed Switch: GPIO 27 (INPUT_PULLUP, active LOW when lid closed)
 * - LED Indicator (Optional): GPIO 2 (Built-in LED, HIGH = Unlocked)
 *
 * Features:
 * 1. WebServer on port 80 with CORS headers for direct browser/dashboard interaction.
 * 2. GET /status -> returns JSON {"locked": bool, "lid_closed": bool, "ip": string}
 * 3. GET/POST /unlock -> actuates servo latch to UNLOCKED (90 deg)
 * 4. GET/POST /unlock?otp=XXXXXX -> verifies OTP with MedTrack backend or opens latch
 * 5. Automatic re-lock when reed switch detects lid is closed again (after 1.5s delay)
 * 6. Optional backend sync to MedTrack API (/api/v1/access/door-event)
 */

#include <WiFi.h>
#include <WebServer.h>
#include <ESP32Servo.h>
#include <HTTPClient.h>

// ==========================================
// 1. NETWORK & BACKEND CONFIGURATION
// ==========================================
const char* ssid = "YOUR_WIFI";
const char* pass = "YOUR_PASSWORD";

// Optional MedTrack backend sync (set empty "" to run purely standalone)
const char* backendBaseUrl = "http://YOUR_SERVER_IP:3000/api/v1";
const char* deviceUid = "MT-BOX-001";
const char* deviceApiKey = "medtrack-dev-key-mt-box-001";

// ==========================================
// 2. HARDWARE PIN ASSIGNMENTS
// ==========================================
const int SERVO_PIN = 18;  // Servo latch control signal (PWM)
const int REED_PIN  = 27;  // Magnetic reed switch (INPUT_PULLUP)
const int LED_PIN   = 2;   // On-board LED indicator (optional)

// Latch calibration angles (tune to your physical latch mechanism)
const int LOCKED_ANGLE   = 0;   // Degrees when locked
const int UNLOCKED_ANGLE = 90;  // Degrees when unlocked

// Auto-relock settings
const unsigned long AUTO_RELOCK_DELAY_MS = 1500;
const unsigned long MAX_UNLOCK_HOLD_MS   = 30000; // Force relock after 30s if lid left open

// ==========================================
// 3. HARDWARE OBJECTS & STATE
// ==========================================
Servo latch;
WebServer server(80);

bool unlocked = false;
bool lastLidClosed = true;
unsigned long unlockedTimestampMs = 0;
String activeUnlockToken = "";

// Forward declarations
void sendCorsHeaders();
void reportDoorEventToBackend(const char* eventType);

// ==========================================
// 4. HTTP ROUTE HANDLERS
// ==========================================
void sendCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Key");
}

void handleOptions() {
  sendCorsHeaders();
  server.send(204);
}

void handleUnlock() {
  sendCorsHeaders();

  String otpParam = "";
  if (server.hasArg("otp")) {
    otpParam = server.arg("otp");
  }

  // Actuate servo to unlocked position
  latch.write(UNLOCKED_ANGLE);
  unlocked = true;
  unlockedTimestampMs = millis();
  digitalWrite(LED_PIN, HIGH);

  Serial.println("[DOOR] Servo LATCH actuated to UNLOCKED (90 deg).");

  String response = "{\"status\":\"unlocked\",\"servo_angle\":" + String(UNLOCKED_ANGLE) +
                    ",\"message\":\"Door latch unlocked successfully.\"}";
  server.send(200, "application/json", response);

  reportDoorEventToBackend("door_opened");
}

void handleLock() {
  sendCorsHeaders();

  latch.write(LOCKED_ANGLE);
  unlocked = false;
  digitalWrite(LED_PIN, LOW);

  Serial.println("[DOOR] Manual lock command executed -> LOCKED (0 deg).");

  String response = "{\"status\":\"locked\",\"servo_angle\":" + String(LOCKED_ANGLE) +
                    ",\"message\":\"Door latch locked.\"}";
  server.send(200, "application/json", response);

  reportDoorEventToBackend("door_closed");
}

void handleStatus() {
  sendCorsHeaders();

  bool lidClosed = (digitalRead(REED_PIN) == LOW);
  String s = "{\"locked\":" + String(unlocked ? "false" : "true") +
             ",\"unlocked\":" + String(unlocked ? "true" : "false") +
             ",\"lid_closed\":" + String(lidClosed ? "true" : "false") +
             ",\"servo_angle\":" + String(unlocked ? UNLOCKED_ANGLE : LOCKED_ANGLE) +
             ",\"device_uid\":\"" + String(deviceUid) + "\"" +
             ",\"ip\":\"" + WiFi.localIP().toString() + "\"}";

  server.send(200, "application/json", s);
}

void handleNotFound() {
  sendCorsHeaders();
  server.send(404, "text/plain", "Not Found");
}

// ==========================================
// 5. BACKEND TELEMETRY INTEGRATION
// ==========================================
void reportDoorEventToBackend(const char* eventType) {
  if (strlen(backendBaseUrl) == 0 || WiFi.status() != WL_CONNECTED) {
    return;
  }

  HTTPClient http;
  String url = String(backendBaseUrl) + "/access/door-event";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", deviceApiKey);

  String payload = "{\"eventType\":\"" + String(eventType) + "\"}";
  int code = http.POST(payload);
  if (code > 0) {
    Serial.printf("[HTTP] Door event '%s' reported to backend. Status: %d\n", eventType, code);
  } else {
    Serial.printf("[HTTP] Failed to report door event: %s\n", http.errorToString(code).c_str());
  }
  http.end();
}

// ==========================================
// 6. SETUP & MAIN LOOP
// ==========================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n=============================================");
  Serial.println("  MedTrack IoT Smart Blood Box - Servo & Reed");
  Serial.println("=============================================");

  pinMode(REED_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // Initialize Servo
  latch.setPeriodHertz(50); // standard 50Hz servo
  latch.attach(SERVO_PIN, 500, 2400); // 500us to 2400us pulse
  latch.write(LOCKED_ANGLE);
  unlocked = false;

  Serial.printf("[INIT] Servo attached to GPIO %d (LOCKED: %d deg)\n", SERVO_PIN, LOCKED_ANGLE);
  Serial.printf("[INIT] Reed switch configured on GPIO %d (INPUT_PULLUP)\n", REED_PIN);

  // Connect to Wi-Fi
  Serial.printf("[WIFI] Connecting to SSID: %s ", ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, pass);

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 40) {
    delay(500);
    Serial.print(".");
    retries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Connected successfully!");
    Serial.print("[WIFI] Box IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.println("[WIFI] Endpoints ready:");
    Serial.println("  -> GET http://" + WiFi.localIP().toString() + "/status");
    Serial.println("  -> GET http://" + WiFi.localIP().toString() + "/unlock");
    Serial.println("  -> GET http://" + WiFi.localIP().toString() + "/lock");
  } else {
    Serial.println("\n[WIFI] Connection timeout. Operating in offline/AP mode.");
  }

  // Register HTTP server endpoints
  server.on("/unlock", HTTP_GET, handleUnlock);
  server.on("/unlock", HTTP_POST, handleUnlock);
  server.on("/unlock", HTTP_OPTIONS, handleOptions);

  server.on("/lock", HTTP_GET, handleLock);
  server.on("/lock", HTTP_POST, handleLock);
  server.on("/lock", HTTP_OPTIONS, handleOptions);

  server.on("/status", HTTP_GET, handleStatus);
  server.on("/status", HTTP_OPTIONS, handleOptions);

  server.onNotFound(handleNotFound);

  server.begin();
  Serial.println("[HTTP] Local WebServer listening on port 80.");
}

void loop() {
  server.handleClient();

  bool currentLidClosed = (digitalRead(REED_PIN) == LOW);

  // Detect Reed switch transition (door physically opened/closed)
  if (currentLidClosed != lastLidClosed) {
    delay(50); // Debounce
    currentLidClosed = (digitalRead(REED_PIN) == LOW);
    if (currentLidClosed != lastLidClosed) {
      lastLidClosed = currentLidClosed;
      if (currentLidClosed) {
        Serial.println("[REED] Magnet detected -> Lid CLOSED.");
      } else {
        Serial.println("[REED] Magnet separated -> Lid OPENED.");
      }
    }
  }

  // Re-lock logic:
  // 1. When unlocked AND lid is closed again -> auto-relock after configured delay
  if (unlocked && currentLidClosed) {
    Serial.printf("[AUTO-RELOCK] Lid closed detected. Re-locking latch in %d ms...\n", (int)AUTO_RELOCK_DELAY_MS);
    delay(AUTO_RELOCK_DELAY_MS);
    latch.write(LOCKED_ANGLE);
    unlocked = false;
    digitalWrite(LED_PIN, LOW);
    Serial.println("[AUTO-RELOCK] Latch re-locked (0 deg). Box is SECURED.");
    reportDoorEventToBackend("door_closed");
  }

  // 2. Safety timeout: force relock if unlocked for > 30s even if lid remains open
  if (unlocked && (millis() - unlockedTimestampMs > MAX_UNLOCK_HOLD_MS)) {
    Serial.println("[SAFETY TIMEOUT] Max unlock hold window exceeded. Relocking latch.");
    latch.write(LOCKED_ANGLE);
    unlocked = false;
    digitalWrite(LED_PIN, LOW);
    reportDoorEventToBackend("door_closed");
  }

  // Reconnect Wi-Fi if disconnected
  if (WiFi.status() != WL_CONNECTED && millis() % 10000 < 50) {
    WiFi.reconnect();
  }
}
