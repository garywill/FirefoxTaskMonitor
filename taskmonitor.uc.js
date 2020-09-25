/* Firefox userChrome script
 * Show per-tab cpu and memory bar on tab
 * Show tasks-without-tabs cpu and memory bar
 * Tested on Firefox 78
 * Author: garywill (https://github.com/garywill)
 * https://github.com/garywill/firefoxtaskmonitor
 * 
 * Notice
 * This file contains code from Mozilla Firefox aboutPerformance.js
 * Code from Mozilla Firefox aboutPerformance.js is licensed under MPL
 * 
 */
console.log("taskmonitor.js");

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
    AddonManager
} = ChromeUtils.import(
    "resource://gre/modules/AddonManager.jsm"
);
const {
    ExtensionParent
} = ChromeUtils.import(
    "resource://gre/modules/ExtensionParent.jsm"
);

const {
    WebExtensionPolicy
} = Cu.getGlobalForObject(Services);

// Time in ms before we start changing the sort order again after receiving a
// mousemove event.
const TIME_BEFORE_SORTING_AGAIN = 5000;

// How often we should add a sample to our buffer.
const BUFFER_SAMPLING_RATE_MS = 1000;

// The age of the oldest sample to keep.
const BUFFER_DURATION_MS = 10000;

// How often we should update
const UPDATE_INTERVAL_MS = 1000;

// The name of the application
const BRAND_BUNDLE = Services.strings.createBundle(
    "chrome://branding/locale/brand.properties"
);
const BRAND_NAME = BRAND_BUNDLE.GetStringFromName("brandShortName");

function extensionCountersEnabled() {
    return Services.prefs.getBoolPref(
        "extensions.webextensions.enablePerformanceCounters",
        false
    );
}

// The ids of system add-ons, so that we can hide them when the
// toolkit.aboutPerformance.showInternals pref is false.
// The API to access addons is async, so we cache the list during init.
// The list is unlikely to change while the about:performance
// tab is open, so not updating seems fine.
var gSystemAddonIds = new Set();

let tabFinder = {
    update() {
        this._map = new Map();
        for (let win of Services.wm.getEnumerator("navigator:browser")) {
            let tabbrowser = win.gBrowser;
            for (let browser of tabbrowser.browsers) {
                let id = browser.outerWindowID;
                if (id != null) {
                    this._map.set(id, browser);
                }
            }
            if (tabbrowser.preloadedBrowser) {
                let browser = tabbrowser.preloadedBrowser;
                if (browser.outerWindowID) {
                    this._map.set(browser.outerWindowID, browser);
                }
            }
        }

    },

    /**
     * Find the <xul:tab> for a window id.
     *
     * This is useful e.g. for reloading or closing tabs.
     *
     * @return null If the xul:tab could not be found, e.g. if the
     * windowId is that of a chrome window.
     * @return {{tabbrowser: <xul:tabbrowser>, tab: <xul.tab>}} The
     * tabbrowser and tab if the latter could be found.
     */
    get(id) {
        let browser = this._map.get(id);
        if (!browser) {
            return null;
        }
        let tabbrowser = browser.getTabBrowser();
        if (!tabbrowser) {
            return {
                tabbrowser: null,
                tab: {
                    getAttribute() {
                        return "";
                    },
                    linkedBrowser: browser,
                },
            };
        }
        return {
            tabbrowser,
            tab: tabbrowser.getTabForBrowser(browser) // <tab>节点
        };
    },

};

/**
 * Returns a Promise that's resolved after the next turn of the event loop.
 *
 * Just returning a resolved Promise would mean that any `then` callbacks
 * would be called right after the end of the current turn, so `setTimeout`
 * is used to delay Promise resolution until the next turn.
 *
 * In mochi tests, it's possible for this to be called after the
 * about:performance window has been torn down, which causes `setTimeout` to
 * throw an NS_ERROR_NOT_INITIALIZED exception. In that case, returning
 * `undefined` is fine.
 */
function wait(ms = 0) {
    try {
        let resolve;
        let p = new Promise(resolve_ => {
            resolve = resolve_;
        });
        setTimeout(resolve, ms);
        return p;
    } catch (e) {
        dump(
            "WARNING: wait aborted because of an invalid Window state in aboutPerformance.js.\n"
        );
        return undefined;
    }
}

/**
 * Utilities for dealing with state
 */
