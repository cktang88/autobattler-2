// Tug of war AI: every second or so it looks at its gold and the field and decides whether to invest in income,
// unlock the next hull tier, or buy a block (and where to drop it). Runs locally (vs AI) as one more source of
// TugCommands, so it plays by exactly the rules a person does.

import { makeRng, type Rng } from './rng.ts';
import { DEPLOY_D, FIELD_H, FIELD_W } from './grid.ts';
import { computeStats } from './stats.ts';
import { MODULE_BY_ID } from './parts.ts';
import { TIER_COST, TUG, castleGunPrice, castlePos, dropError, incomeCost, type TugCommand, type TugGame } from './tug.ts';
import type { AiDifficulty } from './ai.ts';
import type { Design, Side, Size } from './types.ts';

const THINK_EVERY = 1; // s
/** castle guns the AI buys, in order (starting from TUG.startCastleGun) */
const CASTLE_LADDER = [TUG.startCastleGun, 'twin30', 'minigun', 'plasma', 'missilebattery'];

export class TugAi {
  readonly side: Side;
  private rng: Rng;
  private next = 0;
  private want: Design | null = null;
  private readonly diff: AiDifficulty;

  constructor(side: Side, seed: number, difficulty: AiDifficulty = 'normal') {
    this.side = side;
    this.rng = makeRng(seed);
    this.diff = difficulty;
  }

  /** the commands to issue this tick (usually none) */
  think(g: TugGame): TugCommand[] {
    if (g.done || g.time < this.next) return [];
    const slow = this.diff === 'easy' ? 2.2 : this.diff === 'hard' ? 0.7 : 1;
    this.next = g.time + THINK_EVERY * slow * (0.7 + 0.6 * this.rng());
    const S = g.sides[this.side];
    // under attack: spend on defence first
    const threat = this.threat(g);
    if (threat.danger) {
      // a real answer, not a dribble of single units into a bigger blob: save until we can drop a wave that
      // outweighs the attack, then send it all at once (the castle's gun holds the line meanwhile)
      const out: TugCommand[] = [];
      if (S.gold >= threat.value * 0.9) {
        let gold = S.gold, sent = 0;
        // each design once per wave (the buy cooldown)
        const usable = g.rosters[this.side].filter((d) => computeStats(d).size <= S.tier && g.cooldown(this.side, d.id) === 0).sort((a, b) => computeStats(b).cost - computeStats(a).cost);
        for (let k = 0; k < 6 && sent < threat.value * 1.2; k++) {
          const best = usable.find((d) => computeStats(d).cost <= gold);
          if (!best) break;
          usable.splice(usable.indexOf(best), 1);
          const c = this.buyCmd(g, gold, threat.x, threat.y, best);
          if (!c) break;
          out.push(c);
          gold -= computeStats(best).cost;
          sent += computeStats(best).cost;
        }
      }
      if (out.length || threat.near) return out;
    }
    // economy: keep the income level on a schedule (a level every ~45 s on normal)
    const pace = this.diff === 'easy' ? 80 : this.diff === 'hard' ? 35 : 45;
    const ecoCap = this.diff === 'easy' ? 3 : this.diff === 'hard' ? TUG.maxIncomeLevel : 6;
    const ecoWant = Math.min(ecoCap, 1 + Math.floor(g.time / pace));
    if (S.incomeLvl < ecoWant) return S.gold >= incomeCost(S.incomeLvl) ? [{ t: 'income' }] : this.spareBuy(g, incomeCost(S.incomeLvl));
    // tiers: when the roster has designs waiting on the next tier, on a schedule
    const nt = g.nextTier(this.side);
    if (nt !== null) {
      const due = g.time > (this.diff === 'hard' ? 80 : 110) * (nt - 2);
      if (due) return S.gold >= TIER_COST[nt] ? [{ t: 'tier' }] : this.spareBuy(g, TIER_COST[nt]);
    }
    // castle guns: climb a ladder of better guns once the economy is going
    const ladder = this.diff === 'easy' ? CASTLE_LADDER.slice(0, 1) : CASTLE_LADDER;
    const at = ladder.indexOf(S.castleGun);
    const nextGun = ladder[at + 1];
    if (nextGun && g.time > 150 * (at + 2)) {
      const price = castleGunPrice(MODULE_BY_ID.get(nextGun)!);
      return S.gold >= price ? [{ t: 'castleGun', moduleId: nextGun }] : this.spareBuy(g, price);
    }
    // otherwise save for a block and push a lane
    return this.spareBuy(g, 0);
  }

