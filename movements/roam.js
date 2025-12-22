// movements/roam.js
const { GoalNear } = require('mineflayer-pathfinder');
const { log } = require('../utils/logger');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function wanderRoutine(bot, isRunning, sleeping, pvpEnabled) {
  log('Wandering randomly...');
  for (let i = 0; i < 5; i++) {
    if (!isRunning || sleeping || pvpEnabled) return;

    const dx = Math.floor(Math.random() * 11) - 5;
    const dz = Math.floor(Math.random() * 11) - 5;
    const pos = bot.entity.position.offset(dx, 0, dz);

    const ground = bot.blockAt(pos.offset(0, -1, 0));
    const block = bot.blockAt(pos);

    // Check for reachable and visible positions
    if (ground && block && ground.boundingBox === 'block' && block.boundingBox === 'empty') {
      if (bot.canSeeBlock(ground)) { // ✅ Only move if ground is visible
        log(`Moving to ${pos}`);
        await goTo(bot, pos);
        await delay(3000);
      } else {
        log(`Skipped position (not visible) at ${pos}`);
      }
    } else {
      log(`Skipped unreachable position at ${pos}`);
    }
  }
}

async function goTo(bot, pos) {
  try {
    await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 1));
  } catch (e) {
    log(`Navigation error: ${e.message}`);
  }
}

module.exports = { wanderRoutine, goTo };
