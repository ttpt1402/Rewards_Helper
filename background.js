let topics = {};
let isRunning = false;
let stopRequested = false;
let openedTabs = 0;
let totalTabs = 0;

const sleep = ms => new Promise(res => setTimeout(res, ms));

// --- Helpers to build realistic Bing search URLs with common query parameters ---
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randHex = (len = 8) => {
    let s = '';
    const hex = '0123456789abcdef';
    for (let i = 0; i < len; i++) s += hex[Math.floor(Math.random() * hex.length)];
    return s;
};

function buildBingUrl(query, opts = {}) {
    // opts can override defaults for testing
    const q = encodeURIComponent(query);
    const qs = opts.qs || 'SS'; // query source (suggestion)
    const pq = opts.pq ? encodeURIComponent(opts.pq) : '';
    const sp = opts.sp || String(randInt(1, 5)); // suggestion position
    const sc = opts.sc || `${randInt(1,30)}-${randInt(1,9)}`; // score-like string
    const sk = opts.sk || randHex(12); // session key / suggestion key
    const cvid = opts.cvid || `${randHex(8)}-${randHex(4)}-${randHex(4)}`; // correlation id
    const refig = opts.refig || randHex(12);
    const FORM = opts.FORM || 'QBRE';
    const pc = opts.pc || 'U531';

    const params = [];
    params.push(`q=${q}`);
    if (pq) params.push(`pq=${pq}`);
    params.push(`qs=${qs}`);
    params.push(`sp=${sp}`);
    params.push(`sc=${sc}`);
    params.push(`sk=${sk}`);
    params.push(`cvid=${cvid}`);
    params.push(`refig=${refig}`);
    params.push(`FORM=${FORM}`);
    params.push(`pc=${pc}`);

    return `https://www.bing.com/search?${params.join('&')}`;
}

async function loadTopics() {
    try {
        const response = await fetch(chrome.runtime.getURL('topics.json'));
        if (!response.ok) throw new Error(`Failed to fetch topics: ${response.statusText}`);
        topics = await response.json();
        console.log("Topics loaded successfully.");
    } catch (error) {
        console.error("Error loading topics:", error);
    }
}

const resetState = () => {
    isRunning = false;
    stopRequested = false;
    openedTabs = 0;
    totalTabs = 0;
    setTimeout(() => {
        chrome.action.setBadgeText({ text: '' });
    }, 2000);
    // broadcast reset status
    try { chrome.runtime.sendMessage({ type: 'status', isRunning, openedTabs, totalTabs }); } catch (e) { }
};

function sendStatus() {
    try {
        chrome.runtime.sendMessage({ type: 'status', isRunning, openedTabs, totalTabs });
    } catch (e) {
        // service worker may be inactive
    }
}

/**
 * Fetches settings from chrome.storage.local with default values.
 * @returns {Promise<object>} A promise that resolves to the settings object.
 */
async function getSettings() {
    const defaults = { tabsToOpen: 1, delayMode: 'immediate', fixedDelaySeconds: 5, customTopics: [] };
    const settings = await chrome.storage.local.get(defaults);
    return settings;
}

/**
 * Selects and shuffles topics for the search session.
 * @param {object} settings - The extension settings.
 * @param {object} allTopics - The global topics object.
 * @returns {string[]} An array of selected topics.
 */
function selectSearchTopics(settings, allTopics) {
    const { tabsToOpen: numToOpen, customTopics = [] } = settings;
    const topicPool = (customTopics && customTopics.length) ? customTopics : Object.values(allTopics).flat();

    if (topicPool.length === 0) {
        return [];
    }

    // Shuffle the pool and take the required number of topics
    const shuffled = topicPool.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, numToOpen);
}

/**
 * Executes the sequential search process in a single tab.
 * @param {string[]} selectedTopics - The topics to search for.
 * @param {object} settings - The extension settings.
 */
