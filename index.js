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

// FOLLOW + COMBAT STATE
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
      if (autoEatEnabled && bot.food < 20 && !isEating && !pvpEnabled && !combatTarget) {
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

// ---------------- CHAT (UNCHANGED COMMANDS) ----------------
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

// ---------------- COMBAT LOOP (FIXED) ----------------
function startCombatLoop() {
  if (combatInterval) return

  combatInterval = setInterval(async () => {
    if (!followCombatActive || combatTarget || pvpEnabled) return

    await autoEquipArmor()
    await holdSword()

    const hostile = Object.values(bot.entities).find(e =>
      e.type === 'mob' &&
      e.position.distanceTo(bot.entity.position) < 10 &&
      (
        e.name.includes('zombie') ||
        e.name === 'skeleton' ||
        e.name.includes('spider') ||
        e.name === 'creeper'
      )
    )

    if (!hostile) return

    combatTarget = hostile

    if (hostile.name === 'creeper') {
      fightCreeper(hostile)
    } else {
      fightMob(hostile)
    }
  }, 500)
}

function stopCombatLoop() {
  if (combatInterval) {
    clearInterval(combatInterval)
    combatInterval = null
  }
}

function fightMob(entity) {
  bot.pvp.attack(entity)

  const check = setInterval(() => {
    if (!entity.isValid) {
      clearInterval(check)
      bot.pvp.stop()
      combatTarget = null
    }
  }, 400)
}

function fightCreeper(creeper) {
  bot.pvp.attack(creeper)

  const loop = setInterval(async () => {
    if (!creeper.isValid) {
      clearInterval(loop)
      bot.pvp.stop()
      combatTarget = null
      return
    }

    bot.pvp.stop()
    const dir = bot.entity.position.minus(creeper.position).normalize().scaled(5)
    await goTo(bot.entity.position.plus(dir))
    bot.pvp.attack(creeper)
  }, 900)
}

// ---------------- ARMOR / WEAPON ----------------
async function holdSword() {
  const sword = bot.inventory.items().find(i => i.name.includes('sword'))
  if (sword && bot.heldItem?.name !== sword.name) {
    try { await bot.equip(sword, 'hand') } catch {}
  }
}

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

// ---------------- EAT ----------------
async function eatFood() {
  const food = bot.inventory.items().find(i => preferredFoods.includes(i.name))
  if (!food) return
  try {
    isEating = true
    await bot.equip(food, 'off-hand')
    await bot.consume()
  } finally {
    isEating = false
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
