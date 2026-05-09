// #include "esp_camera.h"
// #include <WiFi.h>
// #include <HTTPClient.h>
// #include <WebServer.h>
// #include <Preferences.h>
// #include <driver/i2s.h>
// #include <ArduinoJson.h>
// #include <Audio.h>             // Streaming Speaker Library
// #include "soc/soc.h"           
// #include "soc/rtc_cntl_reg.h"  

// // ==========================================
// // CONFIGURATION
// // ==========================================
// String serverBaseUrl = "http://192.168.1.5:3000"; // put your own ip address 

// const int BUTTON_PIN = 13; 

// // I2S Shared Audio Pins
// const int I2S_SCK = 14;  // BCLK (Shared by Mic & Speaker)
// const int I2S_WS = 15;   // LRC  (Shared by Mic & Speaker)
// const int I2S_SD = 2;    // DIN  (Microphone Data IN)
// const int I2S_DOUT = 12; // DOUT (Speaker Data OUT)

// Preferences preferences;
// WebServer server(80);
// Audio audio; // Speaker Object

// String savedSSID = "";
// String savedPassword = "";
// String savedToken = "";

// bool isSetupMode = false;
// unsigned long buttonPressTime = 0;
// bool isButtonPressed = false;
// int lastButtonState = HIGH;

// const int sampleRate = 16000;
// const int recordDuration = 4; 
// const int headerSize = 44;
// const int byteRate = sampleRate * 2; 
// const int audioSize = byteRate * recordDuration;

// // ==========================================
// // CAMERA CONFIG 
// // ==========================================
// void startCamera() {
//   camera_config_t config;
//   config.ledc_channel = LEDC_CHANNEL_0;
//   config.ledc_timer = LEDC_TIMER_0;
//   config.pin_d0 = 5; config.pin_d1 = 18; config.pin_d2 = 19;
//   config.pin_d3 = 21; config.pin_d4 = 36; config.pin_d5 = 39;
//   config.pin_d6 = 34; config.pin_d7 = 35; config.pin_xclk = 0;
//   config.pin_pclk = 22; config.pin_vsync = 25; config.pin_href = 23;
//   config.pin_sccb_sda = 26; config.pin_sccb_scl = 27;
//   config.pin_pwdn = 32; config.pin_reset = -1;
//   config.xclk_freq_hz = 20000000;
//   config.pixel_format = PIXFORMAT_JPEG;
//   config.frame_size = FRAMESIZE_VGA;
//   config.jpeg_quality = 10;
//   config.fb_count = 1;

//   esp_camera_init(&config);
//   sensor_t * s = esp_camera_sensor_get();
//   if (s != NULL) {
//     s->set_vflip(s, 1);   
//     s->set_hmirror(s, 1); 
//   }
// }

// // ==========================================
// // MICROPHONE I2S CONFIG
// // ==========================================
// void initMicrophone() {
//   i2s_config_t i2s_config = {
//     .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
//     .sample_rate = sampleRate,
//     .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
//     .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
//     .communication_format = I2S_COMM_FORMAT_I2S,
//     .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
//     .dma_buf_count = 8,
//     .dma_buf_len = 1024,
//     .use_apll = false,
//     .tx_desc_auto_clear = false,
//     .fixed_mclk = 0
//   };
//   i2s_pin_config_t pin_config = { .bck_io_num = I2S_SCK, .ws_io_num = I2S_WS, .data_out_num = I2S_PIN_NO_CHANGE, .data_in_num = I2S_SD };
//   i2s_driver_install(I2S_NUM_0, &i2s_config, 0, NULL);
//   i2s_set_pin(I2S_NUM_0, &pin_config);
// }

