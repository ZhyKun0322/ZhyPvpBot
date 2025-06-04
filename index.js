const mineflayer = require('mineflayer');
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const Movements = require('mineflayer-pathfinder').Movements;
const { goals: { GoalNear } } = require('mineflayer-pathfinder');
const autoEat = require('mineflayer-auto-eat');
const armorManager = require('mineflayer-armor-manager');
const pvp = require('mineflayer-pvp').plugin;
const mcDataLib = require('minecraft-data');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const bot = mineflayer.createBot({
  host: config.host,
  port: config.port,
  username: config.username,
  version: false,
});

let mcData;
let defaultMove;
let deathLocation = null;
let bedBlock = null;
let isFleeing = false;
let isFighting = false;

function isEdible(item) {
  if (!item) return false;
  const edibleItems = [
    'apple', 'bread', 'carrot', 'cooked_beef', 'cooked_chicken',
    'cooked_mutton', 'cooked_porkchop', 'cooked_rabbit', 'golden_apple',
    'melon_slice', 'potato', 'pumpkin_pie', 'rabbit_stew', 'rotten_flesh',
    'steak', 'sweet_berries', 'cooked_salmon', 'cooked_cod',
  ];
  return edibleItems.some(name => item.name.includes(name));
}

function isPotion(item) {
  if (!item) return false;
  return item.name.includes('potion');
}

function isShield(item) {
  if (!item) return false;
  return item.name.includes('shield');
}

async function equipArmor() {
  try {
    await bot.armorManager.equipAll();
  } catch {}
}

async function equipShield() {
  const shield = bot.inventory.items().find(isShield);
  if (shield) {
    try {
      await bot.equip(shield, 'off-hand');
    } catch {}
  }
}

async function equipWeapon() {
  const sword = bot.inventory.items().find(item => item.name.includes('sword'));
  if (sword) {
    try {
      await bot.equip(sword, 'hand');
      return;
    } catch {}
  }
  const bow = bot.inventory.items().find(item => item.name === 'bow');
  if (bow) {
    try {
      await bot.equip(bow, 'hand');
    } catch {}
  }
}

async function drinkPotions() {
  const potion = bot.inventory.items().find(item => {
    if (!isPotion(item)) return false;
    const name = item.displayName.toLowerCase();
    return (
      name.includes('healing') ||
      name.includes('regeneration') ||
      name.includes('strength') ||
      name.includes('swiftness')
    );
  });
  if (potion) {
    try {
      await bot.equip(potion, 'hand');
      await bot.useOnSelf();
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch {}
  }
}

async function eatFood() {
  const food = bot.inventory.items().find(isEdible);
  if (food && bot.food < 20) {
    try {
      await bot.eat(food);
    } catch {}
  }
}

async function wander() {
  if (!bot.entity) return;
  const pos = bot.entity.position;
  // Random walk near current position within wanderRadius
  const randomX = pos.x + (Math.random() * config.wanderRadius * 2 - config.wanderRadius);
  const randomZ = pos.z + (Math.random() * config.wanderRadius * 2 - config.wanderRadius);
  const goal = new GoalNear(randomX, pos.y, randomZ, 1);
  bot.pathfinder.setGoal(goal, false);
}

async function sleepOnBed() {
  if (!config.sleepAtNight) return;
  const time = bot.time.timeOfDay;
  // Nighttime is between 12541 and 23458 ticks
  if (time < 12541 || time > 23458) return;

  if (!bedBlock) {
    bedBlock = bot.findBlock({
      matching: (block) => block.name.includes('bed'),
      maxDistance: 32,
    });
  }

  if (!bedBlock) return;

  const goal = new GoalNear(bedBlock.position.x, bedBlock.position.y, bedBlock.position.z, 1);
  bot.pathfinder.setGoal(goal, false);

  if (bot.entity.position.distanceTo(bedBlock.position) < 2) {
    try {
      await bot.sleep(bedBlock.position);
      console.log('Sleeping on bed...');
      await new Promise(resolve => setTimeout(resolve, 5000)); // Sleep time
      await bot.wake();
      console.log('Woke up from bed');
    } catch (err) {
      console.log('Could not sleep:', err.message);
    }
  }
}

async function returnToDeathLocation() {
  if (!deathLocation) return;
  const goal = new GoalNear(deathLocation.x, deathLocation.y, deathLocation.z, 1);
  bot.pathfinder.setGoal(goal, false);
  if (bot.entity.position.distanceTo(deathLocation) < 2) {
    deathLocation = null;
  }
}

async function startFight(player) {
  if (isFighting) return;
  isFighting = true;
  isFleeing = false;

  console.log(`Started fighting with ${player.username}`);

  while (isFighting) {
    if (bot.health < bot.maxHealth * config.maxFleeHealthPercent) {
      isFleeing = true;
      await fleeFrom(player);
    } else {
      isFleeing = false;
      await fightPlayer(player);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function fleeFrom(player) {
  const botPos = bot.entity.position;
  const playerPos = player.entity.position;

  const fleeX = botPos.x + (botPos.x - playerPos.x) * 2;
  const fleeZ = botPos.z + (botPos.z - playerPos.z) * 2;
  const fleeGoal = new GoalNear(fleeX, botPos.y, fleeZ, 1);
  bot.pathfinder.setGoal(fleeGoal, false);

  const start = Date.now();
  while (bot.health < bot.maxHealth * config.returnFightHealthPercent && Date.now() - start < 5000) {
    await eatFood();
    await drinkPotions();
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  isFleeing = false;
}

async function fightPlayer(player) {
  if (!player.entity) return;

  await equipArmor();
  await equipShield();
  await equipWeapon();
  await drinkPotions();

  const goal = new GoalNear(player.entity.position.x, player.entity.position.y, player.entity.position.z, 1);
  bot.pathfinder.setGoal(goal);

  try {
    await bot.pvp.attack(player);
  } catch {}

  if (bot.entity.onGround) {
    bot.setControlState('jump', true);
    setTimeout(() => bot.setControlState('jump', false), 200);
  }
  await eatFood();
}

function stopFight() {
  isFighting = false;
  bot.pathfinder.setGoal(null);
}

bot.once('spawn', () => {
  mcData = mcDataLib(bot.version);
  bot.mcData = mcData;

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(autoEat);
  bot.loadPlugin(armorManager);
  bot.loadPlugin(pvp);

  defaultMove = new Movements(bot, mcData);
  bot.pathfinder.setMovements(defaultMove);

  bot.autoEat.options = {
    priority: 'food',
    startAt: 14,
    bannedFood: []
  };

  bot.on('windowUpdate', () => {
    equipArmor();
    equipShield();
  });

  bot.on('entityHurt', (entity) => {
    if (entity === bot.entity && entity.lastDamageSource) {
      const attacker = bot.players[entity.lastDamageSource.username];
      if (attacker && attacker.entity) {
        console.log(`${attacker.username} attacked me! Starting fight.`);
        startFight(attacker.entity);
      }
    }
  });

  bot.on('death', () => {
    console.log('I died!');
    deathLocation = bot.entity.position.clone();
    stopFight();
  });

  bot.on('respawn', () => {
    console.log('Respawned');
    if (deathLocation) {
      returnToDeathLocation();
    }
  });

  setInterval(async () => {
    if (!bot.entity) return;

    if (!isFighting && !isFleeing) {
      await sleepOnBed();
      await wander();
      await eatFood();
    }
  }, config.wanderIntervalSec * 1000);
});

bot.on('error', err => console.log('Error:', err));
bot.on('kicked', reason => console.log('Kicked:', reason));
