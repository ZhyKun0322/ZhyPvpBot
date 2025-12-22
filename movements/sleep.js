// movements/sleep.js
const { GoalNear } = require('mineflayer-pathfinder');

async function sleepRoutine(bot, log, config = { searchRange: 16 }) {
  if (bot.isSleeping) return;

  const bed = bot.findBlock({
    matching: b => bot.isABed(b),
    maxDistance: config.searchRange
  });

  if (!bed) {
    log('No bed found nearby.');
    bot.chat('No bed found nearby.');
    return;
  }

  log(`Heading to bed at ${bed.position}`);
  bot.chat('Going to bed...');

  try {
    bot.isSleeping = true; // lock sleep state
    await bot.pathfinder.goto(new GoalNear(bed.position.x, bed.position.y, bed.position.z, 1));

    await bot.sleep(bed);
    bot.chat('Sleeping now...');
    log('Sleeping...');

    bot.once('wake', () => {
      bot.isSleeping = false; // unlock sleep state
      bot.chat('Woke up!');
      log('Woke up from sleep.');
    });

  } catch (err) {
    log(`Sleep failed: ${err.message}`);
    bot.chat(`Sleep failed: ${err.message}`);
    bot.isSleeping = false;
  }
}

module.exports = sleepRoutine;
