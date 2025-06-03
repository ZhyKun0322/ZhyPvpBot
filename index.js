const mineflayer = require('mineflayer');
const autoEat = require('mineflayer-auto-eat');
const mineflayer = require('mineflayer');
const autoeat = require('mineflayer-auto-eat');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalFollow } = goals;
const config = require('./config.json');

const bot = mineflayer.createBot({
  host: config.host,
  port: config.port,
  username: config.username,
  password: config.password,
  version: config.version || false,
  auth: offline
};

let bot;
let mcData;
let movements;
let isEating = false;
let lastAttacker = null;

function createBot() {
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(autoEat);

  bot.once('spawn', onSpawn);
  bot.on('error', console.error);
  bot.on('end', () => setTimeout(createBot, 5000));

  bot.on('physicTick', () => {
    eatWhenHungry();
    drinkPotionsIfNeeded();
    runFromCreepers();
  });

  bot.on('entityHurt', (entity) => {
    if (entity === bot.entity) {
      handleBeingHit();
    }
  });

  bot.on('physicsTick', () => {
    openDoorsOnPath();
  });
}

function onSpawn() {
  mcData = mcDataLib(bot.version);
  movements = new Movements(bot, mcData);
  movements.allow1by1tallDoors = true;
  bot.pathfinder.setMovements(movements);

  // Enable autoEat plugin for auto eating
  bot.autoEat.options = {
    priority: 'foodPoints',
    startAt: 14,
    bannedFood: []
  };
  bot.autoEat.enable();

  equipArmor();
  setInterval(roamRandomly, 15000);
  setupBedSleep();
}

async function equipArmor() {
  const armorSlots = ['helmet', 'chestplate', 'leggings', 'boots'];
  for (const slot of armorSlots) {
    if (!bot.getEquipment(slot)) {
      const armor = bot.inventory.items().find(i => i.name.includes(slot));
      if (armor) {
        try {
          await bot.equip(armor, 'armor');
        } catch {}
      }
    }
  }
  // Equip any sword in hand
  const sword = bot.inventory.items().find(i => i.name.includes('sword'));
  if (sword) {
    try {
      await bot.equip(sword, 'hand');
    } catch {}
  }
}

function eatWhenHungry() {
  // autoEat plugin handles eating, so no need to manually eat here
  if (bot.food < 14 && !bot.autoEat.isEating()) {
    bot.autoEat.enable();
  }
}

function drinkPotionsIfNeeded() {
  if (bot.health < 10 || bot.effects.length === 0) {
    const potion = bot.inventory.items().find(i => i.name.includes('potion'));
    if (potion && !bot.usingHeldItem) {
      bot.equip(potion, 'hand').then(() => bot.consume()).catch(() => {});
    }
  }
}

function roamRandomly() {
  const pos = bot.entity.position;
  const goal = new GoalNear(pos.x + (Math.random() * 10 - 5), pos.y, pos.z + (Math.random() * 10 - 5), 1);
  bot.pathfinder.goto(goal).catch(() => {});
}

function handleBeingHit() {
  const attacker = getLastAttacker();
  if (!attacker) return;
  lastAttacker = attacker;

  bot.chat("I'll kill you!");
  setTimeout(() => bot.chat("Why did you hit me?"), 3000);
  setTimeout(() => bot.chat("Come back here!"), 6000);

  chaseAndAttack(attacker);
}

function getLastAttacker() {
  const entities = Object.values(bot.entities);
  for (const e of entities) {
    if (e.type === 'player' && e.position.distanceTo(bot.entity.position) < 12) {
      return e;
    }
  }
  return null;
}

async function chaseAndAttack(target) {
  if (!target) return;
  const dist = bot.entity.position.distanceTo(target.position);
  if (dist > 12) {
    bot.pathfinder.setGoal(null); // Stop chasing if too far
    return;
  }

  const sword = bot.inventory.items().find(i => i.name.includes('sword'));
  if (sword) {
    await bot.equip(sword, 'hand').catch(() => {});
  }

  const goal = new GoalNear(target.position.x, target.position.y, target.position.z, 1);
  bot.pathfinder.setGoal(goal, true);

  bot.attack(target);
}

function openDoorsOnPath() {
  // Automatically open doors
  const frontPos = bot.entity.position.offset(0, 0, 1);
  const block = bot.blockAt(frontPos);
  if (block && block.name.includes('door') && !block.open) {
    bot.activateBlock(block).catch(() => {});
  }
}

function setupBedSleep() {
  bot.on('time', () => {
    const time = bot.time.timeOfDay;
    if (time > 12500 && time < 13500) { // night time
      const bed = findNearbyBed();
      if (bed) {
        bot.pathfinder.goto(new GoalNear(bed.position.x, bed.position.y, bed.position.z, 1)).then(() => {
          bot.sleep(bed).catch(() => {});
        });
      }
    }
  });
}

function findNearbyBed() {
  // Find nearest bed in loaded chunks
  const beds = [];
  for (const key in bot.world.blocks) {
    const b = bot.world.blocks[key];
    if (b && b.name.includes('bed')) beds.push(b);
  }
  if (beds.length === 0) return null;

  beds.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));
  return beds[0];
}

function runFromCreepers() {
  const creepers = Object.values(bot.entities).filter(e => e.name === 'creeper' && e.position.distanceTo(bot.entity.position) < 8);
  if (creepers.length === 0) return;

  // Run away from closest creeper
  const creeper = creepers.reduce((a, b) => (a.position.distanceTo(bot.entity.position) < b.position.distanceTo(bot.entity.position)) ? a : b);
  const dir = bot.entity.position.minus(creeper.position).normalize();
  const runTo = bot.entity.position.offset(dir.x * 10, 0, dir.z * 10);
  bot.pathfinder.setGoal(new GoalNear(runTo.x, runTo.y, runTo.z, 1));
}

createBot();
