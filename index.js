const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals: { GoalNear } } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const mcDataLoader = require('minecraft-data')
const fs = require('fs')
const config = require('./config.json')

const OWNER = 'YourMinecraftUsername' // CHANGE THIS

let bot, mcData, defaultMove
let sleeping = false
let isEating = false
let alreadyLoggedIn = false
let pvpEnabled = false
let followTask = null
let roaming = true
let autoEatEnabled = true
let awaitingTeleport = false

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

// ---------------- COMBAT MOVE ----------------
function setCombatMovement(enabled) {
  bot.setControlState('sprint', enabled)
  bot.setControlState('jump', false)
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

    let lastEatCheck = 0
    bot.on('physicsTick', () => {
      if (!autoEatEnabled) return
      if (pvpEnabled) return
      if (Date.now() - lastEatCheck < 1000) return
      lastEatCheck = Date.now()

      if (bot.food < 20 && !isEating) eatFood()
    })

    roaming = true
    if (!bot.roamingLoopActive) roamLoop()
  })

  bot.on('respawn', () => {
    sleeping = false
    pvpEnabled = false

    if (followTask) {
      followTask.cancel()
      followTask = null
    }

    roaming = true
    if (!bot.roamingLoopActive) roamLoop()
  })

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
  if (username === bot.username) return
  const isOwner = username === OWNER

  if (isOwner && message === '!roam') {
    roaming = true
    if (!bot.roamingLoopActive) roamLoop()
    bot.chat('Roaming enabled')
    return
  }

  if (isOwner && message === '!stoproam') {
    roaming = false
    bot.chat('Roaming stopped')
    return
  }

  if (isOwner && message === '!come') {
    const target = bot.players[username]?.entity
    if (!target) return bot.chat("Can't see you!")
    if (followTask) followTask.cancel()
    roaming = false
    followTask = followPlayer(target)
    bot.chat(`Following ${username}`)
    return
  }

  if (isOwner && message === '!stop') {
    if (followTask) followTask.cancel()
    followTask = null
    roaming = true
    if (!bot.roamingLoopActive) roamLoop()
    bot.chat('Stopped')
    return
  }

  if (isOwner && message === '!autoeat') {
    autoEatEnabled = !autoEatEnabled
    bot.chat(`AutoEat: ${autoEatEnabled}`)
    return
  }

  if (message === '!sleep') {
    sleepRoutine()
    return
  }

  if (message === '!pvp') {
    const player = Object.values(bot.entities).find(
      e => e.type === 'player' && e.username === username
    )
    if (!player) return bot.chat("Can't find you!")

    const weapon =
      bot.inventory.items().find(i => i.name.includes('sword')) ||
      bot.inventory.items().find(i => i.name.includes('axe'))
    if (!weapon) return bot.chat('No weapon')

    roaming = false
    pvpEnabled = true
    await bot.equip(weapon, 'hand')
    setCombatMovement(true)
    bot.pvp.attack(player)
    bot.chat(`PvP started vs ${player.username}`)
    return
  }

  if (message === '!pvpstop') {
    pvpEnabled = false
    setCombatMovement(false)
    bot.pvp.stop()
    roaming = true
    if (!bot.roamingLoopActive) roamLoop()
    bot.chat('PvP stopped')
    return
  }

  if (message === '!drop') {
    for (const item of bot.inventory.items()) {
      try { await bot.tossStack(item) } catch {}
    }
    bot.chat('Dropped all items.')
    return
  }

  if (message === '!tpa') {
    roaming = false
    awaitingTeleport = true
    bot.chat('/tpa ZhyKun')
    bot.chat('TPA request sent.')
  }
}

// ---------------- EAT (PvP SAFE) ----------------
async function eatFood() {
  if (isEating || bot.food >= 20) return

  const food = bot.inventory.items().find(i => preferredFoods.includes(i.name))
  if (!food) return

  const wasPvP = pvpEnabled

  try {
    isEating = true

    if (wasPvP) {
      pvpEnabled = false
      bot.pvp.stop()
      setCombatMovement(false)
    }

    await bot.equip(food, 'hand')
    await bot.consume()

  } catch (e) {
    log(e.message)
  } finally {
    isEating = false

    if (wasPvP) {
      pvpEnabled = true
      setCombatMovement(true)
    }
  }
}

// ---------------- SLEEP ----------------
async function sleepRoutine() {
  if (sleeping) return

  const bed = bot.findBlock({
    matching: b => b.name?.includes('bed'),
    maxDistance: 16
  })
  if (!bed) return bot.chat('No bed nearby.')

  try {
    sleeping = true
    roaming = false
    await goTo(bed.position)
    await bot.sleep(bed)

    bot.once('wake', () => {
      sleeping = false
      roaming = true
      if (!bot.roamingLoopActive) roamLoop()
    })
  } catch (e) {
    sleeping = false
    log(e.message)
  }
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

    const ground = bot.blockAt(pos.offset(0, -1, 0))
    const space = bot.blockAt(pos)

    if (!ground || ground.boundingBox !== 'block' || !space || space.boundingBox !== 'empty') {
      await delay(200)
      continue
    }

    try {
      await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 1))
    } catch {}

    await delay(3000)
  }

  bot.roamingLoopActive = false
}

// ---------------- FOLLOW ----------------
function followPlayer(target) {
  let cancelled = false
  ;(async () => {
    while (!cancelled) {
      if (!target?.position) break
      try {
        await bot.pathfinder.goto(
          new GoalNear(target.position.x, target.position.y, target.position.z, 1)
        )
      } catch {}
      await delay(1000)
    }
  })()
  return { cancel: () => (cancelled = true) }
}

// ---------------- GOTO ----------------
async function goTo(pos) {
  try {
    await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 1))
  } catch {}
}

// ---------------- UTIL ----------------
function delay(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// ---------------- START ----------------
createBot()
