import twilio from 'twilio';
import express from 'express';
import { nehaBrain } from '../ai_recruiter/core/neha-brain.js';

const router = express.Router();

// --- Twilio Client ----------------------------------------------------------
function getClient() {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set in .env');
  return twilio(sid, token);
}

/**
 * Public webhook base - your server must be reachable by Twilio.
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

    console.log(`[Twilio] Dialling ${name} (${phone}) SID: ${call.sid}`);
    res.json({ success: true, callSid: call.sid, sessionId, name, phone });
  } catch (err) {
    console.error('[Twilio] Dial error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- 2. Call answered - play Neha greeting inside Gather (Instant Barge-In + Fast Timeout) ---
// POST /api/twilio/answered  (Twilio webhook)
router.post('/answered', async (req, res) => {
  const sessionId = req.query.sessionId || `twilio-${Date.now()}`;
  const name      = decodeURIComponent(req.query.name || 'Candidate');

  if (!nehaBrain.getSession(sessionId)) {
    nehaBrain.createSession(sessionId, { name, phone: req.body.To || '' });
  }

  const greeting = await nehaBrain.getInitialGreeting(sessionId);
  console.log(`[Neha Greeting]: "${greeting.text}"`);

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  // Nest <Say> inside <Gather> for zero-gap listening and instant response
  const gather = twiml.gather({
    input:         'speech',
    action:        `${base(req)}/api/twilio/respond?sessionId=${sessionId}`,
    method:        'POST',
    speechTimeout: '1', // Triggers 1 second after candidate stops speaking (eliminates 3s lag)
    speechModel:   'phone_call',
    language:      'en-IN',
    hints:         'yes, yeah, definitely, sure, looking, job, open, no, not looking, not interested, who is this',
    timeout:       7,
  });

  gather.say({ voice: 'Polly.Aditi', language: 'en-IN' }, greeting.text);

  // If candidate stays completely silent after 7s, redirect to polite timeout
  twiml.redirect(`${base(req)}/api/twilio/timeout?sessionId=${sessionId}`);
  res.type('text/xml').send(twiml.toString());
});

// --- 3. Candidate spoke - run NehaBrain -----------------------------------
// POST /api/twilio/respond  (Twilio webhook)
router.post('/respond', async (req, res) => {
  const sessionId  = req.query.sessionId;
  const speechText = req.body.SpeechResult || '';
  const confidence = req.body.Confidence || 'unknown';

  console.log(`[Candidate Speech]: "${speechText}" (Confidence: ${confidence})`);

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  if (!speechText.trim()) {
    console.log(`[Twilio]: Empty speech recognized, asking candidate to clarify.`);
    const gather = twiml.gather({
      input:         'speech',
      action:        `${base(req)}/api/twilio/respond?sessionId=${sessionId}`,
      method:        'POST',
      speechTimeout: '1',
      speechModel:   'phone_call',
      language:      'en-IN',
      hints:         'yes, yeah, definitely, sure, looking, job, open, no, not interested',
      timeout:       6,
    });
    gather.say({ voice: 'Polly.Aditi', language: 'en-IN' },
      "Sorry, I did not catch that. Are you currently looking out for a job?");
    twiml.redirect(`${base(req)}/api/twilio/timeout?sessionId=${sessionId}`);
    return res.type('text/xml').send(twiml.toString());
  }

  const turn = await nehaBrain.processCandidateTurn(sessionId, speechText);
  console.log(`[Neha Reply]: "${turn.replyText}" (Intent: ${turn.intent}, Saved: ${turn.savedToExcel})`);

  if (turn.shouldHangUp) {
    twiml.say({ voice: 'Polly.Aditi', language: 'en-IN' }, turn.replyText);
    twiml.pause({ length: 1 });
    twiml.hangup();
  } else {
    const gather = twiml.gather({
      input:         'speech',
      action:        `${base(req)}/api/twilio/respond?sessionId=${sessionId}`,
      method:        'POST',
      speechTimeout: '1',
      speechModel:   'phone_call',
      language:      'en-IN',
      hints:         'yes, yeah, definitely, sure, looking, job, open, no, not interested',
      timeout:       6,
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
  if (AnsweredBy === 'machine_start' || AnsweredBy === 'machine_end_beep') {
    console.log(`[Twilio] Voicemail detected for ${CallSid} - skipping.`);
  }
  console.log(`[Twilio Status] ${CallSid} -> ${CallStatus}`);
  res.sendStatus(200);
});

// --- 6. Account info (check trial limits) ---------------------------------
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
