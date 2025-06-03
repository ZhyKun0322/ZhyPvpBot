const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals: { GoalNear } } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp')
const autoeat = require('mineflayer-auto-eat')
// const collectBlock = require('mineflayer-collectblock') // ❌ Removed because it's not a function
const { Vec3 } = require('vec3')
const config = require('./config.json')

let bot
let hasLoggedIn = false

function createBot() {
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username
  })

  bot.loadPlugin(pathfinder)
  bot.loadPlugin(pvp)
  bot.loadPlugin(autoeat)
  // bot.loadPlugin(collectBlock) // ❌ Removed

  let attacker = null

  bot.once('spawn', () => {
    hasLoggedIn = false
    const mcData = require('minecraft-data')(bot.version)
    const defaultMove = new Movements(bot, mcData)
    bot.pathfinder.setMovements(defaultMove)

    bot.autoEat.options = {
      priority: 'foodPoints',
      startAt: 18,
      bannedFood: []
    }

    setInterval(equipBestArmor, 2000)
    roamRandomly()
  })

  bot.on('message', (message) => {
    const msg = message.toString().toLowerCase()

    if (!hasLoggedIn) {
      if (msg.includes('/register')) {
        bot.chat(`/register ${config.password} ${config.password}`)
      } else if (msg.includes('/login')) {
        bot.chat(`/login ${config.password}`)
      }

      if (msg.includes('successfully') || msg.includes('logged in')) {
        hasLoggedIn = true
        bot.chat('Logged in ✅')
      }
    }
  })

  function equipBestArmor() {
    const armorSlots = ['head', 'torso', 'legs', 'feet']
    for (const slot of armorSlots) {
      const items = bot.inventory.items().filter(item => item.name.includes(slot))
      if (items.length) {
        bot.equip(items[0], slot).catch(() => {})
      }
    }

    const swords = bot.inventory.items().filter(i => i.name.includes('sword'))
    if (swords.length) bot.equip(swords[0], 'hand').catch(() => {})
  }

  function roamRandomly() {
    setInterval(() => {
      if (attacker) return
      const x = bot.entity.position.x + (Math.random() * 10 - 5)
      const z = bot.entity.position.z + (Math.random() * 10 - 5)
      bot.pathfinder.setGoal(new GoalNear(x, bot.entity.position.y, z, 1))
    }, 10000)
  }

  bot.on('health', () => {
    if (bot.food < 18) bot.autoEat.enable()
    else bot.autoEat.disable()
  })

  bot.on('entityHurt', (entity) => {
    if (entity === bot.entity) {
      const nearestPlayer = Object.values(bot.players).find(p => p?.entity && bot.entity.distanceTo(p.entity) < 6)
      if (nearestPlayer) {
        attacker = nearestPlayer.username
        const phrases = ["I'll kill you!", "Why did you hit me?", "Come back here!"]
        bot.chat(phrases[Math.floor(Math.random() * phrases.length)])
        bot.pvp.attack(nearestPlayer.entity)
      }
    }
  })

  bot.on('physicsTick', () => {
    if (attacker) {
      const player = bot.players[attacker]?.entity
      if (!player || bot.entity.position.distanceTo(player.position) > 12) {
        attacker = null
        bot.pvp.stop()
      }
    }

    const creeper = bot.nearestEntity(e => e.name === 'creeper')
    if (creeper && bot.entity.position.distanceTo(creeper.position) < 6) {
      const away = bot.entity.position.minus(creeper.position).scaled(2)
      const flee = bot.entity.position.plus(away)
      bot.pathfinder.setGoal(new GoalNear(flee.x, flee.y, flee.z, 1))
    }
  })

  bot.on('night', () => {
    const bed = bot.findBlock({ matching: block => bot.isABed(block), maxDistance: 20 })
    if (bed) {
      bot.pathfinder.setGoal(new GoalNear(bed.position.x, bed.position.y, bed.position.z, 1))
      bot.once('goal_reached', async () => {
        try {
          await bot.sleep(bed)
          bot.chat("Goodnight 😴")
        } catch {}
      })
    }
  })

  bot.on('wake', () => {
    bot.chat("Good morning! ☀️")
  })

  bot.on('blockUpdate', (oldBlock, newBlock) => {
    if (newBlock.name.includes('door') && bot.entity.position.distanceTo(newBlock.position) < 2) {
      bot.activateBlock(newBlock)
    }
  })

  bot.on('death', () => {
    attacker = null
  })

  bot.on('end', () => {
    console.log('Bot disconnected. Reconnecting in 5 seconds...')
    setTimeout(createBot, 5000)
  })

  bot.on('kicked', reason => {
    console.log('Bot kicked:', reason)
  })

  bot.on('error', err => {
    console.log('Bot error:', err)
  })
}

createBot()
