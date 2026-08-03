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

    // Register the socket handler exactly once. Registering it from a render hook
    // would add a new listener on every chat re-render (popout/collapse), causing
    // a single socket message to be processed multiple times.
    createSocketHandler();
});

// V14+: `renderChatInput` is the dedicated hook that hands us the `#chat-controls`
// element directly, and it re-fires whenever the controls are re-parented (sidebar
// popout/collapse), so our button is re-injected instead of being lost.
Hooks.on("renderChatInput", function (app, elements) {
    const chatControls = elements?.["#chat-controls"] ?? document.querySelector("#chat-controls");
    if (chatControls) injectButton(chatControls);
});

// V13 fallback: the chat controls there live inside the chat log render, and
// `renderChatInput` is not emitted. `html` may be a jQuery object or HTMLElement.
Hooks.on("renderChatLog", function (app, html) {
    const root = html?.[0] ?? html ?? document;
    const chatControls = root.querySelector?.("#chat-controls") ?? document.querySelector("#chat-controls");
    if (chatControls) injectButton(chatControls);
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
//
// Build the button from scratch to match the native Foundry chat control markup
// rather than cloning a system control. In V14 the chat controls are plain
// <button class="ui-control icon fa-solid ..."> elements grouped inside
// #roll-privacy (the dice-visibility split-button) and #chat-controls. We mirror
// that markup so styling, theming, and tooltips come "for free" from core CSS.
function injectButton(chatControls) {
    if (chatControls.querySelector(".crash-ready-check-sidebar")) return;

    const btnTitle = game.user.isGM
        ? game.i18n.localize("READYCHECK.UiGmButton")
        : game.i18n.localize("READYCHECK.UiChangeButton");

    // Prefer to sit alongside the dice-visibility controls; fall back to the
    // controls bar itself (e.g. V13, or systems that restructure the privacy group).
    const rollPrivacy = chatControls.querySelector("#roll-privacy");
    const container = rollPrivacy ?? chatControls;

    // Copy a sibling control's classes so we inherit whatever the running Foundry
    // version uses (V14: "ui-control icon", older builds may differ). When there's
    // no sibling to copy, synthesize the V14 defaults.
    const sibling = container.querySelector("button.ui-control, .chat-control-icon, button");
    const baseClasses = sibling ? sibling.className : "ui-control icon fa-solid";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${baseClasses} crash-ready-check-sidebar`;
    // Strip any roll-mode/active state inherited from the sibling's class list,
    // then ensure our icon is present (replacing the sibling's icon if copied).
    btn.classList.remove("active", "selected");
    for (const cls of [...btn.classList]) {
        if (cls.startsWith("fa-") && cls !== "fa-solid") btn.classList.remove(cls);
    }
    btn.classList.add("fa-solid", "fa-hourglass-half");
    btn.removeAttribute("data-roll-mode");
    btn.removeAttribute("aria-pressed");
    // Empty data-tooltip + aria-label is the native pattern for the hover tooltip.
    btn.setAttribute("data-tooltip", "");
    btn.setAttribute("aria-label", btnTitle);

    btn.addEventListener("click", (event) => {
        event.preventDefault();
        // Drop focus so the button doesn't keep a pressed/focused look after click.
        event.currentTarget?.blur();
        if (game.user.isGM) displayGmDialog();
        else displayStatusUpdateDialog();
    });

    container.prepend(btn);
}

// CREATE THE SOCKET HANDLER
// Called once from the init hook. Removes any prior handler first so it stays
// idempotent even if invoked again, preventing duplicate message processing.
function createSocketHandler() {
    game.socket.off("module.ready-check");
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
        // Guard against a stale or malformed userId from another client; an
        // unknown id would otherwise throw on setFlag and break the handler.
        const userToUpdate = game.users.get(data.userId);
        if (!userToUpdate) return;
        await userToUpdate.setFlag("ready-check", "isReady", data.ready);
        ui.players.render(true);
        sendPlayerRenderSocketMessage();
    }
}

// DISPLAY A CHAT MESSAGE WHEN A USER RESPONDS TO A READY CHECK
function displayReadyCheckChatMessage(data) {
    if (game.settings.get("ready-check", "showChatMessagesForChecks")) {
        const user = game.users.get(data.userId);
        if (!user) return;
        const username = user.name;
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
        const user = game.users.get(data.userId);
        if (!user) return;
        const username = user.name;
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
    // This makes the icon aligned with the icon in the players-active container. For v13.
    // Hoisted out of the per-user loop since it's a single global DOM effect.
    $("#players-inactive").removeClass("scrollable");

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
