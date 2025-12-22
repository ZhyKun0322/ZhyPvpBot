// bot/movements/roam.js
const { Movements, goals: { GoalNear } } = require('mineflayer-pathfinder');

function setupRoamMovements(bot) {
  const mcData = require('minecraft-data')(bot.version);
  const roamMove = new Movements(bot, mcData);

  roamMove.canDig = false;   // Never break blocks while roaming
  roamMove.canSwim = false;  // No swimming while roaming
  roamMove.allow1by1tallDoors = false;

  return roamMove;
}

async function wanderRoutine(bot, logger, range = 10, steps = 5) {
  const pathfinder = bot.pathfinder;
  pathfinder.setMovements(setupRoamMovements(bot));

  logger('Starting roam routine...');

  for (let i = 0; i < steps; i++) {
    const dx = Math.floor(Math.random() * (range * 2 + 1)) - range;
    const dz = Math.floor(Math.random() * (range * 2 + 1)) - range;
    const targetPos = bot.entity.position.offset(dx, 0, dz);

    const ground = bot.blockAt(targetPos.offset(0, -1, 0));
    const block = bot.blockAt(targetPos);

    // Only walkable positions
    if (ground && block && ground.boundingBox === 'block' && block.boundingBox === 'empty') {
      logger(`Roaming to ${targetPos}`);
      try {
        await pathfinder.goto(new GoalNear(targetPos.x, targetPos.y, targetPos.z, 1));
        await delay(3000);
      } catch (e) {
        logger(`Failed to reach position ${targetPos}: ${e.message}`);
      }
    } else {
      logger(`Skipped unreachable position at ${targetPos}`);
    }
  }

  logger('Roam routine finished.');
}

// Helper delay
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  wanderRoutine,
  setupRoamMovements
};
