// Name banks for auto-naming designs. Players can rename freely; these just give every new design a
// flavourful default picked from its chassis' primary role (or its size class for giants and titans).

import { CHASSIS_BY_ID } from './parts.ts';
import type { Role } from './types.ts';

export const ROLE_NAMES: Record<Role, string[]> = {
  raider: ['Jackal', 'Razorback', 'Viper', 'Whiplash', 'Stinger', 'Ferret', 'Dart', 'Mongoose', 'Wildcat', 'Render', 'Hotshot', 'Skink', 'Weasel', 'Gadfly', 'Prowler', 'Coyote', 'Lynx', 'Sidewinder', 'Hornfly', 'Raptor', 'Brigand', 'Zipper', 'Marauder', 'Scrapper', 'Raider King', 'Desperado', 'Snapjaw', 'Quickfang', 'Harrier', 'Skitter'],
  skirmisher: ['Ranger', 'Lancer', 'Falcon', 'Kestrel', 'Javelin', 'Pathfinder', 'Outrider', 'Strider', 'Hawkeye', 'Longbow', 'Vanguard', 'Ghostlight', 'Mirage', 'Archer', 'Peregrine', 'Sabre', 'Cutlass', 'Halberd', 'Zephyr', 'Fennec', 'Sparrowhawk', 'Phantasm', 'Talon', 'Scimitar', 'Skylark', 'Drifter', 'Rapier', 'Arbalest', 'Voyager', 'Nomad'],
  riot: ['Bulldozer', 'Thresher', 'Grinder', 'Bonfire', 'Pyre', 'Shredder', 'Mauler', 'Hailstorm', 'Riot Cop', 'Peacekeeper', 'Firebrand', 'Blowtorch', 'Furnace', 'Buzzkill', 'Crowd Control', 'Sweeper', 'Hammerhead', 'Brawler', 'Blizzard', 'Cyclone', 'Mulcher', 'Hellfire', 'Torrent', 'Typhoon', 'Wrecker', 'Ironside', 'Reaper', 'Breaker', 'Cinder', 'Tempest'],
  assault: ['Warhound', 'Spartan', 'Crusader', 'Centurion', 'Gladiator', 'Exemplar', 'Bannerman', 'Berserker', 'Legionnaire', 'Ravager', 'Conqueror', 'Warlord', 'Hammer', 'Striker', 'Brute', 'Bruiser', 'Onslaught', 'Valkyrie', 'Hoplite', 'Huscarl', 'Lancehorn', 'Cataphract', 'Ironclad', 'Vindicator', 'Champion', 'Destroyer', 'Ironfist', 'Warbringer', 'Lionheart', 'Rampart'],
  tank: ['Bulwark', 'Bastion', 'Aegis', 'Tortoise', 'Ironhide', 'Stonewall', 'Monolith', 'Bedrock', 'Fortress', 'Ironhorn', 'Mammoth', 'Anvil', 'Boulder', 'Rampart', 'Palisade', 'Gatekeeper', 'Warden', 'Bunker', 'Turtle', 'Mountain', 'Barricade', 'Steelwall', 'Granite', 'Obelisk', 'Pillar', 'Oxen', 'Big Bertha', 'Shellback', 'Armadillo', 'Holdfast'],
  artillery: ['Thunderhead', 'Firestorm', 'Longshot', 'Rainmaker', 'Skyfall', 'Hellrain', 'Big Gun', 'Howler', 'Mortarion', 'Lobber', 'Earthshaker', 'Doombringer', 'Siegebreaker', 'Thunderclap', 'Basilisk', 'Barrage', 'Cannonade', 'Stormbringer', 'Volley', 'Meteor', 'Comet', 'Falling Star', 'Grand Battery', 'Long Arc', 'Quake', 'Rumble', 'Distant Thunder', 'Death From Above', 'Hailmaker', 'Brimstone'],
  antiair: ['Skyguard', 'Flak Jack', 'Overwatch', 'Sky Sweeper', 'Birdbane', 'Hawkbane', 'Starburst', 'Umbrella', 'Sentinel', 'Watchtower', 'Skyshield', 'Cloudbreaker', 'Interceptor', 'Patriot', 'Stingray', 'Goalkeeper', 'Zenith', 'Skycutter', 'Popcorn', 'Lookout', 'Halo', 'Ack-Ack', 'Seraph', 'Skyrake', 'Flakjaw', 'Sky Lancer', 'Fireworks', 'Searchlight', 'Nightwatch', 'Canopy'],
  support: ['Field Medic', 'Patchwork', 'Lifeline', 'Wrench', 'Guardian Angel', 'Mender', 'Tinker', 'Nanny', 'Shepherd', 'Beacon', 'Lighthouse', 'Caretaker', 'Sawbones', 'Bandage', 'Commander', 'Conductor', 'Oracle', 'Herald', 'Steward', 'Custodian', 'Sanctuary', 'Haven', 'Mother Hen', 'Pit Crew', 'Spanner', 'Duct Tape', 'Second Wind', 'Overseer', 'Quartermaster', 'Rally Point'],
  scout: ['Spotter', 'Pathfinder', 'Lookout', 'Recon', 'Peeper', 'Picket', 'Ferret', 'Snoop', 'Eyeball', 'Tracker', 'Seeker', 'Whisker', 'Antenna', 'Periscope', 'Owl', 'Magpie', 'Sparrow', 'Mouse', 'Gecko', 'Tadpole', 'Scuttle', 'Rover', 'Probe', 'Pip', 'Flea', 'Gnat', 'Telltale', 'Scanner', 'Beagle', 'Busybody'],
  flyer: ['Hornfly', 'Strafer', 'Kite', 'Wasp', 'Dragonfly', 'Albatross', 'Condor', 'Osprey', 'Swift', 'Rook', 'Vulture', 'Buzzard', 'Griffin', 'Wyvern', 'Wailer', 'Skyknight', 'Stormwing', 'Firehawk', 'Hummingbird', 'Mosquito', 'Locust', 'Cormorant', 'Storm Crow', 'Nighthawk', 'Starling', 'Jetstream', 'Updraft', 'Gale', 'Blackbird', 'Firefly'],
  bomber: ['Payload', 'Dambuster', 'Carpet', 'Big Drop', 'Grand Slam', 'Blockbuster', 'Thunderbolt', 'Stratofortress', 'Lancaster', 'Liberator', 'Hailbringer', 'Bombardier', 'Egg Layer', 'Pelican', 'Stork', 'Delivery Boy', 'Surprise Package', 'Mailman', 'Air Raid', 'Blitz', 'Hammerfall', 'Skystrike', 'Deadweight', 'Ordnance', 'Doom Bucket', 'Cluster Fudge', 'Rolling Thunder', 'Arc Strike', 'Ground Pounder', 'Sky Anvil'],
  siege: ['Wallbreaker', 'Trebuchet', 'Ballista', 'Catapult', 'Battering Ram', 'Siegemaster', 'Bombard', 'Culverin', 'Mangonel', 'Onager', 'Demolisher', 'Sapper', 'Gate Crasher', 'Bastion Buster', 'Castle Cracker', 'Fortbane', 'Earthbreaker', 'Longreach', 'Pounder', 'Sledge', 'Ironworks', 'Grinding Gear', 'Siegeborn', 'Breach', 'Rubblemaker', 'Big Iron', 'Hammerstorm', 'Starfall', 'Dreadnought', 'Leveller'],
  stealth: ['Ghost', 'Shade', 'Phantasm', 'Specter', 'Wisp', 'Shadow', 'Nightshade', 'Silhouette', 'Whisper', 'Mirage', 'Chameleon', 'Ninja', 'Assassin', 'Eclipse', 'Umbra', 'Penumbra', 'Veil', 'Hush', 'Smoke', 'Stalker', 'Cipher', 'Nobody', 'Lurker', 'Wight', 'Poltergeist', 'Black Cat', 'Mist', 'Silent Night', 'Shroud', 'Vanish'],
  melee: ['Buzzsaw', 'Render', 'Butcher', 'Cleaver', 'Needler', 'Gutter', 'Hacker', 'Slasher', 'Chopper', 'Shank', 'Knuckles', 'Bonecrusher', 'Headbutt', 'Mangler', 'Gnasher', 'Chomper', 'Scissorhands', 'Lumberjack', 'Woodchipper', 'Crusher', 'Pincer', 'Claw', 'Tusk', 'Talon', 'Sawtooth', 'Thrasher', 'Gouger', 'Brawl', 'Haymaker', 'Grappler'],
};

