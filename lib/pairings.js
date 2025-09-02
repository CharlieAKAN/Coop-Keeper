// lib/pairings.js
const { getRoundPairings } = require('./store');

function shuffle(arr) { for (let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }
function buildHistory(allRounds) {
  const map = {};
  for (const r of allRounds) {
    for (const m of (r.pairings || [])) {
      if (!m.playerA || !m.playerB) continue;
      (map[m.playerA] ||= new Set()).add(m.playerB);
      (map[m.playerB] ||= new Set()).add(m.playerA);
    }
  }
  return map;
}
function noRepeat(a,b,h){ return !(h[a]?.has(b)); }

function collectPriorRounds(loadTournament, tid, uptoRound) {
  const t = loadTournament(tid);
  const rounds = [];
  for (let r = 1; r < uptoRound; r++) {
    rounds.push({ pairings: t.rounds[String(r)]?.pairings || [] });
  }
  return rounds;
}

function swissPair(tid, roundNum, players, loadTournamentFn) {
  const prior = collectPriorRounds(loadTournamentFn, tid, roundNum);
  const history = buildHistory(prior);

  // group by score
  const byScore = new Map();
  for (const p of players) {
    const s = p.score || 0;
    if (!byScore.has(s)) byScore.set(s, []);
    byScore.get(s).push(p);
  }
  const scores = [...byScore.keys()].sort((a,b)=>b-a);

  const pairings = []; let table = 1; const floats = [];
  for (const s of scores) {
    let bracket = shuffle(byScore.get(s));
    if (bracket.length % 2 === 1) floats.push(bracket.pop());
    while (bracket.length >= 2) {
      const a = bracket.shift();
      let idx = bracket.findIndex(b => noRepeat(a.userId, b.userId, history));
      if (idx === -1) idx = 0;
      const [b] = bracket.splice(idx,1);
      pairings.push({ table: table++, playerA: a.userId, playerB: b.userId, result: 'PENDING' });
    }
  }
  if (floats.length % 2 === 1) {
    const byeP = floats.pop();
    pairings.push({ table: table++, playerA: byeP.userId, playerB: null, bye: true, result: 'PENDING' });
  }
  while (floats.length >= 2) {
    const a = floats.shift(), b = floats.shift();
    pairings.push({ table: table++, playerA: a.userId, playerB: b.userId, result: 'PENDING' });
  }
  return pairings;
}

module.exports = { swissPair };