var State = {
    /**
     * Indexed by the number of minutes since the snapshot was taken.
     *
     * @type {Array<ApplicationSnapshot>}
     */
    _buffer: [],
    /**
     * The latest snapshot.
     *
     * @type ApplicationSnapshot
     */
    _latest: null,

    async _promiseSnapshot() {
        let addons = WebExtensionPolicy.getActiveExtensions();
        let addonHosts = new Map();
        for (let addon of addons) {
            addonHosts.set(addon.mozExtensionHostname, addon.id);
        }

        let counters = await ChromeUtils.requestPerformanceMetrics();
        let tabs = {};
        for (let counter of counters) {
            let {
                items,
                host,
                pid,
                counterId,
                windowId,
                duration,
                isWorker,
                memoryInfo,
                isTopLevel,
            } = counter;
            // If a worker has a windowId of 0 or max uint64, attach it to the
            // browser UI (doc group with id 1).
            if (isWorker && (windowId == 18446744073709552000 || !windowId)) {
                windowId = 1;
            }
            let dispatchCount = 0;
            for (let {
                    count
                } of items) {
                dispatchCount += count;
            }

            let memory = 0;
            for (let field in memoryInfo) {
                if (field == "media") {
                    for (let mediaField of ["audioSize", "videoSize", "resourcesSize"]) {
                        memory += memoryInfo.media[mediaField];
                    }
                    continue;
                }
                memory += memoryInfo[field];
            }

            let tab;
            let id = windowId;
            if (addonHosts.has(host)) {
                id = addonHosts.get(host);
            }
            if (id in tabs) {
                tab = tabs[id];
            } else {
                tab = {
                    windowId,
                    host,
                    dispatchCount: 0,
                    duration: 0,
                    memory: 0,
                    children: [],
                    pid: pid,
                };
                tabs[id] = tab;
            }
            tab.dispatchCount += dispatchCount;
            tab.duration += duration;
            tab.memory += memory;
            if (!isTopLevel || isWorker) {
                tab.children.push({
                    host,
                    isWorker,
                    dispatchCount,
                    duration,
                    memory,
                    counterId: pid + ":" + counterId,
                });
            }
        }

        if (extensionCountersEnabled()) {
            let extCounters = await ExtensionParent.ParentAPIManager.retrievePerformanceCounters();
            for (let [id, apiMap] of extCounters) {
                let dispatchCount = 0,
                    duration = 0;
                for (let [, counter] of apiMap) {
                    dispatchCount += counter.calls;
                    duration += counter.duration;
                }

                let tab;
                if (id in tabs) {
                    tab = tabs[id];
                } else {
                    tab = {
                        windowId: 0,
                        host: id,
                        dispatchCount: 0,
                        duration: 0,
                        memory: 0,
                        children: [],
                        pid: 0,
                    };
                    tabs[id] = tab;
                }
                tab.dispatchCount += dispatchCount;
                tab.duration += duration;
            }
        }

        return {
            tabs,
            date: Cu.now()
        };
    },

    /**
     * Update the internal state.
     *
     * @return {Promise}
     */
    async update() {
        // If the buffer is empty, add one value for bootstraping purposes.
        if (!this._buffer.length) {
            this._latest = await this._promiseSnapshot();
            this._buffer.push(this._latest);
            await wait(BUFFER_SAMPLING_RATE_MS * 1.1);
        }

        let now = Cu.now();

        // If we haven't sampled in a while, add a sample to the buffer.
        let latestInBuffer = this._buffer[this._buffer.length - 1];
        let deltaT = now - latestInBuffer.date;
        if (deltaT > BUFFER_SAMPLING_RATE_MS) {
            this._latest = await this._promiseSnapshot();
            this._buffer.push(this._latest);
        }

        // If we have too many samples, remove the oldest sample.
        let oldestInBuffer = this._buffer[0];
        if (oldestInBuffer.date + BUFFER_DURATION_MS < this._latest.date) {
            this._buffer.shift();
        }
    },

    // We can only know asynchronously if an origin is matched by the tracking
    // protection list, so we cache the result for faster future lookups.
    _trackingState: new Map(),
    isTracker(host) {
        if (!this._trackingState.has(host)) {
            // Temporarily set to false to avoid doing several lookups if a site has
            // several subframes on the same domain.
            this._trackingState.set(host, false);
            if (host.startsWith("about:") || host.startsWith("moz-nullprincipal")) {
                return false;
            }

            let uri = Services.io.newURI("http://" + host);
            let classifier = Cc["@mozilla.org/url-classifier/dbservice;1"].getService(
                Ci.nsIURIClassifier
            );
            let feature = classifier.getFeatureByName("tracking-protection");
            if (!feature) {
                return false;
            }

            classifier.asyncClassifyLocalWithFeatures(
                uri, [feature],
                Ci.nsIUrlClassifierFeature.blacklist,
                list => {
                    if (list.length) {
                        this._trackingState.set(host, true);
                    }
                }
            );
        }
        return this._trackingState.get(host);
    },

    getCounters() {
        tabFinder.update();
        // We rebuild the maps during each iteration to make sure that
        // we do not maintain references to groups that has been removed
        // (e.g. pages that have been closed).

        let previous = this._buffer[Math.max(this._buffer.length - 2, 0)].tabs;
        let current = this._latest.tabs;
        let counters = [];
        for (let id of Object.keys(current)) {
            let tab = current[id];
            let oldest;
            for (let index = 0; index <= this._buffer.length - 2; ++index) {
                if (id in this._buffer[index].tabs) {
                    oldest = this._buffer[index].tabs[id];
                    break;
                }
            }
            let prev = previous[id];
            let host = tab.host;

            let type = "other";
            let name = `${host} (${id})`;
            let image = "";
            let found = tabFinder.get(parseInt(id));
            if (found) {
                if (found.tabbrowser) {
                    name = found.tab.getAttribute("label");
                    type = "tab";
                } else {
                    name = {
                        id: "preloaded-tab",
                        title: found.tab.linkedBrowser.contentTitle,
                    };
                }
            } else if (id == 1) {
                name = BRAND_NAME;
                type = "browser";
            } else if (/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(host)) {
                let addon = WebExtensionPolicy.getByHostname(host);
                if (!addon) {
                    continue;
                }
                name = addon.name;
                type = gSystemAddonIds.has(addon.id) ? "system-addon" : "addon";
            } else if (id == 0 && !tab.isWorker) {
                name = {
                    id: "ghost-windows"
                };
            }

            // Create a map of all the child items from the previous time we read the
            // counters, indexed by counterId so that we can quickly find the previous
            // value for any subitem.
            let prevChildren = new Map();
            if (prev) {
                for (let child of prev.children) {
                    prevChildren.set(child.counterId, child);
                }
            }
            // For each subitem, create a new object including the deltas since the previous time.
            let children = tab.children.map(child => {
                let {
                    host,
                    dispatchCount,
                    duration,
                    memory,
                    isWorker,
                    counterId,
                } = child;
                let dispatchesSincePrevious = dispatchCount;
                let durationSincePrevious = duration;
                if (prevChildren.has(counterId)) {
                    let prevCounter = prevChildren.get(counterId);
                    dispatchesSincePrevious -= prevCounter.dispatchCount;
                    durationSincePrevious -= prevCounter.duration;
                    prevChildren.delete(counterId);
                }

                return {
                    host,
                    dispatchCount,
                    duration,
                    isWorker,
                    memory,
                    dispatchesSincePrevious,
                    durationSincePrevious,
                };
            });

            // Any item that remains in prevChildren is a subitem that no longer
            // exists in the current sample; remember the values of its counters
            // so that the values don't go down for the parent item.
            tab.dispatchesFromFormerChildren =
                (prev && prev.dispatchesFromFormerChildren) || 0;
            tab.durationFromFormerChildren =
                (prev && prev.durationFromFormerChildren) || 0;
            for (let [, counter] of prevChildren) {
                tab.dispatchesFromFormerChildren += counter.dispatchCount;
                tab.durationFromFormerChildren += counter.duration;
            }

            // Create the object representing the counters of the parent item including
            // the deltas from the previous times.
            let dispatches = tab.dispatchCount + tab.dispatchesFromFormerChildren;
            let duration = tab.duration + tab.durationFromFormerChildren;
            let durationSincePrevious = NaN;
            let dispatchesSincePrevious = NaN;
            let dispatchesSinceStartOfBuffer = NaN;
            let durationSinceStartOfBuffer = NaN;
            if (prev) {
                durationSincePrevious =
                    duration - prev.duration - (prev.durationFromFormerChildren || 0);
                dispatchesSincePrevious =
                    dispatches -
                    prev.dispatchCount -
                    (prev.dispatchesFromFormerChildren || 0);
            }
            if (oldest) {
                dispatchesSinceStartOfBuffer =
                    dispatches -
                    oldest.dispatchCount -
                    (oldest.dispatchesFromFormerChildren || 0);
                durationSinceStartOfBuffer =
                    duration - oldest.duration - (oldest.durationFromFormerChildren || 0);
            }
            counters.push({
                id,
                name,
                image,
                type,
                memory: tab.memory,
                totalDispatches: dispatches,
                totalDuration: duration,
                durationSincePrevious,
                dispatchesSincePrevious,
                durationSinceStartOfBuffer,
                dispatchesSinceStartOfBuffer,
                children,
                tabNode: (found && found.tabbrowser) ? found.tab : null,
                pid: tab.pid,
            });
        }
        return counters;
    },
};

