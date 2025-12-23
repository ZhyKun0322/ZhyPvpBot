const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals: { GoalNear } } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const mcDataLoader = require('minecraft-data')
const fs = require('fs')
const config = require('./config.json')

let bot, mcData, defaultMove
let sleeping = false
let isEating = false
let alreadyLoggedIn = false
let pvpEnabled = false
let followTask = null
let roaming = true
let autoEatEnabled = true
let awaitingTeleport = false

const OWNER = 'ZhyKun'

// !come combat-follow state
let followOwner = false
let busyCombat = false

// ---------------- FOOD ----------------
const preferredFoods = [
  'cooked_beef',
  'cooked_chicken',
  'bread',
  'golden_apple',
  'potato',
  'baked_potato',
  'carrot'
]

// ---------------- LOG ----------------
function log(msg) {
  const time = new Date().toISOString()
  const fullMsg = `[${time}] ${msg}`
  console.log(fullMsg)
  fs.appendFileSync('logs.txt', fullMsg + '\n')
}

// ---------------- BOT ----------------
function createBot() {
  log('Creating bot...')
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
    auth: 'offline'
  })

  bot.loadPlugin(pathfinder)
  bot.loadPlugin(pvp)

  bot.once('spawn', () => {
    log('Bot spawned')
    mcData = mcDataLoader(bot.version)

    defaultMove = new Movements(bot, mcData)
    defaultMove.canDig = false
    defaultMove.canPlace = false
    defaultMove.allow1by1tallDoors = false
    defaultMove.allowParkour = false
    defaultMove.scaffoldingBlocks = []
    defaultMove.countScaffoldingItems = () => 0

    bot.pathfinder.setMovements(defaultMove)
    bot.on('chat', onChat)

    bot.on('physicsTick', () => {
      if (autoEatEnabled && !pvpEnabled && bot.food < 16 && !isEating) {
        eatFood()
      }
      followCombatTick()
    })

    roaming = true
    if (!bot.roamingLoopActive) roamLoop()
  })

  bot.on('respawn', () => {
    sleeping = false
    pvpEnabled = false
    followOwner = false
    busyCombat = false

    if (followTask) {
      followTask.cancel()
      followTask = null
    }

    roaming = true
    if (!bot.roamingLoopActive) roamLoop()
  })

  // TELEPORT DETECTION
  bot.on('forcedMove', () => {
    if (!awaitingTeleport) return
    awaitingTeleport = false
    roaming = true
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
    log('Bot disconnected. Reconnecting in 5s...')
    setTimeout(createBot, 5000)
  })

  bot.on('error', err => log('Error: ' + err.message))
}

// ---------------- CHAT ----------------
async function onChat(username, message) {
  if (username !== OWNER) return

  if (message === '!come') {
    const target = bot.players[OWNER]?.entity
    if (!target) return bot.chat("Can't see you!")

    roaming = false
    followOwner = true
    busyCombat = false

    await equipArmor()
    await equipSwordAndFood()

    if (followTask) followTask.cancel()
    followTask = followPlayer(target)

    bot.chat('Following and protecting you')
    return
  }

  if (message === '!stop') {
    followOwner = false
    busyCombat = false
    if (followTask) followTask.cancel()
    followTask = null
    bot.pvp.stop()
    roaming = true
    if (!bot.roamingLoopActive) roamLoop()
    bot.chat('Stopped')
    return
  }

  if (message === '!roam') {
    roaming = true
    if (!bot.roamingLoopActive) roamLoop()
    bot.chat('Roaming enabled')
  }

  if (message === '!stoproam') {
    roaming = false
    bot.chat('Roaming stopped')
  }

  if (message === '!sleep') {
    sleepRoutine()
  }

  if (message === '!autoeat') {
    autoEatEnabled = !autoEatEnabled
    bot.chat(`AutoEat: ${autoEatEnabled}`)
  }

  if (message === '!drop') {
    for (const item of bot.inventory.items()) {
      try { await bot.tossStack(item) } catch {}
    }
    bot.chat('Dropped all items.')
  }

  if (message === '!armor') {
    await equipArmor()
    bot.chat('Armor equipped.')
  }

  if (message === '!remove') {
    for (const slot of ['head','torso','legs','feet']) {
      try { await bot.unequip(slot) } catch {}
    }
    bot.chat('Armor removed.')
  }

  if (message === '!tpa') {
    roaming = false
    awaitingTeleport = true
    bot.chat('/tpa ZhyKun')
  }
}

