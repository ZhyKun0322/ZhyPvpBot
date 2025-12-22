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

// Check if the path to target is reachable
function isReachable(bot, targetPos) {
  const ground = bot.blockAt(targetPos.offset(0, -1, 0));
  const block = bot.blockAt(targetPos);

  if (!ground || !block) return false;
  if (ground.boundingBox !== 'block') return false;
  if (block.boundingBox !== 'empty') return false;

  // Simple line-of-sight check
  try {
    const vec = targetPos.minus(bot.entity.position);
    const distance = vec.norm();
    const steps = Math.ceil(distance);
    for (let i = 0; i <= steps; i++) {
      const checkPos = bot.entity.position.offset(vec.x * (i / steps), vec.y * (i / steps), vec.z * (i / steps));
      const checkBlock = bot.blockAt(checkPos);
      if (checkBlock && checkBlock.boundingBox === 'block') return false; // wall in the way
    }
  } catch (e) {
    return false;
  }

  return true;
}

async function wanderRoutine(bot, logger, range = 10, steps = 5) {
  const pathfinder = bot.pathfinder;
  pathfinder.setMovements(setupRoamMovements(bot));

  logger('Starting roam routine...');

  for (let i = 0; i < steps; i++) {
    const dx = Math.floor(Math.random() * (range * 2 + 1)) - range;
    const dz = Math.floor(Math.random() * (range * 2 + 1)) - range;
    const targetPos = bot.entity.position.offset(dx, 0, dz);

    if (!isReachable(bot, targetPos)) {
      logger(`Skipped unreachable or blocked position at ${targetPos}`);
      continue;
    }

    logger(`Roaming to ${targetPos}`);
    try {
      await pathfinder.goto(new GoalNear(targetPos.x, targetPos.y, targetPos.z, 1));
      await delay(3000);
    } catch (e) {
      logger(`Failed to reach position ${targetPos}: ${e.message}`);
    }
  }

  logger('Roam routine finished.');
}

// Simple delay helper
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Export wanderRoutine
module.exports = {
  wanderRoutine
};
