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

// Foods the bot can eat
const preferredFoods = [
  'cooked_beef',
  'cooked_chicken',
  'bread',
  'golden_apple',
  'potato',
  'baked_potato',
  'carrot'
]

function log(msg) {
  const time = new Date().toISOString()
  const fullMsg = `[${time}] ${msg}`
  console.log(fullMsg)
  fs.appendFileSync('logs.txt', fullMsg + '\n')
}

function setCombatMovement(enabled) {
  bot.setControlState('sprint', enabled)
  bot.setControlState('jump', false)
}

// ---------------- Create Bot ----------------
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

    // Custom movements: no digging, no doors, no scaffolding
    defaultMove = new Movements(bot, mcData)
    defaultMove.canDig = false
    defaultMove.canPlace = false
    defaultMove.allow1by1tallDoors = false
    defaultMove.allowParkour = false
    defaultMove.scaffoldingBlocks = []
    defaultMove.countScaffoldingItems = () => 0
    bot.pathfinder.setMovements(defaultMove)

    bot.on('chat', onChat)

    // Auto-eat every tick
    bot.on('physicsTick', () => {
      if (autoEatEnabled && bot.food < 20 && !isEating) eatFood()
    })

    // Start roaming automatically
    if (roaming && !bot.roamingLoopActive) roamLoop()
  })

  bot.on('respawn', () => {
    log('Bot respawned')
    sleeping = false
    pvpEnabled = false
    if (followTask) {
      followTask.cancel()
      followTask = null
    }
    if (roaming && !bot.roamingLoopActive) roamLoop()
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

  bot.on('error', err => {
    log('Error: ' + err.message)
    if (!bot._client?.ended) bot.quit()
  })
}

// ---------------- Chat Commands ----------------
async function onChat(username, message) {
  if (username === bot.username) return
  const isOwner = username === 'ZhyKun'

  // Roam commands (owner only)
  if (isOwner && message === '!roam') {
    if (!roaming) {
      roaming = true
      bot.chat('Starting roam...')
      if (!bot.roamingLoopActive) roamLoop()
    }
    return
  }
  if (isOwner && message === '!stoproam') {
    roaming = false
    bot.chat('Stopped roaming.')
    return
  }

  // Follow commands (owner only)
  if (isOwner && message === '!come') {
    const target = bot.players[username]?.entity
    if (!target) {
      bot.chat("Can't see you!")
      return
    }
    if (followTask) followTask.cancel()
    followTask = followPlayer(target)
    bot.chat(`Following ${username}`)
    return
  }
  if (isOwner && message === '!stop') {
    if (followTask) followTask.cancel()
    followTask = null
    bot.chat("Stopped following")
    return
  }

  // Auto-eat toggle (owner only)
  if (isOwner && message === '!autoeat') {
    autoEatEnabled = !autoEatEnabled
    bot.chat(`Auto-eat is now ${autoEatEnabled ? 'ON' : 'OFF'}`)
    return
  }

  // Sleep command (public)
  if (message === '!sleep') sleepRoutine()

  // PvP commands (public)
  if (message === '!pvp') {
    const player = Object.values(bot.entities).find(
      e => e.type === 'player' && e.username.toLowerCase().endsWith(username.toLowerCase())
    )
    if (!player) {
      bot.chat("Can't find you!")
      return
    }
    const weapon =
      bot.inventory.items().find(i => i.name.includes('sword')) ||
      bot.inventory.items().find(i => i.name.includes('axe'))
    if (!weapon) {
      bot.chat("No weapon found!")
      return
    }
    bot.equip(weapon, 'hand')
    pvpEnabled = true
    setCombatMovement(true)
    bot.pvp.attack(player)
    bot.chat(`PvP started against ${player.username}`)
    return
  }
  if (message === '!pvpstop') {
    pvpEnabled = false
    setCombatMovement(false)
    bot.pvp.stop()
    bot.chat("PvP stopped")
    return
  }

  // ---------------- Public Inventory Commands ----------------
  if (message === '!drop') {
    const items = bot.inventory.items()
    if (!items.length) bot.chat("No items to drop.")
    else {
      for (const item of items) {
        try { await bot.tossStack(item) } catch {}
      }
      bot.chat("Dropped all items.")
    }
    return
  }

  // Equip armor
  if (message === '!armor') {
    const slots = ['head', 'torso', 'legs', 'feet']
    let equipped = false
    for (const slot of slots) {
      if (!bot.inventory.slots[bot.getEquipmentDestSlot(slot)]) {
        const item = bot.inventory.items().find(i => {
          switch(slot) {
            case 'head': return i.name.includes('helmet')
            case 'torso': return i.name.includes('chestplate')
            case 'legs': return i.name.includes('leggings')
            case 'feet': return i.name.includes('boots')
          }
        })
        if (item) {
          try {
            await bot.equip(item, slot)
            equipped = true
          } catch(err) { log(err.message) }
        }
      }
    }
    bot.chat(equipped ? "Equipped all armor." : "No armor found or slots already filled.")
    return
  }

  // Remove armor
  if (message === '!remove') {
    const slots = ['head', 'torso', 'legs', 'feet']
    for (const slot of slots) {
      const item = bot.inventory.slots[bot.getEquipmentDestSlot(slot)]
      if (item) {
        try { await bot.unequip(slot) } catch(err) { log(err.message) }
      }
    }
    bot.chat("Removed all armor.")
    return
  }

  // ---------------- Public TPA ----------------
  if (message.startsWith('!tpa ')) {
    const args = message.split(' ')
    if (args.length < 2) {
      bot.chat('Usage: !tpa <username>')
      return
    }
    const targetName = args[1]
    bot.chat(`/tpa ${targetName}`)
    return
  }
}

// ---------------- Eating ----------------
async function eatFood() {
  if (isEating || bot.food >= 20) return
  const food = bot.inventory.items().find(i => preferredFoods.includes(i.name))
  if (!food) return
  try {
    isEating = true
    bot.clearControlStates()
    await bot.equip(food, 'hand')
    await bot.consume()
  } catch (err) {
    log('Failed to eat: ' + err.message)
  } finally { isEating = false }
}

// ---------------- Sleep ----------------
async function sleepRoutine() {
  if (sleeping) return
  const bed = bot.findBlock({ matching: b => bot.isABed(b), maxDistance: 16 })
  if (!bed) { bot.chat("No bed found nearby!"); return }

  try {
    sleeping = true
    const wasRoaming = roaming
    roaming = false

    bot.chat("Going to bed...")
    await goTo(bed.position)
    await bot.sleep(bed)

    bot.once('wake', () => {
      sleeping = false
      bot.chat("Woke up!")
      if (wasRoaming) {
        roaming = true
        if (!bot.roamingLoopActive) roamLoop()
      }
    })
  } catch (err) {
    sleeping = false
    log('Sleep failed: ' + err.message)
  }
}

// ---------------- Roaming ----------------
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
      await delay(100)
      continue
    }

    try {
      bot.lookAt(pos.offset(0, 1.5, 0))
      await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 1), { allowDig: false })
    } catch {}
    await delay(3000)
  }
  bot.roamingLoopActive = false
}

// ---------------- Follow ----------------
function followPlayer(target) {
  let cancelled = false
  async function loop() {
    while (!cancelled) {
      if (!target || !target.position) break
      const pos = target.position.offset(0, 0, 0)
      try {
        bot.lookAt(pos.offset(0,1.5,0))
        await bot.pathfinder.goto(new GoalNear(pos.x,pos.y,pos.z,1), { allowDig: false })
      } catch {}
      await delay(1000)
    }
  }
  loop()
  return { cancel() { cancelled = true } }
}

// ---------------- GoTo ----------------
async function goTo(pos) {
  try {
    bot.lookAt(pos.offset(0, 1.5, 0))
    await bot.pathfinder.goto(new GoalNear(pos.x,pos.y,pos.z,1), { allowDig: false })
  } catch {}
}

// ---------------- Utility ----------------
function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

// ---------------- Start Bot ----------------
createBot()
