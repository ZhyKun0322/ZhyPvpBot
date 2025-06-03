const mineflayer = require('mineflayer');
const autoEat = require('mineflayer-auto-eat');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalFollow, GoalNear } = goals;
const mcDataLoader = require('minecraft-data');
const config = require('./config.json');

function createBot() {
  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    version: config.version || false,
    auth: config.auth || 'offline'
  });

  let mcData;
  let movements;

  bot.loadPlugin(autoEat);

  bot.once('spawn', () => {
    try {
      if (!bot.version) throw new Error('Bot version not loaded');
      mcData = mcDataLoader(bot.version);
      bot.loadPlugin(pathfinder);

      movements = new Movements(bot, mcData);
      movements.allow1by1tallDoors = true;
      bot.pathfinder.setMovements(movements);

      setupBot();
    } catch (err) {
      console.error('Spawn error:', err.message);
      bot.end(); // force restart
    }
  });

  bot.on('error', err => {
    console.error('Error:', err);
  });

  bot.on('end', () => {
    console.log('Bot disconnected. Reconnecting...');
    setTimeout(createBot, 5000);
  });

  function setupBot() {
    bot.autoEat.options = {
      priority: 'foodPoints',
      startAt: 14,
      bannedFood: []
    };
    bot.autoEat.enable();

    equipArmor();
    setInterval(walkAround, 10000);
  }

  function equipArmor() {
    const armorSlots = ['helmet', 'chestplate', 'leggings', 'boots'];
    for (const slot of armorSlots) {
      const item = bot.inventory.items().find(i => i.name.includes(slot));
      if (item) bot.equip(item, 'armor').catch(() => {});
    }

    const sword = bot.inventory.items().find(i => i.name.includes('sword'));
    if (sword) bot.equip(sword, 'hand').catch(() => {});
  }

  function walkAround() {
    const pos = bot.entity.position;
    const goal = new GoalNear(pos.x + (Math.random() * 6 - 3), pos.y, pos.z + (Math.random() * 6 - 3), 1);
    bot.pathfinder.setGoal(goal);
  }

  bot.on('physicsTick', () => {
    if (bot.food < 14) bot.autoEat.enable();
  });
}

createBot();
