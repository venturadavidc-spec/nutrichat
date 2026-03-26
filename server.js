require('dotenv').config();
const express = require('express');
const PORT = process.env.PORT || 3000;
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Access-Control-Request-Private-Network');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'NutriChat proxy is running' });
});

// Meal analysis endpoint
app.post('/analyze', async (req, res) => {
  const { text, profile } = req.body;
  if (!text || text.trim() === '') return res.status(400).json({ error: 'No meal text provided' });

  const profileCtx = profile
    ? `Dave's profile: ${profile.weightLbs}lbs, ${profile.heightFt}ft ${profile.heightIn}in, activity level: ${profile.activityLevel}.`
    : "Dave's profile: not yet set.";

  console.log(`[NutriChat] Analyzing food: "${text}"`);

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: `You are NutriChat, a nutrition logging assistant for Dave — male, Chicago suburbs. ${profileCtx}

When Dave describes food, respond ONLY with this exact JSON (no prose, no markdown fences):
{
  "desc": "brief clean description",
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
- fiber is dietary fiber in grams
- notes: flag any significant assumption
- If input is NOT food (e.g. activity/exercise), respond with: {"error": "not_food", "message": "your short friendly reply here"}`,
      messages: [{ role: 'user', content: text }],
    });

    const raw = response.content.map(b => b.text || '').join('');
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    console.log(`[NutriChat] Food result: ${parsed.cal} kcal, ${parsed.pro}g protein`);
    res.json(parsed);
  } catch (err) {
    console.error('[NutriChat] Error:', err.message);
    res.status(500).json({ error: 'api_error', message: err.message });
  }
});

// Activity analysis endpoint
app.post('/analyze-activity', async (req, res) => {
  const { text, profile } = req.body;
  if (!text || text.trim() === '') return res.status(400).json({ error: 'No activity text provided' });

  const weightKg = profile?.weightLbs ? Math.round(profile.weightLbs * 0.453592) : 82;
  const activityLevel = profile?.activityLevel || 'Moderately Active';

  console.log(`[NutriChat] Analyzing activity: "${text}"`);

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: `You are NutriChat, a fitness logging assistant for Dave — male, Chicago suburbs. Weight: ${weightKg}kg, activity level: ${activityLevel}.

When Dave describes physical activity, estimate calories burned using MET values and his weight. Respond ONLY with this exact JSON (no prose, no markdown fences):
{
  "desc": "brief clean activity description",
  "cal": 280,
  "duration": 30,
  "met": 3.5,
  "notes": "one optional short assumption note, or empty string"
}

Rules:
- Use standard MET values (walking=3.5, jogging=7, cycling=6, strength training=5, yoga=2.5, yardwork=3.5, etc.)
- Formula: cal = MET x weightKg x (duration/60)
- duration in minutes — extract from text or assume 30 if not stated
- desc should be concise (under 10 words)
- Round cal to nearest integer
- notes: flag duration assumption if not stated
- If input is NOT an activity (e.g. food), respond with: {"error": "not_activity", "message": "your short friendly reply here"}`,
      messages: [{ role: 'user', content: text }],
    });

    const raw = response.content.map(b => b.text || '').join('');
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    console.log(`[NutriChat] Activity result: ${parsed.cal} kcal burned`);
    res.json(parsed);
  } catch (err) {
    console.error('[NutriChat] Error:', err.message);
    res.status(500).json({ error: 'api_error', message: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`NutriChat running at http://localhost:${PORT}`);
});