// ---------------- FOLLOW COMBAT ----------------
async function followCombatTick() {
  if (!followOwner || busyCombat) return

  const hostile = Object.values(bot.entities).find(e =>
    e.type === 'mob' &&
    e.position.distanceTo(bot.entity.position) < 12 &&
    ['zombie','husk','drowned','skeleton','spider','cave_spider','creeper'].includes(e.name)
  )

  if (!hostile) return

  busyCombat = true
  if (followTask) followTask.cancel()

  if (hostile.name === 'creeper') {
    await fightCreeper(hostile)
  } else {
    await fightMob(hostile)
  }

  busyCombat = false

  if (followOwner) {
    const target = bot.players[OWNER]?.entity
    if (target) followTask = followPlayer(target)
  }
}

// ---------------- COMBAT ----------------
async function fightMob(entity) {
  await equipSwordAndFood()
  pvpEnabled = true
  bot.pvp.attack(entity)
  while (entity.isValid) await delay(300)
  bot.pvp.stop()
  pvpEnabled = false
}

async function fightCreeper(creeper) {
  await equipSwordAndFood()
  pvpEnabled = true

  while (creeper.isValid) {
    bot.pvp.attack(creeper)
    await delay(600)
    const dir = bot.entity.position.minus(creeper.position).normalize().scaled(5)
    await goTo(bot.entity.position.plus(dir))
    await delay(500)
  }

  bot.pvp.stop()
  pvpEnabled = false
}

// ---------------- EQUIP ----------------
async function equipArmor() {
  const slots = ['head','torso','legs','feet']
  for (const slot of slots) {
    if (!bot.inventory.slots[bot.getEquipmentDestSlot(slot)]) {
      const item = bot.inventory.items().find(i =>
        (slot === 'head' && i.name.includes('helmet')) ||
        (slot === 'torso' && i.name.includes('chestplate')) ||
        (slot === 'legs' && i.name.includes('leggings')) ||
        (slot === 'feet' && i.name.includes('boots'))
      )
      if (item) try { await bot.equip(item, slot) } catch {}
    }
  }
}

async function equipSwordAndFood() {
  const sword = bot.inventory.items().find(i => i.name.includes('sword'))
  const food = bot.inventory.items().find(i => preferredFoods.includes(i.name))
  if (sword) await bot.equip(sword, 'hand')
  if (food) await bot.equip(food, 'off-hand')
}

// ---------------- EAT ----------------
async function eatFood() {
  if (isEating || bot.food >= 20) return
  const food = bot.inventory.items().find(i => preferredFoods.includes(i.name))
  if (!food) return
  isEating = true
  try {
    await bot.equip(food, 'off-hand')
    await bot.consume()
  } catch {}
  isEating = false
}

// ---------------- FOLLOW ----------------
function followPlayer(target) {
  let cancelled = false
  ;(async () => {
    while (!cancelled && target?.position) {
      bot.pathfinder.setMovements(defaultMove)
      try {
        await bot.pathfinder.goto(
          new GoalNear(target.position.x, target.position.y, target.position.z, 1)
        )
      } catch {}
      await delay(500)
    }
  })()
  return { cancel: () => (cancelled = true) }
}

// ---------------- GOTO ----------------
async function goTo(pos) {
  bot.pathfinder.setMovements(defaultMove)
  try {
    await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 1))
  } catch {}
}

// ---------------- ROAM ----------------
async function roamLoop() {
  bot.roamingLoopActive = true
  while (roaming && !sleeping && !pvpEnabled) {
    const pos = bot.entity.position.offset(
      Math.floor(Math.random() * 11) - 5,
      0,
      Math.floor(Math.random() * 11) - 5
    )
    try {
      await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 1))
    } catch {}
    await delay(3000)
  }
  bot.roamingLoopActive = false
}

// ---------------- SLEEP ----------------
async function sleepRoutine() {
  const bed = bot.findBlock({ matching: b => b.name?.includes('bed'), maxDistance: 16 })
  if (!bed) return bot.chat('No bed nearby.')
  try {
    sleeping = true
    roaming = false
    await goTo(bed.position)
    await bot.sleep(bed)
  } catch {
    sleeping = false
  }
}

// ---------------- UTIL ----------------
function delay(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// ---------------- START ----------------
createBot()