async function runSearchSession(selectedTopics, settings) {
    const { delayMode, fixedDelaySeconds } = settings;
    const firstTopic = selectedTopics.shift();
    const firstUrl = buildBingUrl(firstTopic);

    const newWindow = await new Promise(resolve => chrome.windows.create({ url: firstUrl, focused: true }, win => resolve(win)));
    if (!newWindow) {
        console.error("Could not create a new window.");
        return;
    }

    const tabId = newWindow.tabs?.[0]?.id;
    if (!tabId) {
        console.error("Could not get created tab id.");
        return;
    }

    openedTabs++;
    await chrome.action.setBadgeText({ text: `${openedTabs}/${totalTabs}` });
    sendStatus();

    let previousTopic = firstTopic;

    for (const topic of selectedTopics) {
        if (stopRequested) {
            console.log("Stop request received. Halting operation.");
            break;
        }

        if (delayMode !== 'immediate') {
            const delayMs = (delayMode === 'fixed') ? fixedDelaySeconds * 1000 : randInt(5000, 10000);
            await sleep(delayMs);
        }

        if (stopRequested) { // Check again after delay
            console.log("Stop request received. Halting operation.");
            break;
        }

        const url = buildBingUrl(topic, { pq: previousTopic });
        await new Promise(resolve => {
            chrome.tabs.update(tabId, { url }, () => {
                if (!stopRequested) {
                    openedTabs++;
                    chrome.action.setBadgeText({ text: `${openedTabs}/${totalTabs}` });
                    sendStatus();
                }
                resolve();
            });
        });
        previousTopic = topic;
    }
}

/**
 * Main orchestrator function to start the search process.
 */
const openTabs = async () => {
    if (isRunning) {
        console.log("A session is already running.");
        return;
    }

    try {
        isRunning = true;
        stopRequested = false;
        console.log("Starting search session...");

        const settings = await getSettings();
        const selectedTopics = selectSearchTopics(settings, topics);

        if (selectedTopics.length === 0) {
            console.error("No topics available to search.");
            return;
        }

        totalTabs = selectedTopics.length;
        openedTabs = 0;
        await chrome.action.setBadgeBackgroundColor({ color: '#0078D4' });
        await chrome.action.setBadgeText({ text: `${openedTabs}/${totalTabs}` });
        sendStatus();

        await runSearchSession(selectedTopics, settings);

        console.log("Search session finished.");
    } catch (error) {
        console.error("An error occurred during the search session:", error);
    } finally {
        resetState();
    }
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startOpeningTabs") {
        openTabs();
        sendResponse({ success: true });
    } else if (request.action === "stopOpeningTabs") {
        stopRequested = true;
        sendResponse({ success: true });
        console.log("Stop request queued.");
    } else if (request.action === "getStatus") {
        sendResponse({ isRunning, openedTabs, totalTabs });
    } else if (request.action === "scheduleRun") {
        const [hour, minute] = request.time.split(':').map(Number);
        const now = new Date();
        const nextRun = new Date();
        nextRun.setHours(hour, minute, 0, 0);
        if (nextRun < now) nextRun.setDate(nextRun.getDate() + 1);
        chrome.alarms.create('dailyRun', { when: nextRun.getTime(), periodInMinutes: 24 * 60 });
        console.log(`Alarm set for ${nextRun}`);
    } else if (request.action === "cancelSchedule") {
        chrome.alarms.clear('dailyRun');
        console.log("Alarm canceled.");
    }
    return true; // Keep message channel open for async response
});

chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'dailyRun') {
        console.log("Daily scheduled run triggered.");
        openTabs();
    }
});

chrome.runtime.onStartup.addListener(() => {
    chrome.storage.local.get('scheduleTime', data => {
        if (data.scheduleTime) {
            const [hour, minute] = data.scheduleTime.split(':').map(Number);
            const now = new Date();
            const nextRun = new Date();
            nextRun.setHours(hour, minute, 0, 0);
            if (nextRun < now) nextRun.setDate(nextRun.getDate() + 1);
            chrome.alarms.create('dailyRun', { when: nextRun.getTime(), periodInMinutes: 24 * 60 });
            console.log(`Alarm re-created on startup for ${nextRun}`);
        }
    });
});

loadTopics();
console.log("Background script initialized.");