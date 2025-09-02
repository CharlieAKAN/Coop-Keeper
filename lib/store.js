// lib/store.js
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', 'data', 'tournaments');

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('[store] Failed to read JSON', filePath, e);
    return null;
  }
}

function writeJSONAtomic(filePath, obj) {
  ensureDir(path.dirname(filePath));
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}

function tourneyPath(tid) {
  const safe = tid.replace(/[^a-zA-Z0-9_\-]/g, '_');
  return path.join(BASE, `${safe}.json`);
}

// Public API
function loadTournament(tid) {
  return readJSON(tourneyPath(tid));
}
function saveTournament(tid, data) {
  writeJSONAtomic(tourneyPath(tid), data);
}

function upsertTournament(metaPatch) {
  const t = loadTournament(metaPatch.tid) || { meta: {}, payment: {}, players: {}, rounds: {} };
  t.meta = { ...t.meta, ...metaPatch };
  saveTournament(metaPatch.tid, t);
  return t;
}

function getTournamentMeta(tid) {
  const t = loadTournament(tid);
  return t ? t.meta : null;
}

function upsertPayment(tid, paymentPatch) {
  const t = loadTournament(tid) || { meta: { tid }, payment: {}, players: {}, rounds: {} };
  t.payment = { ...t.payment, ...paymentPatch };
  saveTournament(tid, t);
  return t.payment;
}

function addOrUpdatePlayer(tid, user) {
  const t = loadTournament(tid);
  if (!t) throw new Error('Tournament not found');
  const p = t.players[user.id] || {
    userId: user.id,
    displayName: user.username,
    paid: false,
    paymentStatus: 'unpaid',
    dropped: false,
    score: 0,
    record: { wins: 0, losses: 0, draws: 0 },
    deck: { url: null, fileUrl: null, locked: false }
  };
  t.players[user.id] = p;
  saveTournament(tid, t);
  return p;
}

function setPlayerFields(tid, userId, patch) {
  const t = loadTournament(tid);
  if (!t) throw new Error('Tournament not found');
  t.players[userId] = { ...(t.players[userId] || { userId }), ...t.players[userId], ...patch };
  saveTournament(tid, t);
  return t.players[userId];
}

function listPlayers(tid) {
  const t = loadTournament(tid);
  if (!t) throw new Error('Tournament not found');
  return Object.values(t.players);
}

function setRoundPairings(tid, roundNum, pairings) {
  const t = loadTournament(tid);
  if (!t) throw new Error('Tournament not found');
  t.rounds[String(roundNum)] = { ...(t.rounds[String(roundNum)] || {}), pairings };
  t.meta.currentRound = roundNum;
  t.meta.status = 'in_progress';
  saveTournament(tid, t);
  return pairings;
}

function getRoundPairings(tid, roundNum) {
  const t = loadTournament(tid);
  if (!t) throw new Error('Tournament not found');
  return t.rounds[String(roundNum)]?.pairings || [];
}

module.exports = {
  loadTournament, saveTournament, upsertTournament, getTournamentMeta,
  upsertPayment, addOrUpdatePlayer, setPlayerFields, listPlayers,
  setRoundPairings, getRoundPairings
};
