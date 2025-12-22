// bot/movements/roam.js
const { Movements, goals: { GoalNear } } = require('mineflayer-pathfinder');
const Vec3 = require('vec3');

function setupRoamMovements(bot) {
  const mcData = require('minecraft-data')(bot.version);
  const roamMove = new Movements(bot, mcData);

  roamMove.canDig = false;          // Never break blocks while roaming
  roamMove.canSwim = true;          // IMPORTANT: don't soft-lock on water
  roamMove.allow1by1tallDoors = false;

  return roamMove;
}

/**
 * Find a standable position at XZ by scanning Y
 */
function findStandablePos(bot, x, z, baseY) {
  for (let y = baseY + 4; y >= baseY - 6; y--) {
    const pos = new Vec3(x, y, z);
    const block = bot.blockAt(pos);
    const below = bot.blockAt(pos.offset(0, -1, 0));

    if (
      block &&
      below &&
      block.boundingBox === 'empty' &&
      below.boundingBox === 'block'
    ) {
      return pos;
    }
  }
  return null;
}

async function wanderRoutine(bot, logger, range = 10, steps = 5) {
  const pathfinder = bot.pathfinder;
  pathfinder.setMovements(setupRoamMovements(bot));

  logger('Starting roam routine...');

  for (let i = 0; i < steps; i++) {
    const base = bot.entity.position.floored();
    const dx = rand(-range, range);
    const dz = rand(-range, range);

    const targetPos = findStandablePos(
      bot,
      base.x + dx,
      base.z + dz,
      base.y
    );

    if (!targetPos) {
      logger('No standable position found, skipping...');
      continue;
    }

    logger(`Roaming to ${targetPos}`);

    try {
      await pathfinder.goto(
        new GoalNear(targetPos.x, targetPos.y, targetPos.z, 1)
      );
      await delay(3000);
    } catch (e) {
      logger(`Failed to reach ${targetPos}: ${e.message}`);
    }
  }

  logger('Roam routine finished.');
}

// Helpers
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  wanderRoutine
};
