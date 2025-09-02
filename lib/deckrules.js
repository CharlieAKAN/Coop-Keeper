// lib/deckrules.js
const fs = require('fs');
const path = require('path');

const RULES_PATH = path.join(__dirname, '..', 'data', 'op_rules.json');

function loadRules() {
  try {
    const raw = fs.readFileSync(RULES_PATH, 'utf8');
    const json = JSON.parse(raw);
    // normalize sets to UPPERCASE codes
    json.bannedCards = (json.bannedCards || []).map(s => s.toUpperCase());
    json.bannedPairs = (json.bannedPairs || []).map(p => ({
      cardA: String(p.cardA || '').toUpperCase(),
      forbiddenWith: (p.forbiddenWith || []).map(s => s.toUpperCase())
    }));
    const restricted = {};
    for (const [k, v] of Object.entries(json.restrictedCards || {})) {
      restricted[k.toUpperCase()] = Number(v);
    }
    json.restrictedCards = restricted;
    json.copyLimitPerCardNumber = Number(json.copyLimitPerCardNumber || 4);
    return json;
  } catch (e) {
    console.error('[deckrules] Failed to load rules:', e);
    return {
      game: 'ONE_PIECE_TCG',
      effectiveDate: null,
      copyLimitPerCardNumber: 4,
      bannedCards: [],
      restrictedCards: {},
      bannedPairs: []
    };
  }
}

/**
 * parsedLines: [{ qty:number, code:string, raw:string }]
 * returns { ok:boolean, errors:string[], warnings:string[] }
 */
function validateDeck(parsedLines) {
  const rules = loadRules();
  const errors = [];
  const warnings = [];

  // Tally copies per card number
  const counts = {};
  for (const { qty, code } of parsedLines) {
    const c = code.toUpperCase();
    counts[c] = (counts[c] || 0) + (Number(qty) || 0);
  }

  // 1) 4-copy rule
  const maxCopies = rules.copyLimitPerCardNumber || 4;
  for (const [code, n] of Object.entries(counts)) {
    if (n > maxCopies) {
      errors.push(`❌ ${code}: ${n} copies (limit ${maxCopies}).`);
    }
  }

  // 2) banned cards (and restricted=0)
  const bannedSet = new Set(rules.bannedCards || []);
  for (const code of Object.keys(counts)) {
    if (bannedSet.has(code)) {
      errors.push(`❌ ${code} is banned.`);
    }
  }

  // 3) restricted > 0
  for (const [code, limit] of Object.entries(rules.restrictedCards || {})) {
    const have = counts[code] || 0;
    if (have > limit) {
      errors.push(`❌ ${code}: ${have} copies (restricted to ${limit}).`);
    }
  }

  // 4) banned pairs
  const present = new Set(Object.keys(counts));
  for (const pair of rules.bannedPairs || []) {
    if (!pair.cardA || !pair.forbiddenWith || !pair.forbiddenWith.length) continue;
    const hasA = present.has(pair.cardA);
    if (!hasA) continue;
    const badB = pair.forbiddenWith.filter(b => present.has(b));
    if (badB.length) {
      errors.push(`❌ Banned pair: ${pair.cardA} cannot be used with ${badB.join(', ')}.`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, rulesMeta: { effectiveDate: rules.effectiveDate } };
}

module.exports = { loadRules, validateDeck };
