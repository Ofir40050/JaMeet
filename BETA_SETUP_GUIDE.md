# JaMeet Beta Setup Guide

Welcome to the **JaMeet Beta** for low-latency, studio-quality remote audio collaboration between musicians, producers, and audio engineers.

---

## Quick Setup (5 Steps)

### 1. Install the App
- **macOS (Apple Silicon)**: Open `JaMeet-Installer.pkg` and follow the installer wizard. This installs both `JaMeet.app` and the `JaMeetRemote.driver` virtual audio driver.
- **Windows (x64)**: Run `JaMeet-0.1.0-win-x64.exe` to complete the standard desktop installer.

---

### 2. Allow Camera & Microphone Permissions
- When launching JaMeet for the first time, grant OS permission for **Microphone** and **Camera**.
- **macOS Users**: Verify permissions in **System Settings > Privacy & Security > Microphone / Camera**.

---

### 3. Select Your Audio Interface & Headphones
- **Important**: Always use **headphones** during live sessions to avoid audio feedback.
- In **Studio Setup** (or **Settings > Audio & Hardware**):
  - **Voice Input**: Choose your vocal microphone or hardware interface input channel.
  - **Music Input**: Choose your stereo instrument input or DAW routing.
  - **Monitoring Output**: Choose your headphones or audio interface output.
  - **Audio Profile**:
    - **Music Mode (Default)**: Full stereo dynamics, uncompressed transients, 256 kbps Opus, no noise gate or speech filters.
    - **Talk Mode**: Optimized for conversation with echo cancellation.

---

### 4. Create or Join a Session
- **Host**: Click **New Session**, copy the 8-character session code (or `jameet://` invite link), and send it to your collaborator.
- **Join**: Paste the 8-character code from your collaborator and click **Join Session** (sign in or continue as a guest).

---

### 5. Report Issues & Send Feedback
- If you experience audio dropouts, routing bugs, or have ideas for workflow improvements:
  - Open **Settings (⚙️) > General > Report an Issue / Send Feedback** (or click **Send Feedback** in the top-right Account menu).
  - Diagnostic details (App version, OS, platform architecture) will be pre-filled automatically.
