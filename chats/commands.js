const { wanderRoutine } = require('../movements/roam');
const { runPatrol, attackPlayer, stopPvP } = require('../movements/combat');
const sleepRoutine = require('../movements/sleep');
const { equipArmor, removeArmor } = require('../movements/armor');
const { eatIfHungry } = require('../movements/eat');
const { GoalNear } = require('mineflayer-pathfinder');
const log = require('../utils/logger');

async function handleChat(bot, username, message, state = {}) {
  if (username === bot.username) return;

  // ---------------- Global debug ----------------
  if (message.startsWith('!debugentities')) {
    const names = Object.values(bot.entities)
      .filter(e => e.type === 'player' && e.username)
      .map(e => e.username)
      .join(', ');
    bot.chat(`Players detected: ${names || 'None'}`);
    log(`Players detected: ${names || 'None'}`);
    return;
  }

  // ---------------- Public commands ----------------
  if (message === '!sleep') {
  bot.pathfinder.stop(); // stop roaming / movement
  if (!bot.isSleeping) {
    await sleepRoutine(bot, log, { searchRange: 16 });
  } else {
    bot.chat("I'm already sleeping 😴");
  }
  return;
  }

  if (message === '!pvp') {
    bot.pvpEnabled = true;
    await attackPlayer(bot, username);
    return;
  }

  if (message === '!pvpstop') {
    bot.pvpEnabled = false;
    stopPvP(bot);
    return;
  }

  if (message === '!armor') {
    await equipArmor(bot);
    return;
  }

  if (message === '!removearmor') {
    await removeArmor(bot);
    return;
  }

  // ---------------- Owner-only commands ----------------
  if (username !== 'ZhyKun') return;

  if (message === '!stop') {
    state.isRunning = false;
    bot.chat("Bot paused.");
    return;
  }

  if (message === '!start') {
    state.isRunning = true;
    bot.chat("Bot resumed.");
    return;
  }

  if (message === '!roam') {
    if (bot.isSleeping) {
      bot.chat("Can't roam, I'm sleeping 😴");
      return;
    }
    if (bot.pvpEnabled) {
      bot.chat("Can't roam, PvP mode active ⚔️");
      return;
    }
    bot.chat("Wandering around...");
    await wanderRoutine(bot, log);
    return;
  }

  if (message === '!come') {
    const player = Object.values(bot.entities)
      .find(e => e.type === 'player' && e.username === username);
    if (player) {
      bot.chat('Coming to you!');
      try {
        await bot.pathfinder.goto(new GoalNear(player.position.x, player.position.y, player.position.z, 1));
      } catch (err) {
        bot.chat(`Failed to come: ${err.message}`);
      }
    } else {
      bot.chat('Cannot find you!');
    }
    return;
  }

  if (message === '!patrol') {
    bot.chat('Patrolling for hostile mobs...');
    await runPatrol(bot);
    return;
  }

  if (message === '!patrolstop') {
    bot.patrolEnabled = false;
    bot.chat('Stopped patrolling.');
    return;
  }

  if (message === '!drop') {
    for (const item of bot.inventory.items()) {
      try {
        await bot.tossStack(item);
        log(`Dropped ${item.name}`);
      } catch (e) {
        log(`Failed to drop ${item.name}: ${e.message}`);
      }
    }
    bot.chat("Dropped all items.");
    return;
  }
}

module.exports = handleChat;
