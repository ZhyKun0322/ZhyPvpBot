const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals: { GoalNear } } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const mcDataLoader = require('minecraft-data')
const fs = require('fs')
const config = require('./config.json')

let bot, mcData, defaultMove
let sleeping = false, isEating = false, alreadyLoggedIn = false
let pvpEnabled = false, followTask = null, roaming = true
let autoEatEnabled = true, awaitingTeleport = false, huntingEnabled = true

const hostileMobs = ['zombie', 'skeleton', 'spider', 'creeper', 'drowned', 'husk', 'zombie_villager']
const OWNER = 'ZhyKun'
const preferredFoods = ['cooked_beef', 'cooked_chicken', 'bread', 'golden_apple', 'potato', 'baked_potato', 'carrot']

function log(msg) {
  const time = new Date().toISOString()
  const fullMsg = `[${time}] ${msg}`
  console.log(fullMsg)
  fs.appendFileSync('logs.txt', fullMsg + '\n')
}

function createBot() {
  log('Creating bot...')
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
    auth: 'offline',
    checkTimeoutInterval: 60000,
    keepAlive: true
  })

  bot.loadPlugin(pathfinder)
  bot.loadPlugin(pvp)

  bot.once('spawn', () => {
    log('Bot spawned')
    mcData = mcDataLoader(bot.version)
    defaultMove = new Movements(bot, mcData)
    
    // Movement & Door Settings
    defaultMove.canDig = false
    defaultMove.canPlace = false
    defaultMove.allowOpeningDoors = true
    defaultMove.allow1by1tallDoors = true
    defaultMove.allowParkour = false
    
    bot.pathfinder.setMovements(defaultMove)
    bot.on('chat', onChat)

    // Door Closer: Triggers after the bot finishes a move
    bot.on('goal_reached', async () => {
      await delay(800) 
      closeNearbyDoors()
    })

    let lastEatCheck = 0
    bot.on('physicsTick', () => {
      if (!bot?.entity || Date.now() - lastEatCheck < 1000) return
      lastEatCheck = Date.now()
      if (autoEatEnabled && bot.food < 20 && !isEating) eatFood()
    })

    if (roaming) roamLoop()
    huntLoop() 
  })

  bot.on('respawn', () => {
    sleeping = false; pvpEnabled = false; roaming = true
    if (followTask) followTask.cancel()
    if (!bot.roamingLoopActive) roamLoop()
  })

  bot.on('message', jsonMsg => {
    if (alreadyLoggedIn) return
    const msg = jsonMsg.toString().toLowerCase()
    if (msg.includes('register')) {
      bot.chat(`/register ${config.password} ${config.password}`)
      alreadyLoggedIn = true
    } else if (msg.includes('login')) {
      bot.chat(`/login ${config.password}`)
      alreadyLoggedIn = true
    }
  })

  bot.on('end', () => {
    log('Disconnected. Reconnecting...')
    alreadyLoggedIn = false
    setTimeout(createBot, 5000)
  })

  bot.on('error', err => log('Error: ' + err.message))
}

// ---------------- SMART DOOR CLOSER ----------------
async function closeNearbyDoors() {
  if (pvpEnabled || isEating || !bot?.entity) return
  const door = bot.findBlock({
    matching: block => {
      const name = block.name.toLowerCase()
      return (name.includes('door') || name.includes('gate')) && !name.includes('iron')
    },
    maxDistance: 2.5
  })
  if (door) {
    const isOpen = door.getProperties().open
    const botPos = bot.entity.position.floored()
    const isStandingInDoor = botPos.equals(door.position) || botPos.equals(door.position.offset(0, 1, 0))
    if (isOpen && !isStandingInDoor) {
      try {
        await bot.lookAt(door.position.offset(0.5, 0.5, 0.5))
        await bot.activateBlock(door)
      } catch (e) {}
    }
  }
}

