import express from 'express';
import { nehaBrain } from './core/neha-brain.js';
import { excelLogger } from './core/excel-logger.js';
import { pgLogger } from './core/pg-logger.js';

export const router = express.Router();

// 1. Get all interested candidates
router.get('/candidates', async (req, res) => {
  const candidates = pgLogger.isConnected 
    ? await pgLogger.getAllInterestedCandidates()
    : excelLogger.getAllInterestedCandidates();
    
  res.json({ success: true, count: candidates.length, candidates });
});

// 2. Download the live Excel spreadsheet (.xlsx)
router.get('/download-excel', async (req, res) => {
  if (pgLogger.isConnected) {
    const candidates = await pgLogger.getAllInterestedCandidates();
    excelLogger.syncFromDatabase(candidates);
  } else {
    excelLogger.ensureExcelFile();
  }
  
  const filePath = excelLogger.filePath;
  res.download(filePath, 'interested_candidates.xlsx', (err) => {
    if (err) {
      console.error('Error downloading file:', err);
      res.status(500).send('Error downloading Excel file');
    }
  });
});

// 3. Generate a personalized Web-Link for Candidate Outreach
router.post('/candidate-link', (req, res) => {
  const { name = 'Candidate', phone = '' } = req.body;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const callUrl = `${baseUrl}/call.html?name=${encodeURIComponent(name)}&phone=${encodeURIComponent(phone)}`;
  const whatsappText = `Hi ${name}, please take a 1-minute quick voice call with Neha from our recruitment team: ${callUrl}`;
  const whatsappUrl = `https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(whatsappText)}`;

  res.json({ success: true, name, phone, callUrl, whatsappUrl });
});

// 4. API to trigger automated test evaluation
router.post('/simulate-call', async (req, res) => {
  const { name = 'Simulated Candidate', phone = '+919876543210', userSpeech = 'Yes, I am actively looking for a job' } = req.body;
  const sessionId = `sim-${Date.now()}`;
  nehaBrain.createSession(sessionId, { name, phone });

  const greeting = await nehaBrain.getInitialGreeting(sessionId);
  const turnResult = await nehaBrain.processCandidateTurn(sessionId, userSpeech);

  res.json({
    success: true,
    greeting: greeting.text,
    userSpeech,
    reply: turnResult.replyText,
    intent: turnResult.intent,
    savedToExcel: turnResult.savedToExcel
  });
});

// 5. Get all Flick Studio Dubai Leads from In-RAM PGlite
router.get('/flick-leads', async (req, res) => {
  const leads = await pgLogger.getAllFlickLeads();
  res.json({ success: true, count: leads.length, leads });
});

// 6. Record a Flick Studio Dubai Lead into In-RAM PGlite
router.post('/flick-leads', async (req, res) => {
  const { domain, ownerName, phone, status = 'QUALIFIED_INTERESTED', responseText = '', notes = '' } = req.body;
  const saved = await pgLogger.saveFlickLead(domain, ownerName, phone, status, responseText, notes);
  res.json({ success: true, lead: saved });
});
