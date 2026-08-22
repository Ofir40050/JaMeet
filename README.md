# JaMeet

JaMeet is an installable two-person desktop calling application for remote writing, production, vocal, and instrumental sessions. It uses Electron for the desktop client, WebRTC for encrypted media, Socket.IO for signaling, and coturn for calls that cannot connect directly.

## What works

- Real two-way camera and microphone/audio-interface calls
- Start or join an ephemeral session with an eight-character code or `jameet://` link
- Talk Mode with echo cancellation, noise suppression, and automatic gain control
- Music Mode with processing disabled where supported, stereo capture preference, and 256 kbps Opus negotiation
- Independent camera, Voice Input, stereo Music Input, and audio-output selection
- Camera preview, dBFS input meter, speaker test, and recorded microphone test
- In-call mute, camera, Audio Only, performance profiles, and advanced studio-audio controls
- Independent local remote voice/music/master volume, remote mute, and fullscreen remote media
- DAW-aware screen sharing with supported system audio while the microphone remains active
- Two-person room limits, waiting state, reconnection grace period, ICE restart, STUN, and authenticated TURN

JaMeet does not provide call recording or video export. The short microphone test in Studio Setup is kept only in memory for immediate local playback and is never uploaded or saved.

Music Mode is not lossless or sample-accurate and is not a replacement for a dedicated synchronized DAW transport. OS-visible virtual devices such as BlackHole or Loopback work like any other Music Input. System-audio capture depends on the operating system; on macOS, use a virtual device when native screen capture does not provide an audio track.

## Local development

Requirements: Node.js 22 or newer and npm. Docker is optional for local TURN testing.

```bash
npm install
cp apps/server/.env.example apps/server/.env
cp apps/desktop/.env.example apps/desktop/.env
npm run dev:server
```

In another terminal:

```bash
npm run dev:desktop
```

The development TURN settings point to localhost. Direct peer-to-peer calls can work locally, but public-internet reliability requires the production deployment below.

## First public deployment

Use an Ubuntu or Debian Linux VM with Docker Engine, the Docker Compose plugin, a public IPv4 address, and at least 1 GB RAM. The provider must allow inbound TCP and UDP rather than placing the VM behind an unconfigurable carrier-grade NAT.

You need these values before deployment:

- A public IPv4 address from the cloud server dashboard.
- A domain you control and two hostnames, normally `signal.yourdomain.com` and `turn.yourdomain.com`.
- The server's primary private IPv4 if the public IP is mapped onto a private NIC. Run `ip route get 1.1.1.1` on the server and use the address following `src`. Leave it blank when the public IP is bound directly.
- SSH access to the server so this repository can be copied or cloned there.

