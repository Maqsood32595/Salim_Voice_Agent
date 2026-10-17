import { excelLogger } from './excel-logger.js';
import { pgLogger } from './pg-logger.js';
import { nehaVoice } from './tts.js';

export const CALL_STATES = {
  NOT_STARTED: 'NOT_STARTED',
  GREETING_SENT: 'GREETING_SENT',
  WAITING_FOR_INTEREST: 'WAITING_FOR_INTEREST',
  COMPLETED_INTERESTED: 'COMPLETED_INTERESTED',
  COMPLETED_NOT_INTERESTED: 'COMPLETED_NOT_INTERESTED'
};

/**
 * Natural Conversational Engine for Neha (Job Agency Recruiter)
 * Delivers natural turn-taking, semantic intent detection, and automated Excel persistence.
 */
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

  /**
   * Generates Neha's natural opening line
   */
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

  /**
   * Classify candidate response naturally into: YES (Interested), NO (Not interested), WHO_IS_THIS, or UNCLEAR
   */
  classifyIntent(transcript) {
    const clean = transcript.toLowerCase().trim();

    // 1. Identity / Confusion checks
    if (/(?:who is this|who are you|which agency|which company|pardon|sorry|what did you say|repeat)/i.test(clean)) {
      return 'IDENTITY_CHECK';
    }

    // 2. Explicit positive affirmations
    const hasPositive = /\b(?:yes|yeah|yep|yup|sure|definitely|actively looking|looking for|looking out|open to|job change|new role|new opportunity|tell me more|what role|what job|interested|hiring)\b/i.test(clean) ||
                        /\b(?:i am|am looking|we are looking|i'm looking|need a job|searching for a job)\b/i.test(clean);

    // 3. Multi-word explicit negative patterns
    const hasStrongNegative = /\b(?:not looking|not interested|not open|don't call|dont call|no thanks|not right now|already employed|have a job|happy with my job|not searching)\b/i.test(clean) ||
                              /\bnot\s+(?:looking|interested|open|searching|ready|free|wanting)\b/i.test(clean) ||
                              /\b(?:already|happily)\s+(?:working|employed|placed)\b/i.test(clean);

    // 4. Standalone negative words
    const hasSimpleNo = /\b(?:no|nope|nah|never)\b/i.test(clean);

    // Positive takes priority when combined with standalone 'no' (e.g. echo 'yes or no' or 'yes no problem')
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

  /**
   * Process candidate voice utterance
   */
  async processCandidateTurn(sessionId, userSpeech) {
    const session = this.getSession(sessionId) || this.createSession(sessionId);
    session.turns.push({ role: 'candidate', text: userSpeech, timestamp: Date.now() });

    const intent = this.classifyIntent(userSpeech);
    let replyText = '';
    let shouldHangUp = false;
    let savedToExcel = false;

    if (intent === 'YES_INTERESTED') {
      replyText = "Thank you so much! I have noted down your number. Our senior recruitment team will reach out to you shortly with matching job openings. Have a wonderful day ahead!";
      session.state = CALL_STATES.COMPLETED_INTERESTED;
      shouldHangUp = true;

      // Save to Database or Excel
      if (pgLogger.isConnected) {
        await pgLogger.saveCandidate(session.candidateName, session.candidatePhone, userSpeech);
        savedToExcel = true;
      } else {
        const saveRes = excelLogger.saveInterestedCandidate({
          name: session.candidateName,
          phone: session.candidatePhone,
          response: userSpeech,
          notes: 'Candidate confirmed actively looking / open to job opportunities'
        });
        savedToExcel = saveRes.success;
      }
    } 
    else if (intent === 'NO_NOT_INTERESTED') {
      replyText = "No problem at all! Thank you so much for your time, and I wish you all the very best. Have a great day, goodbye!";
      session.state = CALL_STATES.COMPLETED_NOT_INTERESTED;
      shouldHangUp = true;
      // As requested: "if it says no leave it" -> NOT saved to Excel
      console.log(`ℹ️ [Neha Brain] Candidate ${session.candidateName} (${session.candidatePhone}) said NO. Leaving it without saving.`);
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

    // Voice is natively rendered by Twilio Polly.Aditi
    const audioBuffer = null;

    return {
      replyText,
      audioBase64: audioBuffer ? audioBuffer.toString('base64') : null,
      intent,
      state: session.state,
      shouldHangUp,
      savedToExcel,
      candidate: {
        name: session.candidateName,
        phone: session.candidatePhone
      }
    };
  }
}

export const nehaBrain = new NehaBrain();
