function escapeHtml(value) {
    if (globalThis.foundry?.utils?.escapeHTML) {
        return globalThis.foundry.utils.escapeHTML(String(value ?? ""));
    }
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    }[ch]));
}

function getDialogClasses(...extra) {
    const classes = [];
    if (typeof game !== "undefined" && game.system?.id === "ose") {
        classes.push("ose");
    }
    classes.push("dialog", "ready-check-dialog", ...extra);
    return classes;
}

// Register Game Settings
if (typeof Hooks !== "undefined") {
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
    Hooks.on("renderPlayers", function (app, html) {
        updatePlayersWindow(html);
    });
}

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
    if (!game.user.isGM) return;

    const users = game.users?.contents ?? [];
    if (users.length > 0) {
        const UserClass = globalThis.User ?? foundry?.documents?.User;
        if (typeof UserClass?.updateDocuments === "function") {
            await UserClass.updateDocuments(
                users.map((u) => ({
                    _id: u.id,
                    "flags.ready-check.isReady": false,
                }))
            );
        } else {
            await Promise.all(
                users.map((u) => u.setFlag("ready-check", "isReady", false))
            );
        }
    }

    if (ui?.players?.render) {
        ui.players.render({ force: true });
    } else {
        updatePlayersWindow();
    }
    sendPlayerRenderSocketMessage();
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
    btn.setAttribute("data-tooltip", btnTitle);
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
            await processReadyResponse(data);
        } else if (
            data.action === "player-render" &&
            game.user.id !== data.userId
        ) {
            updatePlayersWindow();
        }
    });
}

/**
 * Checks to see if a dialog already exists with the supplied title.
 * @param {string} title the title to check for (exact match).
 * @returns true if there is a dialog with a matching title, otherwise false.
 */
function isDialogShowing(title) {
    if (globalThis.foundry?.applications?.instances) {
        for (const app of foundry.applications.instances.values()) {
            if (app.rendered && (app.title === title || app.options?.window?.title === title)) {
                return true;
            }
        }
    }
    if (globalThis.ui?.windows) {
        for (const app of Object.values(ui.windows)) {
            if (app?.rendered && app.title === title) return true;
        }
    }
    if (typeof document !== "undefined") {
        for (const el of document.querySelectorAll(".window-title")) {
            if (el.textContent?.trim() === title) return true;
        }
    }
    return false;
}

// DISPLAY DIALOG ASKING GM WHAT THEY WANT TO DO
function displayGmDialog() {
    const title = game.i18n.localize("READYCHECK.GmDialogTitle");
    if (isDialogShowing(title)) {
        return;
    }

    const classes = getDialogClasses("ready-check-stacked-dialog");
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (DialogV2) {
        new DialogV2({
            window: { title: title },
            content: `<p>${game.i18n.localize("READYCHECK.GmDialogContent")}</p>`,
            classes,
            position: { width: 360, height: "auto" },
            buttons: [
                {
                    action: "check",
                    icon: "fas fa-check",
                    label: game.i18n.localize("READYCHECK.GmDialogButtonCheck"),
                    default: true,
                    callback: () => initReadyCheck(),
                },
                {
                    action: "status",
                    icon: "fas fa-hourglass-half",
                    label: game.i18n.localize("READYCHECK.GmDialogButtonStatus"),
                    callback: () => displayStatusUpdateDialog(),
                },
                {
                    action: "clear",
                    icon: "fas fa-broom",
                    label: game.i18n.localize("READYCHECK.GmDialogButtonClear"),
                    callback: () => setAllToNotReady(),
                },
            ],
        }).render({ force: true });
    } else {
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
            width: 360,
            classes,
        }).render(true);
    }
}

// INITIATE A READY CHECK (GM)
async function initReadyCheck() {
    if (game.user.isGM) {
        const data = { action: "check" };
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
    const classes = getDialogClasses();
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (DialogV2) {
        new DialogV2({
            window: { title: title },
            content: `<p>${game.i18n.localize("READYCHECK.DialogContentStatusUpdate")}</p>`,
            classes,
            position: { width: 360, height: "auto" },
            buttons: [
                {
                    action: "yes",
                    icon: "fas fa-check",
                    label: game.i18n.localize("READYCHECK.StatusReady"),
                    default: true,
                    callback: () => {
                        data.ready = true;
                        updateReadyStatus(data);
                        displayStatusUpdateChatMessage(data);
                    },
                },
                {
                    action: "no",
                    icon: "fas fa-times",
                    label: game.i18n.localize("READYCHECK.StatusNotReady"),
                    callback: () => {
                        data.ready = false;
                        updateReadyStatus(data);
                        displayStatusUpdateChatMessage(data);
                    },
                },
            ],
        }).render({ force: true });
    } else {
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
        }, {
            width: 360,
            classes,
        }).render(true);
    }
}

