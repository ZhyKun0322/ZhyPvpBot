// bot/movements/eat.js
const mcDataLoader = require('minecraft-data');

// Allowed foods
const allowedFoods = [
  'bread',
  'cooked_beef',
  'cooked_porkchop',
  'cooked_chicken',
  'cooked_mutton',
  'golden_apple'
];

async function eatIfHungry(bot, logger) {
  if (bot.isEating || bot.food === 20) return;

  const mcData = mcDataLoader(bot.version);

  const foodItem = bot.inventory.items().find(item => allowedFoods.includes(item.name));

  if (!foodItem) return; // Nothing to eat

  bot.isEating = true;

  try {
    await bot.equip(foodItem, 'hand');
    await bot.consume();
    logger(`Bot ate ${foodItem.name}`);
  } catch (err) {
    logger(`Error eating: ${err.message}`);
  } finally {
    bot.isEating = false;
  }
}

// Manual eat command
async function eatCommand(bot, logger) {
  await eatIfHungry(bot, logger);
  bot.chat("Finished eating!");
}

module.exports = {
  eatIfHungry,
  eatCommand
};
