
let tabFinder = {
    update() {
        this._map = new Map();
        for (let win of Services.wm.getEnumerator("navigator:browser")) {
            let tabbrowser = win.gBrowser;
            for (let browser of tabbrowser.browsers) {
                let id = browser.outerWindowID; // May be `null` if the browser isn't loaded yet
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
        return { tabbrowser, tab: tabbrowser.getTabForBrowser(browser) };
    },
}; 