// ---------------- ALL COMMANDS ----------------
async function onChat(username, message) {
  if (username === bot.username) return
  const isOwner = username === OWNER

  // Owner Commands
  if (isOwner) {
    if (message === '!hunting') {
      huntingEnabled = !huntingEnabled
      bot.chat(`Mob Hunting: ${huntingEnabled ? 'ON' : 'OFF'}`)
      return
    }
    if (message === '!roam') {
      roaming = true
      if (!bot.roamingLoopActive) roamLoop()
      bot.chat('Roaming enabled')
      return
    }
    if (message === '!stoproam') {
      roaming = false
      bot.chat('Roaming stopped')
      return
    }
    if (message === '!come') {
      const target = bot.players[username]?.entity
      if (!target) return bot.chat("Can't see you!")
      if (followTask) followTask.cancel()
      roaming = false
      followTask = followPlayer(target)
      bot.chat(`Following ${username}`)
      return
    }
    if (message === '!stop') {
      if (followTask) followTask.cancel()
      followTask = null; roaming = true
      bot.pathfinder.stop()
      if (!bot.roamingLoopActive) roamLoop()
      bot.chat('Stopped')
      return
    }
    if (message === '!autoeat') {
      autoEatEnabled = !autoEatEnabled
      bot.chat(`AutoEat: ${autoEatEnabled}`)
      return
    }
  }

  // Public Commands
  if (message === '!sleep') {
    bot.chat('Going to sleep...')
    sleepRoutine()
  } else if (message === '!pvp') {
    const player = Object.values(bot.entities).find(e => e.type === 'player' && e.username === username)
    if (!player) return bot.chat("Can't find you!")
    const weapon = bot.inventory.items().find(i => i.name.includes('sword') || i.name.includes('axe'))
    if (!weapon) return bot.chat('No weapon')
    roaming = false; pvpEnabled = true
    await bot.equip(weapon, 'hand')
    bot.pvp.attack(player)
    bot.chat(`PvP started vs ${player.username}`)
  } else if (message === '!pvpstop') {
    pvpEnabled = false
    bot.pvp.stop()
    roaming = true
    if (!bot.roamingLoopActive) roamLoop()
    bot.chat('PvP stopped')
  } else if (message === '!drop') {
    const items = bot.inventory.items()
    if (!items.length) bot.chat('No items to drop.')
    else {
      for (const item of items) { try { await bot.tossStack(item) } catch {} }
      bot.chat('Dropped all items.')
    }
  } else if (message === '!armor') {
    const slots = ['head', 'torso', 'legs', 'feet']
    for (const slot of slots) {
      const item = bot.inventory.items().find(i => 
        (slot === 'head' && i.name.includes('helmet')) ||
        (slot === 'torso' && i.name.includes('chestplate')) ||
        (slot === 'legs' && i.name.includes('leggings')) ||
        (slot === 'feet' && i.name.includes('boots'))
      )
      if (item) await bot.equip(item, slot)
    }
    bot.chat('Equipped best armor.')
  } else if (message === '!remove') {
    for (const slot of ['head', 'torso', 'legs', 'feet']) { try { await bot.unequip(slot) } catch {} }
    bot.chat('Armor removed.')
  } else if (message === '!tpa') {
    roaming = false; awaitingTeleport = true
    bot.chat('/tpa ZhyKun')
  }
}

// ---------------- HUNTING & MOB KILLING ----------------
async function huntLoop() {
  while (true) {
    await delay(1000)
    if (!huntingEnabled || pvpEnabled || sleeping || isEating || !bot?.entity) continue
    const weapon = bot.inventory.items().find(i => i.name.includes('sword') || i.name.includes('axe'))
    if (!weapon) continue
    const target = bot.nearestEntity(e => hostileMobs.includes(e.name) && e.position && e.position.distanceTo(bot.entity.position) < 16 && e.isValid)
    if (target) {
      const wasRoaming = roaming; roaming = false
      await killMob(target)
      roaming = wasRoaming
      if (roaming && !bot.roamingLoopActive) roamLoop()
    }
  }
}

async function killMob(mob) {
  while (bot?.entity && mob?.isValid && !pvpEnabled && !isEating) {
    const weapon = bot.inventory.items().find(i => i.name.includes('sword') || i.name.includes('axe'))
    if (!weapon) break
    await bot.equip(weapon, 'hand')
    const dist = bot.entity.position.distanceTo(mob.position)
    if (dist > 16) break
    if (mob.name === 'creeper') {
      if (dist > 3.5) await goTo(mob.position)
      else {
        await bot.lookAt(mob.position.offset(0, 1.5, 0))
        bot.attack(mob)
        const dir = bot.entity.position.minus(mob.position).normalize().scale(4)
        await goTo(bot.entity.position.plus(dir))
        await delay(800)
      }
    } else {
      if (dist > 2.5) await goTo(mob.position)
      else { await bot.lookAt(mob.position.offset(0, 1.5, 0)); bot.attack(mob) }
    }
    await delay(600)
  }
}

// ---------------- SYSTEMS ----------------
async function eatFood() {
  if (isEating || !bot?.entity || bot.food >= 20) return
  const food = bot.inventory.items().find(i => preferredFoods.includes(i.name))
  if (!food) return
  try { isEating = true; await bot.equip(food, 'hand'); await bot.consume() } catch (e) {} finally { isEating = false }
}

async function sleepRoutine() {
  const bed = bot.findBlock({ matching: b => b.name?.includes('bed'), maxDistance: 16 })
  if (!bed) return bot.chat('No bed nearby.')
  try {
    sleeping = true; roaming = false
    await goTo(bed.position)
    await bot.sleep(bed)
    bot.once('wake', () => { sleeping = false; roaming = true; if (!bot.roamingLoopActive) roamLoop() })
  } catch (e) { sleeping = false }
}

async function roamLoop() {
  if (bot.roamingLoopActive) return
  bot.roamingLoopActive = true
  while (roaming && !sleeping && !pvpEnabled && bot?.entity) {
    const pos = bot.entity.position.offset(Math.floor(Math.random() * 15) - 7, 0, Math.floor(Math.random() * 15) - 7)
    try { await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 2)) } catch {}
    await delay(4000)
  }
  bot.roamingLoopActive = false
}

function followPlayer(target) {
  let cancelled = false
  ;(async () => {
    while (!cancelled && bot?.entity) {
      if (!target?.position) break
      try { await bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 1.5)) } catch {}
      await delay(1000)
    }
  })()
  return { cancel: () => (cancelled = true) }
}

async function goTo(pos) {
  if (!bot?.entity || !pos) return
  try { await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 1.5)) } catch {}
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

createBot()
      
