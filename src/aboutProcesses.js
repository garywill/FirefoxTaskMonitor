
"use strict";

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

const PROFILE_DURATION = Math.max(
    1,
    Services.prefs.getIntPref("toolkit.aboutProcesses.profileDuration")
);

/**
  * For the time being, Fluent doesn't support duration or memory formats, so we need
  * to fetch units from Fluent. To avoid re-fetching at each update, we prefetch these
  * units during initialization, asynchronously, and keep them.
  *
  * @type {
  *   duration: { ns: String, us: String, ms: String, s: String, m: String, h: String, d: String },
  *   memory: { B: String, KB: String, MB: String, GB: String, TB: String, PB: String, EB: String }
  * }.
  */
let gLocalizedUnits = 
{
    "duration": { "ns": "ns", "us": "µs", "ms": "ms", "s": "s", "m": "m", "h": "h", "d": "d" },
    "memory": { "B": "B", "KB": "KB", "MB": "MB", "GB": "GB", "TB": "TB", "PB": "PB", "EB": "EB" }
};

#include "tabFinder.js"

#include "State.js"

#include "View.js"

#include "Control.js"




window.onload = async function () {
    Control.init();

    // Display immediately the list of processes. CPU values will be missing.
    await Control.update();

    // After the minimum interval between samples, force an update to show
    // valid CPU values asap.
    await new Promise(resolve =>
        setTimeout(resolve, MINIMUM_INTERVAL_BETWEEN_SAMPLES_MS)
    );
    await Control.update(true);

    // Then update at the normal frequency.
    window.setInterval(() => Control.update(), UPDATE_INTERVAL_MS);
};
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

function psToMText(ps) 
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
        arr_mtext.push(pline)
        
        if (Array.isArray(p.webs)) {
            for (var webtitle of p.webs) {
                var tabline = `└${webtitle}`;
                arr_mtext.push(tabline);
            }
        }
    }
    return arr_mtext.join('\r\n');
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
