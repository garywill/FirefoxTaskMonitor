var View = {
    commit() {
        let tbody = document.getElementById("process-tbody");
        
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
    
    /**
     * Display a thread summary row with the thread count and a twisty to
     * open/close the list.
     *
     * @param {ProcessDelta} data The data to display.
     * @return {boolean} Whether the full thread list should be displayed.
     */
    displayThreadSummaryRow(data) {
        const cellCount = 2;
        let rowId = "ts:" + data.pid;
        let row = this._getOrCreateRow(rowId, cellCount);
        row.process = data;
        row.className = "thread-summary";
        let isOpen = false;
        
        // Column: Name
        let nameCell = row.firstChild;
        let threads = data.threads;
        let activeThreads = new Map();
        let activeThreadCount = 0;
        for (let t of data.threads) {
            if (!t.active) {
                continue;
            }
            ++activeThreadCount;
            let name = t.name.replace(/ ?#[0-9]+$/, "");
            if (!activeThreads.has(name)) {
                activeThreads.set(name, { name, slopeCpu: t.slopeCpu, count: 1 });
            } else {
                let thread = activeThreads.get(name);
                thread.count++;
                thread.slopeCpu += t.slopeCpu;
            }
        }
        let fluentName, fluentArgs;
        if (activeThreadCount) {
            let percentFormatter = new Intl.NumberFormat(undefined, {
                style: "percent",
                minimumSignificantDigits: 1,
            });
            
            let threadList = Array.from(activeThreads.values());
            threadList.sort((t1, t2) => t2.slopeCpu - t1.slopeCpu);
            
            fluentName = "about-processes-active-threads";
            fluentArgs = {
                number: threads.length,
                active: activeThreadCount,
                list: new Intl.ListFormat(undefined, { style: "narrow" }).format(
                    threadList.map(t => {
                        let name = t.count > 1 ? `${t.count} × ${t.name}` : t.name;
                        let percent = Math.round(t.slopeCpu * 1000) / 1000;
                        if (percent) {
                            return `${name} ${percentFormatter.format(percent)}`;
                        }
                        return name;
                    })
                ),
            };
        } else {
            fluentName = "about-processes-inactive-threads";
            fluentArgs = {
                number: threads.length,
            };
        }
        
        let span;
        if (!nameCell.firstChild) {
            nameCell.className = "name indent";
            // Create the nodes:
            let imgBtn = document.createElement("span");
            // Provide markup for an accessible disclosure button:
            imgBtn.className = "twisty";
            imgBtn.setAttribute("role", "button");
            imgBtn.setAttribute("tabindex", "0");
            // Label to include both summary and details texts
            imgBtn.setAttribute("aria-labelledby", `${data.pid}-label ${rowId}`);
            if (!imgBtn.hasAttribute("aria-expanded")) {
                imgBtn.setAttribute("aria-expanded", "false");
            }
            nameCell.appendChild(imgBtn);
            
            span = document.createElement("span");
            span.setAttribute("id", rowId);
            nameCell.appendChild(span);
        } else {
            // The only thing that can change is the thread count.
            let imgBtn = nameCell.firstChild;
            isOpen = imgBtn.classList.contains("open");
            span = imgBtn.nextSibling;
        }
        document.l10n.setAttributes(span, fluentName, fluentArgs);
        
        // Column: action
        let actionCell = nameCell.nextSibling;
        actionCell.className = "action-icon";
        
        return isOpen;
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
    },
};
     
