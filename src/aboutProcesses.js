/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


// Time in ms before we start changing the sort order again after receiving a
// mousemove event.
const TIME_BEFORE_SORTING_AGAIN = 5000;

// How long we should wait between samples.
const MINIMUM_INTERVAL_BETWEEN_SAMPLES_MS = 1000;

// How often we should update
const UPDATE_INTERVAL_MS = 2000;

const NS_PER_US = 1000;
const NS_PER_MS = 1000 * 1000;
const NS_PER_S = 1000 * 1000 * 1000;
const NS_PER_MIN = NS_PER_S * 60;
const NS_PER_HOUR = NS_PER_MIN * 60;
const NS_PER_DAY = NS_PER_HOUR * 24;

const ONE_GIGA = 1024 * 1024 * 1024;
const ONE_MEGA = 1024 * 1024;
const ONE_KILO = 1024;

// const { XPCOMUtils } = ChromeUtils.importESModule(
//     "resource://gre/modules/XPCOMUtils.sys.mjs"
// );
// const { AppConstants } = ChromeUtils.importESModule(
//     "resource://gre/modules/AppConstants.sys.mjs"
// );

ChromeUtils.defineESModuleGetters(this, {
    ContextualIdentityService:
        "resource://gre/modules/ContextualIdentityService.sys.mjs",
});

ChromeUtils.defineLazyGetter(this, "ProfilerPopupBackground", function () {
    return ChromeUtils.importESModule(
        "resource://devtools/client/performance-new/shared/background.sys.mjs"
    );
});

const { WebExtensionPolicy } = Cu.getGlobalForObject(Services);


const gLocalizedUnits = 
{
    "duration": { "ns": "ns", "us": "µs", "ms": "ms", "s": "s", "m": "m", "h": "h", "d": "d" },
    "memory": { "B": "B", "KB": "KB", "MB": "MB", "GB": "GB", "TB": "TB", "PB": "PB", "EB": "EB" }
};


