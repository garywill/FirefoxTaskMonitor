   
var Control = {
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
    },
    

    


  
};