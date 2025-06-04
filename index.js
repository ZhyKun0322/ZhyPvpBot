const mineflayer = require('mineflayer');
const mcDataLib = require('minecraft-data');
const { pathfinder, Movements, goals: { GoalNear } } = require('mineflayer-pathfinder');
const autoEat = require('mineflayer-auto-eat');
const pvp = require('mineflayer-pvp').plugin;
const armorManager = require('mineflayer-armor-manager');
const Vec3 = require('vec3');
const fs = require('fs');
const config = require('./config.json');

let bot, mcData, defaultMove;
let sleeping = false;
let isRunning = true;
let alreadyLoggedIn = false;
let deathPosition = null;

function log(msg) {
  const time = new Date().toISOString();
  const fullMsg = `[${time}] ${msg}`;
  console.log(fullMsg);
  try {
    fs.appendFileSync('logs.txt', fullMsg + '\n');
  } catch (e) {
    console.error('Failed to write log:', e.message);
  }
}

function createBot() {
  log('Creating bot...');
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password || undefined,
    version: config.version,
    auth: config.auth || 'offline'  // Change to 'mojang' or 'microsoft' if needed
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(autoEat);
  bot.loadPlugin(pvp);
  bot.loadPlugin(armorManager);

  bot.once('login', () => log('Bot logged in to the server.'));
  bot.once('spawn', async () => {
    log('Bot has spawned in the world.');

    mcData = mcDataLib(bot.version);
    defaultMove = new Movements(bot, mcData);
    defaultMove.canDig = false;
    bot.pathfinder.setMovements(defaultMove);

    bot.autoEat.options = {
      priority: 'foodPoints',
      bannedFood: []
    };

    bot.on('chat', onChat);
    bot.on('entityHurt', onEntityHurt);
    bot.on('physicsTick', () => {
      equipArmorAndWeapons();
      usePotionIfLow();
    });

    bot.on('death', () => {
      deathPosition = bot.entity.position.clone();
      log('Bot has died.');
    });

    bot.once('spawn', () => {
      if (deathPosition) {
        log('Attempting to recover items...');
        goTo(deathPosition).catch(e => log(`Failed to recover items: ${e.message}`));
        deathPosition = null;
      }
    });

    runLoop().catch(e => log(`runLoop error: ${e.message}`));
  });

  bot.on('message', msg => {
    const text = msg.toString().toLowerCase();
    log(`Server Message: ${text}`);

    if (alreadyLoggedIn) return;

    if (text.includes('register')) {
      bot.chat(`/register ${config.password} ${config.password}`);
      alreadyLoggedIn = true;
    } else if (text.includes('login')) {
      bot.chat(`/login ${config.password}`);
      alreadyLoggedIn = true;
    }
  });

  bot.on('kicked', reason => log(`[KICKED] ${reason}`));
  bot.on('error', err => log(`[ERROR] ${err.message}`));
  bot.on('end', () => {
    log('Bot disconnected. Reconnecting in 5 seconds...');
    setTimeout(createBot, 5000);
  });
}

function onChat(username, message) {
  if (username === bot.username) return;

  if (message === '!stop') {
    isRunning = false;
    bot.chat("Bot paused.");
  } else if (message === '!start') {
    isRunning = true;
    bot.chat("Bot resumed.");
  } else if (message === '!sleep') {
    bot.chat("Trying to sleep...");
    sleepRoutine().catch(e => log(`Sleep routine error: ${e.message}`));
  } else if (message === '!wander') {
    bot.chat("Wandering...");
    randomWander().catch(e => log(`Wander error: ${e.message}`));
  }
}

function onEntityHurt(victim) {
  if (!isRunning || sleeping) return;
  if (victim !== bot.entity) return;

  const attacker = Object.values(bot.entities).find(e =>
    e.type === 'player' &&
    e.position.distanceTo(bot.entity.position) < 6
  );

  if (attacker) {
    bot.pvp.attack(attacker);
    log(`Attacked by: ${attacker.username} – Counterattacking.`);
  }
}

function equipArmorAndWeapons() {
  bot.inventory.items().forEach(item => {
    if (!item) return;
    const name = mcData.items[item.type]?.name || '';
    try {
      if (name.includes('helmet')) bot.armorManager.equip(item, 'head');
      else if (name.includes('chestplate')) bot.armorManager.equip(item, 'torso');
      else if (name.includes('leggings')) bot.armorManager.equip(item, 'legs');
      else if (name.includes('boots')) bot.armorManager.equip(item, 'feet');
      else if (name.includes('sword')) bot.equip(item, 'hand');
      else if (name.includes('shield')) bot.equip(item, 'off-hand');
      else if (name.includes('bow')) bot.equip(item, 'hand');
    } catch (e) {
      log(`Equip error: ${e.message}`);
    }
  });
}

function usePotionIfLow() {
  if (bot.health < 10) {
    const potion = bot.inventory.items().find(i => mcData.items[i.type]?.name.includes('potion'));
    if (potion) {
      bot.equip(potion, 'hand')
        .then(() => bot.consume())
        .catch(err => log(`Potion error: ${err.message}`));
    }
  }
}

async function runLoop() {
  while (true) {
    if (!isRunning || sleeping) {
      await delay(3000);
      continue;
    }

    const dayTime = bot.time.dayTime;
    // Nighttime in Minecraft: 13000 - 23458
    if (dayTime >= 13000 && dayTime <= 23458) {
      await sleepRoutine();
    } else {
      await randomWander();
    }

    await delay(5000);
  }
}

async function sleepRoutine() {
  if (sleeping) return;

  const bed = bot.findBlock({
    matching: b => bot.isABed(b),
    maxDistance: 32
  });

  if (!bed) {
    log('No bed found nearby.');
    return;
  }

  log(`Heading to bed at ${bed.position}`);
  try {
    await bot.pathfinder.goto(new GoalNear(bed.position.x, bed.position.y, bed.position.z, 1));
    await bot.sleep(bed);
    sleeping = true;
    bot.chat("Sleeping now...");
    log('Sleeping...');

    await onceAsync(bot, 'wake');

    sleeping = false;
    bot.chat("Woke up!");
    log('Woke up from sleep.');
  } catch (e) {
    log(`Sleep failed: ${e.message}`);
    bot.chat(`Sleep failed: ${e.message}`);
  }
}

async function randomWander() {
  const xOffset = Math.floor(Math.random() * 20) - 10;
  const zOffset = Math.floor(Math.random() * 20) - 10;
  const target = bot.entity.position.offset(xOffset, 0, zOffset);
  await goTo(target);
}

async function goTo(pos) {
  try {
    await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 1));
  } catch (e) {
    log(`Navigation error: ${e.message}`);
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to convert event once into promise
function onceAsync(emitter, event) {
  return new Promise(resolve => {
    emitter.once(event, (...args) => {
      resolve(...args);
    });
  });
}

createBot();
