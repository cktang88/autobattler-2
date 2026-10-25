import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_POOL, DECK_TAGS, POOL_CAP, ROLE_MAX, ROLE_MIN, TAG_MIN, defaultPool, designTags, drawDeck, evolvePool, poolKey, roleOf,
  sanitizePool, scoreMatch, slotKey, type AiPool, type DesignPerf,
  MAX_UNPROVEN_MUTANTS, MUTANT_PRIOR, mutateDesign, mutateWeak,
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
  assert.equal(new Set(ds.map(poolKey)).size, ds.length, 'no duplicate designs');
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

test('evolvePool adopts a clearly better player design into its role, and grows', () => {
  const hunter = starter('hunter'); // raider/legs [atgm, atgm]
  const m = oneRound([hunter, starter('buzzsaw')]);
  const pool = defaultPool();
  const aiIds = m.players[1].deck.map((d) => d.id);
  // player lost, but its design did 2.5x the AI's designs of the same role
  const rows: [0 | 1, string, number][] = [[0, hunter.id, 2.5], [0, 'starter-buzzsaw', 0.4], ...aiIds.map((id) => [1, id, 1] as [1, string, number])];
  const next = evolvePool(pool, { ...m, status: 'done', winner: 1 }, 1, perf(m, rows));
  assert.equal(next.entries.length, pool.entries.length + 1);
  const adopted = next.entries.find((e) => e.learned)!;
  assert.equal(poolKey(adopted.design), poolKey(hunter));
  assert.equal(roleOf(adopted.design), roleOf(hunter));
  assert.notEqual(adopted.design.name, hunter.name, 'gets an AI name');
  assert.ok(isValidDesign(adopted.design));
  floorsHold(next);
  // the weak one is not adopted (lost, and not better than the AI's)
  assert.ok(!next.entries.some((e) => poolKey(e.design) === poolKey(starter('buzzsaw'))));
  // not clearly better and the player lost: no adoption
  const meh = evolvePool(pool, { ...m, status: 'done', winner: 1 }, 1, perf(m, [[0, hunter.id, 1.1], ...aiIds.map((id) => [1, id, 1] as [1, string, number])]));
  assert.equal(meh.entries.length, pool.entries.length);
  // the player won: its best designs are adopted
  const won = evolvePool(pool, { ...m, status: 'done', winner: 0 }, 1, perf(m, [[0, hunter.id, 1.1], ...aiIds.map((id) => [1, id, 1] as [1, string, number])]));
  assert.equal(won.entries.length, pool.entries.length + 1);
});

test('evolvePool dedupes: a pooled design (in any mount order) merges instead of growing', () => {
  const pooled = AI_POOL.find((d) => d.id === 'pool-railstrider')!; // striker/spider [lightrail, lightrail, targeting]
  const same: Design = { id: 'mine', name: 'My Rails', chassis: pooled.chassis, mobility: pooled.mobility, mounts: [...pooled.mounts] };
  const reordered: Design = { ...same, id: 'mine2', name: 'Reordered', mounts: ['lightrail', 'lightrail', 'targeting'] };
  for (const d of [same, reordered]) {
    const m = oneRound([d]);
    const pool = defaultPool();
    const next = evolvePool(pool, { ...m, status: 'done', winner: 0 }, 1, perf(m, [[0, d.id, 2]]));
    assert.equal(next.entries.length, pool.entries.length, `${d.id} does not grow the pool`);
    const e = next.entries.find((x) => poolKey(x.design) === poolKey(pooled))!;
    assert.ok(e.score > 1 && e.games === 1, 'merged into the existing entry');
  }
  // near-duplicate: same hull, drive and weapons, a different utility -> same slot, no growth
  const near: Design = { id: 'near', name: 'Near', chassis: 'striker', mobility: 'spider', mounts: ['lightrail', 'lightrail', 'gyro'] };
  assert.ok(isValidDesign(near));
  const m = oneRound([near]);
  const next = evolvePool(defaultPool(), { ...m, status: 'done', winner: 0 }, 1, perf(m, [[0, near.id, 3]]));
  assert.equal(next.entries.length, AI_POOL.length);
  assert.equal(next.entries.filter((e) => slotKey(e.design) === slotKey(near)).length, 1);
  assert.ok(next.entries.some((e) => poolKey(e.design) === poolKey(near)), 'the clearly better variant takes the slot');
});

