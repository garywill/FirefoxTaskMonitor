/* Firefox userChrome script
 * Show tab cpu and memory bars on every tab button
 * Show addon cpu and memory bars on every addon toolbar button
 * Show all-task cpu and memory bars on a slender widget at the right of tab bar
 * Dynamically show top tasks on popup menu of the widget
 * Optional periodically clean Firefox memory 
 * Tested on Firefox 91
 * Author: garywill (https://garywill.github.io)
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

var taskMonitorTimerID = null;
var memoryCleanerTimerID = null;

(() => {
//=====================
// User customization

var periodicalClean = false; // if to periodically clean memory
var cleanMemory_period = 20*60*1000; // milisecond

//------------

const    tabCpuColor = "#fd9191"; // red
//const    tabMemColor = "rgb(242, 242, 0)"; //yellow
const    tabMemColor = "rgb(100, 160, 255)"; //blue
const    tabMemMax = 400*1000*1000;
//const    tabBarsTransp
const    addonCpuColor = tabCpuColor;
const    addonMemColor = tabMemColor;
const    addonMemMax = 20*1000*1000;
//const    addonBarsTransp
const    allCpuColor = tabCpuColor;
const    allMemColor = tabMemColor;
const    allMemMax = 1000*1000*1000;
//const    allBarsTransp

//=======================

const barWidth = 3;
const barGap = 1;
        
const sss = Components.classes["@mozilla.org/content/style-sheet-service;1"].getService(Components.interfaces.nsIStyleSheetService);

var wins = [];

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
const UPDATE_INTERVAL_MS = 2000;

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
        //for (let win of Services.wm.getEnumerator("navigator:browser")) {
        for (let win of wins) {
            let tabbrowser = win.gBrowser;
            if ( tabbrowser === undefined)
                continue;
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
            tab: tabbrowser.getTabForBrowser(browser)
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
                Ci.nsIUrlClassifierFeature.blocklist,
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
    //wins: [],
    widget_init() {
        const fftm_widget_label = "TaskManager Widget for all tasks";
        const fftm_widget_id = "fftm_widget";
        if ( ! CustomizableUI.getWidget(fftm_widget_id) ) {
            CustomizableUI.createWidget({
                id: fftm_widget_id,
                type: "custom",
                defaultArea: CustomizableUI.AREA_TABSTRIP,
                removable: true,
                onBuild: function (doc) {
                    let btn = doc.createXULElement('toolbarbutton');
                    btn.id = fftm_widget_id;
                    btn.label = fftm_widget_label;
                    btn.tooltipText = fftm_widget_label;
                    btn.type = 'menu';
                    btn.className = 'toolbarbutton-1 chromeclass-toolbar-additional fftm_widget_class';
                    btn.style.MozBoxAlign="unset";
                    
                    let mp = doc.createXULElement("menupopup");
                    mp.id = 'fftm_widget_menupopup';
                    mp.onclick = function(event) {  event.preventDefault()  ;} ;
                
                    const menu_show_tasks_num = 10;
                    for (var i=0; i<menu_show_tasks_num ; i++)
                    {
                        var menuitem = doc.createXULElement("menuitem");
                        menuitem.id = "fftm_widget_task_" + i;
                        menuitem.label = "Top task " + (i+1) ;
                        menuitem.className = 'menuitem-iconic fftm_widget_task' ;
                        
                        mp.appendChild(menuitem);
                    }
                    
                    mp.appendChild(doc.createXULElement('menuseparator'));
                
                    var menu_open_about_performance = doc.createXULElement("menuitem");
                    menu_open_about_performance.className = 'menuitem-iconic' ;
                    menu_open_about_performance.label = "Open about:performance";
                    menu_open_about_performance.onclick = function(event) {
                        if (event.button == 0) {
                            const win = Components.classes["@mozilla.org/appshell/window-mediator;1"].getService(Components.interfaces.nsIWindowMediator).getMostRecentWindow("navigator:browser");
                            win.gBrowser.selectedTab = win.gBrowser.addTrustedTab('about:performance');
                        }
                    }
                    mp.appendChild(menu_open_about_performance);
                    
                    var menu_open_about_processes = doc.createXULElement("menuitem");
                    menu_open_about_processes.className = 'menuitem-iconic' ;
                    menu_open_about_processes.label = "Open about:processes";
                    menu_open_about_processes.onclick = function() {
                        if (event.button == 0) {
                            const win = Components.classes["@mozilla.org/appshell/window-mediator;1"].getService(Components.interfaces.nsIWindowMediator).getMostRecentWindow("navigator:browser");
                            win.gBrowser.selectedTab = win.gBrowser.addTrustedTab('about:processes');
                        }
                    }
                    mp.appendChild(menu_open_about_processes);
                    
                    var menu_open_about_memory = doc.createXULElement("menuitem");
                    menu_open_about_memory.className = 'menuitem-iconic' ;
                    menu_open_about_memory.label = "Open about:memory";
                    menu_open_about_memory.onclick = function(event) {
                        if (event.button == 0) {
                            const win = Components.classes["@mozilla.org/appshell/window-mediator;1"].getService(Components.interfaces.nsIWindowMediator).getMostRecentWindow("navigator:browser");
                            win.gBrowser.selectedTab = win.gBrowser.addTrustedTab('about:memory');
                        }
                    }
                    mp.appendChild(menu_open_about_memory);
                    
                    mp.appendChild(doc.createXULElement('menuseparator'));
                    
                    var menu_donate = doc.createXULElement("menuitem");
                    menu_donate.className = 'menuitem-iconic' ;
                    menu_donate.label = "More scripts/Donate: Visit author";
                    menu_donate.onclick = function(event) {
                        if (event.button == 0) {
                            const win = Components.classes["@mozilla.org/appshell/window-mediator;1"].getService(Components.interfaces.nsIWindowMediator).getMostRecentWindow("navigator:browser");
                            win.gBrowser.selectedTab = win.gBrowser.addWebTab('https://github.com/garywill/receiving/blob/master/receiving_methods.md');
                        }
                    }
                    mp.appendChild(menu_donate);
                    
                    btn.appendChild(mp);
                    return btn;
                }
            });
            const fftm_widget_css = Services.io.newURI("data:text/css;charset=utf-8," + encodeURIComponent(`
            #${fftm_widget_id} .toolbarbutton-icon {
                max-width: ${ (barWidth*2 + barGap) }px ！important ;
                min-width: ${ (barWidth*2 + barGap) }px !important;
                width: ${ (barWidth*2 + barGap) }px !important;
            }
            #${fftm_widget_id}:hover {
                background-color: grey;
            }
            `
            ), null, null);
            sss.loadAndRegisterSheet(fftm_widget_css, sss.USER_SHEET);
        }
    },
    memoryAddUnit(memory) {
        let unit = "";
        let mem_united = "?";
        if (memory) {
            unit = "kB";
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
    numberAddUnit(x) {
        let unit = "";
        let x_united = "?";
        if (x > 1000) {
            unit = "k";
            x_united = Math.ceil(x / 1000);
            if (x_united > 1000) {
                x_united = Math.ceil((x_united / 1000) * 10) / 10;
                unit = "M";
                if (x_united > 1000) {
                    x_united = Math.ceil((x_united / 1000) * 100) / 100;
                    unit = "G";
                }
            }
            x_united += unit;
        }
        return x_united;
    },
 
    addCpuMem2Tabbtn(tabNode, taskInfo, hide=false){
        var insertNode = tabNode.getElementsByClassName("tab-content")[0];
        if (!insertNode) return;
 
        var tabAllBarsCont;
        tabAllBarsCont = this.createVertRightEdgeCont(insertNode,  "taskMonitor-TabbtnP",
            {
                position: "absolute",
                display: "block",
                right: 0,
                zIndex: "9",
                height: "100%",
                bottom: 0,
            },
            {
                display: "block",
                position: "absolute",
                height: "100%",
                zIndex: "99",
                right: 0,
                maxWidth: "100px",
                minWidth: (barWidth*2 + barGap) + "px",
                //width: ( parseInt(getComputedStyle(insertNode).width) / 2 ) + "px"
            }
        , hide );
        if (hide) // TODO actually don't have to pass 'hide' to createVertRightEdgeCont, just return above
            return;
        
        var close_button = tabNode.getElementsByClassName("tab-content")[0].getElementsByClassName("tab-close-button")[0];
        close_button.style.zIndex = "999";
        close_button.style.position = "fixed";
        
        /*
        const c_minwidth = barWidth*2 + barGap ;
        const c_maxwidth = 100;
        
        if (widthToSet > c_maxwidth)
            widthToSet = c_maxwidth;
        if (widthToSet < c_minwidth)
            widthToSet = c_minwidth;
        */
        var widthToSet = parseInt( getComputedStyle(insertNode).width ) / 2 ;
        tabAllBarsCont.style.width = widthToSet + "px";
        
        
        this.addBarsToNode(tabAllBarsCont, taskInfo.cpu, taskInfo.mem, {cpuColor: tabCpuColor, memColor: tabMemColor, memMax: tabMemMax, rightBlank: 2}, taskInfo);
        
        
        //var ttp = `CPU ${taskInfo.cpu}\nMEM ${taskInfo.mem_united}\nPID ${taskInfo.pid}`;
        //tabNode.getElementsByClassName("tab-icon-image")[0].tooltipText = ttp;
    },
    addCpuMem2AddonBtn(addonId, taskInfo){
        wins.forEach( function(win, win_i) {
            //var _btnNode = document.getElementsByAttribute("data-extensionid",addonId)[0];
            var _btnNode = win.document.body.getElementsByAttribute("data-extensionid",addonId)[0];
            var btnNode;
            if ( _btnNode ) btnNode = _btnNode.getElementsByClassName("toolbarbutton-badge-stack")[0];
            if (!btnNode) return;
    
            var BABarsCont = null;
            BABarsCont = View.createVertRightEdgeCont(btnNode,  "taskMonitor-addonBtnP",
                {
                    position: "relative",
                    display: "block",
                    right: 0,
                    zIndex: "999",
                    height: "100%"
                },
                {
                    display: "block",
                    position: "absolute",
                    height: "100%",
                    zIndex: "99999",
                    right: 0,
                    // marginRight: (barWidth*2 + barGap) + "px",
                    marginRight: "-4px",
                }
            );
            
            View.addBarsToNode(BABarsCont, taskInfo.cpu, taskInfo.mem,  {cpuColor: addonCpuColor, memColor: addonMemColor, memMax: addonMemMax}, taskInfo);
        });
      
    },
    addCpuMem2whole(cpu, mem, tooltip){
       
        var arr_tooltip_split = tooltip.split('\n');
        
        wins.forEach( function(win, win_i) {
            
            //var fftm_widget = document.getElementById("fftm_widget");
            var fftm_widget = win.document.body.getElementsByClassName("fftm_widget_class")[0];
            if ( fftm_widget )
            {
                var allBarsCont = null;
                allBarsCont = View.createVertRightEdgeCont(fftm_widget, 'fftm_widget_p', 
                    {
                        position: "relative",
                        display: "inline-block",
                        zIndex: "999",
                        height: "100%",
                        //minWidth: (barWidth*2 + barGap) + "px",
                        //width: (barWidth*2 + barGap) + "px",
                    },
                    {
                        display: "block",
                        position: "absolute",
                        height: "100%",
                        zIndex: "99999",
                        minWidth: (barWidth*2 + barGap) + "px",
                        marginLeft: -(barWidth*2 + barGap) + "px",
                    }
                );
                View.addBarsToNode(allBarsCont, cpu, mem, {cpuColor: allCpuColor, memColor: allMemColor, memMax: allMemMax} );
                fftm_widget.title = fftm_widget.tooltipText = tooltip;
                

                for (var i=0; i< 1000; i++)
                {
                    //var menu_task_obj = document.getElementById( "fftm_widget_task_"+i );
                    var menu_task_obj = win.document.body.getElementsByClassName( "fftm_widget_task" )[i];
                    var text = arr_tooltip_split[i];
                    if ( menu_task_obj && text ) {
                        menu_task_obj.label = text.replace('\t','  ').replace('\t','  ').replace('\t','  ');
                        menu_task_obj.tooltipText = text;
                        menu_task_obj.hidden = false;
                    }
                    if ( menu_task_obj && !text ) {
                        menu_task_obj.hidden = true;
                    }
                    if ( !menu_task_obj && !text ) {
                        break;
                    }
                }
                
                    
            }
        });
    },
    
 
    createVertRightEdgeCont(BrowserNode, pname, PStyle, CStyle, hide=false){
        var contParent = BrowserNode.getElementsByClassName(pname)[0];
        
        if (hide && contParent)
        {
            contParent.style.visibility="hidden";
            return;
        }else if (!hide && contParent)
        {
            contParent.style.visibility="visible";
        }
        
        var cont = null;
        if (!contParent) {
            contParent = document.createXULElement("div");
            contParent.className = pname;
            for (var key in PStyle)
            {
                contParent.style[key] = PStyle[key]
            }
            //contParent.tooltipText = "PAPA";
            
            cont = document.createXULElement("div");
            cont.className = "taskMonitorBarsCont";
            for (var key in CStyle)
            {
                cont.style[key] = CStyle[key]
            }
            //cont.tooltipText = "haha";
            
            contParent.appendChild(cont);
            BrowserNode.appendChild(contParent);
        }else{
            cont = contParent.getElementsByClassName("taskMonitorBarsCont")[0];
        }
        
        return cont;
    },
 
    addBarsToNode(node, cpu, memory, ui, taskInfo) {
        if (ui.rightBlank === undefined)  ui.rightBlank = 0;
        
        var cpubar;
        cpubar = node.getElementsByClassName("cpuBar")[0];
        if (!cpubar) {
            cpubar = document.createElement("div");
            cpubar.className = "cpuBar";
            cpubar.style.backgroundColor = ui.cpuColor;
            cpubar.style.width = barWidth + "px";
            cpubar.style.position = "absolute";
            cpubar.style.right = (ui.rightBlank + barWidth + barGap ) + "px";
            cpubar.style.bottom = 0;
            node.appendChild(cpubar);
        }
        cpubar.style.height = Math.min((cpu > 0) ? cpu : 0, 100) + "%";

        var membar;
        membar = node.getElementsByClassName("memBar")[0];
        if (!membar) {
            membar = document.createElement("div");
            membar.className = "memBar";
            membar.style.backgroundColor = ui.memColor; 
            membar.style.width = barWidth + "px";
            membar.style.position = "absolute";
            membar.style.right = ui.rightBlank + "px";
            membar.style.bottom = 0;
            node.appendChild(membar);
        }
        membar.style.height = Math.min(memory / ui.memMax * 100, 100) + "%";
        
        //node.style.width = (barWidth*2 + barGap + ui.rightBlank) + "px";
        node.style.minWidth = (barWidth*2 + barGap + ui.rightBlank) + "px";
        if (taskInfo){
            node.tooltipText = `CPU ${taskInfo.cpu}\nMEM ${taskInfo.mem_united}\nPID ${taskInfo.pid}`
        }
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

        var all_cpu = 0;
        var all_mem = 0;
        var all_tooltip = "";

        counters = this._sortCounters(counters);
        //var num = 0;
        
        
        
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
            
            var mem_united = View.memoryAddUnit(memory);
            
            var taskInfo = {
                cpu: EnergyImpact >= 0 ? EnergyImpact : 0,
                mem: memory,
                mem_united: mem_united,
                pid: pid,
            };

            var show_name = "";
            if (type == "tab") {
                //num += 1;
                show_name = `<${name}>`;
                View.addCpuMem2Tabbtn(tabNode, taskInfo);
            } else if (type == "addon") {
                show_name = `[${name}]`;
                View.addCpuMem2AddonBtn(id, taskInfo);
            } else {
                show_name = `${name}`;
            }
            
            all_cpu += EnergyImpact;
            all_mem += memory;
            all_tooltip += `${EnergyImpact}\t${mem_united}\t${show_name}\t${pid}\n`;

            //if (!children.length) {
            //    continue;
            //}

        } // end loop for every task
        //console.log("taskMonitorTimerID = ", taskMonitorTimerID, "tabnum = ", num);
        
        View.addCpuMem2whole(all_cpu, all_mem, all_tooltip);
        
        wins.forEach( function(win, win_i) {
            win.document.body.querySelectorAll("tab[pending=true]").forEach( function(tabnode) {
                View.addCpuMem2Tabbtn(tabnode, {cpu:0, mem:0, mem_united:"", pid:0}, true);
            });
        });
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

