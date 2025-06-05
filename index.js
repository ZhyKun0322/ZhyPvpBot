const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalNear } } = require('mineflayer-pathfinder');
const Vec3 = require('vec3');
const mcDataLoader = require('minecraft-data');
const fs = require('fs');
const config = require('./config.json');
const pvp = require('mineflayer-pvp').plugin;

let bot, mcData, defaultMove;
let sleeping = false;
let isRunning = true;
let isEating = false;
let alreadyLoggedIn = false;

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

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(pvp);

  bot.once('login', () => {
    log('Bot logged in to the server.');
  });

  bot.once('spawn', () => {
    log('Bot has spawned in the world.');
    mcData = mcDataLoader(bot.version);
    defaultMove = new Movements(bot, mcData);
    defaultMove.allow1by1tallDoors = true;
    defaultMove.canDig = false;
    bot.pathfinder.setMovements(defaultMove);

    bot.on('chat', onChat);
    bot.on('physicsTick', eatIfHungry);

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

  if (message === '!sleep') {
    bot.chat("Trying to sleep...");
    sleepRoutine();
    return;
  }

  if (username !== 'ZhyKun') return;

  if (message === '!stop') {
    isRunning = false;
    bot.chat("Bot paused.");
  }
  if (message === '!start') {
    isRunning = true;
    bot.chat("Bot resumed.");
  }
  if (message === '!roam') {
    bot.chat("Wandering around...");
    wanderRoutine();
  }
  if (message === '!come') {
    const player = bot.players[username]?.entity;
    if (player) {
      bot.chat('Coming to you!');
      goTo(player.position);
    } else {
      bot.chat('Cannot find you!');
    }
  }

  if (message === '!pvp') {
    const target = bot.players[username]?.entity;
    if (!target) return bot.chat("Can't find you!");
    const sword = bot.inventory.items().find(item => mcData.items[item.type].name.includes('sword'));
    if (sword) {
      bot.equip(sword, 'hand').then(() => {
        bot.chat('Equipped sword! Attacking...');
        bot.pvp.attack(target);
      }).catch(err => {
        bot.chat("Failed to equip sword.");
        log(err.message);
      });
    } else {
      bot.chat('No sword found in inventory.');
    }
  }

  if (message === '!pvpstop') {
    bot.pvp.stop();
    bot.chat("PvP stopped.");
  }

  if (message === '!armor') {
    wearArmor();
  }

  if (message === '!removearmor') {
    removeArmor();
  }
}

function eatIfHungry() {
  if (isEating || bot.food === 20) return;

  const foodItem = bot.inventory.items().find(item => {
    const itemInfo = mcData.items[item.type];
    return itemInfo && itemInfo.food;
  });

  if (!foodItem) return;

  isEating = true;
  bot.equip(foodItem, 'hand')
    .then(() => bot.consume())
    .then(() => log(`Bot ate ${mcData.items[foodItem.type].name}`))
    .catch(err => log(`Error eating: ${err.message}`))
    .finally(() => isEating = false);
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
      await wanderRoutine();
    }

    await delay(5000);
  }
}

async function sleepRoutine() {
  if (sleeping) return;
  const bed = bot.findBlock({
    matching: b => bot.isABed(b),
    maxDistance: config.searchRange
  });

  if (!bed) {
    log('No bed found nearby.');
    return;
  }

  log(`Heading to bed at ${bed.position}`);
  try {
    await goTo(bed.position);
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

async function wanderRoutine() {
  log('Wandering randomly...');
  for (let i = 0; i < 5; i++) {
    if (sleeping) return;

    const dx = Math.floor(Math.random() * 11) - 5;
    const dz = Math.floor(Math.random() * 11) - 5;
    const pos = bot.entity.position.offset(dx, 0, dz);

    const ground = bot.blockAt(pos.offset(0, -1, 0));
    const block = bot.blockAt(pos);

    if (ground && block && ground.boundingBox === 'block' && block.boundingBox === 'empty') {
      log(`Moving to ${pos}`);
      await goTo(pos);
      await delay(3000);
    } else {
      log(`Skipped unreachable position at ${pos}`);
    }
  }
}

async function goTo(pos) {
  try {
    await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 1));
  } catch (e) {
    log(`Navigation error: ${e.message}`);
  }
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function wearArmor() {
  const armorSlots = ['head', 'torso', 'legs', 'feet'];
  const armorTypes = ['helmet', 'chestplate', 'leggings', 'boots'];

  for (let i = 0; i < armorSlots.length; i++) {
    const slot = armorSlots[i];
    const type = armorTypes[i];
    const armor = bot.inventory.items().find(item => mcData.items[item.type].name.includes(type));
    if (armor) {
      bot.equip(armor, slot).then(() => {
        log(`Equipped ${type}`);
      }).catch(err => {
        log(`Failed to equip ${type}: ${err.message}`);
      });
    }
  }
  bot.chat('Equipping armor.');
}

function removeArmor() {
  const armorSlots = ['head', 'torso', 'legs', 'feet'];
  for (const slot of armorSlots) {
    bot.unequip(slot).catch(err => log(`Error removing ${slot}: ${err.message}`));
  }
  bot.chat('Removed all armor.');
}

createBot();
