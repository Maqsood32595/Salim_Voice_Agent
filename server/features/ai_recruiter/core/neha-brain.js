import { excelLogger } from './excel-logger.js';
import { pgLogger } from './pg-logger.js';
import { nehaVoice } from './tts.js';
import { generateRecruiterVoiceReply } from './gemini-brain.js';

export const CALL_STATES = {
  NOT_STARTED: 'NOT_STARTED',
  GREETING_SENT: 'GREETING_SENT',
  WAITING_FOR_INTEREST: 'WAITING_FOR_INTEREST',
  COMPLETED_INTERESTED: 'COMPLETED_INTERESTED',
  COMPLETED_NOT_INTERESTED: 'COMPLETED_NOT_INTERESTED'
};

/**
 * Natural Conversational Engine for Neha (Job Agency Recruiter)
 * Powered by Gemini 2.5 Flash + In-RAM Relational Engine + Fast Path Telecom Fallback
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
   * Fast-path deterministic classifier
   */
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

  /**
   * Process candidate voice utterance with Gemini 2.5 Flash + In-RAM DB
   */
  async processCandidateTurn(sessionId, userSpeech) {
    const session = this.getSession(sessionId) || this.createSession(sessionId);
    session.turns.push({ role: 'candidate', text: userSpeech, timestamp: Date.now() });

    // 1. Try Gemini 2.5 Flash Neural Conversational Brain first
    try {
      const geminiResult = await generateRecruiterVoiceReply({
        userTranscript: userSpeech,
        session,
        candidateName: session.candidateName,
        candidatePhone: session.candidatePhone
      });

      if (geminiResult && geminiResult.replyText) {
        console.log(`🧠 [Gemini Brain] Handled turn: "${geminiResult.intent}" -> "${geminiResult.replyText}"`);
        
        let savedToExcel = false;
        if (geminiResult.intent === 'YES_INTERESTED') {
          session.state = CALL_STATES.COMPLETED_INTERESTED;
          await pgLogger.saveCandidate(session.candidateName, session.candidatePhone, userSpeech);
          savedToExcel = true;
        } else if (geminiResult.intent === 'NOT_INTERESTED') {
          session.state = CALL_STATES.COMPLETED_NOT_INTERESTED;
        }

        session.turns.push({ role: 'neha', text: geminiResult.replyText, timestamp: Date.now() });

        return {
          replyText: geminiResult.replyText,
          intent: geminiResult.intent,
          state: session.state,
          shouldHangUp: geminiResult.shouldHangUp ?? false,
          savedToExcel,
          audioBase64: null
        };
      }
    } catch (err) {
      console.warn('⚠️ [Gemini Brain] Fallback to fast-path classifier:', err.message);
    }

    // 2. Fast-Path Deterministic Fallback
    const intent = this.classifyIntent(userSpeech);
    let replyText = '';
    let shouldHangUp = false;
    let savedToExcel = false;

    if (intent === 'YES_INTERESTED') {
      replyText = "Thank you so much! I have noted down your number. Our senior recruitment team will reach out to you shortly with matching job openings. Have a great day!";
      session.state = CALL_STATES.COMPLETED_INTERESTED;
      shouldHangUp = true;
      await pgLogger.saveCandidate(session.candidateName, session.candidatePhone, userSpeech);
      savedToExcel = true;
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
      replyText = "Can you please repeat your response? Are you currently looking out for a job opportunity?";
      session.state = CALL_STATES.WAITING_FOR_INTEREST;
    }

    session.turns.push({ role: 'neha', text: replyText, timestamp: Date.now() });

    return {
      replyText,
      intent,
      state: session.state,
      shouldHangUp,
      savedToExcel,
      audioBase64: null
    };
  }
}

export const nehaBrain = new NehaBrain();