// void generateWavHeader(byte* header, int wavSize) {
//   header[0] = 'R'; header[1] = 'I'; header[2] = 'F'; header[3] = 'F';
//   unsigned int fileSize = wavSize - 8;
//   header[4] = (byte)(fileSize & 0xFF); header[5] = (byte)((fileSize >> 8) & 0xFF); header[6] = (byte)((fileSize >> 16) & 0xFF); header[7] = (byte)((fileSize >> 24) & 0xFF);
//   header[8] = 'W'; header[9] = 'A'; header[10] = 'V'; header[11] = 'E';
//   header[12] = 'f'; header[13] = 'm'; header[14] = 't'; header[15] = ' ';
//   header[16] = 16; header[17] = 0; header[18] = 0; header[19] = 0;
//   header[20] = 1; header[21] = 0; header[22] = 1; header[23] = 0;
//   header[24] = (byte)(sampleRate & 0xFF); header[25] = (byte)((sampleRate >> 8) & 0xFF); header[26] = (byte)((sampleRate >> 16) & 0xFF); header[27] = (byte)((sampleRate >> 24) & 0xFF);
//   header[28] = (byte)(byteRate & 0xFF); header[29] = (byte)((byteRate >> 8) & 0xFF); header[30] = (byte)((byteRate >> 16) & 0xFF); header[31] = (byte)((byteRate >> 24) & 0xFF);
//   header[32] = 2; header[33] = 0; header[34] = 16; header[35] = 0;
//   header[36] = 'd'; header[37] = 'a'; header[38] = 't'; header[39] = 'a';
//   unsigned int dataSize = wavSize - 44;
//   header[40] = (byte)(dataSize & 0xFF); header[41] = (byte)((dataSize >> 8) & 0xFF); header[42] = (byte)((dataSize >> 16) & 0xFF); header[43] = (byte)((dataSize >> 24) & 0xFF);
// }

// // ==========================================
// // VOICE PROCESSING (Record -> Backend TTS Stream)
// // ==========================================
// void recordAndSendAudio() {
//   Serial.println("\n🎙️ Listening (4 seconds)...");
//   int totalWavSize = headerSize + audioSize;
//   byte* wavData = (byte*) ps_malloc(totalWavSize);
//   if (wavData == NULL) { Serial.println("❌ Failed to allocate PSRAM"); return; }

//   generateWavHeader(wavData, totalWavSize);
//   size_t bytesRead = 0;
//   i2s_read(I2S_NUM_0, wavData + headerSize, audioSize, &bytesRead, portMAX_DELAY);
  
//   Serial.println("✅ Recording finished! Asking AI...");

//   HTTPClient http;
//   http.begin(serverBaseUrl + "/api/voice");
//   http.addHeader("Content-Type", "audio/wav");
//   http.addHeader("x-glasses-token", savedToken);

//   int httpResponseCode = http.POST(wavData, totalWavSize);
//   String responseBody = http.getString();
//   http.end();
//   free(wavData); 

//   if (httpResponseCode == 200) {
//     DynamicJsonDocument doc(2048);
//     deserializeJson(doc, responseBody);
//     const char* aiAnswer = doc["answer"];
//     const char* audioUrl = doc["audioUrl"]; // 🚀 Get the URL to the MP3 from Node.js!
    
//     Serial.printf("🤖 AI Answer: %s\n", aiAnswer);
//     Serial.printf("🔗 Streaming MP3 from: %s\n", audioUrl);

//     // 1. Turn off Microphone driver
//     i2s_driver_uninstall(I2S_NUM_0);

//     // 2. Turn on Speaker driver & pinout
//     audio.setPinout(I2S_SCK, I2S_WS, I2S_DOUT);
//     audio.setVolume(100); 

//     // 3. Play the stream directly from your Node.js Backend!
//     Serial.println("🔊 Streaming audio...");
//     audio.connecttohost(audioUrl); 

//     while(audio.isRunning()) {
//       audio.loop();
//     }
//     Serial.println("🤫 Finished speaking.");

//     // 4. Turn Microphone driver back on for next time
//     initMicrophone();

//   } else {
//     Serial.printf("❌ Error from server: %d\n", httpResponseCode);
//   }
// }

// // ==========================================
// // SOFT AP PROVISIONING ROUTE
// // ==========================================
// void handleProvision() {
//   if (server.hasArg("ssid") && server.hasArg("password") && server.hasArg("token")) {
//     preferences.putString("ssid", server.arg("ssid"));
//     preferences.putString("password", server.arg("password"));
//     preferences.putString("token", server.arg("token"));

//     server.send(200, "application/json", "{\"status\":\"success\", \"message\":\"Credentials saved.\"}");
//     Serial.println("\n✅ Credentials Received from App! Rebooting in 2s...");
//     delay(2000); ESP.restart(); 
//   } else { server.send(400, "application/json", "{\"status\":\"error\"}"); }
// }

