import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_POOL, DECK_TAGS, POOL_CAP, ROLE_MAX, ROLE_MIN, TAG_MIN, defaultPool, designTags, drawDeck, evolvePool, poolKey, roleOf,
  sanitizePool, scoreMatch, slotKey, type AiPool, type DesignPerf,
  MAX_UNPROVEN_MUTANTS, MUTANT_PRIOR, mutateDesign, mutateWeak, MAX_CANDIDATES, addCandidate, foldMatch, PROMOTE_GOOD, KICK_BAD,
  type PoolEntry,
} from '../src/shared/aipool.ts';
import { aiDeck, aiDeploy, generateDesign, type Role } from '../src/shared/ai.ts';
import { ROLES } from '../src/shared/aiprofile.ts';
import { DECK_SIZE, applyDeploy, newMatch, newPlayer, resolveRound, validateDeck } from '../src/shared/match.ts';
import { isValidDesign } from '../src/shared/stats.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { makeRng } from '../src/shared/rng.ts';
import type { Design, MatchState } from '../src/shared/types.ts';

const starter = (id: string) => STARTER_DESIGNS.find((d) => d.id === 'starter-' + id)!;

function floorsHold(pool: AiPool) {
  const ds = pool.entries.map((e) => e.design);
  for (const r of ROLES) {
    const n = ds.filter((d) => roleOf(d) === r).length;
    assert.ok(n >= ROLE_MIN[r], `role ${r} has ${n} < ${ROLE_MIN[r]}`);
    assert.ok(n <= ROLE_MAX[r], `role ${r} has ${n} > ${ROLE_MAX[r]}`);
  }
  for (const [t, min] of Object.entries(TAG_MIN)) assert.ok(ds.filter((d) => designTags(d).has(t as never)).length >= min!, `tag ${t}`);
  assert.ok(pool.entries.length <= POOL_CAP);
  assert.ok(pool.candidates.length <= MAX_CANDIDATES);
  // dedupe holds across both tiers
  const both = [...ds, ...pool.candidates.map((e) => e.design)];
  assert.equal(new Set(both.map(poolKey)).size, both.length, 'no duplicate designs across the tiers');
  assert.equal(new Set(both.map(slotKey)).size, both.length, 'no near-duplicates across the tiers');
  assert.equal(new Set(ds.map(slotKey)).size, ds.length, 'no near-duplicate designs');
  for (const d of ds) assert.ok(isValidDesign(d), d.id);
}

/** A one-round match: side 0 = player with `pdeck`, side 1 = AI with a drawn deck. */
function oneRound(pdeck: Design[], winner?: 0 | 1): MatchState {
  const m = newMatch('p', 'ai', 5, newPlayer('P', pdeck), newPlayer('AI', aiDeck(5, 'hard'), true));
  for (const side of [0, 1] as const) applyDeploy(m, side, { round: 1, place: [], upgrade: [] });
  resolveRound(m);
  if (winner !== undefined) { m.status = 'done'; m.winner = winner; }
  return m;
}
const perf = (m: MatchState, rows: [0 | 1, string, number][]): DesignPerf[] =>
  rows.map(([side, designId, eff]) => ({ side, designId, invested: 100, killed: 100 * eff, dealt: 1000 * eff, eff }));

test('curated pool: valid, distinct, cost-model designs covering every role floor and deck tag', () => {
  assert.ok(AI_POOL.length >= 18 && AI_POOL.length <= 30, `size ${AI_POOL.length}`);
  assert.deepEqual(validateDeck(AI_POOL.slice(0, DECK_SIZE)), []);
  for (const d of AI_POOL) assert.ok(isValidDesign(d), d.id);
  floorsHold(defaultPool());
  for (const t of DECK_TAGS) assert.ok(AI_POOL.some((d) => designTags(d).has(t)), t);
  // defensive variety
  for (const t of ['shield', 'armor', 'stealth', 'interceptor', 'giant'] as const) assert.ok(AI_POOL.some((d) => designTags(d).has(t)), t);
});

test('hard drafts a valid, covering deck against a known opponent deck', () => {
  const opp = STARTER_DESIGNS.slice(0, DECK_SIZE);
  const d = aiDeck(7, 'hard', undefined, opp);
  assert.equal(d.length, DECK_SIZE);
  assert.deepEqual(validateDeck(d), []);
  assert.deepEqual(aiDeck(7, 'hard', undefined, opp), d);
  for (const t of DECK_TAGS) assert.ok(d.some((x) => designTags(x).has(t)), t);
});

