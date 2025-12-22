// index.js
const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;
const mcDataLoader = require('minecraft-data');
const config = require('./config.json');

// Modules
const roam = require('./movements/roam');
const combat = require('./movements/combat');
const eat = require('./movements/eat');
const sleep = require('./movements/sleep');
const armor = require('./movements/armor');
const chat = require('./chat');
const { log } = require('./utils/logger');

let bot;
let mcData;
let defaultMove;

// Flags
let sleeping = false;
let isRunning = true;
let isEating = false;
let alreadyLoggedIn = false;
let pvpEnabled = false;
let armorEquipped = false;
let patrolEnabled = false;
let patrolTaskRunning = false;

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

    // 🚫 Prevent block breaking outside combat
    defaultMove.canDig = false;

    bot.pathfinder.setMovements(defaultMove);

    // Attach modules
    bot.on('chat', (username, message) => chat(bot, username, message, {
      isRunning,
      sleeping,
      pvpEnabled,
      armorEquipped,
      patrolEnabled,
      patrolTaskRunning
    }));

    bot.on('physicsTick', () => eat(bot, { mcData, isEating }));

    // Start main loop
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

async function runLoop() {
  while (true) {
    if (!isRunning || sleeping || pvpEnabled) {
      await delay(3000);
      continue;
    }

    const dayTime = bot.time.dayTime;
    if (dayTime >= 13000 && dayTime <= 23458) {
      await sleep(bot);
    } else {
      await roam(bot);
    }

    await delay(5000);
  }
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Start bot
createBot();

module.exports = {
  bot,
  sleeping,
  isRunning,
  isEating,
  pvpEnabled,
  armorEquipped,
  patrolEnabled,
  patrolTaskRunning
};
