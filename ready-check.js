// Register Game Settings
Hooks.once("init", function () {
    game.settings.register("ready-check", "showChatMessagesForUserUpdates", {
        name: game.i18n.localize(
            "READYCHECK.SettingsChatMessagesForUserUpdatesTitle"
        ),
        hint: game.i18n.localize(
            "READYCHECK.SettingsChatMessagesForUserUpdatesHint"
        ),
        scope: "world",
        config: true,
        default: true,
        type: Boolean,
    });

    game.settings.register("ready-check", "showChatMessagesForChecks", {
        name: game.i18n.localize(
            "READYCHECK.SettingsChatMessagesForChecksTitle"
        ),
        hint: game.i18n.localize(
            "READYCHECK.SettingsChatMessagesForChecksHint"
        ),
        scope: "world",
        config: true,
        default: false,
        type: Boolean,
    });

    game.settings.register("ready-check", "playAlertForCheck", {
        name: game.i18n.localize("READYCHECK.SettingsPlayAlertForChecksTitle"),
        hint: game.i18n.localize("READYCHECK.SettingsPlayAlertForChecksHint"),
        scope: "world",
        config: true,
        default: false,
        type: Boolean,
    });

    game.settings.register("ready-check", "checkAlertSoundPath", {
        name: game.i18n.localize("READYCHECK.SettingsCheckAlertSoundPathTitle"),
        hint: game.i18n.localize("READYCHECK.SettingsCheckAlertSoundPathHint"),
        scope: "world",
        config: true,
        default: "modules/ready-check/sounds/notification.mp3",
        type: String,
    });
});

Hooks.on("renderChatLog", async function (app, html, data) {
    await createSocketHandler();
    await createButtons(html);
});

// Update the display of the Player UI.
Hooks.on("renderPlayers", async function () {
    await updatePlayersWindow();
});

/**
 * This sends a message to all connected clients that they should update their PlayerList.
 * The receiver should filter it out if it's from the same user to prevent a loop.
 */
function sendPlayerRenderSocketMessage() {
    game.socket.emit("module.ready-check", {
        action: "player-render",
        userId: game.user.id,
    });
}

// SET ALL USERS STATUS TO NOT READY (GM)
async function setAllToNotReady() {
    if (game.user.isGM) {
        for (let i = 0; i < game.users.contents.length; i++) {
            await game.users.contents[i].setFlag(
                "ready-check",
                "isReady",
                false
            );
        }

        sendPlayerRenderSocketMessage();
    }
}

// CREATE THE UI BUTTON FOR THE GM AND PLAYERS
async function createButtons(html) {
    // Target the chat controls area instead of the main sidebar container
    let chatControls;
    if (html && html.length > 0) {
        chatControls = html[0].querySelector('#chat-controls');
    }
    if (!chatControls) {
        chatControls = document.querySelector('#chat-controls');
    }
    
    if (chatControls) {
        _injectButton(chatControls);
    }
}

/**
 * Common injection logic for the sidebar button
 * @param {HTMLElement} navContainer - The sidebar navigation container
 */