var View = {
    memoryAddUnit(memory) {
        let unit = "";
        let mem_united = "?";
        if (memory) {
            unit = "KB";
            mem_united = Math.ceil(memory / 1024);
            if (mem_united > 1024) {
                mem_united = Math.ceil((mem_united / 1024) * 10) / 10;
                unit = "MB";
                if (mem_united > 1024) {
                    mem_united = Math.ceil((mem_united / 1024) * 100) / 100;
                    unit = "GB";
                }
            }
            mem_united += unit;
        }
        return mem_united;
    },
};

var Control = {
    _sortOrder: "",
    init() {
    },
    _lastMouseEvent: 0,
    _updateLastMouseEvent() {
        this._lastMouseEvent = Date.now();
    },
    async update() {
        //console.log("");
        //console.log("===start period================");
        await State.update();

        await wait(0);

        await this._updateDisplay();
        //console.log("===finish period================");
    },
    // The force parameter can force a full update even when the mouse has been
    // moved recently.
    async _updateDisplay(force = false) {
        let counters = State.getCounters();
        // If the mouse has been moved recently, update the data displayed
        // without moving any item to avoid the risk of users clicking an action
        // button for the wrong item.
        // Memory use is unlikely to change dramatically within a few seconds, so
        // it's probably fine to not update the Memory column in this case.

        if (
            !force &&
            Date.now() - this._lastMouseEvent < TIME_BEFORE_SORTING_AGAIN
        ) {
            let energyImpactPerId = new Map();
            for (let {
                    id,
                    dispatchesSincePrevious,
                    durationSincePrevious,
                } of counters()) {
                let energyImpact = this._computeEnergyImpact(
                    dispatchesSincePrevious,
                    durationSincePrevious
                );
                energyImpactPerId.set(id, energyImpact);
            }
            return;
        }

        let addons_all_cpu = 0;
        let addons_all_mem = 0;
        let addons_all_tooltip = "";

        counters = this._sortCounters(counters);

        for (

            let {
                id,
                name,
                image,
                type,
                memory: memory,
                totalDispatches: dispatches,
                totalDuration: duration,
                durationSincePrevious,
                dispatchesSincePrevious,
                durationSinceStartOfBuffer,
                dispatchesSinceStartOfBuffer,
                children,
                tabNode: tabNode,
                pid,
            } of counters)
        {
            if (name.title) name = name.title;
            else if (name.id) name = name.id;

            EnergyImpact = this._computeEnergyImpact(
                dispatchesSincePrevious,
                durationSincePrevious);


            let mem_united = View.memoryAddUnit(memory);


            if (type == "tab") {

                let tabAllBarsContParent = tabNode.getElementsByClassName("tab-background")[0];
                let tabAllBarsCont = tabAllBarsContParent.getElementsByClassName("tabBars")[0];
                if (!tabAllBarsCont) {
                    tabAllBarsCont = document.createElement("div");
                    tabAllBarsCont.className = "tabBars";
                    tabAllBarsCont.style.position = "absolute";
                    tabAllBarsCont.style.right = "2px";
                    tabAllBarsCont.style.bottom = 0;
                    tabAllBarsCont.style.height = "100%";
                    tabAllBarsCont.style.width = "11px";
                    tabAllBarsContParent.appendChild(tabAllBarsCont);
                }
                this.addBarsToNode(tabAllBarsCont, EnergyImpact, memory);
                //console.log(`cpu=${EnergyImpact}  ${tabNode.getAttribute("label")}`);

                tabAllBarsCont.title = tabAllBarsCont.tooltipText = `CPU ${EnergyImpact}\nMEM ${mem_united}\nPID ${pid}`;

                addons_all_tooltip += `${EnergyImpact}\t${mem_united}\t<${name}>\t${pid}\n`;
            } else if (type == "addon") {
                addons_all_cpu += EnergyImpact;
                addons_all_mem += memory;
                addons_all_tooltip += `${EnergyImpact}\t${mem_united}\t[${name}]\t${pid}\n`;
            } else {
                addons_all_cpu += EnergyImpact;
                addons_all_mem += memory;
                addons_all_tooltip += `${EnergyImpact}\t${mem_united}\t${name}\t${pid}\n`;
            }


            if (!children.length) {
                continue;
            }

        }

        let addonsAllBarsContParent = document.getElementById("TabsToolbar");
        let addonsAllBarsCont = addonsAllBarsContParent.getElementsByClassName("addonsBars")[0];
        if (!addonsAllBarsCont) {
            addonsAllBarsCont = document.createElement("div");
            addonsAllBarsCont.className = "addonsBars";
            addonsAllBarsCont.style.position = "relative";
            addonsAllBarsCont.style.display = "block";
            //addonsAllBarsCont.style.right = 0;
            //addonsAllBarsCont.style.bottom = 0;
            //addonsAllBarsCont.style.height = "var(--tab-min-height) !important";
            addonsAllBarsCont.style.height = "100%";
            addonsAllBarsCont.style.width = "11px";
            addonsAllBarsContParent.appendChild(addonsAllBarsCont);
        }
        //addonsAllBarsCont.style.height = window.getComputedStyle(addonsAllBarsContParent).height


        this.addBarsToNode(addonsAllBarsCont, addons_all_cpu, addons_all_mem);

        addonsAllBarsCont.title = addonsAllBarsCont.tooltipText = addons_all_tooltip;

    },

    addBarsToNode(node, cpu, memory) {
        var cpubar;
        cpubar = node.getElementsByClassName("cpuBar")[0];
        if (!cpubar) {
            cpubar = document.createElement("div");
            cpubar.className = "cpuBar";
            cpubar.style.backgroundColor = "#fd9191";
            cpubar.style.width = "3px";
            cpubar.style.position = "absolute";
            cpubar.style.right = "6px";
            cpubar.style.bottom = 0;
            node.appendChild(cpubar);
        }
        cpubar.style.height = Math.min((cpu > 0) ? cpu : 0, 100) + "%";

        var membar;
        membar = node.getElementsByClassName("memBar")[0];
        if (!membar) {
            membar = document.createElement("div");
            membar.className = "memBar";
            //membar.style.backgroundColor = "rgb(242, 242, 0)"; //yellow
            membar.style.backgroundColor = "rgb(60, 160, 244)"; //blue
            membar.style.width = "3px";
            membar.style.position = "absolute";
            membar.style.right = "2px";
            membar.style.bottom = 0;
            node.appendChild(membar);
        }
        membar.style.height = Math.min(memory / 400000000 * 100, 100) + "%";
    },

    _computeEnergyImpact(dispatches, duration) {
        // 'Dispatches' doesn't make sense to users, and it's difficult to present
        // two numbers in a meaningful way, so we need to somehow aggregate the
        // dispatches and duration values we have.
        // The current formula to aggregate the numbers assumes that the cost of
        // a dispatch is equivalent to 1ms of CPU time.
        // Dividing the result by the sampling interval and by 10 gives a number that
        // looks like a familiar percentage to users, as fullying using one core will
        // result in a number close to 100.
        let energyImpact =
            Math.max(duration || 0, dispatches * 1000) / UPDATE_INTERVAL_MS / 10;
        // Keep only 2 digits after the decimal point.
        return Math.ceil(energyImpact * 100) / 100;
    },
    _sortCounters(counters) {
        return counters.sort((a, b) => {
            var a_cpu, b_cpu;
            a_cpu = this._computeEnergyImpact(
                a.dispatchesSincePrevious,
                a.durationSincePrevious
            );
            b_cpu = this._computeEnergyImpact(
                b.dispatchesSincePrevious,
                b.durationSincePrevious
            );
            var a_value, b_value;
            a_value = a_cpu + a.memory/(150*1024*1024);
            b_value = b_cpu + b.memory/(150*1024*1024);
            return b_value - a_value;
        });
    },
};

var taskMonitorTimerID = null;
async function startTaskMonitor() {
    if (taskMonitorTimerID) {
        console.log("TaskMonitor already running");
        return;
    }

    await Control.update();

    taskMonitorTimerID = window.setInterval(() => Control.update(), UPDATE_INTERVAL_MS);
};

function stopTaskMonitor() {
    window.clearInterval(taskMonitorTimerID);
    taskMonitorTimerID = null;
}

startTaskMonitor();
