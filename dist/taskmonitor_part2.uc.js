/* Firefox userChrome script
 * Show tab cpu and memory bars on every tab button
 * Show all-process cpu and memory bars on a slender widget at the right of tab bar
 * Dynamically show processes on popup menu of the widget
 * 
 * Tested on Firefox 128, with xiaoxiaoflood's uc loader
 * 
 * Author: garywill (https://garywill.github.io)
 *    https://github.com/garywill/firefoxtaskmonitor
 */

// ==UserScript==
// @include         main
// @onlyonce
// ==/UserScript==

console.log("taskmonitor_part2.js"); 

"use strict";

(() => {
    const menu_show_tasks_num = 12;
    
    
    const barGap = 1;
    const barWidth = 3;
    
    const sss = Components.classes["@mozilla.org/content/style-sheet-service;1"].getService(Components.interfaces.nsIStyleSheetService);

    widget_init();
    
    function widget_init() {
        const fftm_widget_label = "TaskManager Widget";
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
                    // mp.onclick = function(event) {  event.preventDefault()  ;} ;
                
                    
                    for (var i=0; i<menu_show_tasks_num ; i++)
                    {
                        var menuitem = doc.createXULElement("menuitem");
                        menuitem.id = "fftm_widget_task_" + i;
                        menuitem.label = "Task " + (i+1) ;
                        menuitem.className = 'menuitem-iconic fftm_widget_task' ;
                        
                        mp.appendChild(menuitem);
                    }
                    
                    mp.appendChild(doc.createXULElement('menuseparator'));
                

                    
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
                    
                    var menu_minimize_memory = doc.createXULElement("menuitem");
                    menu_minimize_memory.className = 'menuitem-iconic' ;
                    menu_minimize_memory.label = "Minimize memory usage";
                    menu_minimize_memory.onclick = function(event) {
                        if (event.button == 0) {
                            const gMgr = Cc["@mozilla.org/memory-reporter-manager;1"].getService(
                                Ci.nsIMemoryReporterManager
                            );
                            
                            Services.obs.notifyObservers(null, "child-mmu-request");
                            gMgr.minimizeMemoryUsage( function() {console.log("minimizeMemoryUsage");} );
                        }
                    }
                    mp.appendChild(menu_minimize_memory);
                    
                    mp.appendChild(doc.createXULElement('menuseparator'));
                    
                    var menu_donate = doc.createXULElement("menuitem");
                    menu_donate.className = 'menuitem-iconic' ;
                    menu_donate.label = "More scripts / Visit author";
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