// DISPLAY READY CHECK DIALOG AND SEND RESPONSE TO GM (PLAYER)
function displayReadyCheckDialog() {
    const title = game.i18n.localize("READYCHECK.DialogTitleReadyCheck");
    if (isDialogShowing(title)) {
        return;
    }

    const data = { action: "update", ready: false, userId: game.user.id };
    const classes = getDialogClasses();
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (DialogV2) {
        new DialogV2({
            window: { title: title },
            content: `<p>${game.i18n.localize("READYCHECK.DialogContentReadyCheck")}</p>`,
            classes,
            position: { width: 360, height: "auto" },
            buttons: [
                {
                    action: "yes",
                    icon: "fas fa-check",
                    label: game.i18n.localize("READYCHECK.StatusReady"),
                    default: true,
                    callback: async () => {
                        data.ready = true;
                        await updateReadyStatus(data);
                        displayReadyCheckChatMessage(data);
                    },
                },
            ],
        }).render({ force: true });
    } else {
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
        }, {
            width: 360,
            classes,
        }).render(true);
    }
}

// UPDATE USER READY STATUS
//  If the user is a GM, just update it since the socket doesn't echo to the sender, and none of the recipients (players)
//  will have the permissions required to update user flags. If the user is not a GM, emit that socket.
async function updateReadyStatus(data) {
    if (game.user.isGM) {
        await processReadyResponse(data);
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
        ui.players?.render({ force: true });
        sendPlayerRenderSocketMessage();
    }
}

// DISPLAY A CHAT MESSAGE WHEN A USER RESPONDS TO A READY CHECK
function displayReadyCheckChatMessage(data) {
    if (game.settings.get("ready-check", "showChatMessagesForChecks")) {
        const user = game.users.get(data.userId);
        if (!user) return;
        const username = escapeHtml(user.name);
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
        const username = escapeHtml(user.name);
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
    const audioHelper = globalThis.foundry?.audio?.AudioHelper ?? globalThis.AudioHelper;

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

// UPDATE PLAYER UI (synchronous to prevent concurrent DOM interleaving/duplicates)
function updatePlayersWindow(html) {
    const passedRoot = html?.[0] ?? html ?? null;
    const playersRoot =
        (passedRoot?.id === "players" ? passedRoot : passedRoot?.querySelector?.("#players")) ??
        passedRoot ??
        (typeof document !== "undefined" ? document.getElementById("players") : null);
    if (!playersRoot) return;

    // Keep icon aligned with the icon in the players-active container (V13 compatibility).
    const inactive =
        playersRoot.querySelector?.("#players-inactive") ??
        (typeof document !== "undefined" ? document.getElementById("players-inactive") : null);
    inactive?.classList?.remove("scrollable");

    const users = game.users?.contents ?? [];
    for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const ready = Boolean(user.getFlag("ready-check", "isReady"));
        const userId = user.id;
        const playerRow = playersRoot.querySelector?.(`[data-user-id="${userId}"]`);
        if (!playerRow) continue;

        const title = ready
            ? game.i18n.localize("READYCHECK.PlayerReady")
            : game.i18n.localize("READYCHECK.PlayerNotReady");
        const classToAdd = ready ? "ready" : "not-ready";
        const classToRemove = ready ? "not-ready" : "ready";
        const iconClassToAdd = ready ? "fa-check" : "fa-times";
        const iconClassToRemove = ready ? "fa-times" : "fa-check";

        const indicators = playerRow.querySelectorAll(".crash-ready-indicator");
        if (indicators.length > 0) {
            // Clean up any stale duplicates if present, keeping the first element.
            for (let j = 1; j < indicators.length; j++) {
                indicators[j].remove();
            }
            const indicator = indicators[0];
            indicator.classList.remove(iconClassToRemove, classToRemove);
            indicator.classList.add(classToAdd, iconClassToAdd);
            indicator.removeAttribute("title");
            indicator.setAttribute("data-tooltip", title);
            indicator.setAttribute("aria-label", title);
        } else {
            const icon = playerRow.ownerDocument.createElement("i");
            icon.className = `fas ${iconClassToAdd} crash-ready-indicator ${classToAdd}`;
            icon.setAttribute("data-tooltip", title);
            icon.setAttribute("aria-label", title);
            playerRow.appendChild(icon);
        }
    }
}

export {
    escapeHtml,
    getDialogClasses,
    setAllToNotReady,
    injectButton,
    isDialogShowing,
    displayGmDialog,
    displayStatusUpdateDialog,
    displayReadyCheckDialog,
    processReadyResponse,
    displayReadyCheckChatMessage,
    displayStatusUpdateChatMessage,
    updatePlayersWindow,
};