function open_about_performance() {
    const win = Components.classes["@mozilla.org/appshell/window-mediator;1"]
        .getService(Components.interfaces.nsIWindowMediator)
        .getMostRecentWindow("navigator:browser");
    win.gBrowser.selectedTab = win.gBrowser.addTrustedTab('about:performance');
}
//================================
function getAllWindows() {
    var windows = [];
    
    var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                    .getService(Components.interfaces.nsIWindowMediator);
    var enumerator = wm.getEnumerator("navigator:browser");
    while(enumerator.hasMoreElements()) {
        var win = enumerator.getNext();
        // win is [Object ChromeWindow] (just like window), do something with it
        windows.push(win);
    }
    return windows;
}


function TaskMonitorUpdate() {
    /*
    var wins = getAllWindows();
    wins.forEach ( function(win, win_i) {
        console.log("window index:", win_i, "tabs num:",
            win.gBrowser.tabs.length );
    });
    */
    var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                    .getService(Components.interfaces.nsIWindowMediator);
    var enumerator = wm.getEnumerator("navigator:browser");
    var win = enumerator.getNext();
    if (gBrowser === win.gBrowser){
        //console.log("TaskMonitor refreshing");
        wins = getAllWindows();
        Control.update();
    }else{
        //console.log("TaskMonitor staling for not first window");
    }
        
}

View.widget_init(); 

async function startTaskMonitor() {
    if (taskMonitorTimerID) {
        console.log("TaskMonitor already running");
        return;
    }

    await Control.update();

    taskMonitorTimerID = window.setInterval(() => TaskMonitorUpdate(), UPDATE_INTERVAL_MS);
    //console.log("taskMonitorTimerID: ", taskMonitorTimerID);
    
    if ( periodicalClean ) {
        memoryCleanerTimerID = window.setInterval(() => cleanMemory(), cleanMemory_period);
    }
};
startTaskMonitor();

function cleanMemory() {
    Components.utils.schedulePreciseGC( function () {
        const gMgr = Cc["@mozilla.org/memory-reporter-manager;1"].getService(
            Ci.nsIMemoryReporterManager
        );
        
        Services.obs.notifyObservers(null, "child-mmu-request");
        gMgr.minimizeMemoryUsage( function() {} );
    });
}

})();

function stopTaskMonitor() {
    window.clearInterval(taskMonitorTimerID);
    taskMonitorTimerID = null;
    if (memoryCleanerTimerID)
    {
        window.clearInterval(memoryCleanerTimerID);
        memoryCleanerTimerID = null;
    }
}




