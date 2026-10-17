import { WebSocketServer } from 'ws';
import { nehaBrain } from './core/neha-brain.js';
import { nehaVoice } from './core/tts.js';
import { pgLogger } from './core/pg-logger.js';

export async function boot(app, server, kernel) {
  // Pre-warm neural TTS voices
  // Twilio Polly.Aditi handles voice directly
  // await nehaVoice.prewarm();

  // Connect to DB if configured (using provided SUPABASE URL)
  const dbUrl = process.env.DATABASE_URL || null;
  if (dbUrl) {
    await pgLogger.connect(dbUrl);
  }

  // Setup WebSocket on the shared HTTP Server for browser call interface
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/freeswitch-stream') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws) => {
    let activeSessionId = null;

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'START_CALL') {
          const sessionId = msg.sessionId || `session-${Date.now()}`;
          activeSessionId = sessionId;

          nehaBrain.createSession(sessionId, {
            name: msg.candidateName || 'Candidate',
            phone: msg.candidatePhone || 'Unknown Phone'
          });

          const greeting = await nehaBrain.getInitialGreeting(sessionId);
          ws.send(JSON.stringify({
            type: 'NEHA_SPEAKS',
            text: greeting.text,
            audioBase64: greeting.audioBase64,
            state: greeting.state
          }));
        }
        else if (msg.type === 'CANDIDATE_SPEECH') {
          const sessionId = msg.sessionId || activeSessionId;
          if (!sessionId) return;

          const turnResult = await nehaBrain.processCandidateTurn(sessionId, msg.text);

          ws.send(JSON.stringify({
            type: 'NEHA_SPEAKS',
            text: turnResult.replyText,
            audioBase64: turnResult.audioBase64,
            intent: turnResult.intent,
            state: turnResult.state,
            shouldHangUp: turnResult.shouldHangUp,
            savedToExcel: turnResult.savedToExcel
          }));
        }
        else if (msg.type === 'END_CALL') {
          console.log(`📞 [Call Ended] Session: ${activeSessionId}`);
        }
      } catch (err) {
        console.error('WebSocket Message Error:', err);
      }
    });
  });

  console.log('✅ [AI Recruiter] Booted successfully with WebSockets attached.');
}
