const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalNear } } = require('mineflayer-pathfinder');
const autoeat = require('mineflayer-auto-eat');
const { Vec3 } = require('vec3');
const config = require('./config.json');

let bot;
let hasLoggedIn = false;

function createBot() {
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(autoeat);

  bot.once('spawn', () => {
    hasLoggedIn = false;
    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);

    bot.autoEat.options = {
      priority: 'foodPoints',
      startAt: 18,
      bannedFood: []
    };

    roamRandomly();
  });

  bot.on('message', (message) => {
    const msg = message.toString().toLowerCase();

    if (!hasLoggedIn) {
      if (msg.includes('/register')) {
        bot.chat(`/register ${config.password} ${config.password}`);
      } else if (msg.includes('/login')) {
        bot.chat(`/login ${config.password}`);
      }

      if (msg.includes('successfully') || msg.includes('logged in')) {
        hasLoggedIn = true;
        bot.chat('Logged in ✅');
      }
    }
  });

  function roamRandomly() {
    setInterval(() => {
      const x = bot.entity.position.x + (Math.random() * 10 - 5);
      const z = bot.entity.position.z + (Math.random() * 10 - 5);
      bot.pathfinder.setGoal(new GoalNear(x, bot.entity.position.y, z, 1));
    }, 10000);
  }

  bot.on('health', () => {
    if (bot.food < 18) bot.autoEat.enable();
    else bot.autoEat.disable();
  });

  bot.on('end', () => {
    console.log('Bot disconnected. Reconnecting in 5 seconds...');
    setTimeout(createBot, 5000);
  });

  bot.on('kicked', reason => {
    console.log('Bot kicked:', reason);
  });

  bot.on('error', err => {
    console.log('Bot error:', err);
  });
}

createBot();
