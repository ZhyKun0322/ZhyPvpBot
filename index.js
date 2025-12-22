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
const { sleepRoutine } = require('./movements/sleep');
const { equipArmor, removeArmor } = require('./movements/armor');
const chat = require('./chats/commands'); // Your chat commands
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

    // Prevent block breaking outside combat
    defaultMove.canDig = false;
    defaultMove.canSwim = false; // only swim in combat if needed
    bot.pathfinder.setMovements(defaultMove);

    // Chat commands
    bot.on('chat', (username, message) => chat(bot, username, message, {
      isRunning,
      sleeping,
      pvpEnabled,
      armorEquipped
    }));

    // Eating handler
    bot.on('physicsTick', () => eatIfHungry(bot, log));

    // Start main loop
    runLoop();
  });

  // Auto-register/login
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
      await sleepRoutine(bot, log);
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

// Export for other modules if needed
module.exports = {
  bot,
  sleeping,
  isRunning,
  isEating,
  pvpEnabled,
  armorEquipped
};
