import { aiDeck, aiDeploy } from '../src/shared/ai.ts';
import { computeStats } from '../src/shared/stats.ts';
import { newMatch, newPlayer, validateDeploy, applyDeploy, resolveRound } from '../src/shared/match.ts';
let decks=0,bought=0,n=0;
for (let seed=1;seed<=12;seed++){
  const d0=aiDeck(seed,'hard'); if (d0.some(d=>computeStats(d).size>=4)) decks++;
  const m=newMatch('x','ai',seed,newPlayer('A',d0,true),newPlayer('B',aiDeck(seed+50,'normal'),true));
  n++;
  while(m.status==='deploy'){ for(const s of [0,1] as const){const a=aiDeploy(m,s,s?'normal':'hard'); if(validateDeploy(m,s,a)) throw new Error('invalid'); applyDeploy(m,s,a);} resolveRound(m);}
  if (m.players[0].board.some(u=>computeStats(m.players[0].deck.find(d=>d.id===u.designId)!).size>=4)) bought++;
}
console.log({decks,bought,n});