Create DNS `A` records for both hostnames pointing directly to the public IPv4. Do not enable an HTTP proxy/CDN on the TURN hostname. Caddy requires the signaling record to resolve correctly and ports 80/443 to be public before it can obtain and renew its certificate. [Caddy automatic HTTPS requirements](https://caddyserver.com/docs/automatic-https)

Open these inbound rules in both the cloud-provider firewall and the VM firewall:

| Protocol | Port(s) | Purpose |
| --- | --- | --- |
| TCP | 22 | SSH administration; restrict to your IP where possible |
| TCP | 80, 443 | HTTPS certificate issuance, health endpoint, and WSS signaling |
| TCP and UDP | 3478 | STUN/TURN listener |
| UDP | 49160–49200 | TURN-relayed media |

For an Ubuntu server using UFW, the matching host rules are:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 49160:49200/udp
sudo ufw enable
```

Coturn uses host networking because the official coturn container recommends it for relay port ranges. [Coturn Docker networking](https://github.com/coturn/coturn/blob/master/docker/coturn/README.md)

### Production TURN Configuration

JaMeet supports two TURN relay providers:
1. **Cloudflare Realtime TURN (`TURN_PROVIDER=cloudflare`) [Recommended for Render & Managed Cloud]**:
   - Generates temporary dynamic WebRTC ICE credentials via Cloudflare Calls TURN API.
   - Required environment variables:
     - `TURN_PROVIDER=cloudflare`
     - `CLOUDFLARE_TURN_KEY_ID`: Cloudflare Calls TURN Key ID.
     - `CLOUDFLARE_TURN_API_TOKEN`: Cloudflare API Token with `Calls:Edit` permission.
     - `TURN_CREDENTIAL_TTL_SECONDS`: Temporary credential lifetime in seconds (default: `86400`, max: `172800`).

2. **Self-Hosted Coturn (`TURN_PROVIDER=self_hosted`) [Dedicated Host/VM]**:
   - Uses a dedicated Coturn instance with shared HMAC secret credentials.
   - Required environment variables:
     - `TURN_PROVIDER=self_hosted`
     - `TURN_HOST`: Public hostname or IP of the Coturn server.
     - `TURN_PORT`: STUN/TURN listener port (default: `3478`).
     - `TURN_SHARED_SECRET`: Secret key for HMAC token generation.
     - `TURN_TLS_ENABLED`: Set to `true` if TURNS/TLS is configured on port `5349`.

On a self-hosted server:

```bash
cp deploy/production.env.example .env
openssl rand -hex 32
```

Put the generated secret in `TURN_SHARED_SECRET`, fill in the DNS and IP values, and then run:

```bash
sh deploy/validate-production.sh
sh deploy/deploy-production.sh
sh deploy/verify-production.sh
```

The deploy script pulls pinned Caddy/coturn images, rebuilds signaling, starts the stack, and waits for the public HTTPS health check. Caddy terminates HTTPS and WSS automatically. Coturn supplies authenticated UDP and TCP TURN on 3478; media remains DTLS-SRTP encrypted.

For a cloud VM whose public address maps to a private NIC, set `TURN_EXTERNAL_IP` to the public address and `TURN_PRIVATE_IP` to the interface address. The entrypoint passes coturn the required public/private mapping. Leave `TURN_PRIVATE_IP` blank on a directly addressed host.

TURN-over-TLS remains optional for the first test. To enable it later, place a valid `fullchain.pem` and `privkey.pem` in `certs/`, set `TURN_TLS_ENABLED=true`, open TCP 5349, and ensure the certificate covers the TURN hostname.

After the public health and Socket.IO checks pass, build the Apple Silicon client on macOS:

```bash
PRODUCTION_SIGNALING_URL=https://signal.yourdomain.com npm run package:mac:production
```

The build script rejects non-HTTPS endpoints, confirms that the production origin is present in the renderer bundle, and produces the official signed and notarized `JaMeet-Installer.pkg` containing both `JaMeet.app` and `JaMeetRemote.driver`.

## Build installers

### macOS (Apple Silicon)

- **Official Signed & Notarized Release Package:**
  ```bash
  npm run package:mac:production
  # or: npm run package:mac
  ```
  Produces `apps/desktop/release/JaMeet-Installer.pkg` containing `JaMeet.app` (for `/Applications`) and the `JaMeetRemote.driver` virtual audio driver (for `/Library/Audio/Plug-Ins/HAL`).

  Official macOS distribution requires complete Apple Developer credentials:
  - `APPLE_SIGNING_IDENTITY` (or `DEVELOPER_ID_APPLICATION`): Developer ID Application certificate name or SHA (for `JaMeet.app` and `JaMeetRemote.driver`).
  - `APPLE_INSTALLER_IDENTITY` (or `DEVELOPER_ID_INSTALLER`): Developer ID Installer certificate name or SHA (for `JaMeet-Installer.pkg`).
  - `APPLE_ID`: Apple Developer account email address.
  - `APPLE_APP_SPECIFIC_PASSWORD` (or `APPLE_ID_PASSWORD`): App-specific password generated on appleid.apple.com.
  - `APPLE_TEAM_ID`: 10-character Apple Developer Team ID.

- **Local Unsigned Developer Preview:**
  ```bash
  npm run package:mac:preview
  ```
  Produces `apps/desktop/release/JaMeet-Preview-Unsigned.pkg` for local Apple Silicon developer testing without requiring Apple Developer certificates.

### Windows & Linux

```bash
npm run package:win
npm run package:linux
```

Windows outputs an x64 NSIS installer (`JaMeet-Setup.exe`), and Linux outputs an x64 AppImage under `apps/desktop/release/`. Windows Authenticode code signing uses `CSC_LINK` and `CSC_KEY_PASSWORD`.

## Verification

Run `npm test`, `npm run typecheck`, and `npm run build`. For the required public-network acceptance test, install JaMeet on two physical computers on different internet connections and verify video, two-way audio, all device controls, both audio modes, disconnect/reconnect behavior, and guest/host leave behavior.

Build once with `VITE_ICE_TRANSPORT_POLICY=relay` and verify the call still connects; this proves coturn is functional. Then block UDP 3478 on one client and confirm TURN/TCP fallback.

## Troubleshooting

- **Devices have blank names:** grant camera/microphone permission, then reopen Studio Setup.
- **Professional interface is absent:** confirm the device is visible and selected in the OS audio control panel and not exclusively locked by another application.
- **Music Mode still reports mono or processing:** Chromium can only request capabilities the OS driver exposes. JaMeet reports the effective track settings rather than claiming stereo or disabled processing.
- **No remote audio:** select the desired output again. On some systems, non-default output routing requires a fresh permission grant.
- **Calls work on one network but not across networks:** check coturn logs, public-IP configuration, UDP/TCP 3478, and the full UDP relay range.
- **TURN/TLS fails:** verify the certificate hostname, mounted paths, TCP 5349, and `TURN_TLS_ENABLED` on both signaling and coturn.
- **macOS or Windows warns during install:** sign and notarize the release package; unsigned development packages trigger normal OS reputation warnings.
