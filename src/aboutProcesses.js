
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

const SHOW_THREADS = false;
const SHOW_ALL_SUBFRAMES = false;
const SHOW_PROFILER_ICONS = true;

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
let gLocalizedUnits;

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
