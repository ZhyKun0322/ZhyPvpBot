const mineflayer = require('mineflayer');
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
  fs.appendFileSync('logs.txt', fullMsg + '\n');
}

function createBot() {
  log('Creating bot...');
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
    auth: 'offline'
  });

  bot.once('login', () => log('Bot logged in to the server.'));

  bot.once('spawn', async () => {
    log('Bot has spawned in the world.');

    mcData = require('minecraft-data')(bot.version);

    bot.loadPlugin(pathfinder);
    bot.loadPlugin(autoEat);
    bot.loadPlugin(pvp);
    bot.loadPlugin(armorManager);

    defaultMove = new Movements(bot, mcData);
    defaultMove.canDig = false;
    bot.pathfinder.setMovements(defaultMove);

    bot.autoEat.options.priority = 'foodPoints';
    bot.autoEat.options.bannedFood = [];

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

    bot.on('spawn', () => {
      if (deathPosition) {
        log('Attempting to recover items...');
        goTo(deathPosition);
        deathPosition = null;
      }
    });

    runLoop();
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
  }

  if (message === '!start') {
    isRunning = true;
    bot.chat("Bot resumed.");
  }

  if (message === '!sleep') {
    bot.chat("Trying to sleep...");
    sleepRoutine();
  }

  if (message === '!wander') {
    bot.chat("Wandering...");
    randomWander();
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
    const name = mcData.items[item.type].name;
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
    const potion = bot.inventory.items().find(i => mcData.items[i.type].name.includes('potion'));
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

    bot.once('wake', () => {
      sleeping = false;
      bot.chat("Woke up!");
      log('Woke up from sleep.');
    });
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

createBot();
