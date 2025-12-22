// movements/sleep.js
const { GoalNear } = require('mineflayer-pathfinder');

let sleeping = false;

function sleepRoutine(bot, log, goTo, config) {
  return new Promise(async (resolve) => {
    if (sleeping) return resolve();

    const bed = bot.findBlock({
      matching: b => bot.isABed(b),
      maxDistance: config.searchRange
    });

    if (!bed) {
      log('No bed found nearby.');
      return resolve();
    }

    log(`Heading to bed at ${bed.position}`);
    try {
      await goTo(bot, bed.position);
      await bot.sleep(bed);
      sleeping = true;
      bot.chat("Sleeping now...");
      log('Sleeping...');

      bot.once('wake', () => {
        sleeping = false;
        bot.chat("Woke up!");
        log('Woke up from sleep.');
        resolve();
      });
    } catch (e) {
      log(`Sleep failed: ${e.message}`);
      bot.chat(`Sleep failed: ${e.message}`);
      resolve();
    }
  });
}

module.exports = sleepRoutine;
