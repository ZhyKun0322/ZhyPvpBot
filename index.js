const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals: { GoalNear } } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const Vec3 = require('vec3')
const mcDataLoader = require('minecraft-data')
const fs = require('fs')
const config = require('./config.json')

let bot, mcData, defaultMove
let sleeping = false
let isRunning = true
let isEating = false
let alreadyLoggedIn = false
let pvpEnabled = false
let armorEquipped = false
let patrolEnabled = false
let patrolTaskRunning = false

function log(msg) {
  const time = new Date().toISOString()
  const fullMsg = `[${time}] ${msg}`
  console.log(fullMsg)
  fs.appendFileSync('logs.txt', fullMsg + '\n')
}

// sprint only, no jump
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

    // 🚫 NO DOORS
    defaultMove.allow1by1tallDoors = false
    // 🚫 NO BLOCK BREAKING
    defaultMove.canDig = false

    bot.pathfinder.setMovements(defaultMove)

    bot.on('chat', onChat)
    bot.on('physicsTick', eatIfHungry)

    runLoop()
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

  bot.on('end', () => setTimeout(createBot, 5000))
  bot.on('error', err => log(err.message))
}

function onChat(username, message) {
  if (username === bot.username) return

  if (message === '!sleep') {
    sleepRoutine()
    return
  }

  // ✅ PvP (crossplay-ready)
  if (message === '!pvp') {
    // use endsWith to match Bedrock players
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

  // 🔒 Owner commands
  if (username !== 'ZhyKun') return

  if (message === '!roam') wanderRoutine()
  if (message === '!patrol') {
    patrolEnabled = true
    runPatrol()
  }
  if (message === '!patrolstop') patrolEnabled = false
}

function eatIfHungry() {
  if (isEating || bot.food === 20) return

  const food = bot.inventory.items().find(i => mcData.items[i.type]?.food)
  if (!food) return

  isEating = true
  bot.equip(food, 'hand')
    .then(() => bot.consume())
    .finally(() => (isEating = false))
}

async function runLoop() {
  while (true) {
    if (!isRunning || sleeping || pvpEnabled) {
      await delay(3000)
      continue
    }

    const t = bot.time.dayTime
    if (t >= 13000 && t <= 23458) await sleepRoutine()
    else await wanderRoutine()

    await delay(5000)
  }
}

async function sleepRoutine() {
  if (sleeping) return
  const bed = bot.findBlock({ matching: b => bot.isABed(b), maxDistance: 16 })
  if (!bed) return

  await goTo(bed.position)
  await bot.sleep(bed)
  sleeping = true

  bot.once('wake', () => (sleeping = false))
}

async function wanderRoutine() {
  for (let i = 0; i < 5; i++) {
    if (sleeping || pvpEnabled) return

    const pos = bot.entity.position.offset(
      Math.floor(Math.random() * 11) - 5,
      0,
      Math.floor(Math.random() * 11) - 5
    )

    const ground = bot.blockAt(pos.offset(0, -1, 0))
    const space = bot.blockAt(pos)

    if (ground?.boundingBox === 'block' && space?.boundingBox === 'empty') {
      await goTo(pos)
      await delay(3000)
    }
  }
}

async function goTo(pos) {
  try {
    await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 1))
  } catch {}
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function runPatrol() {
  if (patrolTaskRunning) return
  patrolTaskRunning = true

  while (patrolEnabled) {
    setCombatMovement(true)

    const hostile = bot.nearestEntity(e =>
      e.type === 'mob' && ['zombie', 'skeleton', 'spider'].includes(e.name)
    )

    if (hostile) bot.pvp.attack(hostile)
    await delay(3000)
  }

  setCombatMovement(false)
  patrolTaskRunning = false
}

createBot()
