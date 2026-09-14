# RecallCast Pro - Backend

Welcome to the **RecallCast Pro** backend repository. This guide will walk you through setting up the server, configuring your ESP32-CAM hardware, and connecting the client applications.

## 🚀 Getting Started

Follow these steps to get your backend server up and running.

### 1. Install Dependencies
Once you have cloned the repository, open your terminal in the project directory and install the required Node.js packages:

```bash
npm install
npm install bcrypt node-cron form-data
```

### 2. Configure Environment Variables
Rename the provided `.env.example` file to `.env` and securely enter your API keys and URIs.

### 3. Setup File Storage
Create a directory named `uploads` in the root of the project to handle incoming files:
```bash
mkdir uploads
```

## 📸 Hardware Setup (ESP32-CAM)

To connect your ESP32-CAM to the server, follow these steps:

1. Open the provided ESP32-CAM C++ code using the Arduino IDE (or your preferred software).
2. **Update Credentials:** Enter your Wi-Fi SSID and password in the designated variables.
3. **Set Server IP:** Configure the code with the local IP address of the machine running this backend server.
4. **Optimize Code:** Remove unnecessary comments from the C++ code before flashing.
5. **Upload:** Flash the code to your ESP32-CAM board.
6. *Important Note:* After successfully uploading the code to the hardware, either delete the C++ file or comment out its contents in your VS Code workspace to avoid any conflicts.

## 💻 Running the Server

Start the backend server by executing:

```bash
node server.js
```

## 📱 Client Application Setup

You can interact with the server and the AI using either our Android application or the web dashboard.

### Option A: Web Dashboard
Simply open the `test.html` file in your preferred web browser to access the web interface.

### Option B: Android App
1. Download the latest application from the [Releases Page](https://github.com/Soham-Coder-OG/Recall_Cast/releases/tag/Recall_Cast_Android_App).
2. Install and launch the application on your Android device.
3. **Access Configuration:** Rapidly tap the "RecallCast" branding at the top of the screen 8 times after logging in or registering.
4. **Authentication:** Enter the configuration password *(Please contact the project maintainer for the password)*.
5. **Server Connection:** Enter the IP address of the machine hosting the backend server.
6. You are now fully set up and ready to interact with the AI!

---
*For any queries or issues, please reach out to the repository maintainer.*