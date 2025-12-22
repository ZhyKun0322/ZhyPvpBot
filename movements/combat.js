// bot/movements/combat.js
const { GoalNear } = require('mineflayer-pathfinder');
const { Movements } = require('mineflayer-pathfinder');

let patrolTaskRunning = false;

function setupCombatMovements(bot) {
  const mcData = require('minecraft-data')(bot.version);
  const combatMove = new Movements(bot, mcData);

  combatMove.canDig = false; // never break blocks unless necessary in combat
  combatMove.canSwim = true; // swimming allowed in combat
  combatMove.canDive = true;

  return combatMove;
}

async function attackPlayer(bot, targetPlayer) {
  if (!targetPlayer) return;

  const sword = bot.inventory.items().find(i => i.name.includes('sword'));
  const axe = bot.inventory.items().find(i => i.name.includes('axe') && !i.name.includes('pickaxe'));
  const bow = bot.inventory.items().find(i => i.name.includes('bow'));

  const distance = bot.entity.position.distanceTo(targetPlayer.position);

  if (distance >= 10 && bow) {
    await bot.equip(bow, 'hand').catch(e => bot.log && bot.log(`Equip bow error: ${e.message}`));
    bot.chat(`Ranged attack on ${targetPlayer.username}`);
  } else if (sword) {
    await bot.equip(sword, 'hand').catch(e => bot.log && bot.log(`Equip sword error: ${e.message}`));
  } else if (axe) {
    await bot.equip(axe, 'hand').catch(e => bot.log && bot.log(`Equip axe error: ${e.message}`));
  } else {
    bot.chat("No weapon found! PvP canceled.");
    return;
  }

  bot.pvp.attack(targetPlayer);
  bot.chat(`Attacking ${targetPlayer.username}`);
}

async function runPatrol(bot) {
  if (patrolTaskRunning) return;
  patrolTaskRunning = true;

  const mcData = require('minecraft-data')(bot.version);
  const combatMove = setupCombatMovements(bot);
  bot.pathfinder.setMovements(combatMove);

  while (bot.patrolEnabled) {
    const time = bot.time.dayTime;
    if (time < 13000 || time > 23458) {
      bot.chat("It's daytime. Stopping patrol.");
      bot.patrolEnabled = false;
      break;
    }

    // Look for nearby hostile mobs
    const hostiles = bot.nearestEntity(entity =>
      entity.type === 'mob' &&
      ['zombie', 'skeleton', 'spider'].includes(entity.name)
    );

    // Detect creeper separately
    const creeper = bot.nearestEntity(e => e.name === 'creeper');

    if (creeper) {
      const bow = bot.inventory.items().find(i => i.name.includes('bow'));
      const runAwayPos = bot.entity.position.offset(
        (bot.entity.position.x - creeper.position.x > 0 ? 15 : -15),
        0,
        (bot.entity.position.z - creeper.position.z > 0 ? 15 : -15)
      );

      bot.chat('Creeper detected! Running and shooting...');
      await goTo(bot, runAwayPos);

      if (bow) {
        try {
          await bot.equip(bow, 'hand');
          bot.lookAt(creeper.position.offset(0, 1.6, 0));
          bot.activateItem();
        } catch (e) {
          bot.log && bot.log(`Couldn't shoot creeper: ${e.message}`);
        }
      }
    } else if (hostiles) {
      bot.chat(`Engaging ${hostiles.name}!`);
      try {
        await bot.pvp.attack(hostiles);
      } catch (e) {
        bot.log && bot.log(`PvP error: ${e.message}`);
      }
    }

    await delay(3000);
  }

  patrolTaskRunning = false;
}

// Helper navigation function
async function goTo(bot, pos) {
  const { pathfinder, goals: { GoalNear } } = bot;
  try {
    await pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 1));
  } catch (e) {
    bot.log && bot.log(`Navigation error: ${e.message}`);
  }
}

// Small delay helper
function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = {
  attackPlayer,
  runPatrol,
  setupCombatMovements
};
