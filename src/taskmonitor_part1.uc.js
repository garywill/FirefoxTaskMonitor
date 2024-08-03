/* Firefox userChrome script
 * Show tab cpu and memory bars on every tab button
 * Show all-process cpu and memory bars on a slender widget at the right of tab bar
 * Dynamically show processes on popup menu of the widget
 * 
 * Tested on Firefox 128, with xiaoxiaoflood's uc loader
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

console.log("taskmonitor_part1.js");

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


"use strict";

let taskMonitorTimerID = null;

(() => {
//=====================
// User customization

const    tabCpuColor = "#fd9191"; // red
//const    tabMemColor = "rgb(242, 242, 0)"; //yellow
const    tabCpuMax = 30;
const    tabMemColor = "rgb(100, 160, 255)"; //blue
const    tabMemMax = 300*1000*1000;
//const    tabBarsTransp
const    allCpuColor = tabCpuColor;
const    allCpuMax = 100;
const    allMemColor = tabMemColor;
const    allMemMax = 1000*1000*1000;
//const    allBarsTransp

//=======================

const barWidth = 3;
const barGap = 1;

#include "aboutProcesses.js"

function parseTbody(tbody) 
{
    let ps = [];
    
    for (var iRow = 0; iRow<tbody.childNodes.length; iRow++) {
        const tr = tbody.childNodes[iRow];
        
        if ( ! (tr.classList.contains("process") || tr.classList.contains("window") ) )
            continue;
        
        
        const td_name = tr.childNodes[0];
        if (!td_name)
            continue
        const td_name_dataId = td_name.getAttribute("data-l10n-id");
        const td_name_args = JSON.parse( td_name.getAttribute("data-l10n-args") );
        
        // exclude hdslb pre web
        if (tr.classList.contains("window")  &&  td_name_dataId != "about-processes-tab-name" ) 
            continue;
        
        if (tr.classList.contains("process")) {
            let p = {};
            p.ptype = shortenFlname(td_name_dataId);
            
            
            p.pid = td_name_args ['pid'] ;
            if ( td_name_args ['origin'] )
                p.origin = td_name_args ['origin'];
            
            const td_cpu = tr.querySelector("td[data-l10n-id='about-processes-cpu']");
            if (td_cpu)
                p.cpu = JSON.parse( td_cpu.getAttribute("data-l10n-args") ) ['percent'] *100 ;
            
            const td_mem = tr.childNodes[1]?.classList.contains("memory") ? tr.childNodes[1] : undefined;
            if (td_mem) {
                const args = JSON.parse( td_mem.getAttribute("data-l10n-args") );
                p.mem =  args['total'].toFixed(1) + args['totalUnit'];
            }
            
            if (['web', 'webIs'].includes(p.ptype) ) 
                p.webs = [];
            
            ps.push(p);
        } 
        else if (tr.classList.contains("window") ) {
            ps [ps.length-1] .webs.push(td_name_args ['name']);
        } 
    }
    return ps;
}

function psToMTextArr(ps) 
{
    let arr_mtext = [];
    for (let p of ps)
    {
        var cpu_str = (typeof p.cpu === 'number' && p.cpu !== NaN) ? Math.round(p.cpu) : '?';
        
        var ptext_str;
        if ( ['web', 'webIs'].includes(p.ptype) ) {
            ptext_str = p.origin;
        }else{
            ptext_str = p.ptype;
        }
        
        var pline = `${cpu_str}\t${p.mem}\t${ptext_str}\t${p.pid}`;
        
        if (Array.isArray(p.webs)) {
            for (var webtitle of p.webs) {
                var tabline = `└${webtitle}`;
                pline += "\n" + tabline;
            }
        }
        
        arr_mtext.push(pline)
    }
    return arr_mtext;
}





const fluentNameToDataType = {  
    "about-processes-web-process": "web",  
    "about-processes-web-isolated-process": "webIs",  
    "about-processes-web-serviceworker": "webServiceWorker",  
    "about-processes-file-process": "file",  
    "about-processes-extension-process": "extension",  
    "about-processes-privilegedabout-process": "about",  
    "about-processes-privilegedmozilla-process": "mozilla",  
    "about-processes-with-coop-coep-process": "withCoopCoep",  
    "about-processes-browser-process": "browser",  
    "about-processes-plugin-process": "plugin",  
    "about-processes-gmp-plugin-process": "gmpPlugin",  
    "about-processes-gpu-process": "gpu",  
    "about-processes-vr-process": "vr",  
    "about-processes-rdd-process": "rdd"  , 
    "about-processes-socket-process": "socket", 
    "about-processes-remote-sandbox-broker-process": "remoteSandboxBroker", 
    "about-processes-fork-server-process": "forkServer", 
    "about-processes-preallocated-process": "pre", 
    "about-processes-utility-process": "utility" 
};  
function shortenFlname(fluentName) {  
    return fluentNameToDataType[fluentName] || "unknown"; 
}  



let wins = [];






 
    function addCpuMem2Tabbtn(tabNode, taskInfo, hide=false)
    {
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
        
        
        this.addBarsToNode(tabAllBarsCont, taskInfo.cpu, taskInfo.mem, {cpuColor: tabCpuColor, memColor: tabMemColor, cpuMax: tabCpuMax, memMax: tabMemMax, rightBlank: 2}, taskInfo);
        
        
        //var ttp = `CPU ${taskInfo.cpu}\nMEM ${taskInfo.mem_united}\nPID ${taskInfo.pid}`;
        //tabNode.getElementsByClassName("tab-icon-image")[0].tooltipText = ttp;
    }
    
    function addCpuMem2whole(cpu, mem, tooltip)
    {
       
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
                View.addBarsToNode(allBarsCont, cpu, mem, {cpuColor: allCpuColor, memColor: allMemColor, cpuMax: allCpuMax, memMax: allMemMax} );
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
    }
    
 
    function createVertRightEdgeCont(BrowserNode, pname, PStyle, CStyle, hide=false)
    {
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
    }
 
    function addBarsToNode(node, cpu, memory, ui, taskInfo) 
    {
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
        cpubar.style.height = Math.min((cpu > 0) ? cpu * (100/ui.cpuMax) : 0, 100) + "%";

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
    }


//================================



function TaskMonitorUpdate() {
    /*
    var wins = getAllWindows();
    wins.forEach ( function(win, win_i) {
        console.log("window index:", win_i, "tabs num:",
            win.gBrowser.tabs.length );
    });
    */
    
    if (isThisTheFirstWindowInOpeningWindowsList() ){
        //console.log("TaskMonitor refreshing");
        wins = getAllWindows(); // wins is needed by updating bars
        Control.update();
    }else{
        //console.log("TaskMonitor staling for not first window");
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


async function startTaskMonitor() {
    if (taskMonitorTimerID) {
        console.log("TaskMonitor already running");
        return;
    }

    await Control.update();

    taskMonitorTimerID = window.setInterval(() => TaskMonitorUpdate(), UPDATE_INTERVAL_MS);
    //console.log("taskMonitorTimerID: ", taskMonitorTimerID);

};
startTaskMonitor();



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



