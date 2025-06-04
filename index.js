const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const autoeat = require('mineflayer-auto-eat').plugin;
const armorManager = require('mineflayer-armor-manager');
const pvp = require('mineflayer-pvp').plugin;
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
let alreadyLoggedIn = false;
let enemy = null;
let respawnPos = null;
let armor; // armor manager instance

const bot = mineflayer.createBot({
  host: config.host,
  port: config.port,
  username: config.username,
  version: config.version
});

// Load plugins
bot.loadPlugin(pathfinder);
bot.loadPlugin(autoeat);
bot.loadPlugin(pvp);
bot.loadPlugin(armorManager); // Load armor manager plugin properly

// On bot spawn
bot.once('spawn', () => {
  console.log('[Bot] Spawned in the world');

  // armorManager is now a plugin, so bot.armorManager exists
  if (!bot.armorManager) {
    console.error('[Error] Armor manager plugin not loaded!');
  } else {
    armor = bot.armorManager;
    console.log('[Info] Armor manager initialized.');
  }

  const defaultMove = new Movements(bot);
  bot.pathfinder.setMovements(defaultMove);
  respawnPos = bot.entity.position.clone();

  equipArmorAndWeapons();

  setInterval(() => {
    if (!enemy && bot.health >= config.healthThreshold) {
      const x = bot.entity.position.x + (Math.random() - 0.5) * 16;
      const z = bot.entity.position.z + (Math.random() - 0.5) * 16;
      const y = bot.entity.position.y;
      bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 1));
      console.log('[Info] Wandering to:', x.toFixed(1), y.toFixed(1), z.toFixed(1));
    }
  }, config.wanderInterval);
});

// Equip armor and weapons
function equipArmorAndWeapons() {
  console.log('[Action] Equipping armor and weapons...');
  const sword = bot.inventory.items().find(item => item.name.includes('sword'));
  const shield = bot.inventory.items().find(item => item.name.includes('shield'));
  const bow = bot.inventory.items().find(item => item.name.includes('bow'));
  const arrows = bot.inventory.items().find(item => item.name.includes('arrow'));

  if (sword) {
    bot.equip(sword, 'hand')
      .then(() => console.log(`[Success] Equipped sword: ${sword.name}`))
      .catch(err => console.error('[Error] Equipping sword:', err));
  }
  if (shield) {
    bot.equip(shield, 'off-hand')
      .then(() => console.log(`[Success] Equipped shield: ${shield.name}`))
      .catch(err => console.error('[Error] Equipping shield:', err));
  }
  if (bow && arrows) {
    bot.equip(bow, 'hand')
      .then(() => console.log(`[Success] Equipped bow: ${bow.name}`))
      .catch(err => console.error('[Error] Equipping bow:', err));
  }

  if (armor) {
    armor.equipAll()
      .then(() => console.log('[Success] Armor equipped!'))
      .catch(err => console.error('[Error] Equipping armor:', err));
  } else {
    console.warn('[Warning] Armor manager is not initialized, cannot equip armor.');
  }
}

// Detect nearby player being hurt
bot.on('entityHurt', (entity) => {
  if (entity.type === 'player' && entity.position.distanceTo(bot.entity.position) < 6) {
    enemy = entity;
    console.log(`[Combat] Enemy detected: ${enemy.username}`);
    fightEnemy();
  }
});

// PvP logic
function fightEnemy() {
  if (!enemy || !enemy.isValid) {
    console.log('[Combat] No valid enemy to fight.');
    return;
  }

  bot.pvp.attack(enemy);
  console.log('[Combat] Engaged in PvP!');

  const fightInterval = setInterval(() => {
    if (!enemy || !enemy.isValid || bot.health <= 0) {
      clearInterval(fightInterval);
      enemy = null;
      console.log('[Combat] Fight ended or enemy lost.');
      return;
    }

    if (bot.health < config.healthThreshold) {
      console.log('[Combat] Low health! Retreating...');
      bot.pvp.stop();
      bot.pathfinder.setGoal(new goals.GoalNear(respawnPos.x, respawnPos.y, respawnPos.z, 2));
    } else {
      usePotion();
    }
  }, 1000);
}

// Use potion if available
function usePotion() {
  const potion = bot.inventory.items().find(item => item.name.includes('potion'));
  if (potion) {
    bot.equip(potion, 'hand')
      .then(() => bot.activateItem())
      .then(() => console.log('[Action] Used a potion!'))
      .catch(err => console.error('[Error] Using potion:', err));
  }
}

// Sleep logic
function sleepIfNight() {
  const time = bot.time || { day: 0 };

  // Night is from 13000 to 23000 in Minecraft time
  if (time.day >= 13000 && time.day <= 23000) {
    console.log('[Info] It is night. Trying to sleep...');
    const bed = bot.findBlock({
      matching: block => bot.isABed(block),
      maxDistance: 16
    });

    if (bed) {
      bot.pathfinder.setGoal(new goals.GoalBlock(bed.position.x, bed.position.y, bed.position.z));
      bot.once('goal_reached', async () => {
        try {
          await bot.sleep(bed);
          console.log('[Success] Sleeping...');
        } catch (err) {
          console.log('[Warning] Failed to sleep:', err.message);
        }
      });
    } else {
      console.log('[Info] No bed found nearby to sleep.');
    }
  }
}
setInterval(sleepIfNight, 10000);

// Auto login/register
bot.on('message', msg => {
  if (alreadyLoggedIn) return;

  const text = msg.toString().toLowerCase();
  if (text.includes('register')) {
    bot.chat(`/register ${config.password} ${config.password}`);
    alreadyLoggedIn = true;
    console.log('[Login] Sent registration command.');
  } else if (text.includes('login')) {
    bot.chat(`/login ${config.password}`);
    alreadyLoggedIn = true;
    console.log('[Login] Sent login command.');
  }
});

// Handle respawn
bot.on('death', () => {
  console.log('[Bot] I died...');
});

bot.on('respawn', () => {
  console.log('[Bot] Respawned!');
  setTimeout(() => {
    equipArmorAndWeapons();
    bot.chat('Back from death!');
    if (respawnPos) {
      bot.pathfinder.setGoal(new goals.GoalNear(respawnPos.x, respawnPos.y, respawnPos.z, 2));
    }
  }, 2000);
});

// Stop PvP if health low
bot.on('health', () => {
  if (bot.health < config.healthThreshold) {
    bot.pvp.stop();
    console.log('[Combat] Stopped PvP due to low health.');
  }
});

// Log autoeat start
bot.on('autoeat_started', () => {
  console.log('[Bot] Eating...');
});
