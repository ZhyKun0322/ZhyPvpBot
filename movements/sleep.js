const { GoalNear } = require('mineflayer-pathfinder');

async function sleepRoutine(bot, log, defaultMove, pvpEnabled) {
  if (bot.isSleeping || pvpEnabled) return;

  const bed = bot.findBlock({ matching: b => bot.isABed(b), maxDistance: 16 });
  if (!bed) {
    log("No bed found nearby.");
    bot.chat("No bed found nearby.");
    return;
  }

  log(`Heading to bed at ${bed.position}`);
  bot.chat("Going to bed...");

  try {
    bot.isSleeping = true;
    bot.pathfinder.setMovements(defaultMove);
    bot.pathfinder.stop();

    await bot.pathfinder.goto(new GoalNear(bed.position.x, bed.position.y, bed.position.z, 1));
    await bot.sleep(bed);
    bot.chat("Sleeping now...");
    log("Sleeping...");

    bot.once("wake", () => {
      bot.isSleeping = false;
      bot.chat("Woke up!");
      log("Woke up from sleep.");
    });
  } catch (err) {
    bot.isSleeping = false;
    bot.chat(`Sleep failed: ${err.message}`);
    log(`Sleep failed: ${err.message}`);
  }
}

module.exports = sleepRoutine;
