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

On the server:

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

The build script rejects non-HTTPS endpoints and confirms that the production origin is present in the renderer bundle. Install the resulting arm64 DMG on both Macs. For the strongest first-call proof, use different internet connections such as home broadband and a phone hotspot.

## Build installers

```bash
npm run build
npm run package:mac
npm run package:win
npm run package:linux
```

Build each installer on its native operating system for release. macOS outputs DMGs for arm64 and x64, Windows outputs an x64 NSIS installer, and Linux outputs an x64 AppImage under `apps/desktop/release/`.

Unsigned packages are suitable for development. Public macOS distribution should set the electron-builder Apple signing/notarization environment variables (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`). Windows signing uses `CSC_LINK` and `CSC_KEY_PASSWORD`.

## Verification

Run `npm test`, `npm run typecheck`, and `npm run build`. For the required public-network acceptance test, install MusicZoom on two physical computers on different internet connections and verify video, two-way audio, all device controls, both audio modes, disconnect/reconnect behavior, and guest/host leave behavior.

Build once with `VITE_ICE_TRANSPORT_POLICY=relay` and verify the call still connects; this proves coturn is functional. Then block UDP 3478 on one client and confirm TURN/TCP fallback.

## Troubleshooting

- **Devices have blank names:** grant camera/microphone permission, then reopen Studio Setup.
- **Professional interface is absent:** confirm the device is visible and selected in the OS audio control panel and not exclusively locked by another application.
- **Music Mode still reports mono or processing:** Chromium can only request capabilities the OS driver exposes. MusicZoom reports the effective track settings rather than claiming stereo or disabled processing.
- **No remote audio:** select the desired output again. On some systems, non-default output routing requires a fresh permission grant.
- **Calls work on one network but not across networks:** check coturn logs, public-IP configuration, UDP/TCP 3478, and the full UDP relay range.
- **TURN/TLS fails:** verify the certificate hostname, mounted paths, TCP 5349, and `TURN_TLS_ENABLED` on both signaling and coturn.
- **macOS or Windows warns during install:** sign and notarize the release package; unsigned development packages trigger normal OS reputation warnings.
