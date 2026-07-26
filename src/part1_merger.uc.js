/* Firefox userChrome script
 * Show tab cpu and memory bars on every tab button
 * Show all-process cpu and memory bars on a slender widget at the right of tab bar
 * Dynamically show processes on popup menu of the widget
 *
 * Tested on Firefox 153, with MrOtherGuy's uc loader
 *
 * Author: garywill (https://garywill.github.io)
 *    https://github.com/garywill/firefoxtaskmonitor
 *
 * Notice
 * Some code is from Mozilla Firefox, which licensed under MPL
 *
 */

// ==UserScript==
// @include         main
// ==/UserScript==

console.log("taskmonitor_part1.uc.js");


"use strict";

let taskMonitorTimerID = null;

(() => {
//=====================
#include "part1_usercustom.uc.js"

#include "aboutProcesses.js"

#include "part1_myfuncs.uc.js"

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