test('drawn decks: valid, unique designs, cover the roles, deterministic and rotating', () => {
  const seen = new Set<string>();
  for (const diff of ['normal', 'hard'] as const) {
    for (let seed = 1; seed <= 30; seed++) {
      const deck = aiDeck(seed, diff);
      assert.equal(deck.length, DECK_SIZE);
      assert.deepEqual(validateDeck(deck), []);
      assert.deepEqual(aiDeck(seed, diff), deck);
      assert.equal(new Set(deck.map(poolKey)).size, deck.length, 'unique designs');
      assert.equal(new Set(deck.map(slotKey)).size, deck.length, 'no near-duplicates');
      for (const t of DECK_TAGS) assert.ok(deck.some((d) => designTags(d).has(t)), `seed ${seed} ${diff}: ${t}`);
      assert.ok(deck.filter((d) => designTags(d).has('giant')).length <= 1);
      seen.add(deck.map((d) => poolKey(d)).sort().join(';'));
    }
  }
  // normal and hard draw the same way (hard then drafts among several draws when it knows the opponent's deck)
  assert.ok(seen.size >= 25, `decks rotate (${seen.size} distinct of 30 seeds)`);
});

test('drawDeck favours higher-scoring entries', () => {
  const pool = defaultPool();
  const star = pool.entries.find((e) => e.design.id === 'pool-gunsled')!;
  let base = 0, boosted = 0;
  for (let s = 1; s <= 80; s++) if (drawDeck(pool, s).some((d) => poolKey(d) === poolKey(star.design))) base++;
  star.score = 3;
  for (let s = 1; s <= 80; s++) if (drawDeck(pool, s).some((d) => poolKey(d) === poolKey(star.design))) boosted++;
  assert.ok(boosted > base, `${boosted} > ${base}`);
});

test('one good report puts a player design on trial in the candidate tier', () => {
  const hunter = starter('hunter'); // raider/legs [atgm, atgm]
  const m = oneRound([hunter, starter('buzzsaw')]);
  const pool = defaultPool();
  const aiIds = m.players[1].deck.map((d) => d.id);
  const ai = (eff: number) => aiIds.map((id) => [1, id, eff] as [1, string, number]);
  // lost, but did 2.5x the AI's designs of its role: on trial straight away (not in the tested tier)
  const next = evolvePool(pool, { ...m, status: 'done', winner: 1 }, 1, perf(m, [[0, hunter.id, 2.5], [0, 'starter-buzzsaw', 0.4], ...ai(1)]));
  assert.equal(next.entries.length, pool.entries.length);
  assert.equal(next.candidates.length, 1);
  const c = next.candidates[0];
  assert.equal(poolKey(c.design), poolKey(hunter));
  assert.equal(roleOf(c.design), roleOf(hunter));
  assert.ok(c.learned && c.origin === 'adopted' && c.creator === 'guest');
  assert.notEqual(c.design.name, hunter.name, 'gets an AI name');
  floorsHold(next);
  // not clearly better and lost: nothing
  assert.equal(evolvePool(pool, { ...m, status: 'done', winner: 1 }, 1, perf(m, [[0, hunter.id, 1.1], ...ai(1)])).candidates.length, 0);
  // won: its best designs go on trial
  assert.equal(evolvePool(pool, { ...m, status: 'done', winner: 0 }, 1, perf(m, [[0, hunter.id, 1.1], ...ai(1)])).candidates.length, 1);
  // a per-reporter cap can refuse it
  const capped = structuredClone(pool);
  foldMatch(capped, { ...m, status: 'done', winner: 0 }, 1, perf(m, [[0, hunter.id, 2], ...ai(1)]), { matchId: 'x', mayAddCandidate: () => false });
  assert.equal(capped.candidates.length, 0);
});

test('dedupe across both tiers: a pooled design (any mount order) or a near-duplicate never goes on trial', () => {
  const pooled = AI_POOL.find((d) => d.id === 'pool-railstrider')!; // striker/spider [lightrail, lightrail, targeting]
  const reordered: Design = { id: 'mine2', name: 'Reordered', chassis: pooled.chassis, mobility: pooled.mobility, mounts: ['lightrail', 'targeting', 'lightrail'] };
  const near: Design = { id: 'near', name: 'Near', chassis: 'striker', mobility: 'spider', mounts: ['lightrail', 'lightrail', 'optics'] };
  for (const d of [{ ...pooled, id: 'mine', name: 'Mine' }, reordered, near]) {
    if (!isValidDesign(d)) continue;
    const m = oneRound([d]);
    const next = evolvePool(defaultPool(), { ...m, status: 'done', winner: 0 }, 1, perf(m, [[0, d.id, 2]]));
    assert.equal(next.entries.length, AI_POOL.length, d.id);
    assert.equal(next.candidates.length, 0, `${d.id} is not a new candidate`);
    floorsHold(next);
  }
  // and a design already on trial is not added twice
  const hunter = starter('hunter');
  const m = oneRound([hunter]);
  let pool = evolvePool(defaultPool(), { ...m, status: 'done', winner: 0 }, 1, perf(m, [[0, hunter.id, 2]]));
  pool = evolvePool(pool, { ...m, id: 'again', status: 'done', winner: 0 }, 1, perf(m, [[0, hunter.id, 2]]));
  assert.equal(pool.candidates.length, 1);
});