test('evolvePool keeps role / tag floors, caps the pool and prunes the weakest when full', () => {
  const rng = makeRng(42);
  const roles: Role[] = ['swarm', 'frontline', 'antiArmor', 'antiAir', 'artillery', 'flyer', 'skirmisher', 'support'];
  let pool = defaultPool();
  let grew = false;
  for (let i = 0; i < 160; i++) {
    const g = generateDesign(rng, roles[i % roles.length], `g${i}`);
    if (!g) continue;
    const m = oneRound([g]);
    const aiIds = m.players[1].deck.map((d) => d.id);
    // the AI's own designs do badly, the player's do well: heavy churn
    const rows: [0 | 1, string, number][] = [[0, g.id, 1.5 + rng()], ...aiIds.map((id) => [1, id, 0.2 + rng() * 0.3] as [1, string, number])];
    const before = pool.entries.length;
    pool = evolvePool(pool, { ...m, status: 'done', winner: 0 }, 1, perf(m, rows));
    if (pool.entries.length > before) grew = true;
    floorsHold(pool);
  }
  assert.ok(grew);
  assert.ok(pool.entries.length >= 40 && pool.entries.length <= POOL_CAP, `size ${pool.entries.length}`);
  // full pool: a strong newcomer replaces the weakest replaceable entry, size unchanged
  const full: AiPool = structuredClone(pool);
  for (let k = 0; full.entries.length < POOL_CAP && k < 3000; k++) {
    const g = generateDesign(rng, roles[k % roles.length], `f${k}`);
    if (!g || full.entries.some((e) => slotKey(e.design) === slotKey(g))) continue;
    const r = roleOf(g);
    if (full.entries.filter((e) => roleOf(e.design) === r).length >= ROLE_MAX[r]) continue;
    full.entries.push({ design: g, score: 1, games: 1 });
  }
  let newcomer: Design | null = null;
  for (let k = 0; k < 400 && !newcomer; k++) {
    const g = generateDesign(rng, roles[k % roles.length], `n${k}`);
    if (g && !full.entries.some((e) => slotKey(e.design) === slotKey(g))) newcomer = g;
  }
  assert.ok(newcomer);
  for (const e of full.entries) e.score = 1;
  // the weakest entry of the newcomer's role (one the floors let go: a learned one)
  const weakest = full.entries.find((e) => e.learned && roleOf(e.design) === roleOf(newcomer!)) ?? full.entries.find((e) => e.learned)!;
  weakest.score = 0.01;
  const m = oneRound([newcomer!]);
  assert.equal(full.entries.length, POOL_CAP);
  const next = evolvePool(full, { ...m, status: 'done', winner: 0 }, 1, perf(m, [[0, newcomer!.id, 2]]));
  assert.equal(next.entries.length, POOL_CAP);
  assert.ok(next.entries.some((e) => poolKey(e.design) === poolKey(newcomer!)), 'newcomer adopted');
  assert.ok(!next.entries.some((e) => poolKey(e.design) === poolKey(weakest.design)), 'weakest replaced');
  floorsHold(next);
});

test('evolvePool and sanitizePool handle bad input', () => {
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
    const made = mutateWeak(pool.entries, m, 1, perf(m, rows), seed);
    return { pool, made };
  };
  const a = run(77), b = run(77);
  assert.equal(a.made.length, 1);
  assert.deepEqual(a.made, b.made, 'same match -> same mutant');
  const mut = a.made[0];
  assert.equal(roleOf(mut), roleOf(aiDeck[0]));
  assert.ok(isValidDesign(mut));
  const e = a.pool.entries.find((x) => poolKey(x.design) === poolKey(mut))!;
  assert.ok(e.mutant && e.score === MUTANT_PRIOR && e.games === 0);
  assert.ok(a.pool.entries.some((x) => poolKey(x.design) === poolKey(aiDeck[0])), 'the parent stays');
  floorsHold(a.pool);
  // nothing weak -> no mutant
  assert.equal(mutateWeak(defaultPool().entries, m, 1, perf(m, aiDeck.map((d) => [1, d.id, 1] as [1, string, number])), 77).length, 0);
  // the pool already holds the maximum of unproven mutants -> no more
  const full = defaultPool();
  let k = 0;
  for (const d of AI_POOL) {
    if (full.entries.filter((x) => x.mutant).length >= MAX_UNPROVEN_MUTANTS) break;
    const v = mutateDesign(d, makeRng(k++), `cap${k}`);
    if (v && !full.entries.some((x) => slotKey(x.design) === slotKey(v))) full.entries.push({ design: v, score: MUTANT_PRIOR, games: 0, mutant: true });
  }
  assert.equal(full.entries.filter((x) => x.mutant).length, MAX_UNPROVEN_MUTANTS);
  assert.equal(mutateWeak(full.entries, m, 1, perf(m, rows), 77).length, 0);
});
