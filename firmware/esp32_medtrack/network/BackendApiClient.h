#ifndef BACKEND_API_CLIENT_H
#define BACKEND_API_CLIENT_H

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

#include "../drivers/CoolingPolicyController.h"

struct OtpVerifyResponse {
  bool authorized;
  String unlockToken;
};

// Transport-agnostic API client (REST/HTTPS initial layer; MQTT client can swap in cleanly)
class BackendApiClient {
private:
  String baseUrl;
  String deviceUid;
  String apiKey;

  int postJson(const String& path, const String& body, String& responseOut) {
    if (WiFi.status() != WL_CONNECTED) return -1;

    HTTPClient http;
    http.begin(baseUrl + path);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Id", deviceUid);
    http.addHeader("X-Device-Key", apiKey);

    int code = http.POST(body);
    if (code > 0) {
      responseOut = http.getString();
    }
    http.end();
    return code;
  }

  void applyPolicyFromResponse(const String& resp, CoolingPolicyController* policyOut) {
    if (!policyOut || resp.length() == 0) return;
    StaticJsonDocument<512> resDoc;
    if (!deserializeJson(resDoc, resp) && resDoc.containsKey("coolingPolicy")) {
      JsonObject p = resDoc["coolingPolicy"];
      if (p.containsKey("targetMinC") && p.containsKey("targetMaxC")) {
        float minC = p["targetMinC"].as<float>();
        float maxC = p["targetMaxC"].as<float>();
        float hystC = p.containsKey("hysteresisC") ? p["hysteresisC"].as<float>() : 0.5f;
        policyOut->updateThresholds(minC, maxC, hystC);
      }
    }
  }

public:
  BackendApiClient(const char* url, const char* uid, const char* key)
    : baseUrl(url), deviceUid(uid), apiKey(key) {}

  bool sendTemperature(float tempC, bool sensorError, bool coolingActive, CoolingPolicyController* policyOut = nullptr) {
    StaticJsonDocument<256> doc;
    doc["sensorType"] = "temperature";
    if (!sensorError) doc["valueNumeric"] = tempC;
    doc["unit"] = "C";
    doc["sensorError"] = sensorError;
    doc["currentlyCooling"] = coolingActive;

    String payload, resp;
    serializeJson(doc, payload);
    int code = postJson("/sensors/readings", payload, resp);
    if (code >= 200 && code < 300) {
      applyPolicyFromResponse(resp, policyOut);
      return true;
    }
    return false;
  }

  bool sendHeartbeat(CoolingPolicyController* policyOut = nullptr) {
    String resp;
    int code = postJson("/devices/heartbeat", "{}", resp);
    if (code >= 200 && code < 300) {
      applyPolicyFromResponse(resp, policyOut);
      return true;
    }
    return false;
  }

  bool sendGps(double lat, double lng, double speedKmh, uint32_t sats, double hdop, bool fixValid) {
    StaticJsonDocument<256> doc;
    doc["latitude"] = lat;
    doc["longitude"] = lng;
    doc["speedKmh"] = speedKmh;
    doc["satellites"] = sats;
    doc["hdop"] = hdop;
    doc["fixValid"] = fixValid;

    String payload, resp;
    serializeJson(doc, payload);
    int code = postJson("/gps/update", payload, resp);
    return code >= 200 && code < 300;
  }

  OtpVerifyResponse verifyOtp(const String& otp) {
    StaticJsonDocument<128> doc;
    doc["otp"] = otp;
    String payload, resp;
    serializeJson(doc, payload);

    int code = postJson("/otp/verify", payload, resp);
    if (code == 200) {
      StaticJsonDocument<256> resDoc;
      if (!deserializeJson(resDoc, resp) && resDoc["unlockAuthorized"] == true) {
        return { true, resDoc["unlockToken"].as<String>() };
      }
    }
    return { false, "" };
  }

  bool sendDoorEvent(const char* eventType, const String& unlockToken) {
    StaticJsonDocument<192> doc;
    doc["eventType"] = eventType;
    if (unlockToken.length() > 0) doc["unlockToken"] = unlockToken;
    String payload, resp;
    serializeJson(doc, payload);
    int code = postJson("/access/door-event", payload, resp);
    return code >= 200 && code < 300;
  }
};

#endif
