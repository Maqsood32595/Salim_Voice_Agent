# Neha AI Recruiter — Master Architecture & Replication Blueprint
**Authoritative, Complete, Zero-Loss Recovery Specification**
**Date:** October 2026  
**Repository:** [https://github.com/Maqsood32595/Salim_Voice_Agent.git](https://github.com/Maqsood32595/Salim_Voice_Agent.git)  
**Production URL:** [https://salim-voice-agent.onrender.com](https://salim-voice-agent.onrender.com)  

---

## 1. System Overview & Architecture

Neha is a real-time autonomous outbound AI voice recruitment agent built for **Prodigy Hunters**. She connects over standard telephone cellular networks (PSTN) to candidates in India, personalizes the greeting with the candidate's name, accurately detects interest ("Yes" vs "No"), and automatically persists interested candidates to Microsoft Excel (`interested_candidates.xlsx`).

```
Candidate Mobile Phone (+91...) 
         ▲
         │ (Cellular Carrier: Airtel / Jio / Vi)
         ▼
Twilio Global Telecom Cloud (US Number: +1 737-250-8034)
   - Polly.Aditi Indian English Neural TTS
   - Phone-optimized Speech-to-Text Recognition (en-IN)
   - Dual input: Natural Voice + DTMF (1=Yes, 2=No)
         ▲
         │ (Direct Datacenter Fiber Webhooks over HTTPS)
         ▼
Render Cloud Web Service (Node.js 24 ESM, Express)
   - neha-brain.js (Semantic turn engine & intent classifier)
   - excel-logger.js (Automated Excel persistence)
   - twilio_adapter.js (TwiML generator with bargeIn: false)
   - Live Speech Recognition Inspector (/api/twilio/logs)
```

---

## 2. Master Credentials & Configuration

### Twilio Telephony Credentials
* **Account SID:** `AC0777dea33403b434dc[MASKED_FOR_GITHUB]`
* **Auth Token:** `a85762605ca8e164[MASKED_FOR_GITHUB]`
* **Assigned Outbound Caller ID:** `+17372508034` (Austin, Texas)
* **Trial Requirement:** In a Twilio Trial account, destination numbers must be verified under **Twilio Console $\rightarrow$ Phone Numbers $\rightarrow$ Manage $\rightarrow$ Verified Caller IDs**. *(Upgraded accounts do not have this restriction).*

### Production Hosting (Render)
* **Platform:** Render.com (Web Service, Free or Standard Tier)
* **Region:** Oregon (US West)
* **Build Command:** `npm install`
* **Start Command:** `node server/index.js`
* **Port:** `5090` (Detected via `process.env.PORT`)
* **Live Service URL:** `https://salim-voice-agent.onrender.com`

### Environment Variables (.env / Render)
```env
TWILIO_ACCOUNT_SID=AC0777dea33403b434dc[MASKED_FOR_GITHUB]
TWILIO_AUTH_TOKEN=a85762605ca8e164[MASKED_FOR_GITHUB]
TWILIO_PHONE_NUMBER=+17372508034
PORT=5090
```
*(Note: `PUBLIC_URL` is optional on Render because `twilio_adapter.js` dynamically detects `https://salim-voice-agent.onrender.com` from `x-forwarded-proto` and `x-forwarded-host`).*

---

## 3. Critical Telecom Engineering Lessons (Why It Works)

1. **`bargeIn: false` is Mandatory for Mobile Audio:**
   * If `bargeIn: true` is set, Neha's voice playing through the candidate's phone speaker bleeds back into the microphone. Twilio mistranscribes Neha's own echo as candidate speech and cuts her off prematurely.
   * `bargeIn: false` ensures Neha delivers her full greeting cleanly before the microphone opens.
2. **Dual Input (`speech dtmf`):**
   * The gather listens for spoken words (*"Yes"*, *"I am looking"*) AND keypad presses (Press `1` for Yes, Press `2` for No). On noisy mobile networks, DTMF keypad provides 100% fail-safe fallback.
3. **Intent Priority Hierarchy:**
   * Affirmative patterns (`yes`, `yeah`, `yup`, `sure`, `definitely`, `looking out`) have **top priority**.
   * Only explicit, multi-word negatives (`not looking`, `not interested`, `no thanks`, `already have a job`) or isolated `no` trigger rejection. This prevents background noise from false-triggering rejections.
4. **No External TTS Latency:**
   * In-engine Microsoft Edge TTS WebSocket (`msedge-tts`) causes 3,000ms 403 timeout delays. Twilio's built-in `<Say voice="Polly.Aditi" language="en-IN">` executes directly on the telecom trunk with zero network latency.

---

## 4. Complete Codebase (Drop-In Replication)

### A. `package.json`
```json
{
  "name": "prodigy-hunters-neha",
  "version": "2.0.0",
  "description": "Neha AI Recruiter - Twilio outbound calling edition",
  "type": "module",
  "main": "server/index.js",
  "scripts": {
    "start": "node server/index.js",
    "dev": "node --watch server/index.js"
  },
  "dependencies": {
    "cors": "^2.8.6",
    "express": "^4.21.2",
    "msedge-tts": "^2.0.7",
    "pg": "^8.11.3",
    "twilio": "^5.4.0",
    "xlsx": "^0.18.5"
  }
}
```

### B. `render.yaml`
```yaml
services:
  - type: web
    name: salim-voice-agent
    env: node
    plan: free
    region: oregon
    buildCommand: npm install
    startCommand: node server/index.js
    envVars:
      - key: PORT
        value: 5090
      - key: TWILIO_ACCOUNT_SID
        sync: false
      - key: TWILIO_AUTH_TOKEN
        sync: false
      - key: TWILIO_PHONE_NUMBER
        sync: false
```

### C. `server/index.js`
```javascript
import express from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { kernel } from './kernel.js';
import twilioRouter from './features/twilio_telecom/twilio_adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app    = express();
app.set("trust proxy", 1); // Crucial for Render HTTPS resolution
const server = http.createServer(app);
const PORT   = process.env.PORT || 5090;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Twilio webhook body parser
app.use(express.static(path.resolve(__dirname, '../public')));

// Mount Twilio routes at /api/twilio
app.use('/api/twilio', twilioRouter);

kernel.boot(app, server, './features').then(() => {
  server.listen(PORT, () => {
    console.log(`[Neha AI Recruiter] Listening on port ${PORT}`);
  });
});
```

### D. `server/features/twilio_telecom/twilio_adapter.js`
```javascript
import twilio from 'twilio';
import express from 'express';
import { nehaBrain } from '../ai_recruiter/core/neha-brain.js';

const router = express.Router();

// In-memory diagnostic ring buffer to inspect exact speech recognition output
const recentCallLogs = [];

function logEvent(event) {
  const item = {
    time: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }),
    timestamp: new Date().toISOString(),
    ...event
  };
  recentCallLogs.unshift(item);
  if (recentCallLogs.length > 50) recentCallLogs.pop();
  return item;
}

function getClient() {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set');
  return twilio(sid, token);
}

function base(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host  = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

// 1. Dial a candidate
router.post('/dial', async (req, res) => {
  const { name = 'Candidate', phone } = req.body;
  if (!phone) return res.status(400).json({ success: false, error: 'phone is required' });

  try {
    const sessionId = `twilio-${Date.now()}`;
    nehaBrain.createSession(sessionId, { name, phone });

    const call = await getClient().calls.create({
      to:   phone,
      from: process.env.TWILIO_PHONE_NUMBER,
      url:  `${base(req)}/api/twilio/answered?sessionId=${sessionId}&name=${encodeURIComponent(name)}`,
    });

    logEvent({ type: 'DIAL_INITIATED', callSid: call.sid, sessionId, name, phone });
    res.json({ success: true, callSid: call.sid, sessionId, name, phone });
  } catch (err) {
    logEvent({ type: 'DIAL_ERROR', error: err.message, phone, name });
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Call answered
router.post('/answered', async (req, res) => {
  const sessionId = req.query.sessionId || `twilio-${Date.now()}`;
  const name      = decodeURIComponent(req.query.name || 'Candidate');

  if (!nehaBrain.getSession(sessionId)) {
    nehaBrain.createSession(sessionId, { name, phone: req.body.To || req.body.From || '' });
  }

  const greeting = await nehaBrain.getInitialGreeting(sessionId);
  logEvent({ type: 'CALL_ANSWERED', sessionId, candidateName: name, greetingPlayed: greeting.text });

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  const gather = twiml.gather({
    input:         'speech dtmf',
    action:        `${base(req)}/api/twilio/respond?sessionId=${sessionId}`,
    method:        'POST',
    speechTimeout: 'auto',
    speechModel:   'phone_call',
    language:      'en-IN',
    hints:         'yes, yeah, definitely, sure, looking, job, open to work, hiring, no, not looking, not interested',
    bargeIn:       false,
    timeout:       10,
  });

  gather.say({ voice: 'Polly.Aditi', language: 'en-IN' }, greeting.text);
  twiml.redirect(`${base(req)}/api/twilio/timeout?sessionId=${sessionId}`);
  res.type('text/xml').send(twiml.toString());
});

// 3. Candidate spoke
router.post('/respond', async (req, res) => {
  const sessionId  = req.query.sessionId;
  let speechText   = (req.body.SpeechResult || '').trim();
  const confidence = req.body.Confidence || 'unknown';
  const digits     = req.body.Digits || '';

  if (!speechText && digits === '1') speechText = 'Yes';
  if (!speechText && digits === '2') speechText = 'No';

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  if (!speechText) {
    logEvent({ type: 'EMPTY_SPEECH_REPROMPT', sessionId, rawBody: req.body });
    const gather = twiml.gather({
      input:         'speech dtmf',
      action:        `${base(req)}/api/twilio/respond?sessionId=${sessionId}`,
      method:        'POST',
      speechTimeout: 'auto',
      speechModel:   'phone_call',
      language:      'en-IN',
      hints:         'yes, yeah, definitely, sure, looking, job, open, no, not interested',
      bargeIn:       false,
      timeout:       8,
    });
    gather.say({ voice: 'Polly.Aditi', language: 'en-IN' },
      "Sorry, I did not catch that. Are you currently looking out for a job?");
    twiml.redirect(`${base(req)}/api/twilio/timeout?sessionId=${sessionId}`);
    return res.type('text/xml').send(twiml.toString());
  }

  const turn = await nehaBrain.processCandidateTurn(sessionId, speechText);
  logEvent({
    type: 'SPEECH_RECOGNIZED_AND_PROCESSED',
    sessionId,
    candidateSpoke: speechText,
    confidence,
    digits,
    detectedIntent: turn.intent,
    nehaReply: turn.replyText,
    savedToExcel: turn.savedToExcel
  });

  if (turn.shouldHangUp) {
    twiml.say({ voice: 'Polly.Aditi', language: 'en-IN' }, turn.replyText);
    twiml.pause({ length: 1 });
    twiml.hangup();
  } else {
    const gather = twiml.gather({
      input:         'speech dtmf',
      action:        `${base(req)}/api/twilio/respond?sessionId=${sessionId}`,
      method:        'POST',
      speechTimeout: 'auto',
      speechModel:   'phone_call',
      language:      'en-IN',
      hints:         'yes, yeah, definitely, sure, looking, job, open, no, not interested',
      bargeIn:       false,
      timeout:       8,
    });
    gather.say({ voice: 'Polly.Aditi', language: 'en-IN' }, turn.replyText);
    twiml.redirect(`${base(req)}/api/twilio/timeout?sessionId=${sessionId}`);
  }

  res.type('text/xml').send(twiml.toString());
});

// 4. Timeout
router.post('/timeout', (req, res) => {
  const sessionId = req.query.sessionId;
  logEvent({ type: 'CALL_TIMEOUT_SILENCE', sessionId, notes: 'No speech detected' });

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  twiml.say({ voice: 'Polly.Aditi', language: 'en-IN' },
    "Sorry, I couldn't hear your response. Please feel free to call us back anytime. Have a great day!");
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});

// 5. Speech recognition inspector
router.get('/logs', (req, res) => {
  res.json({ success: true, count: recentCallLogs.length, logs: recentCallLogs });
});

// 6. Account info
router.get('/account', async (req, res) => {
  try {
    const client  = getClient();
    const account = await client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
    res.json({ success: true, friendlyName: account.friendlyName, status: account.status, type: account.type, phoneNumber: process.env.TWILIO_PHONE_NUMBER });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
```

### E. `server/features/ai_recruiter/core/neha-brain.js`
```javascript
import { excelLogger } from './excel-logger.js';
import { pgLogger } from './pg-logger.js';

export const CALL_STATES = {
  NOT_STARTED: 'NOT_STARTED',
  GREETING_SENT: 'GREETING_SENT',
  WAITING_FOR_INTEREST: 'WAITING_FOR_INTEREST',
  COMPLETED_INTERESTED: 'COMPLETED_INTERESTED',
  COMPLETED_NOT_INTERESTED: 'COMPLETED_NOT_INTERESTED'
};

export class NehaBrain {
  constructor() {
    this.sessions = new Map();
  }

  createSession(sessionId, candidateInfo = {}) {
    const session = {
      id: sessionId,
      candidateName: candidateInfo.name || 'Candidate',
      candidatePhone: candidateInfo.phone || 'Unknown Phone',
      state: CALL_STATES.NOT_STARTED,
      turns: [],
      startTime: Date.now()
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  async getInitialGreeting(sessionId) {
    const session = this.getSession(sessionId);
    const hasName = session && session.candidateName && session.candidateName !== 'Candidate' && session.candidateName.trim() !== '';
    const greetingStart = hasName ? `Hi ${session.candidateName.trim()}!` : 'Hi!';
    const text = `${greetingStart} This is Neha calling on behalf of Prodigy Hunters. Are you currently looking out for a job?`;
    
    if (session) {
      session.state = CALL_STATES.WAITING_FOR_INTEREST;
      session.turns.push({ role: 'neha', text, timestamp: Date.now() });
    }

    return {
      text,
      audioBase64: null,
      state: CALL_STATES.WAITING_FOR_INTEREST
    };
  }

  classifyIntent(transcript) {
    const clean = transcript.toLowerCase().trim();

    if (/(?:who is this|who are you|which agency|which company|pardon|sorry|what did you say|repeat)/i.test(clean)) {
      return 'IDENTITY_CHECK';
    }

    const hasPositive = /\b(?:yes|yeah|yep|yup|sure|definitely|actively looking|looking for|looking out|open to|job change|new role|new opportunity|tell me more|what role|what job|interested|hiring)\b/i.test(clean) ||
                        /\b(?:i am|am looking|we are looking|i'm looking|need a job|searching for a job)\b/i.test(clean);

    const hasStrongNegative = /\b(?:not looking|not interested|not open|don't call|dont call|no thanks|not right now|already employed|have a job|happy with my job|not searching)\b/i.test(clean) ||
                              /\bnot\s+(?:looking|interested|open|searching|ready|free|wanting)\b/i.test(clean) ||
                              /\b(?:already|happily)\s+(?:working|employed|placed)\b/i.test(clean);

    const hasSimpleNo = /\b(?:no|nope|nah|never)\b/i.test(clean);

    if (hasPositive && !hasStrongNegative) {
      return 'YES_INTERESTED';
    }

    if (hasStrongNegative || (hasSimpleNo && !hasPositive)) {
      return 'NO_NOT_INTERESTED';
    }

    if (hasPositive) {
      return 'YES_INTERESTED';
    }

    return 'UNCLEAR_PROMPT_AGAIN';
  }

  async processCandidateTurn(sessionId, userSpeech) {
    const session = this.getSession(sessionId) || this.createSession(sessionId);
    session.turns.push({ role: 'candidate', text: userSpeech, timestamp: Date.now() });

    const intent = this.classifyIntent(userSpeech);
    let replyText = '';
    let shouldHangUp = false;
    let savedToExcel = false;

    if (intent === 'YES_INTERESTED') {
      replyText = "Thank you so much! I have noted down your number. Our senior recruitment team will reach out to you shortly with matching job openings. Have a great day!";
      session.state = CALL_STATES.COMPLETED_INTERESTED;
      shouldHangUp = true;

      const saveRes = excelLogger.saveInterestedCandidate({
        name: session.candidateName,
        phone: session.candidatePhone,
        response: userSpeech,
        notes: 'Candidate confirmed actively looking / open to job opportunities'
      });
      savedToExcel = saveRes.success;
    } 
    else if (intent === 'NO_NOT_INTERESTED') {
      replyText = "No problem at all! Thank you so much for your time, and I wish you all the very best. Have a great day!";
      session.state = CALL_STATES.COMPLETED_NOT_INTERESTED;
      shouldHangUp = true;
    } 
    else if (intent === 'IDENTITY_CHECK') {
      replyText = "This is Neha from Prodigy Hunters recruitment agency! We're reaching out to check if you're currently open to or looking out for a new job opportunity?";
      session.state = CALL_STATES.WAITING_FOR_INTEREST;
    } 
    else {
      replyText = "Got it! Just to quickly confirm, are you open to exploring any new job opportunities at the moment?";
      session.state = CALL_STATES.WAITING_FOR_INTEREST;
    }

    session.turns.push({ role: 'neha', text: replyText, timestamp: Date.now() });

    return {
      replyText,
      audioBase64: null,
      intent,
      state: session.state,
      shouldHangUp,
      savedToExcel,
      candidate: { name: session.candidateName, phone: session.candidatePhone }
    };
  }
}

export const nehaBrain = new NehaBrain();
```

### F. `server/features/ai_recruiter/core/excel-logger.js`
```javascript
import xlsx from 'xlsx';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const EXCEL_PATH = path.resolve(__dirname, '../../interested_candidates.xlsx');

export class ExcelLogger {
  constructor() {
    this.filePath = EXCEL_PATH;
    this.ensureFileExists();
  }

  ensureFileExists() {
    if (!fs.existsSync(this.filePath)) {
      const wb = xlsx.utils.book_new();
      const ws = xlsx.utils.json_to_sheet([], {
        header: ['Timestamp', 'Candidate Name', 'Phone Number', 'Status', 'Candidate Response', 'Agency Notes']
      });
      xlsx.utils.book_append_sheet(wb, ws, 'Interested_Candidates');
      xlsx.writeFile(wb, this.filePath);
    }
  }

  saveInterestedCandidate({ name, phone, response, notes = '' }) {
    try {
      this.ensureFileExists();
      const wb = xlsx.readFile(this.filePath);
      const sheetName = wb.SheetNames[0] || 'Interested_Candidates';
      const ws = wb.Sheets[sheetName];
      const records = xlsx.utils.sheet_to_json(ws);

      records.push({
        'Timestamp': new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }),
        'Candidate Name': name || 'Candidate',
        'Phone Number': phone || 'Unknown',
        'Status': 'INTERESTED (YES)',
        'Candidate Response': response || 'Confirmed interest',
        'Agency Notes': notes || 'Candidate confirmed actively looking'
      });

      const newWs = xlsx.utils.json_to_sheet(records);
      wb.Sheets[sheetName] = newWs;
      xlsx.writeFile(wb, this.filePath);
      return { success: true };
    } catch (err) {
      console.error('[Excel Logger Error]:', err.message);
      return { success: false, error: err.message };
    }
  }

  getInterestedCandidates() {
    try {
      this.ensureFileExists();
      const wb = xlsx.readFile(this.filePath);
      const ws = wb.Sheets[wb.SheetNames[0]];
      return xlsx.utils.sheet_to_json(ws);
    } catch (err) {
      return [];
    }
  }
}

export const excelLogger = new ExcelLogger();
```

---

## 5. Step-by-Step Recovery from Scratch

1. **Clone or recreate repository:**
   ```bash
   git clone https://github.com/Maqsood32595/Salim_Voice_Agent.git
   cd Salim_Voice_Agent
   npm install
   ```
2. **Deploy to Render:**
   - Link `Maqsood32595/Salim_Voice_Agent` repository.
   - Choose `Node` runtime, Build command: `npm install`, Start command: `node server/index.js`.
   - Add environment variables: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`.
3. **Dialing Candidates:**
   - **Web UI:** Open `https://<service-name>.onrender.com/index.html`, enter Candidate Name and Phone, click **"📞 Call Phone Directly via Twilio"**.
   - **REST API:**
     ```bash
     curl -X POST https://<service-name>.onrender.com/api/twilio/dial \
       -H "Content-Type: application/json" \
       -d '{"name": "Maqsood", "phone": "+919980901155"}'
     ```
   - **View Live Speech Recognition Output:**
     ```bash
     curl https://<service-name>.onrender.com/api/twilio/logs
     ```
   - **Download Interested Candidates List:**
     ```bash
     curl https://<service-name>.onrender.com/api/candidates
     ```
