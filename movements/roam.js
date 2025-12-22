// bot/movements/roam.js
const { goals: { GoalNear } } = require('mineflayer-pathfinder');
const Vec3 = require('vec3');

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
  logger('Starting roam routine...');

  for (let i = 0; i < steps; i++) {
    // 🔴 Global safety exits
    if (!bot || bot.pvp?.target || bot.isSleeping) {
      logger('Roam aborted due to state change.');
      break;
    }

    const base = bot.entity.position.floored();
    const dx = rand(-range, range);
    const dz = rand(-range, range);

    const targetPos = findStandablePos(
      bot,
      base.x + dx,
      base.z + dz,
      base.y
    );

    if (!targetPos) continue;

    try {
      await bot.pathfinder.goto(
        new GoalNear(targetPos.x, targetPos.y, targetPos.z, 1)
      );
      await delay(2000);
    } catch {
      // silently skip failed paths
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
