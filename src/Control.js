var Control = {
    // The set of all processes reported as "hung" by the process hang monitor.
    //
    // type: Set<ChildID>
    _hungItems: new Set(),
    _sortColumn: null,
    _sortAscendent: true,
    _removeSubtree(row) {
        let sibling = row.nextSibling;
        while (sibling && !sibling.classList.contains("process")) {
            let next = sibling.nextSibling;
            if (sibling.classList.contains("thread")) {
                View._removeRow(sibling);
            }
            sibling = next;
        }
    },
    init() {
        this._initHangReports();
        
        // Start prefetching units.
        this._promisePrefetchedUnits = (async function () {
            let [ns, us, ms, s, m, h, d, B, KB, MB, GB, TB, PB, EB] =
            await document.l10n.formatValues([
                { id: "duration-unit-ns" },
                { id: "duration-unit-us" },
                { id: "duration-unit-ms" },
                { id: "duration-unit-s" },
                { id: "duration-unit-m" },
                { id: "duration-unit-h" },
                { id: "duration-unit-d" },
                { id: "memory-unit-B" },
                { id: "memory-unit-KB" },
                { id: "memory-unit-MB" },
                { id: "memory-unit-GB" },
                { id: "memory-unit-TB" },
                { id: "memory-unit-PB" },
                { id: "memory-unit-EB" },
            ]);
            return {
                duration: { ns, us, ms, s, m, h, d },
                memory: { B, KB, MB, GB, TB, PB, EB },
            };
        })();
        
        let tbody = document.getElementById("process-tbody");
        
        // Single click:
        // - show or hide the contents of a twisty;
        // - close a process;
        // - profile a process;
        // - change selection.
        tbody.addEventListener("click", event => {
            this._updateLastMouseEvent();
            
            this._handleActivate(event.target);
        });
        
        // Enter or Space keypress:
        // - show or hide the contents of a twisty;
        // - close a process;
        // - profile a process;
        // - change selection.
        tbody.addEventListener("keypress", event => {
            // Handle showing or hiding subitems of a row, when keyboard is used.
            if (event.key === "Enter" || event.key === " ") {
                this._handleActivate(event.target);
            }
        });
        
        // Double click:
        // - navigate to tab;
        // - navigate to about:addons.
        tbody.addEventListener("dblclick", event => {
            this._updateLastMouseEvent();
            event.stopPropagation();
            
            // Bubble up the doubleclick manually.
            for (
                let target = event.target;
            target && target.getAttribute("id") != "process-tbody";
            target = target.parentNode
            ) {
                if (target.classList.contains("tab")) {
                    // We've clicked on a tab, navigate.
                    let { tab, tabbrowser } = target.parentNode.win.tab;
                    tabbrowser.selectedTab = tab;
                    tabbrowser.ownerGlobal.focus();
                    return;
                }
                if (target.classList.contains("extensions")) {
                    // We've clicked on the extensions process, open or reuse window.
                    let parentWin =
                    window.docShell.browsingContext.embedderElement.ownerGlobal;
                    parentWin.BrowserAddonUI.openAddonsMgr();
                    return;
                }
                // Otherwise, proceed.
            }
        });
        
        tbody.addEventListener("mousemove", () => {
            this._updateLastMouseEvent();
        });
        
        // Visibility change:
        // - stop updating while the user isn't looking;
        // - resume updating when the user returns.
        window.addEventListener("visibilitychange", () => {
            if (!document.hidden) {
                this._updateDisplay(true);
            }
        });
        
        document
        .getElementById("process-thead")
        .addEventListener("click", async event => {
            if (!event.target.classList.contains("clickable")) {
                return;
            }
            // Linux has conventions opposite to Windows and macOS on the direction of arrows
            // when sorting.
            const platformIsLinux = AppConstants.platform == "linux";
            const ascArrow = platformIsLinux ? "arrow-up" : "arrow-down";
            const descArrow = platformIsLinux ? "arrow-down" : "arrow-up";
            
            if (this._sortColumn) {
                const td = document.getElementById(this._sortColumn);
                td.classList.remove(ascArrow, descArrow);
            }
            
            const columnId = event.target.id;
            if (columnId == this._sortColumn) {
                // Reverse sorting order.
                this._sortAscendent = !this._sortAscendent;
            } else {
                this._sortColumn = columnId;
                this._sortAscendent = true;
            }
            
            event.target.classList.toggle(ascArrow, this._sortAscendent);
            event.target.classList.toggle(descArrow, !this._sortAscendent);
            
            await this._updateDisplay(true);
        });
    },
    _lastMouseEvent: 0,
    _updateLastMouseEvent() {
        this._lastMouseEvent = Date.now();
    },
    _initHangReports() {
        const PROCESS_HANG_REPORT_NOTIFICATION = "process-hang-report";
        
        // Receiving report of a hung child.
        // Let's store if for our next update.
        let hangReporter = report => {
            report.QueryInterface(Ci.nsIHangReport);
            this._hungItems.add(report.childID);
        };
        Services.obs.addObserver(hangReporter, PROCESS_HANG_REPORT_NOTIFICATION);
        
        // Don't forget to unregister the reporter.
        window.addEventListener(
            "unload",
            () => {
                Services.obs.removeObserver(
                    hangReporter,
                    PROCESS_HANG_REPORT_NOTIFICATION
                );
            },
            { once: true }
        );
    },
    async update(force = false) {
        await State.update(force);
        
        if (document.hidden) {
            return;
        }
        
        await this._updateDisplay(force);
    },
    
    // The force parameter can force a full update even when the mouse has been
    // moved recently.
    async _updateDisplay(force = false) {
        let counters = State.getCounters();
        if (this._promisePrefetchedUnits) {
            gLocalizedUnits = await this._promisePrefetchedUnits;
            this._promisePrefetchedUnits = null;
        }
        
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
                    if (SHOW_ALL_SUBFRAMES || win.tab || win.isProcessRoot) {
                        View.displayDOMWindowRow(win, process);
                    }
                }
            }
            
            if (process.type === "utility") {
                for (let actor of process.utilityActors) {
                    View.displayUtilityActorRow(actor, process);
                }
            }
            
            if (SHOW_THREADS) {
                if (View.displayThreadSummaryRow(process)) {
                    this._showThreads(processRow, this._maxSlopeCpu);
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
        
        if (
            !force &&
            Date.now() - this._lastMouseEvent < TIME_BEFORE_SORTING_AGAIN
        ) {
            // If there has been a recent mouse event, we don't want to reorder,
            // add or remove rows so that the table content under the mouse pointer
            // doesn't change when the user might be about to click to close a tab
            // or kill a process.
            // We didn't return earlier because updating CPU and memory values is
            // still valuable.
            View.discardUpdate();
            return;
        }
        
        View.commit();
        
        // Reset the selectedRow field if that row is no longer in the DOM
        // to avoid keeping forever references to dead processes.
        if (this.selectedRow && !this.selectedRow.parentNode) {
            this.selectedRow = null;
        }
        
        // Used by tests to differentiate full updates from l10n updates.
        document.dispatchEvent(new CustomEvent("AboutProcessesUpdated"));
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
    
    // Handle events on image controls.
    _handleActivate(target) {
        if (target.classList.contains("twisty")) {
            this._handleTwisty(target);
            return;
        }
        if (target.classList.contains("close-icon")) {
            this._handleKill(target);
            return;
        }
        
        if (target.classList.contains("profiler-icon")) {
            this._handleProfiling(target);
            return;
        }
        
        this._handleSelection(target);
    },
    
    // Open/close list of threads.
    _handleTwisty(target) {
        let row = target.parentNode.parentNode;
        if (target.classList.toggle("open")) {
            target.setAttribute("aria-expanded", "true");
            this._showThreads(row, this._maxSlopeCpu);
            View.insertAfterRow(row);
        } else {
            target.setAttribute("aria-expanded", "false");
            this._removeSubtree(row);
        }
    },
    
    // Kill process/close tab/close subframe.
    _handleKill(target) {
        let row = target.parentNode;
        if (row.process) {
            // Kill process immediately.
            let pid = row.process.pid;
            
            // Make sure that the user can't click twice on the kill button.
            // Otherwise, chaos might ensue. Plus we risk crashing under Windows.
            View._killedRecently.push({ pid });
            
            // Discard tab contents and show that the process and all its contents are getting killed.
            row.classList.add("killing");
            for (
                let childRow = row.nextSibling;
            childRow && !childRow.classList.contains("process");
            childRow = childRow.nextSibling
            ) {
                childRow.classList.add("killing");
                let win = childRow.win;
                if (win) {
                    View._killedRecently.push({ pid: win.outerWindowId });
                    if (win.tab && win.tab.tabbrowser) {
                        win.tab.tabbrowser.discardBrowser(
                            win.tab.tab,
                            /* aForceDiscard = */ true
                        );
                    }
                }
            }
            
            // Finally, kill the process.
            const ProcessTools = Cc["@mozilla.org/processtools-service;1"].getService(
                Ci.nsIProcessToolsService
            );
            ProcessTools.kill(pid);
        } else if (row.win && row.win.tab && row.win.tab.tabbrowser) {
            // This is a tab, close it.
            row.win.tab.tabbrowser.removeTab(row.win.tab.tab, {
                skipPermitUnload: true,
                animate: true,
            });
            View._killedRecently.push({ outerWindowId: row.win.outerWindowId });
            row.classList.add("killing");
            
            // If this was the only root window of the process, show that the process is also getting killed.
            if (row.previousSibling.classList.contains("process")) {
                let parentRow = row.previousSibling;
                let roots = 0;
                for (let win of parentRow.process.windows) {
                    if (win.isProcessRoot) {
                        roots += 1;
                    }
                }
                if (roots <= 1) {
                    // Yes, we're the only process root, so the process is dying.
                    //
                    // It might actually become a preloaded process rather than
                    // dying. That's an acceptable error. Even if we display incorrectly
                    // that the process is dying, this error will last only one refresh.
                    View._killedRecently.push({ pid: parentRow.process.pid });
                    parentRow.classList.add("killing");
                }
            }
        }
    },
    
    // Handle profiling of a process.
    _handleProfiling(target) {
        if (Services.profiler.IsActive()) {
            return;
        }
        Services.profiler.StartProfiler(
            10000000,
            1,
            ["default", "ipcmessages", "power"],
            ["pid:" + target.parentNode.parentNode.process.pid]
        );
        target.classList.add("profiler-active");
        setTimeout(() => {
            ProfilerPopupBackground.captureProfile("aboutprofiling");
            target.classList.remove("profiler-active");
        }, PROFILE_DURATION * 1000);
    },
    
    // Handle selection changes.
    _handleSelection(target) {
        let row = target.closest("tr");
        if (!row) {
            return;
        }
        if (this.selectedRow) {
            this.selectedRow.removeAttribute("selected");
            if (this.selectedRow.rowId == row.rowId) {
                // Clicking the same row again clears the selection.
                this.selectedRow = null;
                return;
            }
        }
        row.setAttribute("selected", "true");
        this.selectedRow = row;
    },
}; 