function _injectButton(navContainer) {
    if (navContainer.querySelector(".crash-ready-check-sidebar")) return;

    let btnTitle = game.i18n.localize("READYCHECK.UiChangeButton");
    if (game.user.isGM) btnTitle = game.i18n.localize("READYCHECK.UiGmButton");

    const clickHandler = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        
        if (event.currentTarget) event.currentTarget.blur();
        
        if (game.user.isGM) displayGmDialog();
        else displayStatusUpdateDialog();
    };

    // Locate the native dice visibility control container
    const globeIcon = navContainer.querySelector('[data-mode="publicroll"] i, .fa-globe, .fa-earth-americas');
    if (globeIcon) {
        // Broadly capture any structural parent encompassing the icon (fixes OSE V13 DOM wrapper differences)
        const rollModeItem = globeIcon.closest('[data-mode], .roll-mode, li, button, a') || globeIcon.parentNode;
        if (rollModeItem && rollModeItem !== navContainer && rollModeItem.parentNode) {
            // Deep clone the entire roll mode element so we perfectly match its wrappers/borders
            const sidebarBtn = rollModeItem.cloneNode(true);
            sidebarBtn.className = rollModeItem.className + ' crash-ready-check-sidebar';
            sidebarBtn.classList.remove('active', 'selected', 'focus', 'current');
            
            // Retain the data-mode attribute but change its value so it inherits structural CSS without triggering native roll logic
            if (sidebarBtn.hasAttribute('data-mode')) {
                sidebarBtn.setAttribute('data-mode', 'readycheck');
            }

            // Swap the main icon - handle both inner <i> tags and self-contained <a> nodes
            const innerIconNode = sidebarBtn.classList.contains('fa-globe') || sidebarBtn.classList.contains('fa-earth-americas')
                ? sidebarBtn
                : (sidebarBtn.querySelector('.fa-globe, .fa-earth-americas') || sidebarBtn.querySelector('i') || sidebarBtn);
            
            if (innerIconNode) {
                innerIconNode.className = innerIconNode.className.replace(/fa-globe/g, 'fa-hourglass-half').replace(/fa-earth-americas/g, 'fa-hourglass-half');
                // Ensure the icon updates even if it wasn't a globe (fallback)
                if (!innerIconNode.className.includes('fa-hourglass-half')) {
                    innerIconNode.classList.add('fa-hourglass-half');
                    innerIconNode.classList.add('fas'); // FA5 compat
                }
            }

            // Clean up attributes and active/highlighted states from all layers of the clone
            sidebarBtn.removeAttribute('title');
            sidebarBtn.setAttribute('aria-label', btnTitle);
            sidebarBtn.setAttribute('data-tooltip', btnTitle);
            sidebarBtn.removeAttribute('aria-pressed');
            sidebarBtn.removeAttribute('aria-current');
            sidebarBtn.style.marginBottom = '6px';
            sidebarBtn.style.borderBottom = '1px solid var(--color-border-dark-4, #222)';
            sidebarBtn.style.borderRadius = '5px';
            
            sidebarBtn.querySelectorAll('*').forEach(el => {
                if (el.hasAttribute('data-mode')) el.setAttribute('data-mode', 'readycheck');
                el.removeAttribute('aria-pressed');
                el.removeAttribute('aria-current');
                el.classList.remove('active', 'selected', 'focus', 'current');
                if (el.hasAttribute('data-tooltip')) el.setAttribute('data-tooltip', btnTitle);
                el.removeAttribute('title');
            });

            sidebarBtn.addEventListener("click", clickHandler);
            rollModeItem.parentNode.insertBefore(sidebarBtn, rollModeItem);
            return;
        }
    }

    // Fallback if the dice visibility block isn't found
    const fallbackBtn = document.createElement('a');
    fallbackBtn.removeAttribute('title');
    fallbackBtn.setAttribute('data-tooltip', btnTitle);
    fallbackBtn.setAttribute('aria-label', btnTitle);
    fallbackBtn.innerHTML = '<i class="fas fa-hourglass-half"></i>';
    fallbackBtn.className = 'crash-ready-check-sidebar chat-control-icon';
    fallbackBtn.addEventListener("click", clickHandler);
    
    // Inject before the primary chat control icon if it exists, otherwise prepend
    const existingIcon = navContainer.querySelector('.chat-control-icon:not(.crash-ready-check-sidebar)');
    if (existingIcon && existingIcon.parentNode) {
        existingIcon.parentNode.insertBefore(fallbackBtn, existingIcon);
    } else {
        navContainer.prepend(fallbackBtn);
    }
}

// CREATE THE SOCKET HANDLER
async function createSocketHandler() {
    game.socket.on("module.ready-check", async (data) => {
        if (data.action === "check") {
            displayReadyCheckDialog();
        } else if (data.action === "update") {
            processReadyResponse(data);
        } else if (
            data.action === "player-render" &&
            game.user.id !== data.userId
        ) {
            await updatePlayersWindow();
        }
    });
}

