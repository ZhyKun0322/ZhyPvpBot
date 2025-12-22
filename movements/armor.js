// movements/armor.js

let armorEquipped = false;

async function equipArmor(bot, log) {
  if (armorEquipped) return;
  const armorItems = bot.inventory.items().filter(item =>
    item.name.includes('helmet') ||
    item.name.includes('chestplate') ||
    item.name.includes('leggings') ||
    item.name.includes('boots')
  );

  for (const item of armorItems) {
    try {
      let slot = 'torso';
      if (item.name.includes('helmet')) slot = 'head';
      else if (item.name.includes('chestplate')) slot = 'torso';
      else if (item.name.includes('leggings')) slot = 'legs';
      else if (item.name.includes('boots')) slot = 'feet';

      await bot.equip(item, slot);
      log(`Equipped ${item.name} in ${slot}`);
    } catch (e) {
      log(`Failed to equip ${item.name}: ${e.message}`);
    }
  }

  armorEquipped = true;
  bot.chat("Armor equipped.");
  log("Equipped armor.");
}

async function removeArmor(bot, log) {
  if (!armorEquipped) return;
  const armorSlots = ['head', 'torso', 'legs', 'feet'];

  for (const slot of armorSlots) {
    try {
      await bot.unequip(slot);
    } catch (e) {
      log(`Failed to remove armor from ${slot}: ${e.message}`);
    }
  }

  armorEquipped = false;
  bot.chat("Armor removed.");
  log("Removed armor.");
}

module.exports = { equipArmor, removeArmor };
