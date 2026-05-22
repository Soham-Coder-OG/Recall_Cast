// #include "esp_camera.h"
// #include <WiFi.h>
// #include <HTTPClient.h>
// #include <WebServer.h>
// #include <Preferences.h>
// #include <driver/i2s_std.h>    // ✨ NEW: Modern Core 3.0 I2S Library
// #include <ArduinoJson.h>
// #include <Audio.h>             // Streaming Speaker Library
// #include "soc/soc.h"           
// #include "soc/rtc_cntl_reg.h"  

// // ==========================================
// // CONFIGURATION
// // ==========================================
// String serverBaseUrl = "https://recall-cast-backend-server.onrender.com"; // Your Cloud Backend

// const int BUTTON_PIN = 13; 

// // I2S Shared Audio Pins
// const int I2S_SCK = 14;  // BCLK (Shared by Mic & Speaker)
// const int I2S_WS = 15;   // LRC  (Shared by Mic & Speaker)
// const int I2S_SD = 2;    // DIN  (Microphone Data IN)
// const int I2S_DOUT = 12; // DOUT (Speaker Data OUT)

// Preferences preferences;
// WebServer server(80);
// Audio audio; // Speaker Object

// i2s_chan_handle_t rx_handle = NULL; // ✨ NEW: Core 3.0 I2S Handle

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
//   config.jpeg_quality = 15; 
//   config.fb_count = 1;

//   esp_camera_init(&config);
//   sensor_t * s = esp_camera_sensor_get();
//   if (s != NULL) {
//     s->set_vflip(s, 1);   
//     s->set_hmirror(s, 1); 
//   }
// }

// // ==========================================
// // MICROPHONE I2S CONFIG (CORE 3.0 READY)
// // ==========================================
// void initMicrophone() {
//   // 1. Create a new RX channel (✨ FIXED: Force I2S_NUM_1 because Camera uses I2S_NUM_0)
//   i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_1, I2S_ROLE_MASTER);
//   i2s_new_channel(&chan_cfg, NULL, &rx_handle);

//   // 2. Configure Standard Philips Mode
//   i2s_std_config_t std_cfg = {
//     .clk_cfg  = I2S_STD_CLK_DEFAULT_CONFIG(sampleRate),
//     .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
//     .gpio_cfg = {
//         .mclk = I2S_GPIO_UNUSED,
//         .bclk = (gpio_num_t)I2S_SCK,
//         .ws   = (gpio_num_t)I2S_WS,
//         .dout = I2S_GPIO_UNUSED,
//         .din  = (gpio_num_t)I2S_SD,
//         .invert_flags = {
//             .mclk_inv = false,
//             .bclk_inv = false,
//             .ws_inv   = false,
//         },
//     },
//   };
  
//   // 3. Read only the left channel for a mono microphone
//   std_cfg.slot_cfg.slot_mask = I2S_STD_SLOT_LEFT;

//   // 4. Initialize and Enable the microphone
//   i2s_channel_init_std_mode(rx_handle, &std_cfg);
//   i2s_channel_enable(rx_handle);
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
// // VOICE PROCESSING (Record -> Edge TTS Speech)
// // ==========================================
// void recordAndSendAudio() {
//   Serial.println("\n🎙️ Listening (4 seconds)...");
//   int totalWavSize = headerSize + audioSize;
//   byte* wavData = (byte*) ps_malloc(totalWavSize);
//   if (wavData == NULL) { Serial.println("❌ Failed to allocate PSRAM"); return; }

//   generateWavHeader(wavData, totalWavSize);
  
//   // ✨ NEW: Read data using Core 3.0 API
//   size_t bytesRead = 0;
//   i2s_channel_read(rx_handle, wavData + headerSize, audioSize, &bytesRead, portMAX_DELAY);
  
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
//     JsonDocument doc; 
//     deserializeJson(doc, responseBody);
    
//     // ✅ FIX: Read the text answer directly, no audioUrl needed!
//     const char* aiAnswer = doc["answer"];
    
//     Serial.printf("🤖 AI Answer: %s\n", aiAnswer);

//     // 1. Turn off and delete Microphone driver completely
//     i2s_channel_disable(rx_handle);
//     i2s_del_channel(rx_handle);

//     // 2. Turn on Speaker driver & pinout
//     audio.setPinout(I2S_SCK, I2S_WS, I2S_DOUT);
//     audio.setVolume(100); 

//     // 3. Play the stream using ESP32's built-in Edge Text-to-Speech
//     Serial.println("🔊 Speaking...");
//     audio.connecttospeech(aiAnswer, "en"); // 🚀 FIXED

//     while(audio.isRunning()) {
//       audio.loop();
//     }
//     Serial.println("🤫 Finished speaking.");

//     // 4. Force Speaker library to release the shared pins
//     audio.stopSong(); 
//     audio.setPinout(-1, -1, -1); 
//     delay(10); 

//     // 5. Turn Microphone driver back on for next time
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
//     Serial.println("\n✅ Credentials Received! Rebooting in 2s...");
//     delay(2000); ESP.restart(); 
//   } else { server.send(400, "application/json", "{\"status\":\"error\"}"); }
// }

// // ==========================================
// // SETUP
// // ==========================================
// void setup() {
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
    
//     Serial.printf("🔘 Button released after %lu ms\n", pressDuration);
    
//     if (pressDuration >= 5000) {
//       Serial.println("\n🚨 FACTORY RESET! Wiping memory...");
//       preferences.clear();
//       delay(1000); ESP.restart();
//     } 
//     else if (pressDuration > 50 && !isSetupMode) {
//       recordAndSendAudio(); 
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