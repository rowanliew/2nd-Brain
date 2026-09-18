require('dotenv').config();
const express = require('express');
const cors = require('cors');
const webpush = require('web-push');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');

// ---------- CONFIG ----------
const PORT = process.env.PORT || 3000;
const TIMEZONE = process.env.TIMEZONE || 'Asia/Kuala_Lumpur';
const FRONTEND_URL = process.env.FRONTEND_URL; // e.g. https://yourname.github.io/lifelog
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:you@example.com';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('Missing VAPID keys. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase config. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  process.exit(1);
}
if (!FRONTEND_URL) {
  console.error('Missing FRONTEND_URL (your GitHub Pages site URL).');
  process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ---------- QUESTIONS (keep this array identical to the one in the frontend) ----------
const QUESTIONS = [
  { id: 0, text: "What's the most \"main character\" moment you had this week?" },
  { id: 1, text: "Where did you feel most \"awake\" today, and where did you feel most numb?" },
  { id: 2, text: "Name one thing you're avoiding. Why?" },
  { id: 3, text: "What are you looking forward to?" },
  { id: 4, text: "1 word for now." },
  { id: 5, text: "Describe the situation right now in a prehistoric scenery." },
  { id: 6, text: "Describe your situation with a 3rd person perspective." },
  { id: 7, text: "If you could go back any time in the past week, when would you go and what would you change?" },
  { id: 8, text: "Describe the situation right now in a natural setting (Sakura, Mountain, Forest, Pond)." },
  { id: 9, text: "What did you protect today (your time, energy, image, peace)? Was it worth protecting?" },
  { id: 10, text: "If today was a level in a video game, what was the boss fight?" },
  { id: 11, text: "What was different in a thing that you do regularly today?" },
];

function pickTwoQuestions() {
  const pool = [...QUESTIONS];
  const first = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  const second = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  return [first, second];
}

// ---------- APP ----------
const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.send('Life Log backend is running.'));

// Save a push subscription
app.post('/api/subscribe', async (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  const { error } = await supabase
    .from('subscriptions')
    .upsert({ endpoint: subscription.endpoint, subscription }, { onConflict: 'endpoint' });
  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'Could not save subscription' });
  }
  res.json({ ok: true });
});

// Save a journal entry
app.post('/api/entry', async (req, res) => {
  const { q1_id, q1_text, a1, q2_id, q2_text, a2 } = req.body || {};
  if (!q1_text || !q2_text) {
    return res.status(400).json({ error: 'Missing question text' });
  }
  const { error } = await supabase.from('entries').insert({
    q1_id, q1_text, a1: a1 || '', q2_id, q2_text, a2: a2 || '',
  });
  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'Could not save entry' });
  }
  res.json({ ok: true });
});

// Manual trigger for testing (sends to all subscribers right now)
app.post('/api/send-test', async (req, res) => {
  const count = await sendToAllSubscribers();
  res.json({ ok: true, sent: count });
});

// ---------- SENDING PUSH ----------
async function sendToAllSubscribers() {
  const { data: subs, error } = await supabase.from('subscriptions').select('*');
  if (error) {
    console.error('Failed to load subscriptions', error);
    return 0;
  }
  const [q1, q2] = pickTwoQuestions();
  const payload = JSON.stringify({
    title: 'Life Log',
    body: 'A moment to check in. Tap to answer.',
    url: `${FRONTEND_URL}?q1=${q1.id}&q2=${q2.id}`,
  });

  let sent = 0;
  for (const row of subs) {
    try {
      await webpush.sendNotification(row.subscription, payload);
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await supabase.from('subscriptions').delete().eq('endpoint', row.endpoint);
      } else {
        console.error('Push failed for', row.endpoint, err.statusCode, err.body);
      }
    }
  }
  console.log(`Sent to ${sent} subscriber(s). Questions: [${q1.id}] ${q1.text} / [${q2.id}] ${q2.text}`);
  return sent;
}

// ---------- RANDOM DAILY SCHEDULING ----------
const WINDOWS = [
  { startHour: 8, endHour: 12 },
  { startHour: 13, endHour: 18 },
  { startHour: 18, endHour: 22 },
];

const scheduledTimeouts = [];

function randomTimeWithinWindow(win) {
  const startMinutes = win.startHour * 60;
  const endMinutes = win.endHour * 60;
  return startMinutes + Math.floor(Math.random() * (endMinutes - startMinutes));
}

function scheduleTodaysNotifications() {
  scheduledTimeouts.forEach(clearTimeout);
  scheduledTimeouts.length = 0;

  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, hour12: false, hour: '2-digit', minute: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const nowHour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const nowMinute = parseInt(parts.find(p => p.type === 'minute').value, 10);
  const nowMinutesOfDay = nowHour * 60 + nowMinute;

  WINDOWS.forEach((win, idx) => {
    const targetMinutesOfDay = randomTimeWithinWindow(win);
    let delayMinutes = targetMinutesOfDay - nowMinutesOfDay;
    if (delayMinutes < 0) return;
    const delayMs = delayMinutes * 60 * 1000;
    const h = Math.floor(targetMinutesOfDay / 60);
    const m = targetMinutesOfDay % 60;
    console.log(`Scheduled window ${idx + 1} notification today at ${h}:${String(m).padStart(2, '0')} (${TIMEZONE})`);
    const t = setTimeout(() => sendToAllSubscribers(), delayMs);
    scheduledTimeouts.push(t);
  });
}

cron.schedule('1 0 * * *', scheduleTodaysNotifications, { timezone: TIMEZONE });
scheduleTodaysNotifications();

app.listen(PORT, () => console.log(`Life Log backend listening on port ${PORT}`));
