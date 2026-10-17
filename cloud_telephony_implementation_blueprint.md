# Cloud Telephony Implementation Blueprint: Single-Agent Indian SaaS Setup

## Target Infrastructure & Operational Parameters
* **Agent Seat Count:** Exactly 1 active human agent.
* **Dialing Methodology:** Strict Progressive Dialing (1:1 dial-to-agent ratio).
* **Architecture:** 100% Cloud SaaS (e.g., Exotel, Zoho Voice, Ozonetel).
* **Endpoint:** WebRTC softphone running directly within a Google Chrome browser tab.
* **Agent Audio:** Wired USB noise-cancelling headset (no Bluetooth).
* **Local Network:** Office Wi-Fi router (5GHz band prioritized).
* **Billing Target:** Outbound B2C calls to domestic Indian numbers (~₹0.60 to ₹0.80/min).

---

## Section 1: Office Router & Local Endpoint Optimization

### 1.1 Router Configuration (Disable SIP ALG)
SIP Application-Level Gateway (ALG) tries to inspect and modify VoIP traffic but notoriously corrupts packet headers, causing dropped calls or one-way audio.
- [ ] Log in to the office router's admin panel (typically `192.168.1.1` or `192.168.0.1`).
- [ ] Navigate to **Advanced Settings** -> **WAN Setup** (or **NAT Forwarding** / **Security** depending on the router brand).
- [ ] Locate **SIP ALG** (sometimes labeled SIP Passthrough).
- [ ] Toggle to **DISABLE**.
- [ ] Save changes and reboot the router.

### 1.2 Network QoS (Quality of Service)
- [ ] Locate the MAC address of the agent's laptop.
- [ ] In the router's QoS settings, assign the agent's MAC address to **Highest Priority**.
- [ ] Whitelist and prioritize WebRTC UDP media port ranges (typically UDP 10000 - 20000) and STUN/TURN server IP addresses provided by your SaaS vendor to ensure zero packet loss.

### 1.3 Endpoint Optimization (Google Chrome)
- [ ] **Disable Hardware Acceleration:** Go to `Settings` > `System` > Toggle off "Use hardware acceleration when available". (Prevents UI lag during calls).
- [ ] **Persistent Microphone Access:** Go to `chrome://settings/content/microphone`, ensure your SaaS URL is added to the "Allowed" list.
- [ ] **Disable Tab Sleeping:** Go to `Settings` > `Performance` > Add the SaaS URL to "Always keep these sites active" so Chrome doesn't kill the WebSocket connection when the agent switches tabs.

---

## Section 2: Indian Telecom Compliance & Telemarketer Onboarding

### 2.1 KYC Document Checklist
To activate public outbound dialing in India and lift free-trial restrictions, cloud providers require:
- [ ] Company PAN Card.
- [ ] GSTIN Registration Certificate.
- [ ] Authorized Signatory Letter (on company letterhead authorizing the creation of the telecom account).
- [ ] Proof of Address (matching the GSTIN).
- [ ] Director/Proprietor's Aadhaar or PAN.

### 2.2 DLT Registration Process
- [ ] Register as a Principal Entity on a DLT portal (e.g., Vilpower, Jio, or BSNL).
- [ ] Pay the mandatory DLT registration fee (approx ₹5,900 INR).
- [ ] **Number Selection:** Apply for Headers. 
  - If calls are **Promotional**, you are legally required to use a `140XX` series number. 
  - If calls are **Transactional/Service-based**, you can use a standard 10-digit virtual number (ExoPhone/DID).
- [ ] Submit your approved DLT registration certificates and sender IDs to your cloud SaaS provider.

---

## Section 3: Cloud SaaS Dashboard & Progressive Campaign Setup

### 3.1 Provisioning the Agent & Number
- [ ] Create 1 User Profile in the SaaS Dashboard. Assign the "Agent" role.
- [ ] Purchase or Assign a Virtual Number. Bind this number to the agent's profile as their Outbound Caller ID.

### 3.2 Progressive Campaign Configuration
- [ ] **Upload Leads:** Prepare a CSV with exactly two columns: `Name` and `Phone_Number` (including the +91 country code). Ensure the SaaS auto-scrubs against the NDNC (National Do Not Call) registry upon upload to prevent TRAI fines.
- [ ] **Campaign Type:** Select "Progressive Dialing". Ensure the Dialing Ratio is hardcoded to exactly 1:1.
- [ ] **Wrap-Up Time Limit:** Set to **30 seconds**. The agent will have exactly 30 seconds after hanging up to type their notes. At 31 seconds, the system auto-dials the next lead.
- [ ] **Max Ring Duration:** Set to **25 seconds**. If a candidate's phone rings for 25 seconds without an answer, the system immediately cuts the call, logs "No Answer", and dials the next number.

---

## Section 4: Lead Lifecycle & Cost Tracking

### 4.1 Cost Math & Consumption Tracking
- **Target Metric:** 180 active talk-time minutes per 8-hour shift.
- **Estimated Rate:** ₹0.80/min (billed via per-second pulse).
- **Daily Math:** 180 minutes * ₹0.80 = **₹144 per day** in telecom consumption.
- [ ] Navigate to the Billing/Usage tab in the SaaS dashboard daily to monitor the "Per-Second Burn Rate". Cross-reference the exact deduction against your talk-time to catch minimum-duration padding or rounding errors from the carrier.

### 4.2 Automated Reporting
- [ ] Configure EOD (End of Day) Email Reports in the analytics dashboard to be sent to management.
- [ ] Ensure the report specifically tracks:
  - Total Answered Calls vs. Unanswered Calls (Connect Rate).
  - Average Talk Time (ATT) per call.
  - Total Daily Telephony Cost deducted from the prepaid wallet.
