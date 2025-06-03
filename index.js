const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalNear } } = require('mineflayer-pathfinder');
const autoEat = require('mineflayer-auto-eat');
const mcDataLoader = require('minecraft-data');
const config = require('./config.json');
const fs = require('fs');
const Vec3 = require('vec3');

let bot, mcData, defaultMove;
let isSleeping = false;

function createBot() {
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    auth: 'offline',
    version: config.version || false
  });

  bot.once('spawn', () => {
    mcData = mcDataLoader(bot.version);
    bot.loadPlugin(pathfinder);
    bot.loadPlugin(autoEat);

    defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);

    setupSleepRoutine();
    setupAutoEat();
    roamHouseLoop();
  });

  bot.on('error', console.error);
  bot.on('end', () => {
    console.log("Bot disconnected. Reconnecting in 5s...");
    setTimeout(createBot, 5000);
  });
}

function setupSleepRoutine() {
  bot.on('time', async () => {
    if (bot.time.dayTime > 13000 && bot.time.dayTime < 23460 && !isSleeping) {
      const bed = bot.findBlock({ matching: b => bot.isABed(b), maxDistance: 16 });
      if (bed) {
        try {
          await bot.pathfinder.goto(new GoalNear(bed.position.x, bed.position.y, bed.position.z, 1));
          await bot.sleep(bed);
          isSleeping = true;
          console.log('Bot is sleeping...');

          bot.once('wake', () => {
            console.log('Bot woke up.');
            isSleeping = false;
          });
        } catch (e) {
          console.log(`Sleep failed: ${e.message}`);
        }
      } else {
        console.log("No bed found nearby.");
      }
    }
  });
}

function setupAutoEat() {
  bot.autoEat.options = {
    priority: 'foodPoints',
    startAt: 16,
    bannedFood: []
  };

  bot.on('health', () => {
    if (bot.food < 18) {
      bot.autoEat.enable();
    } else {
      bot.autoEat.disable();
    }
  });
}

async function roamHouseLoop() {
  const center = config.houseCenter;
  const radius = config.houseRadius || 4;

  while (true) {
    if (!bot || !bot.entity || isSleeping) {
      await delay(5000);
      continue;
    }

    const dx = Math.floor(Math.random() * (radius * 2 + 1)) - radius;
    const dz = Math.floor(Math.random() * (radius * 2 + 1)) - radius;
    const target = new Vec3(center.x + dx, center.y, center.z + dz);

    try {
      await bot.pathfinder.goto(new GoalNear(target.x, target.y, target.z, 1));
    } catch (e) {
      console.log(`Roam failed: ${e.message}`);
    }

    await delay(5000);
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

createBot();
