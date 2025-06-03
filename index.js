(r => setTimeout(r, ms));
}

createBot();
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
let isEating = false;
let alreadyLoggedIn = false;
let target = null;

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

  bot.once('login', () => {
    log('Bot logged in to the server.');
  });

  bot.once('spawn', () => {
    log('Bot has spawned in the world.');
    mcData = require('minecraft-data')(bot.version); // ✅ Must be before plugin load

    bot.loadPlugin(pathfinder);
    bot.loadPlugin(autoEat);
    bot.loadPlugin(pvp);
    bot.loadPlugin(armorManager);

    defaultMove = new Movements(bot, mcData);
    defaultMove.allow1by1tallDoors = true;
    defaultMove.canDig = false;
    bot.pathfinder.setMovements(defaultMove);

    bot.autoEat.options.priority = 'foodPoints';
    bot.autoEat.options.bannedFood = [];

    bot.on('chat', onChat);
    bot.on('physicsTick', () => {
      eatIfHungry();
      equipArmor();
    });
    bot.on('entityHurt', onEntityHurt);

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
  if (message === '!roam') {
    bot.chat("Roaming inside the house...");
    houseRoamRoutine();
  }
  if (message === '!defend') {
    bot.chat("Enabling defense mode.");
    target = null;
  }
  if (message === '!stopdefend') {
    bot.chat("Defense mode off.");
    target = null;
  }
}

function onEntityHurt(victim) {
  if (!isRunning || sleeping || victim.type !== 'player') return;
  const attacker = Object.values(bot.entities).find(e => e.type === 'player' && e !== bot.entity);
  if (attacker) {
    target = attacker;
    bot.pvp.attack(target);
    log(`Defending against: ${attacker.username}`);
  }
}

function eatIfHungry() {
  if (isEating || bot.food >= 18) return;
  const food = bot.inventory.items().find(i => mcData.items[i.type].food);
  if (food) {
    isEating = true;
    bot.equip(food, 'hand')
      .then(() => bot.consume())
      .catch(err => log(`Error eating: ${err.message}`))
      .finally(() => isEating = false);
  }
}

function equipArmor() {
  bot.inventory.items().forEach(item => {
    if (mcData.items[item.type].name.includes('helmet')) bot.armorManager.equip(item, 'head');
    else if (mcData.items[item.type].name.includes('chestplate')) bot.armorManager.equip(item, 'torso');
    else if (mcData.items[item.type].name.includes('leggings')) bot.armorManager.equip(item, 'legs');
    else if (mcData.items[item.type].name.includes('boots')) bot.armorManager.equip(item, 'feet');
  });
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
      await searchFoodInChests();
      await houseRoamRoutine();
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
    await goTo(config.entrance);
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

async function searchFoodInChests() {
  for (let chestPos of config.chestPositions) {
    const block = bot.blockAt(new Vec3(chestPos.x, chestPos.y, chestPos.z));
    if (!block) continue;

    try {
      const chest = await bot.openContainer(block);
      const food = chest.containerItems().find(i => i && mcData.items[i.type].food);
      if (food) {
        const toWithdraw = Math.min(food.count, food.type);
        await chest.withdraw(food.type, null, toWithdraw);
        log(`Withdrew ${toWithdraw} of ${mcData.items[food.type].name}`);
      }
      chest.close();
    } catch (e) {
      log(`Chest error: ${e.message}`);
    }
  }
}

async function houseRoamRoutine() {
  log('Roaming inside house.');
  bot.chat(config.chatAnnouncements.houseMessage);
  const radius = config.houseRadius;

  for (let i = 0; i < 5; i++) {
    if (sleeping) return;
    const dx = Math.floor(Math.random() * (radius * 2 + 1)) - radius;
    const dz = Math.floor(Math.random() * (radius * 2 + 1)) - radius;
    const target = new Vec3(config.houseCenter.x + dx, config.houseCenter.y, config.houseCenter.z + dz);
    await goTo(target);
    await delay(3000);
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

createBot();
