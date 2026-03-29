const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { plugin: collectBlock } = require('mineflayer-collectblock');

// ---------------- CONFIGURATION ----------------
const config = {
    host: 'fff1-ok5w.aternos.me', 
    port: 41853, 
    username: 'AFK_Bot', 
    version: false // Auto-detect the exact server version
};
// -----------------------------------------------

let botInstance = null;
let homePoint = null;

function createBot() {
    console.log(`[BOT] Connecting to Aternos Server ${config.host}:${config.port}...`);
    
    const bot = mineflayer.createBot({
        host: config.host,
        port: config.port,
        username: config.username,
        version: config.version,
        hideErrors: true
    });

    botInstance = bot;
    bot.loadPlugin(pathfinder);
    bot.loadPlugin(collectBlock);

    bot.on('login', () => {
        console.log(`[BOT] Success! Logged in as ${bot.username}.`);
    });

    bot.once('spawn', () => {
        homePoint = bot.entity.position.clone();
        // Human Simulation: Brief delay before starting work
        setTimeout(() => {
            console.log('[BOT] Starting High-Speed Autonomous Farmer & Gatherer AI.');
            startRealisticHumanAI(bot);
        }, 3000);
    });

    bot.on('kicked', (reason) => {
        let kickMsg = reason;
        if (typeof reason === 'object') {
            try { kickMsg = JSON.stringify(reason); } catch(e) {}
        }
        console.log(`[BOT] Kicked by the server! Reason: ${kickMsg}`);
    });

    bot.on('end', () => {
        console.log(`[BOT] Disconnected!`);
        const breakTime = 15000 + Math.random() * 20000;
        console.log(`[BOT] Rejoining in ${Math.round(breakTime/1000)} seconds...`);
        setTimeout(createBot, breakTime); 
    });
}

function startRealisticHumanAI(bot) {
    if (bot !== botInstance) return;
    
    const mcData = require('minecraft-data')(bot.version);
    const movements = new Movements(bot, mcData);
    bot.pathfinder.setMovements(movements);

    const woodBlocks = mcData.blocksArray
        .filter(b => b.name.includes('log') || b.name.includes('stem'))
        .map(b => b.id);
    
    const wheatId = mcData.blocksByName.wheat.id;
    const seedsId = mcData.itemsByName.wheat_seeds.id;
    const chestId = mcData.blocksByName.chest.id;

    async function cycle() {
        if (!bot || !bot.entity) return;

        try {
            // STEP 1: FARMING (Harvest fully grown wheat)
            console.log('[BOT] Checking for fully grown wheat (Age 7)...');
            const ripeWheat = bot.findBlock({
                matching: (block) => block.type === wheatId && block.metadata === 7,
                maxDistance: 16
            });

            if (ripeWheat) {
                console.log(`[BOT] Harvesting wheat at ${ripeWheat.position}...`);
                await bot.collectBlock.collect(ripeWheat);
                
                // REPLANT IMMEDIATELY
                const seeds = bot.inventory.items().find(i => i.type === seedsId);
                if (seeds) {
                    console.log(`[BOT] Replanting seeds...`);
                    const farmland = bot.blockAt(ripeWheat.position.offset(0, -1, 0));
                    if (farmland && farmland.name === 'farmland') {
                        await bot.equip(seeds, 'hand');
                        await bot.placeBlock(farmland, new require('vec3')(0, 1, 0));
                    }
                }
            }

            // STEP 2: WOOD GATHERING (If no wheat, search for trees)
            else {
                console.log('[BOT] No ripe wheat. Scanning for wood logs...');
                const woodBlock = bot.findBlock({
                    matching: woodBlocks,
                    maxDistance: 24
                });

                if (woodBlock) {
                    console.log(`[BOT] Found wood at ${woodBlock.position}. Mining...`);
                    await bot.collectBlock.collect(woodBlock);
                } else {
                    wander(bot, 20);
                }
            }

            // STEP 3: STORAGE (Deposit wheat/wood into chest)
            const inventoryItems = bot.inventory.items().filter(i => i.name === 'wheat' || i.name.includes('log'));
            if (inventoryItems.length > 0) {
                console.log('[BOT] Searching for nearby chest to deposit items...');
                const storageChest = bot.findBlock({
                    matching: chestId,
                    maxDistance: 32
                });

                if (storageChest) {
                    await bot.pathfinder.goto(new goals.GoalGetToBlock(storageChest.position.x, storageChest.position.y, storageChest.position.z));
                    const chest = await bot.openChest(storageChest);
                    for (const item of inventoryItems) {
                        console.log(`[BOT] Depositing ${item.name} into chest...`);
                        await chest.deposit(item.type, null, item.count);
                    }
                    chest.close();
                }
            }

        } catch (err) {
            console.log(`[BOT] Cycle action failed (Obstacle/Distance). Retrying...`);
        }

        // Fast Cycle Delay (2-5 seconds)
        setTimeout(cycle, 2000 + Math.random() * 3000);
    }

    cycle();
}

function wander(bot, radius) {
    if (!homePoint) return;
    const x = homePoint.x + (Math.random() - 0.5) * radius * 2;
    const z = homePoint.z + (Math.random() - 0.5) * radius * 2;
    const goal = new goals.GoalNear(x, bot.entity.position.y, z, 2);
    bot.pathfinder.setGoal(goal);
    console.log(`[BOT] Exploring (Radius: ${radius})...`);
}

createBot();

process.on('uncaughtException', (err) => { });
process.on('unhandledRejection', (reason, promise) => { });
