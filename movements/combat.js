const { GoalNear } = require('mineflayer-pathfinder');
const Vec3 = require('vec3');

let bot, mcData, logger;

function init(_bot, _mcData, _logger) {
  bot = _bot;
  mcData = _mcData;
  logger = _logger;
}

let pvpEnabled = false;

// ====================== PvP ======================
async function startPvP(targetPlayer) {
  if (!targetPlayer) return;
  const sword = bot.inventory.items().find(i => i.name.includes('sword'));
  const axe = bot.inventory.items().find(i => i.name.includes('axe') && !i.name.includes('pickaxe'));
  const bow = bot.inventory.items().find(i => i.name.includes('bow'));

  const dist = bot.entity.position.distanceTo(targetPlayer.position);

  // Equip weapon
  if (dist >= 10 && bow) {
    try { await bot.equip(bow, 'hand'); logger('Equipped bow for ranged PvP'); } 
    catch(e) { logger(`Error equipping bow: ${e.message}`); }
  } else if (sword) {
    try { await bot.equip(sword, 'hand'); logger(`Equipped sword: ${sword.name}`); } 
    catch(e) { logger(`Error equipping sword: ${e.message}`); }
  } else if (axe) {
    try { await bot.equip(axe, 'hand'); logger(`No sword found. Equipped axe: ${axe.name}`); } 
    catch(e) { logger(`Error equipping axe: ${e.message}`); }
  } else {
    bot.chat("No weapon found for PvP!");
    logger("PvP canceled: No weapon found.");
    return;
  }

  pvpEnabled = true;
  bot.pvp.attack(targetPlayer);
  bot.chat(`PvP started against ${targetPlayer.username}`);
  logger(`Started PvP against ${targetPlayer.username}`);
}

// Stop PvP
function stopPvP() {
  pvpEnabled = false;
  bot.pvp.stop();
  bot.chat("PvP stopped.");
  logger("PvP stopped.");
}

// ====================== Pathfinding helper ======================
async function goTo(position) {
  if (!bot.pathfinder) return;

  // Avoid unreachable blocks
  try {
    await bot.pathfinder.goto(new GoalNear(position.x, position.y, position.z, 1));
  } catch(e) {
    logger(`Navigation error (skipped unreachable target): ${e.message}`);
  }
}

// ====================== Controlled block breaking ======================
async function breakBlockIfNecessary(targetBlock) {
  if (!targetBlock) return;

  // Check if path to block exists
  const goal = new GoalNear(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z, 1);
  try {
    await bot.pathfinder.goto(goal);
    // Only break if absolutely necessary (combat)
    await bot.dig(targetBlock);
    logger(`Destroyed block ${targetBlock.name} to reach target`);
  } catch(e) {
    logger(`Skipped block ${targetBlock.name}, unreachable or blocked: ${e.message}`);
  }
}

// ====================== Utilities ======================
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = {
  init,
  startPvP,
  stopPvP,
  goTo,
  breakBlockIfNecessary,
  isPvPEnabled: () => pvpEnabled
};
