# Ironclad Assembly

A browser autobattler in the spirit of **Mechabellum**, where you **design your own units from parts**
(like *Echoes of the Architect*). Play against the AI, or play **async multiplayer** against other
players: each of you deploys whenever you like, and the server resolves the round once both have.

## Run

```bash
npm install
npm start          # builds the client and serves it + the API on http://localhost:8080
```

`PORT`, `DATA_DIR` (default `./data`) and `TRUST_PROXY` configure the server. `npm test` runs the test
suite, `npm run typecheck` checks types. `public/artlab.html` (after `npm run build`) shows every part
and a demo battle.

## How it plays

1. **Garage** — build designs from parts:
   - **10 chassis** (sizes 1×1, 2×2, 3×3; 1–4 mount slots of class L/M/H): Scout, Drone Core, Raider,
     Warden, Striker, Longarm, Aegis, Gunship, Bastion, Colossus.
   - **10 mobility systems**: wheels, half-track, tank treads, biped legs, spider legs, jump legs,
     hover skirt, rotor (heli), jet thrusters, anchor (static emplacement). Not every mobility fits every
     chassis (size limits; the Gunship must fly).
   - **82 modules**: 54 weapons in 12 categories (machine guns, autocannons, cannons, sniper & rail,
     rockets, missiles, artillery, energy, flame, stun & disruption, flak, melee) with sub-variants such as
     30mm vs Twin 30mm; plus 25 utilities (shields, shield dome, point defense, smoke, reactive armor,
     stealth & phantom cloaks, ECM, sensors, engines, gyro, autoloader, overclock, self-destruct…) and armor.
     A slot accepts its own class or smaller, and you can fill slots with utilities only.
   - **Weight vs capacity** sets speed (up to +25% when light, crawling when overloaded, illegal past 150%).
   - Weapons differ in firing pattern (sustained, clip + reload, salvo, single shot) and accuracy:
     beams/rails never miss, missiles home, everything else flies to where the target *was* — artillery
     shells take seconds to land, so fast units dodge them unless they clump.
2. **Deck** — bring up to 9 designs into a match.
3. **Rounds** — each round you get supply (300, +50/round, unspent carries over), buy units from your deck
   and place them on your half of the grid, or upgrade units you already own (up to level 3). Placements
   are secret until both sides commit; placed units persist and redeploy every round.
4. **Battle** — fully automatic and deterministic. The loser takes damage based on the enemy's surviving
   units. Start at 100 HP; reach 0 and you lose.

### Unit cost

A design's cost is not just the sum of its parts. `src/shared/stats.ts` predicts each unit's
**offense** (dps vs a mix of armor, × splash/chain/burn/stun value, × range, × accuracy, × target
coverage) and **effective HP** (hp, shields, armor, evasion, cloaks, flight…), then prices it by
`sqrt(offense × ehp)` (Lanchester's square law) plus a share of parts complexity — so equal-supply
armies are balanced whatever their composition. `scripts/balance.ts` checks this by fighting
equal-cost armies for every module.

## Code map

| Path | What |
| --- | --- |
| `src/shared/parts.ts` | Part catalog (chassis, mobility, modules, categories) |
| `src/shared/stats.ts` | Design → stats, validation, cost model |
| `src/shared/sim/` | Deterministic battle simulation (fixed 20 Hz tick, seeded RNG) |
| `src/shared/match.ts` | Match rules: rounds, supply, deployment validation, damage, redaction |
| `src/shared/ai.ts`, `starters.ts` | AI decks/deployment (hard mode simulates candidates), starter designs |
| `src/server/` | Async multiplayer HTTP API + JSON persistence + static hosting |
| `src/client/render/` | Procedural part-based unit art, effects, part icons |
| `src/client/audio.ts` | Synthesized SFX + music |
| `src/client/ui/` | Menu, garage, lobby, vs-AI, match (deploy + battle replay), settings |

## Credits

See [CREDITS.md](CREDITS.md).