/** A pool whose candidate tier holds the AI deck's first design (moved out of the tested tier). */
function withCandidate(m: MatchState): { pool: AiPool; cand: Design } {
  const pool = defaultPool();
  const d = m.players[1].deck[0];
  const e = pool.entries.find((x) => poolKey(x.design) === poolKey(d))!;
  pool.entries.splice(pool.entries.indexOf(e), 1);
  pool.candidates.push({ ...e, origin: 'mutant', parent: 'X', addedAt: 1 });
  return { pool, cand: d };
}

test('candidates graduate after good games in different matches; two bad games kick a design out', () => {
  const m = oneRound([starter('hunter')]);
  const ids = m.players[1].deck.map((d) => d.id);
  const rows = (first: number) => ids.map((id, i) => [1, id, i === 0 ? first : 1] as [1, string, number]);
  // promotion: PROMOTE_GOOD good games in distinct matches (the same match twice counts once)
  const { pool, cand } = withCandidate(m);
  foldMatch(pool, m, 1, perf(m, rows(1.5)), { matchId: 'g1', now: 10 });
  foldMatch(pool, m, 1, perf(m, rows(1.5)), { matchId: 'g1', now: 11 });
  assert.ok(pool.candidates.some((e) => poolKey(e.design) === poolKey(cand)), 'one distinct good game is not enough');
  const r = foldMatch(pool, m, 1, perf(m, rows(1.5)), { matchId: 'g2', now: 12 });
  assert.equal(PROMOTE_GOOD, 2);
  assert.ok(r.promoted.some((d) => poolKey(d) === poolKey(cand)));
  const promoted = pool.entries.find((e) => poolKey(e.design) === poolKey(cand))!;
  assert.ok(promoted && promoted.promotedAt === 12 && !pool.candidates.some((e) => poolKey(e.design) === poolKey(cand)));
  assert.ok(r.events.some((e) => e.kind === 'promoted'));
  // a candidate with KICK_BAD bad games is kicked
  const k = withCandidate(m);
  foldMatch(k.pool, m, 1, perf(m, rows(0.05)), { matchId: 'b1' });
  assert.ok(k.pool.candidates.some((e) => poolKey(e.design) === poolKey(k.cand)));
  const kr = foldMatch(k.pool, m, 1, perf(m, rows(0.05)), { matchId: 'b2' });
  assert.equal(KICK_BAD, 2);
  assert.ok(!k.pool.candidates.some((e) => poolKey(e.design) === poolKey(k.cand)) && kr.kicked.length >= 1);
  // a tested design with two bad games is kicked too (one that no role / tag floor protects)
  const t = defaultPool();
  const ds = t.entries.map((e) => e.design);
  const free = m.players[1].deck.findIndex((d) => ds.filter((x) => roleOf(x) === roleOf(d)).length > ROLE_MIN[roleOf(d)]
    && [...designTags(d)].every((tag) => ds.filter((x) => designTags(x).has(tag)).length > (TAG_MIN[tag] ?? 0)));
  assert.ok(free >= 0);
  const td = m.players[1].deck[free];
  const rowsT = ids.map((id, i) => [1, id, i === free ? 0.05 : 1] as [1, string, number]);
  foldMatch(t, m, 1, perf(m, rowsT), { matchId: 'b1' });
  foldMatch(t, m, 1, perf(m, rowsT), { matchId: 'b2' });
  assert.ok(!t.entries.some((e) => poolKey(e.design) === poolKey(td)), 'tested design kicked');
  floorsHold(t);
});

