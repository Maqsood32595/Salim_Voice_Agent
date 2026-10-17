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
app.set("trust proxy", 1);
const server = http.createServer(app);
const PORT   = process.env.PORT || 5090;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Needed for Twilio webhook POST bodies
app.use(express.static(path.resolve(__dirname, '../public')));

// Mount Twilio routes at /api/twilio
app.use('/api/twilio', twilioRouter);

kernel.boot(app, server, './features').then(() => {
  // Built-in feature list endpoint
  app.get('/api/features', (req, res) => {
    const features = kernel.getAllFeatures().map(f => ({
      id: f.id, name: f.name, basePath: f.basePath, loaded: f.loaded
    }));
    res.json({ count: features.length, features });
  });

  server.listen(PORT, () => {
    console.log(`\n======================================================================`);
    console.log(`[Neha AI Recruiter] Listening on http://localhost:${PORT}`);
    console.log(`   - Recruiter Dashboard : http://localhost:${PORT}/index.html`);
    console.log(`   - Candidate Call Page : http://localhost:${PORT}/call.html`);
    console.log(`   - Twilio Dial API     : POST http://localhost:${PORT}/api/twilio/dial`);
    console.log(`   - Twilio Account Info : GET  http://localhost:${PORT}/api/twilio/account`);
    console.log(`======================================================================\n`);
  });
});
