// ====== SETTINGS ======
const SHEET_ID = '1sFzYS26SGPHXO03v9Xxkdj-gPCT6GnHL4juV6WVj2ms';
const SHEET_NAME = 'CheckIns';
const QUOTES_SHEET_NAME = 'Quotes';
const CHIP_HISTORY_SIZE = 300; // scanned for chip suggestions - higher now since each question only appears ~2/10 of the time
const MAX_CHIPS = 8;

// ====== QUESTION POOL ======
// Add/edit/remove questions here any time - everything downstream reads from this list.
const QUESTION_POOL = [
  { id: 'maincharactermoment', prompt: 'What is the most "main character" moment you had this week?', type: 'sentence',
    defaults: [] , noChips: true},
  { id: 'awakenumb', prompt: "Where did you feel most awake today, and where did you feel most numb?", type: 'sentence',
    defaults: ['studying', 'clinic', 'agency work', 'piano practice', 'at the gym', 'with friends', 'commuting', 'alone at home'], noChips: true },
  { id: 'avoiding', prompt: 'Name one thing you are avoiding. Why?', type: 'sentence',
    defaults: [] , noChips: true},
  { id: 'lookingforward', prompt: "What are you looking forward to?", type: 'sentence',
    defaults: [], noChips: true },
  { id: 'word', prompt: "1 word for now", type: 'word',
    defaults: [] , noChips: true},
  { id: 'primal', prompt: 'Describe the situation right now in a primal scenery', type: 'sentence',
    defaults: [] , noChips: true},
  { id: '3rdperson', prompt: 'Describe your situation from a 3rd person perspective ', type: 'sentence',
    defaults: [], noChips: true },
  { id: 'backintime', prompt: 'If you could go back any time in the past week, when would you go and what would you change', type: 'sentence',
    defaults: [], noChips: true},
  { id: 'naturalsetting', prompt: 'Describe the situation right now in a natural setting', type: 'sentence',
    defaults: ['Sakura', 'Mountain', 'Forest', 'Pond', 'Plains', 'Cave'] },
  { id: 'protect', prompt: 'What did you protect today? Was it worth protecting?', type: 'sentence',
    defaults: ['time', 'energy', 'money', 'peace', 'image', 'mind', 'body'] },
  { id: 'bossfight', prompt: 'If today was a level in a video game, what was the boss fight?', type: 'sentence',
    defaults: [], noChips: true },
  { id: 'differentinaregularthing', prompt: 'What was different in a thing that you do regularly today? ', type: 'sentence',
    defaults: [], noChips: true }
];

// ====== ENTRY POINTS ======

function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  const picked = pickTwoQuestions();
  const withChips = picked.map(q => ({
    id: q.id,
    prompt: q.prompt,
    type: q.type,
    chips: q.noChips ? [] : getChipsForQuestion(q.id, q.defaults)
  }));
  template.questionsJson = JSON.stringify(withChips);
  return template.evaluate()
    .setTitle('Check In')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Called from the page via google.script.run
// Row shape: [Timestamp, Q1_ID, Q1_Answer, Q2_ID, Q2_Answer, Note]
function submitCheckIn(q1id, answer1, q2id, answer2, note) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  data.shift(); // drop header row

  let previousNote = '';
  if (data.length > 0) {
    const lastRow = data[data.length - 1];
    previousNote = (lastRow[5] || '').toString().trim();
  }

  sheet.appendRow([new Date(), q1id, answer1 || '', q2id, answer2 || '', note || '']);

  const quote = getRandomQuote();

  return {
    previousNote: previousNote,
    quote: quote
  };
}

// ====== HELPERS: QUESTIONS ======

function pickTwoQuestions() {
  const shuffled = QUESTION_POOL.slice().sort(() => Math.random() - 0.5);
  return [shuffled[0], shuffled[1]];
}