/**
 * Checks to see if a dialog already exists with the supplied title.
 * @param {string} title the title to check for (exact match).
 * @returns true if there is a dialog with a matching title, otherwise false.
 */
function isDialogShowing(title) {
    return (
        $(".window-title").filter(function () {
            return $(this).text() === title;
        }).length > 0
    );
}

// DISPLAY DIALOG ASKING GM WHAT THEY WANT TO DO
function displayGmDialog() {
    const title = game.i18n.localize("READYCHECK.GmDialogTitle");
    if (isDialogShowing(title)) {
        return;
    }

    const buttons = {
        check: {
            icon: "<i class='fas fa-check'></i>",
            label: game.i18n.localize("READYCHECK.GmDialogButtonCheck"),
            callback: initReadyCheck,
        },
        status: {
            icon: "<i class='fas fa-hourglass-half'></i>",
            label: game.i18n.localize("READYCHECK.GmDialogButtonStatus"),
            callback: displayStatusUpdateDialog,
        },
        clear: {
            icon: "<i class='fas fa-broom'></i>",
            label: game.i18n.localize("READYCHECK.GmDialogButtonClear"),
            callback: setAllToNotReady,
        },
    };

    new Dialog({
        title: title,
        content: `<p>${game.i18n.localize("READYCHECK.GmDialogContent")}</p>`,
        buttons: buttons,
        default: "check",
    }, {
        width: 300,
        classes: ["dialog", "ready-check-stacked-dialog"]
    }).render(true);
}

// INITIATE A READY CHECK (GM)
async function initReadyCheck() {
    if (game.user.isGM) {
        let data = { action: "check" };
        await setAllToNotReady();
        game.socket.emit("module.ready-check", data);
        displayReadyCheckDialog();
        playReadyCheckAlert();
    } else {
        ui.notifications.error(game.i18n.localize("READYCHECK.ErrorNotGM"));
    }
}

// DISPLAY STATUS UPDATE DIALOG AND SEND RESPONSE TO GM
function displayStatusUpdateDialog() {
    const title = game.i18n.localize("READYCHECK.DialogTitleStatusUpdate");
    if (isDialogShowing(title)) {
        return;
    }

    const data = { action: "update", ready: false, userId: game.user.id };
    const buttons = {
        yes: {
            icon: "<i class='fas fa-check'></i>",
            label: game.i18n.localize("READYCHECK.StatusReady"),
            callback: () => {
                data.ready = true;
                updateReadyStatus(data);
                displayStatusUpdateChatMessage(data);
            },
        },
        no: {
            icon: "<i class='fas fa-times'></i>",
            label: game.i18n.localize("READYCHECK.StatusNotReady"),
            callback: () => {
                data.ready = false;
                updateReadyStatus(data);
                displayStatusUpdateChatMessage(data);
            },
        },
    };

    new Dialog({
        title: title,
        content: `<p>${game.i18n.localize(
            "READYCHECK.DialogContentStatusUpdate"
        )}</p>`,
        buttons: buttons,
        default: "yes",
    }).render(true);
}

// DISPLAY READY CHECK DIALOG AND SEND RESPONSE TO GM (PLAYER)
function displayReadyCheckDialog() {
    const title = game.i18n.localize("READYCHECK.DialogTitleReadyCheck");
    if (isDialogShowing(title)) {
        return;
    }

    const data = { action: "update", ready: false, userId: game.user.id };
    const buttons = {
        yes: {
            icon: "<i class='fas fa-check'></i>",
            label: game.i18n.localize("READYCHECK.StatusReady"),
            callback: async () => {
                data.ready = true;
                await updateReadyStatus(data);
                displayReadyCheckChatMessage(data);
            },
        },
    };

    new Dialog({
        title: title,
        content: `<p>${game.i18n.localize(
            "READYCHECK.DialogContentReadyCheck"
        )}</p>`,
        buttons: buttons,
        default: "yes",
    }).render(true);
}

