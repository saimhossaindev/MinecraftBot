const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { plugin: collectBlock } = require('mineflayer-collectblock');

const config = {
    host: 'fff1-ok5w.aternos.me', 
    port: 41853, 
    username: 'AFK_Bot', 
    version: false 
};

let botInstance = null;
let homePoint = null;
const farmMemory = new Set(); // Stores coordinates of farmland blocks

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
        startHumanInteractionLoop(bot);
    });

    bot.once('spawn', () => {
        homePoint = bot.entity.position.clone();
        
        const viewerPort = process.env.PORT || 3000;
        console.log(`[VIEWER] Starting Live Dashboard on port ${viewerPort}...`);
        
        try {
            const viewer = require('prismarine-viewer').mineflayer;
            viewer(bot, { port: viewerPort, firstPerson: true, viewDistance: 4, prefix: '' });
        } catch (err) { }

        // Wait for chunks to load properly
        setTimeout(() => {
            console.log('[BOT] Starting Ultimate Autonomous Farmer AI.');
            startMasterAI(bot);
        }, 10000); 
    });

    bot.on('end', () => {
        console.log(`[BOT] Disconnected! Reconnecting in 15s...`);
        setTimeout(createBot, 15000); 
    });
}

function startHumanInteractionLoop(bot) {
    setInterval(() => {
        if (!bot.entity) return;
        const action = Math.random();
        if (action < 0.1) bot.swingArm('right');
        else if (action < 0.2) bot.setControlState('sneak', true);
        else if (action < 0.3) bot.setControlState('sneak', false);
        else if (action < 0.5) {
            const yaw = bot.entity.yaw + (Math.random() - 0.5) * 1.5;
            const pitch = (Math.random() - 0.5) * 0.5;
            bot.look(yaw, pitch);
        }
    }, 4000 + Math.random() * 4000);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function startMasterAI(bot) {
    if (bot !== botInstance) return;
    
    const mcData = require('minecraft-data')(bot.version);
    const movements = new Movements(bot, mcData);
    
    // SURVIVAL & FARM SETTINGS
    movements.canDig = false; 
    movements.allow1by1towers = false;
    movements.canJump = true; 
    movements.jumpCost = 10.0; // Discourage jumping on farm
    movements.allowSprinting = false; 
    movements.maxDropDown = 3; 

    bot.pathfinder.setMovements(movements);
    bot.pathfinder.thinkTimeout = 50;
    bot.pathfinder.maxIterations = 10000;

    const ids = {
        wheat: mcData.blocksByName.wheat.id,
        seeds: mcData.itemsByName.wheat_seeds.id,
        chest: mcData.blocksByName.chest.id,
        dirt: mcData.blocksByName.dirt.id,
        grass: mcData.blocksByName.grass_block.id,
        farmland: mcData.blocksByName.farmland.id,
        logs: mcData.blocksArray.filter(b => b.name.includes('log') || b.name.includes('stem')).map(b => b.id),
        craftingTable: mcData.itemsByName.crafting_table.id,
        planks: mcData.itemsArray.find(i => i.name.includes('planks')).id,
        sticks: mcData.itemsByName.stick.id,
        hoe: mcData.itemsByName.wooden_hoe.id,
        stoneHoe: mcData.itemsByName.stone_hoe.id,
        cobblestone: mcData.itemsByName.cobblestone.id
    };

    const validHoes = ['Wooden_Hoe', 'Stone_Hoe', 'Iron_Hoe', 'Golden_Hoe', 'Diamond_Hoe', 'Netherite_Hoe', 'Hoe'];
    const trashItems = ['rotten_flesh', 'kelp', 'sand', 'jungle_fence', 'oak_sapling', 'pumpkin_seeds', 'feather', 'gunpowder', 'bone', 'string'];

    let isBusy = false;

    async function tick() {
        if (!bot || !bot.entity || isBusy) return;
        
        const inventory = bot.inventory.items();
        const invSummary = inventory.map(i => i.name).join(', ');
        console.log(`[AI] Inventory: [${invSummary || 'empty'}]`);
        
        isBusy = true;

        try {
            // PRIORITY 1: RETURN TO HOME IF IDLE & AWAY
            const distFromHome = bot.entity.position.distanceTo(homePoint);
            if (distFromHome > 32) {
                const logsInv = inventory.filter(i => ids.logs.includes(i.type));
                const seedsInv = inventory.filter(i => i.type === ids.seeds);
                const hasHoe = inventory.find(i => validHoes.some(h => i.name === h || i.name.includes(h)));
                
                if (hasHoe && (logsInv.length >= 2 || seedsInv.length >= 8)) {
                    console.log('[AI] Task satisfied. Returning to farm zone...');
                    await bot.pathfinder.goto(new goals.GoalNear(homePoint.x, homePoint.y, homePoint.z, 2));
                }
            }

            // PRIORITY 2: CLEANUP & STORAGE (IF FULL OR HAS WHEAT)
            const emptySlots = bot.inventory.emptySlotCount();
            const wheatInv = inventory.filter(i => i.name === 'wheat');
            const hasJunk = inventory.some(i => trashItems.some(t => i.name.includes(t)));
            
            if (emptySlots < 6 || wheatInv.length > 0 || hasJunk) {
                console.log('[AI] Triggering Smart Storage/Cleanup cycle...');
                await depositSmartly(bot, ids, trashItems);
            }

            // PRIORITY 3: MISSING TOOLS
            const items = bot.inventory.items();
            const isHoe = (i) => i.name === 'Hoe' || i.name === 'hoe' || i.name.toLowerCase().includes('_hoe');
            const foundHoe = items.find(isHoe);
            
            if (!foundHoe) {
                console.log('[AI] No Hoe found! Prioritizing Tool Recovery...');
                const searchKeys = ['Hoe', 'wooden_hoe', 'stone_hoe', 'planks', 'log', 'cobblestone', 'stick'];
                const recovered = await searchChestsSafely(bot, ids, searchKeys);
                if (!recovered) {
                    await ensureHoeMaster(bot, ids);
                }
                
                // Block farming until tool is secure
                if (!bot.inventory.items().find(isHoe)) {
                    console.log('[AI] Tool recovery in progress. Skipping farming cycle.');
                    isBusy = false;
                    setTimeout(tick, 2500);
                    return;
                }
            } else {
                // Valid hoe found: foundHoe.name
            }

            // PRIORITY 4: FARMING TASKS
            const ripe = bot.findBlock({
                matching: (b) => b.type === ids.wheat && b.metadata === 7,
                maxDistance: 32
            });

            if (ripe) {
                console.log(`[AI] Harvesting mature wheat at ${ripe.position}...`);
                const goal = new goals.GoalGetToBlock(ripe.position.x, ripe.position.y, ripe.position.z);
                try {
                    await bot.pathfinder.goto(goal);
                    await bot.dig(ripe);
                    await sleep(800); // Increased wait for laggy servers
                    farmMemory.add(ripe.position.toString());

                    // Replant with Smart Hoe handling
                    const allSeeds = bot.inventory.items().filter(i => i.type === ids.seeds);
                    if (allSeeds.length > 0) {
                        let below = bot.blockAt(ripe.position.offset(0, -1, 0));
                        if (below && (below.type === ids.dirt || below.type === ids.grass)) {
                            const activeHoe = bot.inventory.items().find(i => validHoes.some(h => i.name.includes(h)));
                            if (activeHoe) {
                                console.log(`[AI] Re-tilling farmland at ${below.position}...`);
                                await bot.equip(activeHoe, 'hand');
                                await bot.activateBlock(below);
                                await sleep(500);
                                below = bot.blockAt(below.position);
                            }
                        }
                        if (below && below.type === ids.farmland) {
                            await bot.equip(allSeeds[0], 'hand');
                            await bot.placeBlock(below, new require('vec3')(0, 1, 0));
                            await sleep(300);
                        }
                    }
                } catch (e) { }
            }

            // DYNAMIC SEARCH: Expand if resources missing
            const logsInv = bot.inventory.items().filter(i => ids.logs.includes(i.type));
            const hasHoeNow = bot.inventory.items().find(i => validHoes.some(h => i.name.includes(h)));
            if (logsInv.length < 2 && !ripe && !hasHoeNow) {
                console.log('[AI] Resources low. Expanding search radius for wood...');
                for (let r = 32; r <= 100; r += 20) {
                    const logBlock = bot.findBlock({ matching: ids.logs, maxDistance: r });
                    if (logBlock) {
                        await bot.collectBlock.collect(logBlock);
                        break;
                    }
                }
                await wander(bot, 40);
            } else if (!ripe) {
                await wander(bot, 15);
            }

        } catch (e) { console.log(`[AI] Brain Loop Notice: ${e.message}`); }

        isBusy = false;
        setTimeout(tick, 2000);
    }
    tick();
}

async function depositSmartly(bot, ids, trashItems) {
    const chests = bot.findBlocks({ matching: ids.chest, maxDistance: 32, count: 5 });
    if (chests.length === 0) {
        console.log('[AI] Cleanup Failed: No chests identified nearby.');
        return;
    }

    const itemsToStore = bot.inventory.items().filter(item => {
        if (item.name === 'wheat') return true;
        if (trashItems.some(t => item.name.includes(t))) return true;
        if (item.name === 'wheat_seeds' && item.count > 64) return true; // Keep 1 stack
        return false;
    });

    if (itemsToStore.length === 0) return;

    for (const pos of chests) {
        try {
            await bot.pathfinder.goto(new goals.GoalGetToBlock(pos.x, pos.y, pos.z));
            await bot.lookAt(pos.offset(0.5, 0.5, 0.5));
            await sleep(1500); // Account for Aternos lag
            const container = await bot.openChest(bot.blockAt(pos));
            
            for (const item of itemsToStore) {
                const countToStore = (item.name === 'wheat_seeds') ? item.count - 64 : item.count;
                if (countToStore > 0) {
                    await sleep(400);
                    await container.deposit(item.type, null, countToStore);
                }
            }
            await sleep(500);
            container.close();
            console.log('[AI] Smart Storage complete.');
            return; // Finished with this cycle
        } catch (err) { console.log(`[AI] Chest Error: ${err.message}`); }
    }
}

async function searchChestsSafely(bot, ids, keywords) {
    const chests = bot.findBlocks({ matching: ids.chest, maxDistance: 32, count: 8 });
    for (const pos of chests) {
        try {
            await bot.pathfinder.goto(new goals.GoalGetToBlock(pos.x, pos.y, pos.z));
            await bot.lookAt(pos.offset(0.5, 0.5, 0.5));
            await sleep(2000); // 2s wait for Aternos lag after lookAt
            const container = await bot.openChest(bot.blockAt(pos));
            await sleep(1500); // 1.5s wait for chest items to sync

            const itemsInChest = container.containerItems();
            console.log(`[AI] Searching Chest at ${pos}: Found [${itemsInChest.map(i => i.name).join(', ') || 'empty'}]`);
            
            const target = itemsInChest.find(i => keywords.some(k => i.name.includes(k)));
            if (target) {
                console.log(`[AI] Successfully found tool: ${target.name}. Withdrawing...`);
                await sleep(500);
                await container.withdraw(target.type, null, target.count);
                await sleep(800);
            }
            container.close();
            if (target) return true;
        } catch (err) { }
    }
    return false;
}

async function ensureHoeMaster(bot, ids) {
    const craft = async (id, table = null) => {
        const recipes = bot.recipesFor(id, null, 1, table);
        if (recipes && recipes.length > 0) {
            await bot.craft(recipes[0], 1, table);
            return true;
        }
        return false;
    };

    const logs = bot.inventory.items().find(i => ids.logs.includes(i.type));
    const planks = bot.inventory.items().find(i => i.type === ids.planks);
    if (!logs && !planks) return;

    // 1. Planks
    if (logs && !planks) { await sleep(1000); await craft(ids.planks); }
    
    // 2. Craft Table
    const tableBlock = bot.findBlock({ matching: ids.craftingTable, maxDistance: 12 });
    const tableInInv = bot.inventory.items().find(i => i.type === ids.craftingTable);
    if (!tableBlock && !tableInInv) {
        await craft(ids.craftingTable);
        await sleep(1000);
        const ground = bot.findBlock({ matching: (b) => (b.name === 'grass_block' || b.name === 'dirt') && b.position.distanceTo(homePoint) < 10, maxDistance: 5 });
        const item = bot.inventory.items().find(i => i.type === ids.craftingTable);
        if (ground && item) { await bot.equip(item, 'hand'); await bot.placeBlock(ground, new require('vec3')(0, 1, 0)); }
    }

    // 3. Stick & Craft
    const finalTable = bot.findBlock({ matching: ids.craftingTable, maxDistance: 10 });
    if (finalTable) {
        await bot.pathfinder.goto(new goals.GoalGetToBlock(finalTable.position.x, finalTable.position.y, finalTable.position.z));
        await sleep(1000);
        await craft(ids.sticks);
        await sleep(500);
        const hasCobble = bot.inventory.items().find(i => i.type === ids.cobblestone);
        if (hasCobble) await craft(ids.stoneHoe, finalTable);
        else await craft(ids.hoe, finalTable);
    }
}

async function wander(bot, radius) {
    if (!homePoint) return;
    const x = homePoint.x + (Math.random() - 0.5) * radius * 2;
    const z = homePoint.z + (Math.random() - 0.5) * radius * 2;
    try { await bot.pathfinder.goto(new goals.GoalNear(x, bot.entity.position.y, z, 2)); } catch (e) { }
}

function parseVec(s) {
    const parts = s.replace(/[()]/g, '').split(', ');
    const Vec3 = require('vec3');
    return new Vec3(parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2]));
}

createBot();
process.on('uncaughtException', (err) => {});
process.on('unhandledRejection', (reason) => {});