test('a kick that would break a role floor demotes instead', () => {
  const m = oneRound([starter('hunter')]);
  const d = m.players[1].deck[0];
  const role = roleOf(d);
  const pool = defaultPool();
  // leave exactly ROLE_MIN designs of its role (it among them)
  const same = pool.entries.filter((e) => roleOf(e.design) === role && poolKey(e.design) !== poolKey(d));
  const keep = Math.max(0, ROLE_MIN[role] - 1);
  for (const e of same.slice(keep)) pool.entries.splice(pool.entries.indexOf(e), 1);
  if (ROLE_MIN[role] === 0) return; // nothing protects this role: covered by the kick test
  const rows = m.players[1].deck.map((x, i) => [1, x.id, i === 0 ? 0.05 : 1] as [1, string, number]);
  const before = pool.entries.find((e) => poolKey(e.design) === poolKey(d))!.score;
  foldMatch(pool, m, 1, perf(m, rows), { matchId: 'b1' });
  const r = foldMatch(pool, m, 1, perf(m, rows), { matchId: 'b2' });
  const e = pool.entries.find((x) => poolKey(x.design) === poolKey(d));
  assert.ok(e, 'kept for role coverage');
  assert.ok(e!.score < before * 0.7, 'demoted');
  assert.ok(r.demoted.length === 1 && r.events.some((x) => x.kind === 'demoted'));
  assert.equal(pool.entries.filter((x) => roleOf(x.design) === role).length, ROLE_MIN[role]);
});

test('the candidate tier is capped: the weakest, then oldest, drop out', () => {
  const pool = defaultPool();
  const rng = makeRng(5);
  const roles: Role[] = ['swarm', 'frontline', 'antiArmor', 'antiAir', 'artillery', 'flyer', 'skirmisher'];
  let dropped: PoolEntry | null = null;
  for (let i = 0; i < 400 && pool.candidates.length < MAX_CANDIDATES + 5; i++) {
    const g = generateDesign(rng, roles[i % roles.length], `c${i}`);
    if (!g || [...pool.entries, ...pool.candidates].some((e) => slotKey(e.design) === slotKey(g))) continue;
    const out = addCandidate(pool, { design: g, score: i === 0 ? 0.1 : 1, games: 0, addedAt: i });
    if (out) { dropped ??= out; }
    assert.ok(pool.candidates.length <= MAX_CANDIDATES);
  }
  assert.equal(pool.candidates.length, MAX_CANDIDATES);
  assert.equal(dropped!.score, 0.1, 'the weakest went first');
});

test('decks deal 1-2 candidates on trial and still cover every role', () => {
  const m = oneRound([starter('hunter')]);
  const { pool, cand } = withCandidate(m);
  let dealt = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const deck = drawDeck(pool, seed);
    assert.equal(deck.length, DECK_SIZE);
    assert.equal(new Set(deck.map(poolKey)).size, DECK_SIZE);
    for (const t of DECK_TAGS) assert.ok(deck.some((d) => designTags(d).has(t)), t);
    if (deck.some((d) => poolKey(d) === poolKey(cand))) dealt++;
  }
  assert.ok(dealt >= 25, `the only candidate is dealt in most decks (${dealt}/30)`);
});

test('evolvePool keeps role / tag floors and caps under heavy churn', () => {
  const rng = makeRng(42);
  const roles: Role[] = ['swarm', 'frontline', 'antiArmor', 'antiAir', 'artillery', 'flyer', 'skirmisher', 'support'];
  let pool = defaultPool();
  for (let i = 0; i < 120; i++) {
    const g = generateDesign(rng, roles[i % roles.length], `g${i}`);
    if (!g) continue;
    const m = { ...oneRound([g]), id: `churn${i}` };
    const rows: [0 | 1, string, number][] = [[0, g.id, 1.5 + rng()], ...m.players[1].deck.map((d) => [1, d.id, rng() * 1.6] as [1, string, number])];
    pool = evolvePool(pool, { ...m, status: 'done', winner: 0 }, 1, perf(m, rows));
    floorsHold(pool);
  }
  assert.ok(pool.candidates.length > 0);
});

test('evolvePool and sanitizePool handle bad input', () => {
  // a v2 pool (one tier) migrates: its entries become the tested tier
  const v2 = sanitizePool({ v: 2, entries: defaultPool().entries, matches: 7 });
  assert.equal(v2.v, 3); assert.equal(v2.entries.length, AI_POOL.length); assert.equal(v2.matches, 7); assert.deepEqual(v2.candidates, []);
  for (const junk of [null, undefined, 42, 'x', [], {}, { v: 99, entries: [] }, { v: 1, entries: 'no' }, { v: 1, entries: [{ design: { id: 'x' } }] }]) {
    const p = sanitizePool(junk);
    assert.equal(p.entries.length, AI_POOL.length);
    floorsHold(p);
  }
  // invalid / duplicate entries are dropped, valid ones kept
  const good = defaultPool();
  const dirty = structuredClone(good) as AiPool;
  dirty.entries.push({ design: { id: 'bad', name: 'Bad', chassis: 'scout', mobility: 'jet', mounts: ['mg'] }, score: 1, games: 0 });
  dirty.entries.push(structuredClone(dirty.entries[0]));
  dirty.entries[1].score = NaN;
  const clean = sanitizePool(JSON.parse(JSON.stringify(dirty)));
  assert.equal(clean.entries.length, good.entries.length);
  assert.ok(Number.isFinite(clean.entries[1].score));
  // evolve with garbage match / pool never throws and returns a valid pool
  floorsHold(evolvePool(null as never, null as never));
  floorsHold(evolvePool(good, { history: [] } as never));
  const m = oneRound([starter('hunter')]);
  floorsHold(evolvePool({ v: 1, entries: 'x' } as never, m));
});