let tabFinder = {
    update() {
        this._map = new Map();
        for (let win of Services.wm.getEnumerator("navigator:browser")) {
            let tabbrowser = win.gBrowser;
            for (let browser of tabbrowser.browsers) {
                let id = browser.outerWindowID; // May be `null` if the browser isn't loaded yet
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
        return { tabbrowser, tab: tabbrowser.getTabForBrowser(browser) };
    },
}; 


/**
 * Utilities for dealing with state
 */
let State = {
    // Store the previous and current samples so they can be compared.
    _previous: null,
    _latest: null,
    
    async _promiseSnapshot() {
        let date = Cu.now();
        let main = await ChromeUtils.requestProcInfo();
        main.date = date;
        
        let processes = new Map();
        processes.set(main.pid, main);
        for (let child of main.children) {
            child.date = date;
            processes.set(child.pid, child);
        }
        
        return { processes, date };
    },
    
    /**
     * Update the internal state.
     *
     * @return {Promise}
     */
    async update(force = false) {
        if (
            force ||
                !this._latest ||
                Cu.now() - this._latest.date > MINIMUM_INTERVAL_BETWEEN_SAMPLES_MS
        ) {
            // Replacing this._previous before we are done awaiting
            // this._promiseSnapshot can cause this._previous and this._latest to be
            // equal for a short amount of time, which can cause test failures when
            // a forced update of the display is triggered in the meantime.
            let newSnapshot = await this._promiseSnapshot();
            this._previous = this._latest;
            this._latest = newSnapshot;
        }
    },
    
    _getThreadDelta(cur, prev, deltaT) {
        let result = {
            tid: cur.tid,
            name: cur.name || `(${cur.tid})`,
            // Total amount of CPU used, in ns.
            totalCpu: cur.cpuTime,
            slopeCpu: null,
            active: null,
        };
        if (!deltaT) {
            return result;
        }
        result.slopeCpu = (result.totalCpu - (prev ? prev.cpuTime : 0)) / deltaT;
        result.active =
        !!result.slopeCpu || cur.cpuCycleCount > (prev ? prev.cpuCycleCount : 0);
        return result;
    },
    
    _getDOMWindows(process) {
        if (!process.windows) {
            return [];
        }
        if (!process.type == "extensions") {
            return [];
        }
        let windows = process.windows.map(win => {
            let tab = tabFinder.get(win.outerWindowId);
            let addon =
            process.type == "extension"
            ? WebExtensionPolicy.getByURI(win.documentURI)
            : null;
            let displayRank;
            if (tab) {
                displayRank = 1;
            } else if (win.isProcessRoot) {
                displayRank = 2;
            } else if (win.documentTitle) {
                displayRank = 3;
            } else {
                displayRank = 4;
            }
            return {
                outerWindowId: win.outerWindowId,
                documentURI: win.documentURI,
                documentTitle: win.documentTitle,
                isProcessRoot: win.isProcessRoot,
                isInProcess: win.isInProcess,
                tab,
                addon,
                // The number of instances we have collapsed.
                count: 1,
                // A rank used to quickly sort windows.
                displayRank,
            };
        });
        
        // We keep all tabs and addons but we collapse subframes that have the same host.
        
        // A map from host -> subframe.
        let collapsible = new Map();
        let result = [];
        for (let win of windows) {
            if (win.tab || win.addon) {
                result.push(win);
                continue;
            }
            let prev = collapsible.get(win.documentURI.prePath);
            if (prev) {
                prev.count += 1;
            } else {
                collapsible.set(win.documentURI.prePath, win);
                result.push(win);
            }
        }
        return result;
    },
    
    /**
     * Compute the delta between two process snapshots.
     *
     * @param {ProcessSnapshot} cur
     * @param {ProcessSnapshot?} prev
     */
    _getProcessDelta(cur, prev) {
        let windows = this._getDOMWindows(cur);
        let result = {
            pid: cur.pid,
            childID: cur.childID,
            totalRamSize: cur.memory,
            deltaRamSize: null,
            totalCpu: cur.cpuTime,
            slopeCpu: null,
            active: null,
            type: cur.type,
            origin: cur.origin || "",
            threads: null,
            displayRank: Control._getDisplayGroupRank(cur, windows),
            windows,
            utilityActors: cur.utilityActors,
            // If this process has an unambiguous title, store it here.
            title: null,
        };
        // Attempt to determine a title for this process.
        let titles = [
            ...new Set(
                result.windows
                .filter(win => win.documentTitle)
                .map(win => win.documentTitle)
            ),
        ];
        if (titles.length == 1) {
            result.title = titles[0];
        }
        if (!prev) {
            return result;
        }
        if (prev.pid != cur.pid) {
            throw new Error("Assertion failed: A process cannot change pid.");
        }
        let deltaT = (cur.date - prev.date) * NS_PER_MS;
        let threads = null;
        
        result.deltaRamSize = cur.memory - prev.memory;
        result.slopeCpu = (cur.cpuTime - prev.cpuTime) / deltaT;
        result.active = !!result.slopeCpu || cur.cpuCycleCount > prev.cpuCycleCount;
        result.threads = threads;
        return result;
    },
    
    getCounters() {
        tabFinder.update();
        
        let counters = [];
        
        for (let cur of this._latest.processes.values()) {
            let prev = this._previous?.processes.get(cur.pid);
            counters.push(this._getProcessDelta(cur, prev));
        }
        
        return counters;
    }
}; 
     

let View = {
    commit() {
        let tbody = document.createElement("table").appendChild(document.createElement("tbody"));
        let insertPoint = tbody.firstChild;
        let nextRow;
        while ((nextRow = this._orderedRows.shift())) {
            if (insertPoint && insertPoint === nextRow) {
                insertPoint = insertPoint.nextSibling;
            } else {
                tbody.insertBefore(nextRow, insertPoint);
            }
        }
        
        if (insertPoint) {
            while ((nextRow = insertPoint.nextSibling)) {
                this._removeRow(nextRow);
            }
            this._removeRow(insertPoint);
        }
        return tbody;
    },
    _rowsById: new Map(),
    _removeRow(row) {
        this._rowsById.delete(row.rowId);
        
        row.remove();
    },
    _getOrCreateRow(rowId, cellCount) {
        let row = this._rowsById.get(rowId);
        if (!row) {
            row = document.createElement("tr");
            while (cellCount--) {
                row.appendChild(document.createElement("td"));
            }
            row.rowId = rowId;
            this._rowsById.set(rowId, row);
        }
        this._orderedRows.push(row);
        return row;
    },
    
    displayCpu(data, cpuCell, maxSlopeCpu) {
        // Put a value < 0% when we really don't want to see a bar as
        // otherwise it sometimes appears due to rounding errors when we
        // don't have an integer number of pixels.
        let barWidth = -0.5;
        if (data.slopeCpu == null) {
            this._fillCell(cpuCell, {
                fluentName: "about-processes-cpu-user-and-kernel-not-ready",
                classes: ["cpu"],
            });
        } else {
            let { duration, unit } = this._getDuration(data.totalCpu);
            if (data.totalCpu == 0) {
                // A thread having used exactly 0ns of CPU time is not possible.
                // When we get 0 it means the thread used less than the precision of
                // the measurement, and it makes more sense to show '0ms' than '0ns'.
                // This is useful on Linux where the minimum non-zero CPU time value
                // for threads of child processes is 10ms, and on Windows ARM64 where
                // the minimum non-zero value is 16ms.
                unit = "ms";
            }
            let localizedUnit = gLocalizedUnits.duration[unit];
            if (data.slopeCpu == 0) {
                let fluentName = data.active
                ? "about-processes-cpu-almost-idle"
                : "about-processes-cpu-fully-idle";
                this._fillCell(cpuCell, {
                    fluentName,
                    fluentArgs: {
                        total: duration,
                        unit: localizedUnit,
                    },
                    classes: ["cpu"],
                });
            } else {
                this._fillCell(cpuCell, {
                    fluentName: "about-processes-cpu",
                    fluentArgs: {
                        percent: data.slopeCpu,
                        total: duration,
                        unit: localizedUnit,
                    },
                    classes: ["cpu"],
                });
                
                let cpuPercent = data.slopeCpu * 100;
                if (maxSlopeCpu > 1) {
                    cpuPercent /= maxSlopeCpu;
                }
                // Ensure we always have a visible bar for non-0 values.
                barWidth = Math.max(0.5, cpuPercent);
            }
        }
        cpuCell.style.setProperty("--bar-width", barWidth);
    },
    
    /**
     * Display a row showing a single process (without its threads).
     *
     * @param {ProcessDelta} data The data to display.
     * @param {Number} maxSlopeCpu The largest slopeCpu value.
     * @return {DOMElement} The row displaying the process.
     */
    displayProcessRow(data, maxSlopeCpu) {
        const cellCount = 4;
        let rowId = "p:" + data.pid;
        let row = this._getOrCreateRow(rowId, cellCount);
        row.process = data;
        {
            let classNames = "process";
            if (data.isHung) {
                classNames += " hung";
            }
            row.className = classNames;
        }
        
        // Column: Name
        let nameCell = row.firstChild;
        {
            let classNames = [];
            let fluentName;
            let fluentArgs = {
                pid: "" + data.pid, // Make sure that this number is not localized
            };
            switch (data.type) {
                case "web":
                    fluentName = "about-processes-web-process";
                    break;
                case "webIsolated":
                    fluentName = "about-processes-web-isolated-process";
                    fluentArgs.origin = data.origin;
                    break;
                case "webServiceWorker":
                    fluentName = "about-processes-web-serviceworker";
                    fluentArgs.origin = data.origin;
                    break;
                case "file":
                    fluentName = "about-processes-file-process";
                    break;
                case "extension":
                    fluentName = "about-processes-extension-process";
                    classNames = ["extensions"];
                    break;
                case "privilegedabout":
                    fluentName = "about-processes-privilegedabout-process";
                    break;
                case "privilegedmozilla":
                    fluentName = "about-processes-privilegedmozilla-process";
                    break;
                case "withCoopCoep":
                    fluentName = "about-processes-with-coop-coep-process";
                    fluentArgs.origin = data.origin;
                    break;
                case "browser":
                    fluentName = "about-processes-browser-process";
                    break;
                case "plugin":
                    fluentName = "about-processes-plugin-process";
                    break;
                case "gmpPlugin":
                    fluentName = "about-processes-gmp-plugin-process";
                    break;
                case "gpu":
                    fluentName = "about-processes-gpu-process";
                    break;
                case "vr":
                    fluentName = "about-processes-vr-process";
                    break;
                case "rdd":
                    fluentName = "about-processes-rdd-process";
                    break;
                case "socket":
                    fluentName = "about-processes-socket-process";
                    break;
                case "remoteSandboxBroker":
                    fluentName = "about-processes-remote-sandbox-broker-process";
                    break;
                case "forkServer":
                    fluentName = "about-processes-fork-server-process";
                    break;
                case "preallocated":
                    fluentName = "about-processes-preallocated-process";
                    break;
                case "utility":
                    fluentName = "about-processes-utility-process";
                    break;
                    // The following are probably not going to show up for users
                    // but let's handle the case anyway to avoid heisenoranges
                    // during tests in case of a leftover process from a previous
                    // test.
                default:
                    fluentName = "about-processes-unknown-process";
                    fluentArgs.type = data.type;
                    break;
            }
            
            // Show container names instead of raw origin attribute suffixes.
            if (fluentArgs.origin?.includes("^")) {
                let origin = fluentArgs.origin;
                let privateBrowsingId, userContextId;
                try {
                    ({ privateBrowsingId, userContextId } =
                    ChromeUtils.createOriginAttributesFromOrigin(origin));
                    fluentArgs.origin = origin.slice(0, origin.indexOf("^"));
                } catch (e) {
                    // createOriginAttributesFromOrigin can throw NS_ERROR_FAILURE for incorrect origin strings.
                }
                if (userContextId) {
                    let identityLabel =
                    ContextualIdentityService.getUserContextLabel(userContextId);
                    if (identityLabel) {
                        fluentArgs.origin += ` — ${identityLabel}`;
                    }
                }
                if (privateBrowsingId) {
                    fluentName += "-private";
                }
            }
            
            let processNameElement = nameCell;
            document.l10n.setAttributes(processNameElement, fluentName, fluentArgs);
            nameCell.className = ["type", "favicon", ...classNames].join(" ");
            nameCell.setAttribute("id", data.pid + "-label");
            
            let image;
            switch (data.type) {
                case "browser":
                case "privilegedabout":
                    image = "chrome://branding/content/icon32.png";
                    break;
                case "extension":
                    image = "chrome://mozapps/skin/extensions/extension.svg";
                    break;
                default:
                    // If all favicons match, pick the shared favicon.
                    // Otherwise, pick a default icon.
                    // If some tabs have no favicon, we ignore them.
                    for (let win of data.windows || []) {
                        if (!win.tab) {
                            continue;
                        }
                        let favicon = win.tab.tab.getAttribute("image");
                        if (!favicon) {
                            // No favicon here, let's ignore the tab.
                        } else if (!image) {
                            // Let's pick a first favicon.
                            // We'll remove it later if we find conflicting favicons.
                            image = favicon;
                        } else if (image == favicon) {
                            // So far, no conflict, keep the favicon.
                        } else {
                            // Conflicting favicons, fallback to default.
                            image = null;
                            break;
                        }
                    }
                    if (!image) {
                        image = "chrome://global/skin/icons/link.svg";
                    }
            }
            nameCell.style.backgroundImage = `url('${image}')`;
        }
        
        // Column: Memory
        let memoryCell = nameCell.nextSibling;
        {
            let formattedTotal = this._formatMemory(data.totalRamSize);
            if (data.deltaRamSize) {
                let formattedDelta = this._formatMemory(data.deltaRamSize);
                this._fillCell(memoryCell, {
                    fluentName: "about-processes-total-memory-size-changed",
                    fluentArgs: {
                        total: formattedTotal.amount,
                        totalUnit: gLocalizedUnits.memory[formattedTotal.unit],
                        delta: Math.abs(formattedDelta.amount),
                               deltaUnit: gLocalizedUnits.memory[formattedDelta.unit],
                               deltaSign: data.deltaRamSize > 0 ? "+" : "-",
                    },
                    classes: ["memory"],
                });
            } else {
                this._fillCell(memoryCell, {
                    fluentName: "about-processes-total-memory-size-no-change",
                    fluentArgs: {
                        total: formattedTotal.amount,
                        totalUnit: gLocalizedUnits.memory[formattedTotal.unit],
                    },
                    classes: ["memory"],
                });
            }
        }
        
        // Column: CPU
        let cpuCell = memoryCell.nextSibling;
        this.displayCpu(data, cpuCell, maxSlopeCpu);
        
        
        return row;
    },
    
    
    
    displayDOMWindowRow(data) {
        const cellCount = 2;
        let rowId = "w:" + data.outerWindowId;
        let row = this._getOrCreateRow(rowId, cellCount);
        row.win = data;
        row.className = "window";
        
        // Column: name
        let nameCell = row.firstChild;
        let tab = tabFinder.get(data.outerWindowId);
        let fluentName;
        let fluentArgs = {};
        let className;
        if (tab && tab.tabbrowser) {
            fluentName = "about-processes-tab-name";
            fluentArgs.name = tab.tab.label;
            fluentArgs.tabWindowId = data.outerWindowId; // this tabWindowId can be used by tabFinder.get()
            className = "tab";
        } else if (tab) {
            fluentName = "about-processes-preloaded-tab";
            className = "preloaded-tab";
        } else if (data.count == 1) {
            fluentName = "about-processes-frame-name-one";
            fluentArgs.url = data.documentURI.spec;
            className = "frame-one";
        } else {
            fluentName = "about-processes-frame-name-many";
            fluentArgs.number = data.count;
            fluentArgs.shortUrl =
            data.documentURI.scheme == "about"
            ? data.documentURI.spec
            : data.documentURI.prePath;
            className = "frame-many";
        }
        this._fillCell(nameCell, {
            fluentName,
            fluentArgs,
            classes: ["name", "indent", "favicon", className],
        });
        let image = tab?.tab.getAttribute("image");
        if (image) {
            nameCell.style.backgroundImage = `url('${image}')`;
        }
    },
    
    utilityActorNameToFluentName(actorName) {
        let fluentName;
        switch (actorName) {
            case "audioDecoder_Generic":
                fluentName = "about-processes-utility-actor-audio-decoder-generic";
                break;
                
            case "audioDecoder_AppleMedia":
                fluentName = "about-processes-utility-actor-audio-decoder-applemedia";
                break;
                
            case "audioDecoder_WMF":
                fluentName = "about-processes-utility-actor-audio-decoder-wmf";
                break;
                
            case "mfMediaEngineCDM":
                fluentName = "about-processes-utility-actor-mf-media-engine";
                break;
                
            case "jSOracle":
                fluentName = "about-processes-utility-actor-js-oracle";
                break;
                
            case "windowsUtils":
                fluentName = "about-processes-utility-actor-windows-utils";
                break;
                
            case "windowsFileDialog":
                fluentName = "about-processes-utility-actor-windows-file-dialog";
                break;
                
            default:
                fluentName = "about-processes-utility-actor-unknown";
                break;
        }
        return fluentName;
    },
    
    displayUtilityActorRow(data, parent) {
        const cellCount = 2;
        // The actor name is expected to be unique within a given utility process.
        let rowId = "u:" + parent.pid + data.actorName;
        let row = this._getOrCreateRow(rowId, cellCount);
        row.actor = data;
        row.className = "actor";
        
        // Column: name
        let nameCell = row.firstChild;
        let fluentName = this.utilityActorNameToFluentName(data.actorName);
        let fluentArgs = {};
        this._fillCell(nameCell, {
            fluentName,
            fluentArgs,
            classes: ["name", "indent", "favicon"],
        });
    },
    
    /**
     * Display a row showing a single thread.
     *
     * @param {ThreadDelta} data The data to display.
     * @param {Number} maxSlopeCpu The largest slopeCpu value.
     */
    displayThreadRow(data, maxSlopeCpu) {
        const cellCount = 3;
        let rowId = "t:" + data.tid;
        let row = this._getOrCreateRow(rowId, cellCount);
        row.thread = data;
        row.className = "thread";
        
        // Column: name
        let nameCell = row.firstChild;
        this._fillCell(nameCell, {
            fluentName: "about-processes-thread-name-and-id",
            fluentArgs: {
                name: data.name,
                tid: "" + data.tid /* Make sure that this number is not localized */,
            },
            classes: ["name", "double_indent"],
        });
        
        // Column: CPU
        this.displayCpu(data, nameCell.nextSibling, maxSlopeCpu);
        
        // Third column (Buttons) is empty, nothing to do.
    },
    
    _orderedRows: [],
    _fillCell(elt, { classes, fluentName, fluentArgs }) {
        document.l10n.setAttributes(elt, fluentName, fluentArgs);
        elt.className = classes.join(" ");
    },
    
    _getDuration(rawDurationNS) {
        if (rawDurationNS <= NS_PER_US) {
            return { duration: rawDurationNS, unit: "ns" };
        }
        if (rawDurationNS <= NS_PER_MS) {
            return { duration: rawDurationNS / NS_PER_US, unit: "us" };
        }
        if (rawDurationNS <= NS_PER_S) {
            return { duration: rawDurationNS / NS_PER_MS, unit: "ms" };
        }
        if (rawDurationNS <= NS_PER_MIN) {
            return { duration: rawDurationNS / NS_PER_S, unit: "s" };
        }
        if (rawDurationNS <= NS_PER_HOUR) {
            return { duration: rawDurationNS / NS_PER_MIN, unit: "m" };
        }
        if (rawDurationNS <= NS_PER_DAY) {
            return { duration: rawDurationNS / NS_PER_HOUR, unit: "h" };
        }
        return { duration: rawDurationNS / NS_PER_DAY, unit: "d" };
    },
    
    /**
     * Format a value representing an amount of memory.
     *
     * As a special case, we also handle `null`, which represents the case in which we do
     * not have sufficient information to compute an amount of memory.
     *
     * @param {Number?} value The value to format. Must be either `null` or a non-negative number.
     * @return { {unit: "GB" | "MB" | "KB" | B" | "?"}, amount: Number } The formated amount and its
     *  unit, which may be used for e.g. additional CSS formating.
     */
    _formatMemory(value) {
        if (value == null) {
            return { unit: "?", amount: 0 };
        }
        if (typeof value != "number") {
            throw new Error(`Invalid memory value ${value}`);
        }
        let abs = Math.abs(value);
        if (abs >= ONE_GIGA) {
            return {
                unit: "GB",
                amount: value / ONE_GIGA,
            };
        }
        if (abs >= ONE_MEGA) {
            return {
                unit: "MB",
                amount: value / ONE_MEGA,
            };
        }
        if (abs >= ONE_KILO) {
            return {
                unit: "KB",
                amount: value / ONE_KILO,
            };
        }
        return {
            unit: "B",
            amount: value,
        };
    }
};
     
     


let Control = {
    // The set of all processes reported as "hung" by the process hang monitor.
    //
    // type: Set<ChildID>
    _hungItems: new Set(),
    _sortColumn: null,
    _sortAscendent: true,
    
    init() {
        this._initHangReports();
    },
    
    _initHangReports() {
        const PROCESS_HANG_REPORT_NOTIFICATION = "process-hang-report";
        
        // Receiving report of a hung child.
        // Let's store if for our next update.
        let hangReporter = report => {
            report.QueryInterface(Ci.nsIHangReport);
            this._hungItems.add(report.childID);
        };
        
        
    },
    async update(force = false) {
        await State.update(force);
        
        return await this._updateDisplay(force);
    },
    
    // The force parameter can force a full update even when the mouse has been
    // moved recently.
    async _updateDisplay(force = false) {
        let counters = State.getCounters();
        
        // We reset `_hungItems`, based on the assumption that the process hang
        // monitor will inform us again before the next update. Since the process hang monitor
        // pings its clients about once per second and we update about once per 2 seconds
        // (or more if the mouse moves), we should be ok.
        let hungItems = this._hungItems;
        this._hungItems = new Set();
        
        counters = this._sortProcesses(counters);
        
        // Stored because it is used when opening the list of threads.
        this._maxSlopeCpu = Math.max(...counters.map(process => process.slopeCpu));
        
        let previousProcess = null;
        for (let process of counters) {
            this._sortDOMWindows(process.windows);
            
            process.isHung = process.childID && hungItems.has(process.childID);
            
            let processRow = View.displayProcessRow(process, this._maxSlopeCpu);
            
            if (process.type != "extension") {
                // We do not want to display extensions.
                for (let win of process.windows) {
                    if (win.tab || win.isProcessRoot) {
                        View.displayDOMWindowRow(win, process);
                    }
                }
            }
            
            if (process.type === "utility") {
                for (let actor of process.utilityActors) {
                    View.displayUtilityActorRow(actor, process);
                }
            }
            
            
            if (
                this._sortColumn == null &&
                previousProcess &&
                previousProcess.displayRank != process.displayRank
            ) {
                // Add a separation between successive categories of processes.
                processRow.classList.add("separate-from-previous-process-group");
            }
            previousProcess = process;
        }
        
        
        
        return View.commit();
        
        
        
    },
    _compareCpu(a, b) {
        return (
            b.slopeCpu - a.slopeCpu || b.active - a.active || b.totalCpu - a.totalCpu
        );
    },
    _showThreads(row, maxSlopeCpu) {
        let process = row.process;
        this._sortThreads(process.threads);
        for (let thread of process.threads) {
            View.displayThreadRow(thread, maxSlopeCpu);
        }
    },
    _sortThreads(threads) {
        return threads.sort((a, b) => {
            let order;
            switch (this._sortColumn) {
                case "column-name":
                    order = a.name.localeCompare(b.name) || a.tid - b.tid;
                    break;
                case "column-cpu-total":
                    order = this._compareCpu(a, b);
                    break;
                case "column-memory-resident":
                case null:
                    order = a.tid - b.tid;
                    break;
                default:
                    throw new Error("Unsupported order: " + this._sortColumn);
            }
            if (!this._sortAscendent) {
                order = -order;
            }
            return order;
        });
    },
    _sortProcesses(counters) {
        return counters.sort((a, b) => {
            let order;
            switch (this._sortColumn) {
                case "column-name":
                    order =
                    String(a.origin).localeCompare(b.origin) ||
                    String(a.type).localeCompare(b.type) ||
                    a.pid - b.pid;
                    break;
                case "column-cpu-total":
                    order = this._compareCpu(a, b);
                    break;
                case "column-memory-resident":
                    order = b.totalRamSize - a.totalRamSize;
                    break;
                case null:
                    // Default order: classify processes by group.
                    order =
                    a.displayRank - b.displayRank ||
                    // Other processes are ordered by origin.
                    String(a.origin).localeCompare(b.origin);
                    break;
                default:
                    throw new Error("Unsupported order: " + this._sortColumn);
            }
            if (!this._sortAscendent) {
                order = -order;
            }
            return order;
        });
    },
    _sortDOMWindows(windows) {
        return windows.sort((a, b) => {
            let order =
            a.displayRank - b.displayRank ||
            a.documentTitle.localeCompare(b.documentTitle) ||
            a.documentURI.spec.localeCompare(b.documentURI.spec);
            if (!this._sortAscendent) {
                order = -order;
            }
            return order;
        });
    },
    
    // Assign a display rank to a process.
    //
    // The `browser` process comes first (rank 0).
    // Then come web tabs (rank 1).
    // Then come web frames (rank 2).
    // Then come special processes (minus preallocated) (rank 3).
    // Then come preallocated processes (rank 4).
    _getDisplayGroupRank(data, windows) {
        const RANK_BROWSER = 0;
        const RANK_WEB_TABS = 1;
        const RANK_WEB_FRAMES = 2;
        const RANK_UTILITY = 3;
        const RANK_PREALLOCATED = 4;
        let type = data.type;
        switch (type) {
            // Browser comes first.
            case "browser":
                return RANK_BROWSER;
                // Web content comes next.
            case "webIsolated":
            case "webServiceWorker":
            case "withCoopCoep": {
                if (windows.some(w => w.tab)) {
                    return RANK_WEB_TABS;
                }
                return RANK_WEB_FRAMES;
            }
            // Preallocated processes come last.
            case "preallocated":
                return RANK_PREALLOCATED;
                // "web" is special, as it could be one of:
                // - web content currently loading/unloading/...
                // - a preallocated process.
            case "web":
                if (windows.some(w => w.tab)) {
                    return RANK_WEB_TABS;
                }
                if (windows.length >= 1) {
                    return RANK_WEB_FRAMES;
                }
                // For the time being, we do not display DOM workers
                // (and there's no API to get information on them).
                // Once the blockers for bug 1663737 have landed, we'll be able
                // to find out whether this process has DOM workers. If so, we'll
                // count this process as a content process.
                return RANK_PREALLOCATED;
                // Other special processes before preallocated.
            default:
                return RANK_UTILITY;
        }
    }
    
};


