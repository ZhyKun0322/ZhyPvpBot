const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalNear } } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;
const Vec3 = require('vec3');
const mcDataLoader = require('minecraft-data');
const fs = require('fs');
const config = require('./config.json');

let bot, mcData, defaultMove;
let sleeping = false;
let isRunning = true;
let isEating = false;
let alreadyLoggedIn = false;
let pvpEnabled = false;
let armorEquipped = false;
let patrolEnabled = false;
let patrolTaskRunning = false;

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

  bot.once('login', () => log('Bot logged in to the server.'));
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

  bot.on('message', (jsonMsg) => {
    if (alreadyLoggedIn) return;
    const msg = jsonMsg.toString().toLowerCase();
    if (msg.includes('register')) {
      bot.chat(`/register ${config.password} ${config.password}`);
      log('Sent register command.');
      alreadyLoggedIn = true;
    } else if (msg.includes('login')) {
      bot.chat(`/login ${config.password}`);
      log('Sent login command.');
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

  if (message.startsWith('!debugentities')) {
    const names = Object.values(bot.entities)
      .filter(e => e.type === 'player' && e.username)
      .map(e => e.username)
      .join(', ');
    bot.chat(`Players detected: ${names || 'None'}`);
    log(`Players detected: ${names || 'None'}`);
    return;
  }

  // ✅ Public commands (available to everyone)
  if (message === '!sleep') {
    bot.chat("Trying to sleep...");
    sleepRoutine();
    return;
  }

  if (message === '!pvp') {
  const player = Object.values(bot.entities).find(e => e.type === 'player' && e.username === username);
  if (player) {
    const sword = bot.inventory.items().find(item => item.name.includes('sword'));
    const axe = bot.inventory.items().find(item => item.name.includes('axe') && !item.name.includes('pickaxe'));
    const bow = bot.inventory.items().find(item => item.name.includes('bow'));

    const dist = bot.entity.position.distanceTo(player.position);

    if (dist >= 10 && bow) {
      bot.equip(bow, 'hand').then(() => {
        log(`Equipped bow for ranged PvP.`);
      }).catch(e => log(`Error equipping bow: ${e.message}`));
    } else if (sword) {
      bot.equip(sword, 'hand').then(() => {
        log(`Equipped sword: ${sword.name}`);
      }).catch(e => log(`Error equipping sword: ${e.message}`));
    } else if (axe) {
      bot.equip(axe, 'hand').then(() => {
        log(`No sword found. Equipped axe: ${axe.name}`);
      }).catch(e => log(`Error equipping axe: ${e.message}`));
    } else {
      bot.chat("No sword or axe found in inventory!");
      log("PvP canceled: No weapon found.");
      return;
    }

    pvpEnabled = true;
    bot.pvp.attack(player);
    bot.chat(`PvP started against ${username}.`);
    log(`Started PvP against ${username}`);
  } else {
    bot.chat("Can't find you!");
    const detectedNames = Object.values(bot.entities)
      .filter(e => e.type === 'player' && e.username)
      .map(e => e.username)
      .join(', ');
    log(`Detected players when trying PvP: ${detectedNames || 'None'}`);
  }
  return;
  }
  
  if (message === '!pvpstop') {
    pvpEnabled = false;
    bot.pvp.stop();
    bot.chat("PvP stopped.");
    log("PvP stopped.");
    return;
  }

  if (message === '!armor') {
    equipArmor();
    return;
  }

  if (message === '!removearmor') {
    removeArmor();
    return;
  }

  // 🔒 Owner-only commands (ZhyKun only)
  if (username !== 'ZhyKun') return;

  if (message === '!stop') {
    isRunning = false;
    bot.chat("Bot paused.");
    return;
  }

  if (message === '!start') {
    isRunning = true;
    bot.chat("Bot resumed.");
    return;
  }

  if (message === '!roam') {
    bot.chat("Wandering around...");
    wanderRoutine();
    return;
  }

    if (message === '!come') {
    const player = Object.values(bot.entities).find(e => e.type === 'player' && e.username === username);
    if (player) {
      bot.chat('Coming to you!');
      goTo(player.position);
    } else {
      bot.chat('Cannot find you!');
    }
    return;
  }

  if (message === '!patrol') {
    patrolEnabled = true;
    bot.chat('Patrolling for hostile mobs...');
    runPatrol();
    return;
  }

  if (message === '!patrolstop') {
    patrolEnabled = false;
    bot.chat('Stopped patrolling.');
    return;
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
    if (!isRunning || sleeping || pvpEnabled) {
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
    if (sleeping || pvpEnabled) return;

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

async function equipArmor() {
  if (armorEquipped) return;
  const armorItems = bot.inventory.items().filter(item =>
    item.name.includes('helmet') ||
    item.name.includes('chestplate') ||
    item.name.includes('leggings') ||
    item.name.includes('boots')
  );

  for (const item of armorItems) {
    try {
      let slot = 'torso';
      if (item.name.includes('helmet')) slot = 'head';
      else if (item.name.includes('chestplate')) slot = 'torso';
      else if (item.name.includes('leggings')) slot = 'legs';
      else if (item.name.includes('boots')) slot = 'feet';

      await bot.equip(item, slot);
      log(`Equipped ${item.name} in ${slot}`);
    } catch (e) {
      log(`Failed to equip ${item.name}: ${e.message}`);
    }
  }

  armorEquipped = true;
  bot.chat("Armor equipped.");
  log("Equipped armor.");
}

async function removeArmor() {
  if (!armorEquipped) return;
  const armorSlots = ['head', 'torso', 'legs', 'feet'];

  for (const slot of armorSlots) {
    try {
      await bot.unequip(slot);
    } catch (e) {
      log(`Failed to remove armor from ${slot}: ${e.message}`);
    }
  }

  armorEquipped = false;
  bot.chat("Armor removed.");
  log("Removed armor.");
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runPatrol() {
  if (patrolTaskRunning) return;
  patrolTaskRunning = true;

  while (patrolEnabled) {
    const time = bot.time.dayTime;
    if (time < 13000 || time > 23458) {
      bot.chat("It's daytime. Stopping patrol.");
      patrolEnabled = false;
      break;
    }

    const hostiles = bot.nearestEntity(entity =>
      entity.type === 'mob' &&
      ['zombie', 'skeleton', 'spider'].includes(entity.name)
    );

    const creeper = bot.nearestEntity(e => e.name === 'creeper');

    if (creeper) {
      const bow = bot.inventory.items().find(i => i.name.includes('bow'));
      const runAwayPos = bot.entity.position.offset(
        (bot.entity.position.x - creeper.position.x > 0 ? 15 : -15),
        0,
        (bot.entity.position.z - creeper.position.z > 0 ? 15 : -15)
      );

      bot.chat('Creeper detected! Running and shooting...');
      await goTo(runAwayPos);

      if (bow) {
        try {
          await bot.equip(bow, 'hand');
          bot.lookAt(creeper.position.offset(0, 1.6, 0));
          bot.activateItem();
        } catch (e) {
          log(`Couldn't shoot creeper: ${e.message}`);
        }
      }
    } else if (hostiles) {
      bot.chat(`Engaging ${hostiles.name}!`);
      try {
        await bot.pvp.attack(hostiles);
      } catch (e) {
        log(`PvP error: ${e.message}`);
      }
    }

    await delay(3000);
  }

  patrolTaskRunning = false;
}

createBot();
