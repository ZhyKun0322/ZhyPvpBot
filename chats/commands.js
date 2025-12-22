const { wanderRoutine } = require('../movements/roam');
const { runPatrol, attackPlayer, stopPvP } = require('../movements/combat');
const { sleepRoutine } = require('../movements/sleep');
const { equipArmor, removeArmor } = require('../movements/armor');
const { eatIfHungry } = require('../movements/eat');
const log = require('../utils/logger');

async function handleChat(bot, username, message) {
  if (username === bot.username) return;

  // Debug command available to everyone
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
    bot.chat("Trying to sleep...");
    await sleepRoutine(bot);
    return;
  }

  if (message === '!pvp') {
    await attackPlayer(bot, username);
    return;
  }

  if (message === '!pvpstop') {
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
    bot.isRunning = false;
    bot.chat("Bot paused.");
    return;
  }

  if (message === '!start') {
    bot.isRunning = true;
    bot.chat("Bot resumed.");
    return;
  }

  if (message === '!roam') {
    bot.chat("Wandering around...");
    await wanderRoutine(bot);
    return;
  }

  if (message === '!come') {
    const player = Object.values(bot.entities).find(e => e.type === 'player' && e.username === username);
    if (player) {
      bot.chat('Coming to you!');
      const { goTo } = require('../movements/roam');
      await goTo(bot, player.position);
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
    // Drop everything in inventory except empty slots
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

module.exports = { handleChat };
