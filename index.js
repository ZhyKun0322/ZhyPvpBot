// index.js
const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;
const mcDataLoader = require('minecraft-data');
const config = require('./config.json');

// Modules
const { wanderRoutine } = require('./movements/roam');
const { attackPlayer } = require('./movements/combat');
const { eatIfHungry } = require('./movements/eat');
const sleepRoutine = require('./movements/sleep');
const { equipArmor, removeArmor } = require('./movements/armor');
const handleChat = require('./chats/commands');
const log = require('./utils/logger');

let bot;
let mcData;
let defaultMove;

function setDefaultFlags(bot) {
  bot.isSleeping = false;
  bot.isRunning = true;
  bot.isEating = false;
  bot.alreadyLoggedIn = false;
  bot.pvpEnabled = false;
  bot.armorEquipped = false;
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

  setDefaultFlags(bot);

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(pvp);

  bot.once('login', () => log('Bot logged in to the server.'));
  bot.once('spawn', () => {
    log('Bot has spawned in the world.');
    mcData = mcDataLoader(bot.version);
    defaultMove = new Movements(bot, mcData);

    defaultMove.canDig = false;
    defaultMove.canSwim = false;
    bot.pathfinder.setMovements(defaultMove);

    // Chat commands
    bot.on('chat', (username, message) =>
      handleChat(bot, username, message, { defaultMove, log })
    );

    // Eating handler
    bot.on('physicsTick', () => eatIfHungry(bot, log));

    // Start main loop
    runLoop();
  });

  // Auto-register/login
  bot.on('message', (jsonMsg) => {
    if (bot.alreadyLoggedIn) return;
    const msg = jsonMsg.toString().toLowerCase();
    if (msg.includes('register')) {
      bot.chat(`/register ${config.password} ${config.password}`);
      log('Sent register command.');
      bot.alreadyLoggedIn = true;
    } else if (msg.includes('login')) {
      bot.chat(`/login ${config.password}`);
      log('Sent login command.');
      bot.alreadyLoggedIn = true;
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
    if (!bot.isRunning || bot.isSleeping || bot.pvpEnabled) {
      await delay(3000);
      continue;
    }

    const dayTime = bot.time.dayTime;
    if (dayTime >= 13000 && dayTime <= 23458) {
      await sleepRoutine(bot, log, defaultMove, bot.pvpEnabled);
    } else {
      await wanderRoutine(bot, log);
    }

    await delay(5000);
  }
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Start the bot
createBot();

// Export for other modules
module.exports = { bot };
