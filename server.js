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

// ---------- RANDOM DAILY SCHEDULING (persisted — survives restarts/sleep) ----------
const WINDOWS = [
  { startHour: 8, endHour: 12 },
  { startHour: 13, endHour: 18 },
  { startHour: 18, endHour: 22 },
];

function getNowInTimezone() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`; // YYYY-MM-DD
  const minutesOfDay = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10);
  return { now, dateStr, minutesOfDay };
}

function randomMinuteOfDayInRange(startMinutes, endMinutes) {
  if (endMinutes <= startMinutes) return startMinutes;
  return startMinutes + Math.floor(Math.random() * (endMinutes - startMinutes));
}

// Convert "minutes since midnight, TIMEZONE" on a given date into a real UTC Date object
function minuteOfDayToDate(dateStr, minutesOfDay) {
  const h = Math.floor(minutesOfDay / 60);
  const m = minutesOfDay % 60;
  const guess = new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
  const tzDate = new Date(guess.toLocaleString('en-US', { timeZone: TIMEZONE }));
  const utcDate = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetMs = utcDate.getTime() - tzDate.getTime();
  return new Date(guess.getTime() + offsetMs);
}

// Ensure today has 3 scheduled rows in Supabase. Self-heals after any restart.
async function ensureTodaysSchedule() {
  const { dateStr, minutesOfDay: nowMinutes } = getNowInTimezone();

  const { data: existing, error: fetchErr } = await supabase
    .from('schedule')
    .select('slot')
    .eq('date', dateStr);
  if (fetchErr) {
    console.error('Could not check schedule', fetchErr);
    return;
  }
  const existingSlots = new Set((existing || []).map(r => r.slot));

  const rowsToInsert = [];
  WINDOWS.forEach((win, idx) => {
    const slot = idx + 1;
    if (existingSlots.has(slot)) return;

    const startMinutes = win.startHour * 60;
    const endMinutes = win.endHour * 60;
    let scheduledAt;
    let markSentImmediately = false;

    if (nowMinutes >= endMinutes) {
      // Window already fully passed today (e.g. server was asleep) — don't fire it retroactively.
      scheduledAt = minuteOfDayToDate(dateStr, endMinutes);
      markSentImmediately = true;
    } else if (nowMinutes > startMinutes) {
      // Mid-window right now — pick a random remaining moment in this window.
      const target = randomMinuteOfDayInRange(nowMinutes, endMinutes);
      scheduledAt = minuteOfDayToDate(dateStr, target);
    } else {
      // Window hasn't started yet — pick a random moment anywhere in it.
      const target = randomMinuteOfDayInRange(startMinutes, endMinutes);
      scheduledAt = minuteOfDayToDate(dateStr, target);
    }

    rowsToInsert.push({
      date: dateStr,
      slot,
      scheduled_at: scheduledAt.toISOString(),
      sent: markSentImmediately,
    });
  });

  if (rowsToInsert.length > 0) {
    const { error: insertErr } = await supabase.from('schedule').insert(rowsToInsert);
    if (insertErr) {
      // Ignore duplicate-key races (two ticks generating the same day at once) — harmless.
      if (insertErr.code !== '23505') console.error('Could not insert schedule', insertErr);
    } else {
      rowsToInsert.forEach(r => {
        console.log(`Schedule slot ${r.slot} for ${r.date}: ${r.scheduled_at}${r.sent ? ' (window already passed, skipped)' : ''}`);
      });
    }
  }
}

// Runs every minute: create today's schedule if missing, and fire any due, unsent slot.
async function tick() {
  await ensureTodaysSchedule();

  const { data: due, error } = await supabase
    .from('schedule')
    .select('*')
    .eq('sent', false)
    .lte('scheduled_at', new Date().toISOString());
  if (error) {
    console.error('Could not check due schedule rows', error);
    return;
  }

  for (const row of due || []) {
    // Mark as sent first to avoid double-sending if two ticks overlap.
    const { error: updateErr } = await supabase
      .from('schedule')
      .update({ sent: true })
      .eq('id', row.id)
      .eq('sent', false);
    if (updateErr) continue;
    console.log(`Firing scheduled notification: slot ${row.slot}, ${row.date}`);
    await sendToAllSubscribers();
  }
}

cron.schedule('* * * * *', tick, { timezone: TIMEZONE });
tick(); // also run once immediately on boot

app.listen(PORT, () => console.log(`Life Log backend listening on port ${PORT}`));
