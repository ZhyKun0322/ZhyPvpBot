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
let roaming = true // auto-roam on spawn
let autoEatEnabled = true

// Add any foods you want to allow
const preferredFoods = [
  'cooked_beef',
  'cooked_chicken',
  'bread',
  'golden_apple',
  'potato',
  'baked_potato'
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
    defaultMove.allow1by1tallDoors = false
    bot.pathfinder.setMovements(defaultMove)

    bot.on('chat', onChat)

    // Physics tick handles auto-eating
    bot.on('physicsTick', () => {
      if (autoEatEnabled && bot.food < 20 && !isEating) eatFood()
    })

    if (roaming) roamLoop()
  })

  bot.on('respawn', () => {
    log('Bot respawned')
    sleeping = false
    pvpEnabled = false
    if (followTask) {
      followTask.cancel()
      followTask = null
    }
    if (roaming) roamLoop()
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
function onChat(username, message) {
  if (username === bot.username) return

  // Only ZhyKun can use owner commands
  if (username !== 'ZhyKun') return

  if (message === '!roam') {
    if (!roaming) {
      roaming = true
      bot.chat('Starting roam...')
      roamLoop()
    }
    return
  }

  if (message === '!stoproam') {
    roaming = false
    bot.chat('Stopped roaming.')
    return
  }

  // Follow commands
  if (message === '!come') {
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

  if (message === '!stop') {
    if (followTask) followTask.cancel()
    followTask = null
    bot.chat("Stopped following")
    return
  }

  // Toggle auto-eat
  if (message === '!autoeat') {
    autoEatEnabled = !autoEatEnabled
    bot.chat(`Auto-eat is now ${autoEatEnabled ? 'ON' : 'OFF'}`)
    return
  }

  // PvP (crossplay-ready)
  if (message === '!pvp') {
    const player = Object.values(bot.entities).find(
      e => e.type === 'player' && e.username.endsWith(username)
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

  if (message === '!sleep') sleepRoutine()
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
  } finally {
    isEating = false
  }
}

// ---------------- Sleep ----------------
async function sleepRoutine() {
  if (sleeping) return
  const bed = bot.findBlock({ matching: b => bot.isABed(b), maxDistance: 16 })
  if (!bed) return

  // Wait for safe area
  const safe = bot.nearestEntity(e => e.type === 'mob' && e.position.distanceTo(bot.entity.position) < 5)
  if (safe) {
    bot.chat("Waiting for mobs to leave before sleeping...")
    await delay(5000)
  }

  try {
    await goTo(bed.position)
    await bot.sleep(bed)
    sleeping = true
    bot.once('wake', () => sleeping = false)
  } catch (err) {
    log('Sleep failed: ' + err.message)
  }
}

// ---------------- Roaming ----------------
async function roamLoop() {
  while (roaming && !sleeping && !pvpEnabled) {
    const pos = bot.entity.position.offset(
      Math.floor(Math.random() * 11) - 5,
      0,
      Math.floor(Math.random() * 11) - 5
    )

    const ground = bot.blockAt(pos.offset(0, -1, 0))
    const space = bot.blockAt(pos)

    if (ground?.boundingBox === 'block' && space?.boundingBox === 'empty') {
      try {
        bot.lookAt(pos.offset(0, 1.5, 0))
        await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 1))
      } catch {}
    }
    await delay(3000)
  }
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
        await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 1))
      } catch {}
      await delay(1000)
    }
  }

  loop()

  return {
    cancel() {
      cancelled = true
    }
  }
}

// ---------------- GoTo ----------------
async function goTo(pos) {
  try {
    bot.lookAt(pos.offset(0, 1.5, 0))
    await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 1))
  } catch {}
}

// ---------------- Utility ----------------
function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

createBot()