test('scoreMatch rates both sides of a real match', () => {
  const m = newMatch('s', 'ai', 11, newPlayer('A', aiDeck(3, 'normal'), true), newPlayer('B', aiDeck(4, 'normal'), true));
  for (let r = 0; r < 2 && m.status === 'deploy'; r++) {
    for (const side of [0, 1] as const) applyDeploy(m, side, aiDeploy(m, side, 'normal'));
    resolveRound(m);
  }
  const p = scoreMatch(m);
  for (const side of [0, 1] as const) assert.ok(p.some((x) => x.side === side && x.invested > 0));
  assert.ok(p.every((x) => Number.isFinite(x.eff) && x.eff >= 0));
  const pool = evolvePool(defaultPool(), m, 1, p);
  floorsHold(pool);
  assert.equal(pool.matches, 1);
});

test('mutateDesign: small legal tweaks that keep the role and coverage tags', () => {
  const rng = makeRng(9);
  let made = 0;
  for (const d of AI_POOL) {
    const k = mutateDesign(d, rng, 'mut');
    if (!k) continue;
    made++;
    assert.ok(isValidDesign(k), `${d.id} -> ${JSON.stringify(k)}`);
    assert.equal(roleOf(k), roleOf(d), d.id);
    for (const t of DECK_TAGS) if (designTags(d).has(t)) assert.ok(designTags(k).has(t), `${d.id} keeps ${t}`);
    assert.notEqual(poolKey(k), poolKey(d));
  }
  assert.ok(made >= AI_POOL.length * 0.7, `mutants for ${made}/${AI_POOL.length}`);
});

test('mutateWeak: an ineffective AI design yields one deterministic, deduped mutant; unproven mutants are capped', () => {
  const m = oneRound([starter('hunter')]);
  const aiDeck = m.players[1].deck;
  const weakId = aiDeck[0].id;
  const rows: [0 | 1, string, number][] = aiDeck.map((d) => [1, d.id, d.id === weakId ? 0.05 : 1.2] as [1, string, number]);
  const run = (seed: number) => {
    const pool = defaultPool();
    const made = mutateWeak(pool, m, 1, perf(m, rows), seed);
    return { pool, made };
  };
  const a = run(77), b = run(77);
  assert.equal(a.made.length, 1);
  assert.deepEqual(a.made, b.made, 'same match -> same mutant');
  const mut = a.made[0];
  assert.equal(roleOf(mut), roleOf(aiDeck[0]));
  assert.ok(isValidDesign(mut));
  const e = a.pool.candidates.find((x) => poolKey(x.design) === poolKey(mut))!;
  assert.ok(e.mutant && e.origin === 'mutant' && e.parent && e.score === MUTANT_PRIOR && e.games === 0, 'mutants start in the candidate tier');
  assert.ok(a.pool.entries.some((x) => poolKey(x.design) === poolKey(aiDeck[0])), 'the parent stays');
  floorsHold(a.pool);
  // nothing weak -> no mutant
  assert.equal(mutateWeak(defaultPool(), m, 1, perf(m, aiDeck.map((d) => [1, d.id, 1] as [1, string, number])), 77).length, 0);
  // the pool already holds the maximum of unproven mutants -> no more
  const full = defaultPool();
  let k = 0;
  for (const d of AI_POOL) {
    if (full.candidates.filter((x) => x.mutant).length >= MAX_UNPROVEN_MUTANTS) break;
    const v = mutateDesign(d, makeRng(k++), `cap${k}`);
    if (v && ![...full.entries, ...full.candidates].some((x) => slotKey(x.design) === slotKey(v))) full.candidates.push({ design: v, score: MUTANT_PRIOR, games: 0, mutant: true });
  }
  assert.equal(full.candidates.filter((x) => x.mutant).length, MAX_UNPROVEN_MUTANTS);
  assert.equal(mutateWeak(full, m, 1, perf(m, rows), 77).length, 0);
});
