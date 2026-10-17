# FreeSWITCH + AssemblyAI Local Telephony Architecture

This guide details how to set up a 100% free local FreeSWITCH PBX on WSL/Debian to dial into your Node.js Fractal Kernel. We replace Deepgram with your free AssemblyAI credits.

## Phase 1: FreeSWITCH Installation on WSL (Debian)
FreeSWITCH performs best on Debian Linux. You will install it inside Windows Subsystem for Linux (WSL).

1. Open PowerShell and run: `wsl --install -d Debian`
2. Once inside Debian, add the SignalWire keys and install FreeSWITCH:
```bash
apt-get update && apt-get install -y gnupg2 wget lsb-release
wget -O - https://files.freeswitch.org/repo/deb/debian-release/fsstretch-archive-keyring.asc | apt-key add -
echo "deb http://files.freeswitch.org/repo/deb/debian-release/ `lsb_release -sc` main" > /etc/apt/sources.list.d/freeswitch.list
apt-get update
apt-get install -y freeswitch-meta-all
```

## Phase 2: Install mod_audio_fork
This module takes the raw phone call audio and forks it to your Node.js WebSocket.

1. Clone the repository in WSL:
```bash
apt-get install freeswitch-dev
git clone https://github.com/nokeedev/mod_audio_fork.git
cd mod_audio_fork
make && make install
```
2. Enable it in FreeSWITCH by editing `/etc/freeswitch/autoload_configs/modules.conf.xml`:
```xml
<load module="mod_audio_fork"/>
```
3. Restart FreeSWITCH: `systemctl restart freeswitch`

## Phase 3: Zoiper SIP Phone Setup
You need a softphone to dial into FreeSWITCH.
1. Download Zoiper on your smartphone.
2. Ensure your smartphone is on the same Wi-Fi as your Windows PC.
3. In Zoiper, add a SIP Account:
   - **Host:** `<Your-Windows-Local-IP-Address>` (e.g., `192.168.1.50`)
   - **Extension:** `1000`
   - **Password:** `1234`

## Phase 4: FreeSWITCH Dialplan (Route to Node.js)
We tell FreeSWITCH that when you dial `9999` from Zoiper, it should answer and pipe the audio to our Node.js server.

Edit `/etc/freeswitch/dialplan/default.xml` and add this extension:
```xml
<extension name="AI_Recruiter_Bot">
  <condition field="destination_number" expression="^9999$">
    <action application="answer"/>
    <!-- Play a silent tone so the line stays open -->
    <action application="playback" data="silence_stream://2000"/> 
    <!-- Fork the audio to our Fractal Kernel -->
    <action application="uuid_audio_fork" data="ws://127.0.0.1:5090/freeswitch-stream"/>
    <action application="park"/>
  </condition>
</extension>
```

## Phase 5: The Fractal Kernel Adapter
I have written a boilerplate adapter in `server/features/freeswitch_telecom/freeswitch_adapter.js`. This script acts as the bridge.
1. It accepts the WebSocket connection from FreeSWITCH (`/freeswitch-stream`).
2. It takes the raw L16 audio and instantly streams it to **AssemblyAI** (using your $104 credits).
3. AssemblyAI returns the text.
4. The text goes to `NehaBrain`.
5. NehaBrain generates TTS audio, which is piped *back* down the WebSocket to FreeSWITCH so you hear it on Zoiper!