// // ==========================================
// // SETUP
// // ==========================================
// void setup() {
//   WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); 
//   Serial.begin(115200);
//   pinMode(BUTTON_PIN, INPUT_PULLUP);

//   preferences.begin("recallcast", false);
//   savedSSID = preferences.getString("ssid", "");
//   savedPassword = preferences.getString("password", "");
//   savedToken = preferences.getString("token", "");

//   if (savedSSID == "" || savedToken == "") {
//     isSetupMode = true;
//     Serial.println("\n🛠️ Starting SoftAP Setup Mode...");
//     WiFi.softAP("RecallCast_Setup"); 
//     server.on("/provision", HTTP_POST, handleProvision);
//     server.begin();
//     Serial.println("📡 Broadcast running! IP: 192.168.4.1");
//   } else {
//     isSetupMode = false;
//     Serial.println("\n🌐 Connecting to WiFi: " + savedSSID);
//     WiFi.begin(savedSSID.c_str(), savedPassword.c_str());
//     int retries = 0;
//     while (WiFi.status() != WL_CONNECTED && retries < 30) { delay(500); Serial.print("."); retries++; }

//     if (WiFi.status() == WL_CONNECTED) {
//       Serial.println("\n✅ WiFi Connected!");
//       startCamera();
//       initMicrophone(); 
//     } else {
//       Serial.println("\n❌ WiFi Failed. Hold button 5s to reset.");
//     }
//   }
// }

// unsigned long lastPhotoTime = 0;

// void loop() {
//   int buttonState = digitalRead(BUTTON_PIN);
  
//   if (buttonState == LOW && lastButtonState == HIGH) {
//     buttonPressTime = millis();
//     isButtonPressed = true;
//   } 
//   else if (buttonState == HIGH && lastButtonState == LOW && isButtonPressed) {
//     isButtonPressed = false;
//     unsigned long pressDuration = millis() - buttonPressTime;
    
//     if (pressDuration >= 5000) {
//       Serial.println("\n🚨 FACTORY RESET! Wiping memory...");
//       preferences.clear();
//       delay(1000); ESP.restart();
//     } else if (pressDuration > 50 && pressDuration < 1000 && !isSetupMode) {
//       recordAndSendAudio(); // Tap to Wake!
//     }
//   }
//   lastButtonState = buttonState;

//   if (isSetupMode) { server.handleClient(); return; }

//   if (WiFi.status() == WL_CONNECTED && millis() - lastPhotoTime > 3000) {
//     lastPhotoTime = millis();
//     camera_fb_t* fb = esp_camera_fb_get();
//     if (!fb) return;

//     HTTPClient http;
//     http.begin(serverBaseUrl + "/upload");
//     http.addHeader("Content-Type", "image/jpeg");
//     http.addHeader("x-glasses-token", savedToken);

//     int httpResponseCode = http.POST(fb->buf, fb->len);
//     if (httpResponseCode > 0) Serial.printf("📸 Image sent. Server: %d\n", httpResponseCode);
    
//     http.end(); esp_camera_fb_return(fb);
//   }
// }



//Wirings :-
// 🎙️ 1. The Microphone (INMP441)
// VDD ➔ 3.3V pin (Do NOT use 5V or you will fry it!)
// GND ➔ GND pin
// L/R ➔ GND pin (Crucial: This forces it into the "Left Channel" so the code can hear it).
// SCK ➔ GPIO 14 (Shared Clock)
// WS ➔ GPIO 15 (Shared Word Select)
// SD ➔ GPIO 2 (Microphone Data IN)
// 🔊 2. The Speaker Amplifier (MAX98357A)
// VIN / VCC ➔ 5V pin (5V gives the speaker the loudest volume, but 3.3V works too).
// GND ➔ GND pin
// BCLK ➔ GPIO 14 (Solder this to the exact same wire/pin as the Microphone's SCK).
// LRC ➔ GPIO 15 (Solder this to the exact same wire/pin as the Microphone's WS).
// DIN ➔ GPIO 12 (Speaker Data OUT from the ESP32).
// 🔘 3. The Push Button (Tap to Wake / Hold to Reset)
// Button Leg 1 ➔ GPIO 13
// Button Leg 2 ➔ GND pin
// (No resistors needed! The C++ code uses INPUT_PULLUP internally).