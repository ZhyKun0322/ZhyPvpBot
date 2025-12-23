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

    // ✅ STRICT movement: no dig, no place, no doors, no parkour
    defaultMove = new Movements(bot, mcData)
    defaultMove.canDig = false
    defaultMove.canPlace = false
    defaultMove.allowParkour = false
    bot.pathfinder.setMovements(defaultMove)

    bot.on('chat', onChat)

    // Auto-eat
    bot.on('physicsTick', () => {
      if (autoEatEnabled && bot.food < 20 && !isEating) eatFood()
    })

    if (roaming && !bot.roamingLoopActive) roamLoop()
  })

  bot.on('respawn', () => {
    sleeping = false
    pvpEnabled = false
    if (followTask) followTask.cancel()
    followTask = null
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
    setTimeout(createBot, 5000)
  })

  bot.on('error', err => {
    log(err.message)
    if (!bot._client?.ended) bot.quit()
  })
}

// ---------------- Chat Commands ----------------
async function onChat(username, message) {
  if (username === bot.username) return
  const isOwner = username === 'ZhyKun'

  if (isOwner && message === '!roam') {
    roaming = true
    if (!bot.roamingLoopActive) roamLoop()
    return
  }

  if (isOwner && message === '!stoproam') {
    roaming = false
    return
  }

  if (isOwner && message === '!come') {
    const target = bot.players[username]?.entity
    if (!target) return
    if (followTask) followTask.cancel()
    followTask = followPlayer(target)
    return
  }

  if (isOwner && message === '!stop') {
    if (followTask) followTask.cancel()
    followTask = null
    return
  }

  if (isOwner && message === '!autoeat') {
    autoEatEnabled = !autoEatEnabled
    return
  }

  if (message === '!sleep') sleepRoutine()

  if (message.startsWith('!tpa ')) {
    bot.chat(`/tpa ${message.split(' ')[1]}`)
  }
}

// ---------------- Eating ----------------
async function eatFood() {
  if (isEating || bot.food >= 20) return
  const food = bot.inventory.items().find(i => preferredFoods.includes(i.name))
  if (!food) return

  try {
    isEating = true
    await bot.equip(food, 'hand')
    await bot.consume()
  } finally {
    isEating = false
  }
}

// ---------------- Roaming (SAFE) ----------------
async function roamLoop() {
  bot.roamingLoopActive = true

  while (roaming && !sleeping && !pvpEnabled) {
    const base = bot.entity.position

    const target = base.offset(
      Math.floor(Math.random() * 11) - 5,
      0,
      Math.floor(Math.random() * 11) - 5
    )

    const ground = bot.blockAt(target.offset(0, -1, 0))
    const space = bot.blockAt(target)

    // ❌ Invalid target → skip immediately
    if (!ground || ground.boundingBox !== 'block' || !space || space.boundingBox !== 'empty') {
      await delay(200)
      continue
    }

    try {
      // ⏱️ Timeout if unreachable → abandon
      await Promise.race([
        bot.pathfinder.goto(new GoalNear(target.x, target.y, target.z, 1)),
        delay(2500)
      ])
    } catch {}

    bot.pathfinder.stop()
    await delay(2000)
  }

  bot.roamingLoopActive = false
}

// ---------------- Follow (SAFE) ----------------
function followPlayer(target) {
  let cancelled = false

  async function loop() {
    while (!cancelled) {
      if (!target?.position) break
      try {
        await Promise.race([
          bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 1)),
          delay(2000)
        ])
      } catch {}
      bot.pathfinder.stop()
      await delay(800)
    }
  }

  loop()
  return { cancel: () => cancelled = true }
}

// ---------------- Sleep ----------------
async function sleepRoutine() {
  if (sleeping) return
  const bed = bot.findBlock({ matching: b => bot.isABed(b), maxDistance: 16 })
  if (!bed) return

  sleeping = true
  const wasRoaming = roaming
  roaming = false

  try {
    await bot.pathfinder.goto(new GoalNear(bed.position.x, bed.position.y, bed.position.z, 1))
    await bot.sleep(bed)
  } catch {}

  bot.once('wake', () => {
    sleeping = false
    roaming = wasRoaming
    if (roaming && !bot.roamingLoopActive) roamLoop()
  })
}

// ---------------- Utility ----------------
function delay(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// ---------------- Start ----------------
createBot()
