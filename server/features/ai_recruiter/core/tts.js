import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import fs from 'fs';
import path from 'path';

/**
 * Natural Neural Voice Engine for Neha
 * Powered by 100% free Microsoft Edge Neural TTS (zero API fees)
 */
export class NehaVoiceEngine {
  constructor() {
    this.voiceName = 'en-IN-NeerjaNeural'; // Natural, polite Indian English recruiter voice
    this.audioCache = new Map();
  }

  /**
   * Synthesize text to MP3 buffer using msedge-tts
   * @param {string} text 
   * @returns {Promise<Buffer>}
   */
  async synthesize(text) {
    // Check in-RAM audio cache
    if (this.audioCache.has(text)) {
      return this.audioCache.get(text);
    }

    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(this.voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      
      const { audioStream } = tts.toStream(text);
      const chunks = [];

      await new Promise((resolve, reject) => {
        audioStream.on('data', chunk => chunks.push(chunk));
        audioStream.on('end', resolve);
        audioStream.on('error', reject);
      });

      const buffer = Buffer.concat(chunks);
      this.audioCache.set(text, buffer);
      return buffer;
    } catch (err) {
      console.warn(`[TTS] Error generating voice for "${text}":`, err.message);
      return null;
    }
  }

  /**
   * Pre-warm common responses in RAM so calls have 0ms latency
   */
  async prewarm() {
    console.log('🎙️ [Neha Voice Engine] Pre-warming natural recruiter voice in RAM...');
    const commonPhrases = [
      "Hi! This is Neha calling on behalf of our job agency. Are you currently looking out for a job?",
      "Thank you so much! I have noted down your number. Our senior recruitment team will reach out to you shortly with matching job openings. Have a wonderful day ahead!",
      "No problem at all! Thank you so much for your time, and I wish you all the very best. Have a great day, goodbye!",
      "This is Neha from our recruitment agency! We're reaching out to check if you're currently open to or looking for a new job opportunity?"
    ];

    for (const phrase of commonPhrases) {
      try {
        await this.synthesize(phrase);
      } catch (e) {}
    }
    console.log(`✅ [Neha Voice Engine] Pre-warmed ${this.audioCache.size} standard voice turns in RAM.`);
  }
}

export const nehaVoice = new NehaVoiceEngine();
