/**
 * Utilities for dealing with state
 */
var State = {
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
    },
     }; 
