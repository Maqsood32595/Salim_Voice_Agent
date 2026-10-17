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

// --- Twilio Client ----------------------------------------------------------
function getClient() {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set in .env');
  return twilio(sid, token);
}

/**
 * Public webhook base - intelligently detects Render HTTPS URL.
 */
function base(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host  = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

// --- 1. Dial a candidate -------------------------------------------------
// POST /api/twilio/dial  { name, phone }
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

    logEvent({
      type: 'DIAL_INITIATED',
      callSid: call.sid,
      sessionId,
      name,
      phone
    });

    console.log(`[Twilio] Dialling ${name} (${phone}) SID: ${call.sid}`);
    res.json({ success: true, callSid: call.sid, sessionId, name, phone });
  } catch (err) {
    console.error('[Twilio] Dial error:', err.message);
    logEvent({ type: 'DIAL_ERROR', error: err.message, phone, name });
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- 2. Call answered - play Neha greeting inside Gather -----------------
// POST /api/twilio/answered  (Twilio webhook)
router.post('/answered', async (req, res) => {
  const sessionId = req.query.sessionId || `twilio-${Date.now()}`;
  const name      = decodeURIComponent(req.query.name || 'Candidate');

  if (!nehaBrain.getSession(sessionId)) {
    nehaBrain.createSession(sessionId, { name, phone: req.body.To || req.body.From || '' });
  }

  const greeting = await nehaBrain.getInitialGreeting(sessionId);
  console.log(`[Neha Greeting]: "${greeting.text}"`);

  logEvent({
    type: 'CALL_ANSWERED',
    sessionId,
    candidateName: name,
    greetingPlayed: greeting.text
  });

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  // bargeIn: false ensures speakerphone audio does NOT cut off Neha mid-sentence
  const gather = twiml.gather({
    input:         'speech dtmf', // Accepts voice OR pressing 1 (Yes) / 2 (No)
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

  // If candidate stays completely silent after 10s, redirect to polite timeout
  twiml.redirect(`${base(req)}/api/twilio/timeout?sessionId=${sessionId}`);
  res.type('text/xml').send(twiml.toString());
});

// --- 3. Candidate spoke - run NehaBrain -----------------------------------
// POST /api/twilio/respond  (Twilio webhook)
router.post('/respond', async (req, res) => {
  const sessionId  = req.query.sessionId;
  let speechText = (req.body.SpeechResult || '').trim();
  const confidence = req.body.Confidence || 'unknown';
  const digits     = req.body.Digits || '';

  // Support DTMF keypad: 1 = Yes, 2 = No
  if (!speechText && digits === '1') speechText = 'Yes';
  if (!speechText && digits === '2') speechText = 'No';

  console.log(`[Candidate Speech]: "${speechText}" (Confidence: ${confidence}, Digits: "${digits}")`);

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  if (!speechText) {
    console.log(`[Twilio]: Empty speech recognized, asking candidate to clarify.`);
    logEvent({
      type: 'EMPTY_SPEECH_REPROMPT',
      sessionId,
      rawBody: req.body
    });

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
  console.log(`[Neha Reply]: "${turn.replyText}" (Intent: ${turn.intent}, Saved: ${turn.savedToExcel})`);

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

// --- 4. Silence timeout ---------------------------------------------------
router.post('/timeout', (req, res) => {
  const sessionId = req.query.sessionId;
  console.log(`[Twilio Timeout]: Silence timeout for session ${sessionId}. Playing polite goodbye.`);

  logEvent({
    type: 'CALL_TIMEOUT_SILENCE',
    sessionId,
    notes: 'No speech was detected before timeout'
  });

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  twiml.say({ voice: 'Polly.Aditi', language: 'en-IN' },
    "Sorry, I couldn't hear your response. Please feel free to call us back anytime. Have a great day, goodbye!");
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});

// --- 5. Call status updates -----------------------------------------------
router.post('/status', (req, res) => {
  const { CallSid, CallStatus, AnsweredBy } = req.body;
  logEvent({
    type: 'CALL_STATUS_UPDATE',
    callSid: CallSid,
    callStatus: CallStatus,
    answeredBy: AnsweredBy
  });
  console.log(`[Twilio Status] ${CallSid} -> ${CallStatus}`);
  res.sendStatus(200);
});

// --- 6. Live Speech Diagnostics API --------------------------------------
// GET /api/twilio/logs -> returns exact speech recognition output
router.get('/logs', (req, res) => {
  res.json({
    success: true,
    count: recentCallLogs.length,
    logs: recentCallLogs
  });
});

// --- 7. Account info ------------------------------------------------------
router.get('/account', async (req, res) => {
  try {
    const client  = getClient();
    const account = await client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
    res.json({
      success:      true,
      friendlyName: account.friendlyName,
      status:       account.status,
      type:         account.type,
      phoneNumber:  process.env.TWILIO_PHONE_NUMBER,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
