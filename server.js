require('dotenv').config();
const express = require('express');
const PORT = process.env.PORT || 3000;
const path = require('path');
const https = require('https');
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

// Barcode lookup endpoint (Open Food Facts)
app.post('/lookup-barcode', async (req, res) => {
  const { barcode } = req.body;
  if (!barcode) return res.status(400).json({ found: false });

  console.log(`[NutriChat] Barcode lookup: ${barcode}`);

  const url = `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(barcode)}.json`;

  try {
    const data = await new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'NutriChat/1.0 (nutrition logging app)' } }, (r) => {
        let body = '';
        r.on('data', chunk => body += chunk);
        r.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
      }).on('error', reject);
    });

    if (data.status !== 1 || !data.product) {
      return res.json({ found: false });
    }

    const p = data.product;
    const n = p.nutriments || {};

    const pick = (key) => {
      const serving = n[key + '_serving'];
      const per100  = n[key + '_100g'];
      const val = (serving != null && serving !== '') ? serving : per100;
      return val != null ? Math.round(Number(val)) : 0;
    };

    res.json({
      found:   true,
      name:    (p.product_name || 'Unknown product').trim(),
      brand:   (p.brands || '').trim(),
      cal:     pick('energy-kcal'),
      pro:     pick('proteins'),
      carb:    pick('carbohydrates'),
      fat:     pick('fat'),
      fiber:   pick('fiber'),
      serving: (p.serving_size || '').trim(),
    });
  } catch (err) {
    console.error('[NutriChat] Barcode lookup error:', err.message);
    res.status(500).json({ found: false });
  }
});

app.post('/analyze-drinks', async (req, res) => {
  const { text, sessionStartTs } = req.body;
  const now = new Date();
  const nowStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const prompt = `You are a drink logging parser for a BAC tracking app.
Current time: ${nowStr} on ${dateStr}.
Session started at: ${sessionStartTs ? new Date(sessionStartTs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : 'just now'}.

The user said: "${text}"

Parse this into individual drinks with timestamps. Each drink needs:
- name: friendly name (e.g. "Beer", "Shot of Vodka", "Glass of Wine")
- emoji: single appropriate emoji
- alcoholOz: fluid ounces of pure alcohol (beer 12oz=0.6, wine 5oz=0.6, shot 1.5oz=0.6, hard seltzer=0.55, strong cocktail=0.75, light beer=0.45)
- ts: Unix timestamp in milliseconds for when this drink was consumed

Rules:
- If the user specifies times like "7pm", "8:30pm", use those exact times for today's date (or yesterday if the time has already passed today and context suggests last night)
- If they say "starting at 7pm one an hour for 4 hours", generate 4 drinks at 7pm, 8pm, 9pm, 10pm
- If they say "over the last 2 hours", spread drinks evenly across the last 2 hours from now
- If no time specified, use current time
- If they say "last night" or times that have already passed today, use yesterday's date
- Be generous in parsing drink types — "brewski" = beer, "vino" = wine, "whiskey" = shot, etc.

Respond ONLY with valid JSON, no markdown, no explanation:
{
  "drinks": [
    {
      "name": "Beer",
      "emoji": "🍺",
      "alcoholOz": 0.6,
      "ts": 1234567890000
    }
  ],
  "summary": "One-line summary of what was parsed, e.g. '4 beers from 7pm to 10pm'"
}

If you cannot parse any drinks, respond with:
{ "drinks": [], "summary": "Could not parse drinks from that input" }`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = response.content[0].text.trim();
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.json(parsed);
  } catch (err) {
    console.error('analyze-drinks error:', err);
    res.status(500).json({ drinks: [], summary: 'Error parsing drinks' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`NutriChat running at http://localhost:${PORT}`);
});