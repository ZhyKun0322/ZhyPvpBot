const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const autoeat = require('mineflayer-auto-eat').plugin;
const armorManager = require('mineflayer-armor-manager');
const armorPlugin = armorManager.default || armorManager;
const pvp = require('mineflayer-pvp').plugin;
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
let alreadyLoggedIn = false;
let enemy = null;
let respawnPos = null;

const bot = mineflayer.createBot({
  host: config.host,
  port: config.port,
  username: config.username,
  version: config.version
});

// Load plugins
bot.loadPlugin(pathfinder);
bot.loadPlugin(autoeat);
bot.loadPlugin(armorPlugin); // fixed and future-proof
bot.loadPlugin(pvp);

bot.once('spawn', () => {
  console.log('[Bot] Spawned in the world');

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
    }
  }, config.wanderInterval);
});

function equipArmorAndWeapons() {
  const sword = bot.inventory.items().find(item => item.name.includes('sword'));
  const shield = bot.inventory.items().find(item => item.name.includes('shield'));
  const bow = bot.inventory.items().find(item => item.name.includes('bow'));
  const arrows = bot.inventory.items().find(item => item.name.includes('arrow'));

  if (sword) bot.equip(sword, 'hand').catch(console.error);
  if (shield) bot.equip(shield, 'off-hand').catch(console.error);
  if (bow && arrows) bot.equip(bow, 'hand').catch(console.error);

  if (bot.armor) {
    bot.armor.equipAll().catch(console.error);
  } else {
    console.log('[Bot] Armor plugin not loaded properly!');
  }
}

bot.on('entityHurt', (entity) => {
  if (entity.type === 'player' && entity.position.distanceTo(bot.entity.position) < 6) {
    enemy = entity;
    fightEnemy();
  }
});

function fightEnemy() {
  if (!enemy || !enemy.isValid) return;

  bot.pvp.attack(enemy);
  console.log('[Bot] Engaged in PvP');

  const fightInterval = setInterval(() => {
    if (!enemy || !enemy.isValid || bot.health <= 0) {
      clearInterval(fightInterval);
      enemy = null;
      return;
    }

    if (bot.health < config.healthThreshold) {
      console.log('[Bot] Low health! Retreating...');
      bot.pvp.stop();
      bot.pathfinder.setGoal(new goals.GoalNear(respawnPos.x, respawnPos.y, respawnPos.z, 2));
    } else {
      usePotion();
    }
  }, 1000);
}

function usePotion() {
  const potion = bot.inventory.items().find(item => item.name.includes('potion'));
  if (potion) {
    bot.equip(potion, 'hand')
      .then(() => bot.activateItem())
      .catch(console.error);
  }
}

bot.on('autoeat_started', () => {
  console.log('[Bot] Eating...');
});

// Sleep at night if bed found
function sleepIfNight() {
  if (!bot.time.isNight()) return;

  const bed = bot.findBlock({
    matching: block => bot.isABed(block),
    maxDistance: 16
  });

  if (bed) {
    bot.pathfinder.setGoal(new goals.GoalBlock(bed.position.x, bed.position.y, bed.position.z));
    bot.once('goal_reached', async () => {
      try {
        await bot.sleep(bed);
        console.log('[Bot] Sleeping...');
      } catch (err) {
        console.log('[Bot] Sleep failed:', err.message);
      }
    });
  }
}
setInterval(sleepIfNight, 10000);

// Login/Register auto
bot.on('message', msg => {
  if (alreadyLoggedIn) return;

  const text = msg.toString().toLowerCase();
  if (text.includes('register')) {
    bot.chat(`/register ${config.password} ${config.password}`);
    alreadyLoggedIn = true;
  } else if (text.includes('login')) {
    bot.chat(`/login ${config.password}`);
    alreadyLoggedIn = true;
  }
});

// Respawn handling
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

bot.on('health', () => {
  if (bot.health < config.healthThreshold) {
    bot.pvp.stop();
  }
});
