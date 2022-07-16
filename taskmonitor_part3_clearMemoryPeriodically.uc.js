 
/* Firefox userChrome script
 * Periodically clean Firefox memory 
 * 
 * Tested on Firefox 102, with xiaoxiaoflood's uc loader
 * 
 * Author: garywill (https://garywill.github.io)
 *      https://github.com/garywill/firefoxtaskmonitor
 * 
 */

// ==UserScript==
// @include         main
// ==/UserScript==

console.log("taskmonitor_part3_clearMemoryPeriodically.js");

var memoryCleanerTimerID;

(() => {
    // User customization
    const cleanMemory_period = 20*60*1000; // milisecond

    memoryCleanerTimerID = window.setInterval(() => cleanMemory(), cleanMemory_period);
        
    function cleanMemory() {

        if (isThisTheFirstWindowInOpeningWindowsList() ){
            Components.utils.schedulePreciseGC( function () {
                const gMgr = Cc["@mozilla.org/memory-reporter-manager;1"].getService(
                    Ci.nsIMemoryReporterManager
                );
                
                Services.obs.notifyObservers(null, "child-mmu-request");
                gMgr.minimizeMemoryUsage( function() {} );
            });
        } 
    }

    function isThisTheFirstWindowInOpeningWindowsList() {
        var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                        .getService(Components.interfaces.nsIWindowMediator);
        var enumerator = wm.getEnumerator("navigator:browser");
        var win = enumerator.getNext();
        if (gBrowser === win.gBrowser){ //gBrowser is available only when no @onlyonce
            return true;
        } 
    }
})();




