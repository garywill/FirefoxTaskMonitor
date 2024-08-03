


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

#include "tabFinder.js"

#include "State.js"

#include "View.js"

#include "Control.js"