export const GIANT_NAMES: string[] = [
  'Gigas', 'Bigmaw', 'Leviathan', 'Kraken', 'Megalodon', 'Unstoppable', 'Gargantua', 'Cyclops', 'Minotaur', 'Ogre',
  'Troll King', 'Iron Giant', 'Hecatoncheir', 'Grendel', 'Bigfoot', 'Mastodon', 'Sasquatch', 'Golem', 'Brontes', 'Typhon',
  'Fafnir', 'Jormungandr', 'Moloch', 'Baal', 'Mammon', 'Ironclad Supreme', 'Siege Lord', 'Warmonger', 'Abaddon', 'Hulk',
];

export const TITAN_NAMES: string[] = [
  'Atlas', 'Kronos', 'Hyperion', 'Prometheus', 'Oceanus', 'Titanomachy', 'Ragnarok', 'Apocalypse', 'Armageddon', 'Titanium Rex',
  'World Eater', 'Godbreaker', 'Starcrusher', 'Worldender', 'Omega', 'Doomsday', 'Final Hour', 'Last Word', 'Extinction', 'Cataclysm',
  'Ymir', 'Surtr', 'Gaia', 'Tartarus', 'Erebus', 'Nyx', 'Leviathan Prime', 'Ascendant', 'Megalith Rex', 'The End',
];

const pick = <T>(list: T[], rnd: () => number) => list[Math.floor(rnd() * list.length) % list.length];

/** A random name for a new design on this chassis (giant/titan bank by size, else the chassis' primary role). */
export function randomDesignName(chassisId: string, rnd: () => number = Math.random, taken: string[] = []): string {
  const c = CHASSIS_BY_ID.get(chassisId);
  const bank = !c ? ROLE_NAMES.assault : c.size === 5 ? TITAN_NAMES : c.size === 4 ? GIANT_NAMES : ROLE_NAMES[c.roles[0] ?? 'assault'];
  const free = bank.filter((n) => !taken.includes(n));
  let name = pick(free.length ? free : bank, rnd);
  if (taken.includes(name)) {
    let k = 2;
    while (taken.includes(`${name} Mk${k}`)) k++;
    name = `${name} Mk${k}`;
  }
  return name.slice(0, 24);
}
