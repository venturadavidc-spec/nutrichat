// NutriChat local proxy + static file server
// Serves the PWA files AND proxies Anthropic API calls

require('dotenv').config();
const express = require('express');
const PORT = process.env.PORT || 3000;
const cors = require('cors');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3001;

// Allow requests from any local network device (iPhone on same WiFi)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Access-Control-Request-Private-Network');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

// Serve everything in the public/ folder as static files
// This is what your phone loads when it hits your PC's IP
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Anthropic client
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'NutriChat proxy is running' });
});

// Meal analysis endpoint
app.post('/analyze', async (req, res) => {
  const { text } = req.body;

  if (!text || text.trim() === '') {
    return res.status(400).json({ error: 'No meal text provided' });
  }

  console.log(`[NutriChat] Analyzing: "${text}"`);

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: `You are NutriChat, a nutrition logging assistant for Dave — male, moderately active, Chicago suburbs.

When Dave describes food, extract macros and respond ONLY with this exact JSON (no prose, no markdown fences):
{
  "desc": "brief clean description of what was logged",
  "cal": 450,
  "pro": 32,
  "fiber": 6,
  "carb": 28,
  "fat": 18,
  "notes": "one optional short assumption note, or empty string"
}

Rules:
- Use realistic USDA-style estimates
- If multiple items, sum all macros
- desc should be concise (under 12 words)
- Round all numbers to integers
- fiber is dietary fiber in grams — always estimate it
- notes: flag any significant assumption (e.g. portion size assumed)
- If input is NOT food, respond with: {"error": "not_food", "message": "your short reply here"}`,
      messages: [{ role: 'user', content: text }],
    });

    const raw = response.content.map(b => b.text || '').join('');
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    console.log(`[NutriChat] Result: ${parsed.cal} kcal, ${parsed.pro}g protein`);
    res.json(parsed);

  } catch (err) {
    console.error('[NutriChat] Error:', err.message);
    res.status(500).json({ error: 'api_error', message: err.message });
  }
});

// Catch-all — serve index.html for any unmatched route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`NutriChat running at http://localhost:${PORT}`);
  console.log(`On your iPhone use your PC's IP — run 'ipconfig' to find it`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});