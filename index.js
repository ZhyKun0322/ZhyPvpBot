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
let awaitingTeleport = false   // ✅ ADDED (global)

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

    bot.on('physicsTick', () => {
      if (autoEatEnabled && bot.food < 20 && !isEating) eatFood()
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

  // ✅ TELEPORT DETECTION (SimpleTPA / tp / warp)
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
  const isOwner = username === 'ZhyKun'

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
    bot.chat('Going to sleep...')
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
    const items = bot.inventory.items()
    if (!items.length) bot.chat('No items to drop.')
    else {
      for (const item of items) {
        try { await bot.tossStack(item) } catch {}
      }
      bot.chat('Dropped all items.')
    }
    return
  }

  if (message === '!armor') {
    const slots = ['head', 'torso', 'legs', 'feet']
    let equipped = false

    for (const slot of slots) {
      if (!bot.inventory.slots[bot.getEquipmentDestSlot(slot)]) {
        const item = bot.inventory.items().find(i => {
          if (slot === 'head') return i.name.includes('helmet')
          if (slot === 'torso') return i.name.includes('chestplate')
          if (slot === 'legs') return i.name.includes('leggings')
          if (slot === 'feet') return i.name.includes('boots')
        })
        if (item) {
          try {
            await bot.equip(item, slot)
            equipped = true
          } catch {}
        }
      }
    }

    bot.chat(equipped ? 'Equipped armor.' : 'No armor found.')
    return
  }

  if (message === '!remove') {
    const slots = ['head', 'torso', 'legs', 'feet']
    for (const slot of slots) {
      const item = bot.inventory.slots[bot.getEquipmentDestSlot(slot)]
      if (item) {
        try { await bot.unequip(slot) } catch {}
      }
    }
    bot.chat('Armor removed.')
    return
  }

  // -------- TPA (SimpleTpa → ZhyKun) --------
  if (message === '!tpa') {
    roaming = false
    awaitingTeleport = true
    bot.chat('/tpa ZhyKun')
    bot.chat('TPA request sent to ZhyKun.')
    return
  }
}

// ---------------- EAT ----------------
async function eatFood() {
  if (isEating || bot.food >= 20) return
  const food = bot.inventory.items().find(i => preferredFoods.includes(i.name))
  if (!food) return
  try {
    isEating = true
    await bot.equip(food, 'hand')
    await bot.consume()
  } catch (e) {
    log(e.message)
  } finally {
    isEating = false
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
      bot.chat('Woke up!')
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
      bot.pathfinder.setMovements(defaultMove)
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
      bot.pathfinder.setMovements(defaultMove)
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
  bot.pathfinder.setMovements(defaultMove)
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
