// #include "esp_camera.h"
// #include <WiFi.h>
// #include <HTTPClient.h>
// #include "soc/soc.h"           // Brownout prevention
// #include "soc/rtc_cntl_reg.h"  // Brownout prevention

// // WiFi credentials
// const char* ssid = "Barnona Das";
// const char* password = "Baren718";

// // Server endpoint (Make sure this matches your computer's IP on the hotspot!)
// const char* serverUrl = "http://10.77.228.161:3000/upload";

// // Camera config (AI Thinker ESP32-CAM)
// void startCamera() {
//   camera_config_t config;
//   config.ledc_channel = LEDC_CHANNEL_0;
//   config.ledc_timer = LEDC_TIMER_0;
//   config.pin_d0 = 5;
//   config.pin_d1 = 18;
//   config.pin_d2 = 19;
//   config.pin_d3 = 21;
//   config.pin_d4 = 36;
//   config.pin_d5 = 39;
//   config.pin_d6 = 34;
//   config.pin_d7 = 35;
//   config.pin_xclk = 0;
//   config.pin_pclk = 22;
//   config.pin_vsync = 25;
//   config.pin_href = 23;
//   config.pin_sccb_sda = 26;
//   config.pin_sccb_scl = 27;
//   config.pin_pwdn = 32;
//   config.pin_reset = -1;
//   config.xclk_freq_hz = 20000000;
//   config.pixel_format = PIXFORMAT_JPEG;

//   config.frame_size = FRAMESIZE_VGA;
//   config.jpeg_quality = 10;
//   config.fb_count = 1;

//   esp_camera_init(&config);

//   sensor_t * s = esp_camera_sensor_get();
//   if (s != NULL) {
//     s->set_vflip(s, 1);   // Flips the image vertically (upside down)
//     s->set_hmirror(s, 1); // Mirrors the image horizontally (fixes reversed text)
//   }
// }

// void setup() {
//   WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
//   Serial.begin(115200);
//   WiFi.begin(ssid, password);

//   Serial.print("Connecting to WiFi");
//   while (WiFi.status() != WL_CONNECTED) {
//     delay(500);
//     Serial.print(".");
//   }
//   Serial.println("\nWiFi Connected!");

//   startCamera();
// }

// void loop() {
//   camera_fb_t* fb = esp_camera_fb_get();

//   if (!fb) {
//     Serial.println("Camera capture failed");
//     return;
//   }

//   HTTPClient http;
//   http.begin(serverUrl);
//   http.addHeader("Content-Type", "image/jpeg");

//   // Send the image
//   int httpResponseCode = http.POST(fb->buf, fb->len);

//   if (httpResponseCode > 0) {
//     Serial.printf("Image sent successfully. Server responded: %d\n", httpResponseCode);
//   } else {
//     Serial.printf("Error sending image: %s\n", http.errorToString(httpResponseCode).c_str());
//   }

//   http.end(); 

//   // Return the frame buffer back to be reused
//   esp_camera_fb_return(fb);

//   delay(3000);  // capture every 3 seconds
// }