// UPDATE USER READY STATUS
//  If the user is a GM, just update it since the socket go to the sender, and none of the recipients (players)
//  will have the permissions require to update user flags. If the user is not a GM, emit that socket.
async function updateReadyStatus(data) {
    if (game.user.isGM) {
        processReadyResponse(data);
    } else {
        game.socket.emit("module.ready-check", data);
    }
}

// PROCESS READY CHECK RESPONSE (GM)
async function processReadyResponse(data) {
    if (game.user.isGM) {
        const userToUpdate = game.users.get(data.userId);
        await userToUpdate.setFlag("ready-check", "isReady", data.ready);
        ui.players.render(true);
        sendPlayerRenderSocketMessage();
    }
}

// DISPLAY A CHAT MESSAGE WHEN A USER RESPONDS TO A READY CHECK
function displayReadyCheckChatMessage(data) {
    if (game.settings.get("ready-check", "showChatMessagesForChecks")) {
        const username = game.users.get(data.userId).name;
        const content = `${username} ${game.i18n.localize(
            "READYCHECK.ChatTextCheck"
        )}`;
        ChatMessage.create({
            speaker: { alias: "Ready Set Go!" },
            content: content,
        });
    }
}

// DISPLAY A CHAT MESSAGE WHEN A USER UPDATES THEIR STATUS
function displayStatusUpdateChatMessage(data) {
    if (game.settings.get("ready-check", "showChatMessagesForUserUpdates")) {
        const username = game.users.get(data.userId).name;
        const status = data.ready
            ? game.i18n.localize("READYCHECK.StatusReady")
            : game.i18n.localize("READYCHECK.StatusNotReady");
        const content = `${username} ${game.i18n.localize(
            "READYCHECK.ChatTextUserUpdate"
        )} ${status}`;
        ChatMessage.create({
            speaker: { alias: "Ready Set Go!" },
            content: content,
        });
    }
}

// PLAY SOUND EFFECT ASSOCIATED WITH READY CHECK START
function playReadyCheckAlert() {
    const playAlert = game.settings.get("ready-check", "playAlertForCheck");
    const alertSound = game.settings.get("ready-check", "checkAlertSoundPath");
    const audioHelper = foundry?.audio?.AudioHelper ?? AudioHelper;
    
    if (playAlert && !alertSound) {
        audioHelper.play(
            {
                src: "modules/ready-check/sounds/notification.mp3",
                volume: 1,
                autoplay: true,
                loop: false,
            },
            true
        );
    } else if (playAlert && alertSound) {
        audioHelper.play(
            { src: alertSound, volume: 1, autoplay: true, loop: false },
            true
        );
    }
}

// UPDATE PLAYER UI
async function updatePlayersWindow() {
    for (let i = 0; i < game.users.contents.length; i++) {
        const ready = await game.users.contents[i].getFlag(
            "ready-check",
            "isReady"
        );
        const userId = game.users.contents[i].id;
        const indicator = $("#players").find(
            `[data-user-id="${userId}"] .crash-ready-indicator`
        );
        let title, classToAdd, classToRemove, iconClassToAdd, iconClassToRemove;

        // This makes the icon aligned with the icon in the players-active container. For v13
        $("#players-inactive").removeClass("scrollable");

        if (ready) {
            title = game.i18n.localize("READYCHECK.PlayerReady");
            classToAdd = "ready";
            classToRemove = "not-ready";
            iconClassToAdd = "fa-check";
            iconClassToRemove = "fa-times";
        } else {
            title = game.i18n.localize("READYCHECK.PlayerNotReady");
            classToAdd = "not-ready";
            classToRemove = "ready";
            iconClassToAdd = "fa-times";
            iconClassToRemove = "fa-check";
        }

        if (indicator && indicator.length > 0) {
            $(indicator).removeClass(iconClassToRemove);
            $(indicator).removeClass(classToRemove);
            $(indicator).addClass(classToAdd);
            $(indicator).addClass(iconClassToAdd);
        } else {
            $("#players")
                .find(`[data-user-id="${userId}"]`)
                .append(
                    `<i class="fas ${iconClassToAdd} crash-ready-indicator ${classToAdd}" title="${title}"></i>`
                );
        }
    }
}