function getChipsForQuestion(questionId, defaults) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  data.shift();

  const recent = data.slice(-CHIP_HISTORY_SIZE);
  const counts = {};

  recent.forEach(row => {
    if ((row[1] || '') === questionId) {
      const answer = (row[2] || '').toString().trim();
      if (answer) counts[answer] = (counts[answer] || 0) + 1;
    }
    if ((row[3] || '') === questionId) {
      const answer = (row[4] || '').toString().trim();
      if (answer) counts[answer] = (counts[answer] || 0) + 1;
    }
  });

  const top = Object.keys(counts)
    .sort((a, b) => counts[b] - counts[a])
    .slice(0, MAX_CHIPS);

  return top.length ? top : defaults;
}

// ====== HELPERS: CHECK-INS SHEET ======

function getSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['Timestamp', 'Q1_ID', 'Q1_Answer', 'Q2_ID', 'Q2_Answer', 'Note']);
  }
  return sheet;
}

// ====== HELPERS: QUOTE LIBRARY ======

function getQuotesSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(QUOTES_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(QUOTES_SHEET_NAME);
    sheet.appendRow(['Quote', 'Source']);
    seedQuotes(sheet);
  }
  return sheet;
}

function getRandomQuote() {
  const sheet = getQuotesSheet();
  const data = sheet.getDataRange().getValues();
  data.shift();
  if (!data.length) return null;
  const row = data[Math.floor(Math.random() * data.length)];
  return { text: row[0], source: row[1] };
}

function seedQuotes(sheet) {
  const seed = [
    ['Wanting and liking run on different circuits — you can crave something your brain no longer enjoys.', 'Berridge — reward circuitry'],
    ['Dopamine fires on the prediction of reward, not the reward itself. Anticipation is the actual drug.', 'Schultz — reward prediction error'],
    ['Flow needs a task just past your current skill. Too easy and you drift, too hard and you freeze.', 'Csikszentmihalyi — flow'],
    ['Your nervous system asks "am I safe" before your mind asks anything else.', 'Porges — polyvagal theory'],
    ['A fixed mindset treats effort as proof of weakness. A growth mindset treats it as the mechanism.', 'Dweck — mindsets'],
    ['We evolved to track about 150 real relationships — the feed asks you to track thousands.', 'Dunbar — social cognition'],
    ['Motivation lasts longest when it serves autonomy, competence, and relatedness — not reward alone.', 'Deci & Ryan — self-determination theory'],
    ['Naming an emotion out loud measurably quiets the amygdala. Labeling is not weakness, it is regulation.', 'Affect labeling research'],
    ['Mentally contrasting a goal against the obstacle in its way works better than positive thinking alone.', 'Oettingen — mental contrasting'],
    ['A dopamine high is followed by an equal dip — the pleasure and the pain balance on the same scale.', 'Lembke — reward and pain balance'],
    ['The body keeps a stress response running until it gets a clear signal the threat is over.', 'Nagoski — stress cycle completion'],
    ['Boredom is not empty time. It is the precondition for the mind to generate its own ideas.', 'Default mode network research'],
    ['A habit is a fixed mechanic wrapped around a variable reward — that is what makes it sticky.', 'Habit loop / game design'],
    ['Rumination feels like problem-solving but rarely produces a solution — it produces more rumination.', 'Metacognition research'],
    ['Modern comfort did not remove threat, it just moved it from predators to social evaluation.', 'Evolutionary mismatch theory'],
    ['The self only feels real to some people when it has just produced something.', 'Proof-of-Work Identity'],
    ['Internal reward outlives external validation because no one can revoke it.', 'The Piano Principle'],
    ['Attention is not paid, it is taken — and the tools taking it are optimized daily to take more.', 'Attention economy'],
    ['Functional freeze looks like laziness from the outside and paralysis from the inside.', 'Nervous system regulation'],
    ['A system beats a goal because a system runs on days you do not feel motivated.', 'Identity and habit psychology'],
    ['Comparison spirals accelerate because the brain treats social rank as a survival variable, not a preference.', 'Social comparison / status tracking'],
    ['The cost of a decision is not just the decision — it is every alternative you keep half-considering after.', 'Cognitive load / decision residue'],
    ['Judgment under ambiguity is the actual skill. Certainty is just the absence of practice at it.', 'Renaissance polymath framework']
  ];
  seed.forEach(row => sheet.appendRow(row));
}
