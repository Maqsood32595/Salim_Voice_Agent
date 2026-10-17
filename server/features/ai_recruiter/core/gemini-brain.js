const API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyCCCRkcpqXrjdewQTyMwWC4vGcGNZdZuqE';
const MODEL = 'gemini-2.5-flash';

/**
 * Gemini 2.5 Flash Neural Conversational Brain for Neha & Flick Studio
 */
export async function generateRecruiterVoiceReply({
  userTranscript,
  session,
  candidateName = 'Candidate',
  candidatePhone = '',
  customApiKey = null
}) {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY || API_KEY;
  if (!apiKey) {
    console.warn('⚠️ GEMINI_API_KEY is not set.');
    return null;
  }

  // Compile dialogue turns
  const recentTurns = (session?.turns || []).slice(-10).map(t => 
    `${t.role === 'user' ? candidateName : 'Neha (Recruiter)'}: "${t.text}"`
  ).join('\n');

  const systemInstruction = `
You are Neha, a friendly, ultra-polite, and professional HR recruiter calling from Prodigy Hunters job consultancy in India.
You are on a live phone call with ${candidateName}.

CALL CONTEXT & WORKFLOW:
1. Primary Goal: Qualify whether ${candidateName} is currently looking for a job / open to new opportunities.
2. If they say YES or show interest:
   - Acknowledge warmly.
   - Tell them our senior recruitment team will review their profile and contact them shortly via WhatsApp/Phone with matching openings.
   - End with: "Have a great day!"
3. If they say NO:
   - Politely thank them for their time.
   - End with: "Have a great day!"
4. If they ask a question (e.g. "Which company?", "What salary?", "Is it remote?"):
   - Answer briefly (e.g., "We represent leading corporate and IT clients across India offering competitive packages and flexible roles.").
   - Gently ask if they are open to receiving relevant opportunities.
5. If they ask to call back later:
   - Acknowledge and confirm we'll reach out at a convenient time.

CRITICAL VOICE TELECOM RULES:
- Keep responses extremely SHORT (1 to 2 sentences max) so it sounds natural on phone audio.
- DO NOT use bullet points, asterisks, markdown, emojis, or sound effects.
- NEVER say "goodbye". Both paths must conclude with "Have a great day!"
- NEVER say "feel free to call us back" (this is an outbound call).
`;

  const prompt = `
Dialogue History so far:
${recentTurns || 'Call just started.'}

Candidate said: "${userTranscript}"

Classify intent into one of: YES_INTERESTED, NOT_INTERESTED, QUESTION, REPEAT, or CALLBACK.
Generate your spoken response and intent classification as JSON:
{
  "intent": "YES_INTERESTED" | "NOT_INTERESTED" | "QUESTION" | "REPEAT" | "CALLBACK",
  "replyText": "your spoken 1-2 sentence response",
  "shouldHangUp": true | false
}
`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{ parts: [{ text: `${systemInstruction}\n\n${prompt}` }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.3,
        maxOutputTokens: 1000
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawContent) return null;

    const parsed = JSON.parse(rawContent.trim());
    return parsed;
  } catch (err) {
    console.error('❌ Gemini Brain Error:', err.message);
    return null;
  }
}
