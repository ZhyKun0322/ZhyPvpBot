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

let followCombatActive = false
let combatTarget = null
let combatInterval = null

const OWNER = 'ZhyKun'

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
    mcData = mcDataLoader(bot.version)

    defaultMove = new Movements(bot, mcData)
    defaultMove.canDig = false
    defaultMove.canPlace = false

    bot.pathfinder.setMovements(defaultMove)
    bot.on('chat', onChat)

    bot.on('physicsTick', () => {
      if (
        autoEatEnabled &&
        bot.food < 20 &&
        !isEating &&
        !pvpEnabled &&
        !combatTarget &&
        !sleeping
      ) {
        eatFood()
      }
    })

    roaming = true
    if (!bot.roamingLoopActive) roamLoop()
  })

  bot.on('respawn', resetStates)

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

  bot.on('end', () => setTimeout(createBot, 5000))
}

function resetStates() {
  sleeping = false
  pvpEnabled = false
  followCombatActive = false
  combatTarget = null
  stopCombatLoop()

  if (followTask) {
    followTask.cancel()
    followTask = null
  }

  roaming = true
  if (!bot.roamingLoopActive) roamLoop()
}

// ---------------- CHAT ----------------
async function onChat(username, message) {
  if (username === bot.username) return
  const isOwner = username === OWNER

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
    roaming = false
    followCombatActive = true

    followTask = followPlayer(target)
    startCombatLoop()
    return
  }

  if (isOwner && message === '!stop') {
    if (followTask) followTask.cancel()
    followTask = null

    followCombatActive = false
    combatTarget = null
    stopCombatLoop()
    bot.pvp.stop()

    roaming = true
    if (!bot.roamingLoopActive) roamLoop()
    return
  }

  if (isOwner && message === '!autoeat') {
    autoEatEnabled = !autoEatEnabled
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
    if (!player) return

    const weapon = bot.inventory.items().find(i => i.name.includes('sword'))
    if (!weapon) return

    roaming = false
    pvpEnabled = true
    await bot.equip(weapon, 'hand')
    bot.pvp.attack(player)
    return
  }

  if (message === '!pvpstop') {
    pvpEnabled = false
    bot.pvp.stop()
    roaming = true
    if (!bot.roamingLoopActive) roamLoop()
    return
  }

  if (message === '!drop') {
    for (const item of bot.inventory.items()) {
      try { await bot.tossStack(item) } catch {}
    }
    return
  }

  if (message === '!armor') {
    autoEquipArmor()
    return
  }

  if (message === '!remove') {
    for (const s of ['head','torso','legs','feet']) {
      try { await bot.unequip(s) } catch {}
    }
    return
  }

  if (message === '!tpa') {
    roaming = false
    awaitingTeleport = true
    bot.chat('/tpa ZhyKun')
  }
}

// ---------------- EAT (FIXED: NO PROMISE TIMEOUT) ----------------
async function eatFood() {
  if (isEating) return

  const food = bot.inventory.items().find(i => preferredFoods.includes(i.name))
  if (!food) return

  try {
    isEating = true
    bot.pathfinder.stop()
    await bot.equip(food, 'hand')
    await bot.consume()
  } catch {
    // swallow promise timeout / animation errors silently
  } finally {
    isEating = false
  }
}

// ---------------- SLEEP (FIXED) ----------------
async function sleepRoutine() {
  if (sleeping) return

  const bed = bot.findBlock({
    matching: b => b.name && b.name.includes('bed'),
    maxDistance: 16
  })

  if (!bed) {
    bot.chat('No bed nearby.')
    return
  }

  try {
    sleeping = true
    roaming = false
    bot.pathfinder.stop()

    await goTo(bed.position)
    await bot.sleep(bed)

    bot.once('wake', () => {
      sleeping = false
      roaming = true
      if (!bot.roamingLoopActive) roamLoop()
    })
  } catch {
    sleeping = false
  }
}

// ---------------- COMBAT LOOP (UNCHANGED) ----------------
function startCombatLoop() {
  if (combatInterval) return
  combatInterval = setInterval(() => {}, 500)
}
function stopCombatLoop() {
  if (combatInterval) clearInterval(combatInterval)
  combatInterval = null
}

// ---------------- ARMOR ----------------
async function autoEquipArmor() {
  const slots = ['head','torso','legs','feet']
  for (const s of slots) {
    if (!bot.inventory.slots[bot.getEquipmentDestSlot(s)]) {
      const item = bot.inventory.items().find(i =>
        i.name.includes(
          s === 'head' ? 'helmet' :
          s === 'torso' ? 'chestplate' :
          s === 'legs' ? 'leggings' : 'boots'
        )
      )
      if (item) try { await bot.equip(item, s) } catch {}
    }
  }
}

// ---------------- MOVEMENT ----------------
async function roamLoop() {
  bot.roamingLoopActive = true
  while (roaming && !sleeping && !pvpEnabled) {
    const pos = bot.entity.position.offset(
      Math.floor(Math.random()*11)-5,0,Math.floor(Math.random()*11)-5
    )
    try {
      await bot.pathfinder.goto(new GoalNear(pos.x,pos.y,pos.z,1))
    } catch {}
    await delay(3000)
  }
  bot.roamingLoopActive = false
}

function followPlayer(target) {
  let cancelled = false
  ;(async () => {
    while (!cancelled) {
      try {
        await bot.pathfinder.goto(
          new GoalNear(target.position.x,target.position.y,target.position.z,1)
        )
      } catch {}
      await delay(1000)
    }
  })()
  return { cancel: () => cancelled = true }
}

async function goTo(pos) {
  try {
    await bot.pathfinder.goto(new GoalNear(pos.x,pos.y,pos.z,1))
  } catch {}
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// ---------------- START ----------------
createBot()