  /** buy a block for a lane push only with gold beyond what we are saving for */
  private spareBuy(g: TugGame, reserve: number): TugCommand[] {
    const gold = g.sides[this.side].gold - reserve;
    if (gold <= 0) return [];
    const c = this.buyCmd(g, gold, 8 + this.rng() * (FIELD_W - 16), NaN);
    return c ? [c] : [];
  }

  /** enemies pushing into our half: danger when they outweigh what we have near them */
  private threat(g: TugGame): { danger: boolean; near: boolean; value: number; x: number; y: number } {
    const home = castlePos(this.side);
    let foe = 0, mine = 0, bx = 0, by = 0, bd = Infinity;
    for (const u of g.battle.units) {
      if (!u.alive || u.id === g.castles[0] || u.id === g.castles[1]) continue;
      const inHalf = this.side === 0 ? u.y > FIELD_H / 2 - 6 : u.y < FIELD_H / 2 + 6;
      if (!inHalf) continue;
      const v = u.stats.unitCost * (u.hp / u.maxHp);
      if (u.side === this.side) { mine += v; continue; }
      foe += v;
      const d = Math.abs(u.y - home.y);
      if (d < bd) { bd = d; bx = u.x; by = u.y; }
    }
    return { danger: foe > 0 && (foe > mine * 0.9 || bd < 22), near: bd < 18, value: foe - mine, x: bx, y: by };
  }

  /** pick an affordable design (keeping one goal design to save for) and a legal drop point near (x, y);
   *  y NaN = a forward staging row; `pick` buys that design */
  private buyCmd(g: TugGame, gold: number, x: number, y: number, pick?: Design): TugCommand | null {
    const S = g.sides[this.side];
    const usable = g.rosters[this.side].filter((d) => computeStats(d).size <= S.tier && g.cooldown(this.side, d.id) === 0);
    if (!usable.length) return null;
    if (pick) this.want = pick;
    else if (this.want && g.cooldown(this.side, this.want.id) > 0) return null; // saving for it: wait out its cooldown
    else if (!this.want || computeStats(this.want).size > S.tier || this.rng() < 0.15) {
      // favour bigger hulls a little once they're unlocked
      const w = usable.map((d) => 1 + 0.35 * computeStats(d).size);
      let r = this.rng() * w.reduce((a, b) => a + b, 0);
      this.want = usable[usable.length - 1];
      for (let i = 0; i < usable.length; i++) if ((r -= w[i]) <= 0) { this.want = usable[i]; break; }
    }
    let d = this.want!;
    if (computeStats(d).cost > gold) {
      // under attack: whatever we can afford now
      if (!Number.isNaN(y)) {
        const cheap = usable.filter((u) => computeStats(u).cost <= gold);
        if (!cheap.length) return null;
        d = cheap[Math.floor(this.rng() * cheap.length)];
      } else return null;
    }
    const fwd = this.side === 0 ? -1 : 1;
    const home = castlePos(this.side);
    // defend: drop between the threat and the castle; push: drop a little ahead of the castle
    const ty = Number.isNaN(y) ? clampZone(this.side, home.y + fwd * (10 + this.rng() * (DEPLOY_D - 12))) : clampZone(this.side, y - fwd * 10);
    for (let k = 0; k < 8; k++) {
      const px = Math.max(4, Math.min(FIELD_W - 4, x + (this.rng() - 0.5) * 6 * k));
      const py = ty + (this.rng() - 0.5) * 2 * k;
      const cmd: TugCommand = { t: 'buy', designId: d.id, x: Math.round(px), y: Math.round(py) };
      if (!dropError(this.side, d, cmd.x, cmd.y) && !g.overlapError(this.side, d, cmd.x, cmd.y)) {
        if (Number.isNaN(y)) this.want = null;
        return cmd;
      }
    }
    return null;
  }
}

/** keep a drop row inside our deploy zone, a little in from its edges */
function clampZone(side: Side, y: number): number {
  return side === 0 ? Math.max(FIELD_H - DEPLOY_D + 4, Math.min(FIELD_H - 4, y)) : Math.min(DEPLOY_D - 4, Math.max(4, y));
}
