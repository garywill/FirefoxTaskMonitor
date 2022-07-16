/* Firefox userChrome script
 * Show tab cpu and memory bars on every tab button
 * Show addon cpu and memory bars on every addon toolbar button
 * Show all-task cpu and memory bars on a slender widget at the right of tab bar
 * Dynamically show top tasks on popup menu of the widget
 * 
 * Tested on Firefox 102, with xiaoxiaoflood's uc loader
 * 
 * Author: garywill (https://garywill.github.io)
 *    https://github.com/garywill/firefoxtaskmonitor
 */

// ==UserScript==
// @include         main
// @onlyonce
// ==/UserScript==

console.log("taskmonitor_part2.js"); 

(() => {
    const barGap = 1;
    const barWidth = 3;
    
    const sss = Components.classes["@mozilla.org/content/style-sheet-service;1"].getService(Components.interfaces.nsIStyleSheetService);

    widget_init();
    
    function widget_init() {
        const fftm_widget_label = "TaskManager Widget for all tasks";
        const fftm_widget_id = "fftm_widget";
        
        Components.utils.import("resource:///modules/CustomizableUI.jsm");
        
//         if ( ! CustomizableUI.getWidget(fftm_widget_id) ) {
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
                    menu_open_about_processes.onclick = function(event) {
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
                    menu_donate.label = "More scripts / Donate: Visit author";
                    menu_donate.onclick = function(event) {
                        if (event.button == 0) {
                            const win = Components.classes["@mozilla.org/appshell/window-mediator;1"].getService(Components.interfaces.nsIWindowMediator).getMostRecentWindow("navigator:browser");
                            win.gBrowser.selectedTab = win.gBrowser.addWebTab('https://garywill.github.io');
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
//         }
    }
}) ();
